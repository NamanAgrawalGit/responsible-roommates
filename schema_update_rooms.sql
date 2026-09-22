-- ============================================================
-- Responsible Roommates — Rooms Migration
-- Run this AFTER schema.sql, in the Supabase SQL Editor.
-- Adds invite codes to rooms, and the logic needed to safely
-- create a room (auto-join the creator as owner) and join a
-- room by code (without needing to already be a member to look
-- up the room, which plain RLS on `rooms` would otherwise block).
-- ============================================================

-- ------------------------------------------------------------
-- Invite codes
-- ------------------------------------------------------------
create or replace function public.generate_room_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no easily-confused O/0/I/1
  result text := '';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

alter table public.rooms add column if not exists invite_code text unique;
alter table public.rooms alter column invite_code set default public.generate_room_code();

-- ------------------------------------------------------------
-- Auto-add the creator of a room as its owner in room_members.
-- Runs automatically whenever a new row is inserted into rooms.
-- ------------------------------------------------------------
create or replace function public.handle_new_room()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.room_members (room_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

drop trigger if exists on_room_created on public.rooms;
create trigger on_room_created
  after insert on public.rooms
  for each row execute function public.handle_new_room();

-- ------------------------------------------------------------
-- Join a room by its invite code.
-- This is a SECURITY DEFINER function: it's allowed to look up
-- a room by code even though the caller isn't a member yet
-- (normal RLS on `rooms` would otherwise block that lookup).
-- It only ever inserts a room_members row for the CALLING user,
-- so it can't be used to add anyone else or read other room data.
-- ------------------------------------------------------------
create or replace function public.join_room_by_code(invite_code_input text)
returns table (id uuid, name text)
language plpgsql
security definer
as $$
declare
  target_room record;
begin
  select r.id, r.name into target_room
  from public.rooms r
  where r.invite_code = upper(invite_code_input)
    and r.status = 'active';

  if target_room.id is null then
    raise exception 'That room code was not found.';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (target_room.id, auth.uid(), 'roommate')
  on conflict (room_id, user_id) do update set is_active = true, left_at = null;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (target_room.id, auth.uid(), 'roommate_joined', 'A roommate joined the room', 'room_member', auth.uid());

  return query select target_room.id, target_room.name;
end;
$$;

grant execute on function public.join_room_by_code(text) to authenticated;
