-- Responsible Roommates: "already a member" handling for join_room_by_code
-- Apply AFTER schema_update_security_payments.sql. Safe to rerun.
--
-- Changes:
--   * join_room_by_code now returns a third column, already_member.
--     If the caller is already an ACTIVE member of the room, nothing is
--     written (no membership change, no duplicate history row) and
--     already_member = true.
--   * Everything else (invalid code, signed-in check, re-activating a
--     member who previously left) behaves as before. The re-activation
--     case will be replaced by the owner-approval flow later.
--
-- The return type changes, so the old function must be dropped first
-- (CREATE OR REPLACE cannot change a function's return columns).

drop function if exists public.join_room_by_code(text);

create function public.join_room_by_code(invite_code_input text)
returns table (id uuid, name text, already_member boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room record;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'You must be signed in to join a room.';
  end if;

  if invite_code_input is null or length(trim(invite_code_input)) = 0 then
    raise exception 'Enter a room invite code.';
  end if;

  select r.id, r.name into target_room
  from public.rooms r
  where r.invite_code = upper(trim(invite_code_input))
    and r.status = 'active';

  if target_room.id is null then
    raise exception 'That room code was not found.';
  end if;

  -- Already an active member: report it and change nothing.
  if exists (
    select 1 from public.room_members rm
    where rm.room_id = target_room.id
      and rm.user_id = caller_id
      and rm.is_active = true
  ) then
    return query select target_room.id, target_room.name, true;
    return;
  end if;

  insert into public.room_members (room_id, user_id, role, is_active, left_at)
  values (target_room.id, caller_id, 'roommate', true, null)
  on conflict (room_id, user_id) do update
    set is_active = true, left_at = null;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (target_room.id, caller_id, 'roommate_joined', 'A roommate joined the room', 'room_member', caller_id);

  return query select target_room.id, target_room.name, false;
end;
$$;

revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;

-- ------------------------------------------------------------------
-- OPTIONAL one-time cleanup of duplicate 'roommate_joined' history rows
-- created by earlier re-joins. Run the SELECT first and review it.
-- Keeps the earliest row per (room, user).
-- ------------------------------------------------------------------
-- select id, room_id, actor_id, created_at
-- from public.history
-- where action = 'roommate_joined'
--   and id not in (
--     select distinct on (room_id, actor_id) id
--     from public.history
--     where action = 'roommate_joined'
--     order by room_id, actor_id, created_at
--   );
--
-- To delete exactly those rows, uncomment:
-- delete from public.history
-- where action = 'roommate_joined'
--   and id not in (
--     select distinct on (room_id, actor_id) id
--     from public.history
--     where action = 'roommate_joined'
--     order by room_id, actor_id, created_at
--   );
