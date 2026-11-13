-- Responsible Roommates: room lifecycle foundation (Move-In, slice 1)
-- Apply AFTER schema_update_recurring_chores.sql (last in the run order).
-- Safe to rerun.
--
-- What this does
--   1. Rooms get a lifecycle state: setup -> active -> moving_out -> closed.
--      The columns status, move_in_date and move_out_date already exist on
--      rooms; this adds closed_at and a check on the allowed states.
--      The old state 'archived' becomes 'closed'. Existing rooms stay 'active'.
--   2. room_setup stores wizard progress (which steps are done, last step).
--   3. All room-state changes go through validated functions. The direct
--      UPDATE policy on rooms is removed, so a client can no longer change a
--      room's status (or anything else) with a plain update.
--   4. join_room_by_code accepts rooms in 'setup' as well as 'active', so the
--      owner can invite roommates while configuring the room.
--
-- Nothing in the current front end changes behavior: new rooms still default
-- to 'active' until the setup wizard (slice 2) switches creation over to
-- create_room().

-- -------------------------------------------------------------------
-- 1. Lifecycle state on rooms
-- -------------------------------------------------------------------
alter table public.rooms add column if not exists closed_at timestamptz;

update public.rooms
set status = 'closed',
    closed_at = coalesce(closed_at, now())
where status = 'archived';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_status_check'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_status_check
      check (status in ('setup', 'active', 'moving_out', 'closed'));
  end if;
end;
$$;

comment on column public.rooms.status is
  'Lifecycle: setup | active | moving_out | closed. Changed only by database functions.';

-- -------------------------------------------------------------------
-- 2. Wizard progress
-- One row per room that went through setup. Rooms that existed before this
-- migration have no row and do not need one.
-- -------------------------------------------------------------------
create table if not exists public.room_setup (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  completed_steps text[] not null default '{}',
  last_step text,
  updated_at timestamptz not null default now()
);

alter table public.room_setup enable row level security;

drop policy if exists "view room setup" on public.room_setup;
create policy "view room setup" on public.room_setup
  for select using (public.is_room_member(room_id));
-- No insert, update or delete policies: writes happen only in the functions below.

-- -------------------------------------------------------------------
-- 3. Remove the direct UPDATE path on rooms
-- The "owner updates room" policy let a creator change any column,
-- including status, from the client. Updates now go through functions.
-- -------------------------------------------------------------------
drop policy if exists "owner updates room" on public.rooms;

