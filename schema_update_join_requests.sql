-- Responsible Roommates: owner-approved room joining
-- Apply AFTER schema_update_payment_notifications.sql. Safe to rerun.
--
-- New behavior:
--   * Entering a valid invite code no longer adds you to the room. It
--     creates a PENDING join request and notifies the room's owner(s).
--   * The owner approves or denies the request (Notifications tab).
--     Approval is what creates the room_members row.
--   * Nobody can insert into room_members or room_join_requests directly;
--     everything goes through the validated functions below.
--
-- join_room_by_code's return type changes (adds request_pending), so it is
-- dropped and recreated.

-- ------------------------------------------------------------------
-- 1. Table + RLS
-- ------------------------------------------------------------------
create table if not exists public.room_join_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);

-- A person can have at most one open request per room.
create unique index if not exists room_join_requests_one_pending
  on public.room_join_requests (room_id, user_id)
  where status = 'pending';

create index if not exists room_join_requests_room_status_idx
  on public.room_join_requests (room_id, status);

alter table public.room_join_requests enable row level security;

-- ------------------------------------------------------------------
-- 2. Helper: is the caller an active owner of this room?
-- (SECURITY DEFINER so it can be used inside RLS policies without
-- recursing into room_members' own policies.)
-- ------------------------------------------------------------------
create or replace function public.is_room_owner(room_id_input uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = room_id_input
      and rm.user_id = auth.uid()
      and rm.role = 'owner'
      and rm.is_active = true
  );
$$;

revoke all on function public.is_room_owner(uuid) from public;
grant execute on function public.is_room_owner(uuid) to authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'room_join_requests'
  loop
    execute format('drop policy %I on public.room_join_requests', policy_row.policyname);
  end loop;
end;
$$;

-- You can read your own requests; owners can read requests for their rooms.
create policy "view relevant join requests" on public.room_join_requests
  for select using (user_id = auth.uid() or public.is_room_owner(room_id));

revoke insert, update, delete on public.room_join_requests from anon, authenticated;

-- ------------------------------------------------------------------
-- 3. join_room_by_code: request to join instead of joining
-- ------------------------------------------------------------------
drop function if exists public.join_room_by_code(text);

create function public.join_room_by_code(invite_code_input text)
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
    and r.status = 'active';

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

-- ------------------------------------------------------------------
-- 4. Owner decisions
-- ------------------------------------------------------------------
create or replace function public.approve_join_request(request_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  req public.room_join_requests%rowtype;
begin
  if caller_id is null then
    raise exception 'You must be signed in.';
  end if;

  select * into req
  from public.room_join_requests jr
  where jr.id = request_id_input
  for update;

  if not found then
    raise exception 'Join request not found.';
  end if;
  if not public.is_room_owner(req.room_id) then
    raise exception 'Only the room owner can approve join requests.';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  insert into public.room_members (room_id, user_id, role, is_active, left_at)
  values (req.room_id, req.user_id, 'roommate', true, null)
  on conflict (room_id, user_id) do update
    set is_active = true, left_at = null;

  update public.room_join_requests
  set status = 'approved', decided_at = now(), decided_by = caller_id
  where id = req.id;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (req.room_id, req.user_id, 'roommate_joined', 'A roommate joined the room', 'room_member', req.user_id);
end;
$$;

create or replace function public.deny_join_request(request_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  req public.room_join_requests%rowtype;
begin
  if caller_id is null then
    raise exception 'You must be signed in.';
  end if;

  select * into req
  from public.room_join_requests jr
  where jr.id = request_id_input
  for update;

  if not found then
    raise exception 'Join request not found.';
  end if;
  if not public.is_room_owner(req.room_id) then
    raise exception 'Only the room owner can deny join requests.';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  update public.room_join_requests
  set status = 'denied', decided_at = now(), decided_by = caller_id
  where id = req.id;
end;
$$;

revoke all on function public.approve_join_request(uuid) from public;
revoke all on function public.deny_join_request(uuid) from public;
grant execute on function public.approve_join_request(uuid) to authenticated;
grant execute on function public.deny_join_request(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 5. The requester's own view: rooms they've asked to join.
-- A requester can't read the rooms table (they aren't a member), so this
-- function returns just the room name and request status. Pending requests
-- always show; denied ones show for 7 days; approved ones turn into a
-- normal room membership.
-- ------------------------------------------------------------------
create or replace function public.my_join_requests()
returns table (request_id uuid, room_name text, request_status text, requested_at timestamptz)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select jr.id, r.name, jr.status, jr.created_at
  from public.room_join_requests jr
  join public.rooms r on r.id = jr.room_id
  where jr.user_id = auth.uid()
    and (
      jr.status = 'pending'
      or (jr.status = 'denied' and jr.decided_at > now() - interval '7 days')
    )
  order by jr.created_at desc
  limit 10;
$$;

revoke all on function public.my_join_requests() from public;
grant execute on function public.my_join_requests() to authenticated;