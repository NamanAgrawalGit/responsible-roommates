-- Responsible Roommates: manual database fixes, now in version control
-- Apply AFTER schema_update_rooms.sql. Safe to rerun.
--
-- These two fixes were originally applied by hand in the Supabase SQL
-- Editor. This file records them so a fresh database can be rebuilt from
-- the repository. It does not delete any rows.

-- -------------------------------------------------------------------
-- 1. Room SELECT policy: members OR the room's creator can see the room.
-- Replaces the original "view own rooms" policy from schema.sql, which
-- only allowed active members.
-- -------------------------------------------------------------------
drop policy if exists "view own rooms" on public.rooms;

create policy "view own rooms" on public.rooms
  for select using (public.is_room_member(id) or created_by = auth.uid());

-- -------------------------------------------------------------------
-- 2. Backfill missing profiles rows from auth.users.
-- Anyone who signed up without getting a profiles row gets one, using
-- the same name rule as handle_new_user() in schema.sql (the name from
-- sign-up, or the part of the email before the @). Existing profiles
-- are never changed.
-- -------------------------------------------------------------------
insert into public.profiles (id, name, email)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'name', ''), nullif(split_part(u.email, '@', 1), ''), 'Roommate'),
  coalesce(u.email, '')
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;