-- -------------------------------------------------------------------
-- 4. create_room: new rooms start in 'setup'
-- The existing on_room_created trigger adds the caller as owner.
-- Not used by the front end until slice 2.
-- -------------------------------------------------------------------
create or replace function public.create_room(
  name_input text,
  address_input text default null,
  move_in_date_input date default null
)
returns table (room_id uuid, room_name text, room_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  clean_name text := trim(coalesce(name_input, ''));
  clean_address text := nullif(trim(coalesce(address_input, '')), '');
  new_room public.rooms%rowtype;
begin
  if caller_id is null then
    raise exception 'You must be signed in to create a room.';
  end if;

  if clean_name = '' then
    raise exception 'Room name is required.';
  end if;

  if length(clean_name) > 100 then
    raise exception 'Room name must be 100 characters or fewer.';
  end if;

  if not exists (select 1 from public.profiles p where p.id = caller_id) then
    raise exception 'Your profile was not found. Sign out and sign in again.';
  end if;

  insert into public.rooms (name, address, move_in_date, status, created_by)
  values (clean_name, clean_address, move_in_date_input, 'setup', caller_id)
  returning * into new_room;

  insert into public.room_setup (room_id) values (new_room.id);

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (new_room.id, caller_id, 'room_created', 'Room created', 'room', new_room.id);

  return query select new_room.id, new_room.name, new_room.status;
end;
$$;

-- -------------------------------------------------------------------
-- 5. save_setup_progress: remember where the owner is in the wizard
-- Optionally marks the step as completed. Returns the completed steps.
-- -------------------------------------------------------------------
create or replace function public.save_setup_progress(
  room_id_input uuid,
  step_input text,
  mark_complete boolean default false
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  result_steps text[];
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not public.is_room_owner(room_id_input) then
    raise exception 'Only a room owner can change room setup.';
  end if;

  if step_input is null
     or step_input not in ('basics', 'invite', 'items', 'chores', 'payments', 'review') then
    raise exception 'Unknown setup step.';
  end if;

  select r.status into current_status
  from public.rooms r
  where r.id = room_id_input
  for update;

  if current_status <> 'setup' then
    raise exception 'This room is not in setup.';
  end if;

  insert into public.room_setup as rs (room_id, completed_steps, last_step, updated_at)
  values (
    room_id_input,
    case when coalesce(mark_complete, false) then array[step_input] else '{}'::text[] end,
    step_input,
    now()
  )
  on conflict (room_id) do update
    set last_step = excluded.last_step,
        updated_at = now(),
        completed_steps =
          case
            when coalesce(mark_complete, false) and not (step_input = any (rs.completed_steps))
              then array_append(rs.completed_steps, step_input)
            else rs.completed_steps
          end
  returning rs.completed_steps into result_steps;

  return result_steps;
end;
$$;

-- -------------------------------------------------------------------
-- 6. update_room_basics: name, address and move-in date
-- Allowed while the room is in 'setup' or 'active'.
-- -------------------------------------------------------------------
create or replace function public.update_room_basics(
  room_id_input uuid,
  name_input text,
  address_input text default null,
  move_in_date_input date default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := trim(coalesce(name_input, ''));
  clean_address text := nullif(trim(coalesce(address_input, '')), '');
  current_status text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not public.is_room_owner(room_id_input) then
    raise exception 'Only a room owner can change room details.';
  end if;

  if clean_name = '' then
    raise exception 'Room name is required.';
  end if;

  if length(clean_name) > 100 then
    raise exception 'Room name must be 100 characters or fewer.';
  end if;

  select r.status into current_status
  from public.rooms r
  where r.id = room_id_input
  for update;

  if current_status not in ('setup', 'active') then
    raise exception 'Room details cannot be changed in this state.';
  end if;

  update public.rooms
  set name = clean_name,
      address = clean_address,
      move_in_date = move_in_date_input
  where id = room_id_input;
end;
$$;

-- -------------------------------------------------------------------
-- 7. finish_setup: setup -> active
-- Idempotent: calling it on a room that is already active changes nothing
-- and returns 'active' (a double tap on the button is harmless).
-- -------------------------------------------------------------------
create or replace function public.finish_setup(room_id_input uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  current_status text;
begin
  if caller_id is null then
    raise exception 'You must be signed in.';
  end if;

  if not public.is_room_owner(room_id_input) then
    raise exception 'Only a room owner can finish room setup.';
  end if;

  select r.status into current_status
  from public.rooms r
  where r.id = room_id_input
  for update;

  if current_status = 'active' then
    return 'active';
  end if;

  if current_status <> 'setup' then
    raise exception 'This room is not in setup.';
  end if;

  update public.rooms set status = 'active' where id = room_id_input;

  update public.room_setup
  set last_step = 'review',
      completed_steps = case
        when 'review' = any (completed_steps) then completed_steps
        else array_append(completed_steps, 'review')
      end,
      updated_at = now()
  where room_id = room_id_input;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (room_id_input, caller_id, 'room_setup_finished', 'Room setup finished', 'room', room_id_input);

  return 'active';
end;
$$;

-- -------------------------------------------------------------------
-- 8. Function permissions
-- -------------------------------------------------------------------
revoke all on function public.create_room(text, text, date) from public;
revoke all on function public.save_setup_progress(uuid, text, boolean) from public;
revoke all on function public.update_room_basics(uuid, text, text, date) from public;
revoke all on function public.finish_setup(uuid) from public;

grant execute on function public.create_room(text, text, date) to authenticated;
grant execute on function public.save_setup_progress(uuid, text, boolean) to authenticated;
grant execute on function public.update_room_basics(uuid, text, text, date) to authenticated;
grant execute on function public.finish_setup(uuid) to authenticated;

-- -------------------------------------------------------------------
-- 9. join_room_by_code: allow joining while a room is in setup
-- Identical to the version in schema_update_join_requests.sql except that
-- the room lookup accepts status 'setup' as well as 'active'. Rooms that are
-- moving out or closed still cannot be joined.
-- Same signature and return type, so CREATE OR REPLACE is enough.
-- -------------------------------------------------------------------
create or replace function public.join_room_by_code(invite_code_input text)
returns table (id uuid, name text, already_member boolean, request_pending boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room record;
  caller_id uuid := auth.uid();
  caller_name text;
  new_request_id uuid;
  owner_row record;
begin
  if caller_id is null then
    raise exception 'You must be signed in to join a room.';
  end if;

  if invite_code_input is null or length(trim(invite_code_input)) = 0 then
    raise exception 'Enter a room invite code.';
  end if;

  select r.id as room_id, r.name as room_name into target_room
  from public.rooms r
  where r.invite_code = upper(trim(invite_code_input))
    and r.status in ('setup', 'active');

  if target_room.room_id is null then
    raise exception 'That room code was not found.';
  end if;

  -- Already an active member: report it and change nothing.
  if exists (
    select 1 from public.room_members rm
    where rm.room_id = target_room.room_id
      and rm.user_id = caller_id
      and rm.is_active = true
  ) then
    return query select target_room.room_id, target_room.room_name, true, false;
    return;
  end if;

  -- Create the request. If one is already pending, do nothing (no duplicate
  -- request and no duplicate notification to the owner).
  insert into public.room_join_requests as jr (room_id, user_id, status)
  values (target_room.room_id, caller_id, 'pending')
  on conflict (room_id, user_id) where status = 'pending' do nothing
  returning jr.id into new_request_id;

  if new_request_id is not null then
    select coalesce(nullif(trim(pr.name), ''), 'Someone') into caller_name
    from public.profiles pr
    where pr.id = caller_id;
    caller_name := coalesce(caller_name, 'Someone');

    for owner_row in
      select rm.user_id as owner_id
      from public.room_members rm
      where rm.room_id = target_room.room_id
        and rm.role = 'owner'
        and rm.is_active = true
    loop
      perform public.notify_user(
        owner_row.owner_id,
        target_room.room_id,
        'join_request',
        caller_name || ' wants to join ' || target_room.room_name || '.',
        'join_request',
        new_request_id
      );
    end loop;
  end if;

  return query select target_room.room_id, target_room.room_name, false, true;
end;
$$;

revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;