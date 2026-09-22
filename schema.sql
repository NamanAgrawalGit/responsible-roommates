-- ============================================================
-- Responsible Roommates — MVP Database Schema
-- Run this in the Supabase SQL Editor (SQL Editor > New Query)
-- ============================================================

-- ------------------------------------------------------------
-- USERS
-- Supabase already creates an auth.users table for login.
-- This "profiles" table stores the extra info we want per user,
-- linked 1-to-1 with auth.users.
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ROOMS
-- ------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  move_in_date date,
  move_out_date date,
  status text not null default 'active', -- 'active' | 'archived'
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ROOM MEMBERS
-- Connects a user to a room. A user can belong to many rooms
-- over time (e.g. an old archived apartment + a current one).
-- ------------------------------------------------------------
create table public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'roommate', -- 'owner' | 'roommate'
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_active boolean not null default true,
  unique (room_id, user_id)
);

-- ------------------------------------------------------------
-- EXPENSES
-- ------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null,
  amount numeric(10, 2) not null check (amount > 0),
  paid_by uuid not null references public.profiles(id),
  date date not null default current_date,
  split_method text not null default 'equal', -- 'equal' | 'specific' | 'custom' | 'percentage'
  category text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- EXPENSE SPLITS
-- One row per person who owes part of an expense.
-- Kept separate from "expenses" so custom/percentage splits
-- are simple to store and query.
-- ------------------------------------------------------------
create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_owed numeric(10, 2) not null check (amount_owed >= 0),
  percentage numeric(5, 2),
  payment_status text not null default 'unpaid', -- 'unpaid' | 'paid'
  unique (expense_id, user_id)
);

-- ------------------------------------------------------------
-- PAYMENTS
-- Tracks "who paid whom" records (not real money movement yet).
-- ------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  payer_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  amount numeric(10, 2) not null check (amount > 0),
  date date not null default current_date,
  status text not null default 'pending', -- 'pending' | 'confirmed'
  related_expense_id uuid references public.expenses(id),
  note text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CHORES
-- ------------------------------------------------------------
create table public.chores (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null,
  description text,
  assigned_to uuid references public.profiles(id),
  due_date date,
  due_time time,
  recurrence text default 'none', -- 'none' | 'weekly' | 'biweekly' | 'monthly'
  priority text default 'normal', -- 'low' | 'normal' | 'high'
  status text not null default 'open', -- 'open' | 'completed' | 'overdue'
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id)
);

-- ------------------------------------------------------------
-- MOVE-IN ITEMS
-- ------------------------------------------------------------
create table public.move_in_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null,
  category text,
  cost numeric(10, 2),
  brought_by uuid references public.profiles(id),
  purchased_by uuid references public.profiles(id),
  split_cost boolean not null default false,
  status text not null default 'need_to_buy', -- 'need_to_buy' | 'have_it' | 'planning' | 'purchased' | 'brought' | 'not_needed'
  notes text,
  converted_expense_id uuid references public.expenses(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- HISTORY
-- A simple audit log of important actions in a room.
-- ------------------------------------------------------------
create table public.history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,      -- e.g. 'expense_added', 'chore_completed'
  details text,
  related_type text,         -- 'expense' | 'chore' | 'room_member' | ...
  related_id uuid,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Ensures a user can only see/modify data for rooms they belong to.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.payments enable row level security;
alter table public.chores enable row level security;
alter table public.move_in_items enable row level security;
alter table public.history enable row level security;

-- Helper: is the current user an active member of a given room?
create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.room_members
    where room_id = target_room_id
      and user_id = auth.uid()
      and is_active = true
  );
$$;

-- PROFILES: users can see their own profile, and profiles of people
-- who share a room with them (so names show up in expense/chore lists).
create policy "view own profile" on public.profiles
  for select using (id = auth.uid());

create policy "view roommates profiles" on public.profiles
  for select using (
    exists (
      select 1 from public.room_members rm1
      join public.room_members rm2 on rm1.room_id = rm2.room_id
      where rm1.user_id = auth.uid() and rm2.user_id = profiles.id
    )
  );

create policy "update own profile" on public.profiles
  for update using (id = auth.uid());

create policy "insert own profile" on public.profiles
  for insert with check (id = auth.uid());

-- ROOMS: members can view; only the creator can update/delete initially.
create policy "view own rooms" on public.rooms
  for select using (public.is_room_member(id));

create policy "create rooms" on public.rooms
  for insert with check (created_by = auth.uid());

create policy "owner updates room" on public.rooms
  for update using (created_by = auth.uid());

-- ROOM MEMBERS: visible to other members of the same room.
create policy "view room members" on public.room_members
  for select using (public.is_room_member(room_id));

create policy "join room" on public.room_members
  for insert with check (user_id = auth.uid());

-- EXPENSES / SPLITS / PAYMENTS / CHORES / MOVE-IN / HISTORY:
-- standard "must be a member of the room" pattern.
create policy "view room expenses" on public.expenses
  for select using (public.is_room_member(room_id));
create policy "add room expenses" on public.expenses
  for insert with check (public.is_room_member(room_id) and created_by = auth.uid());
create policy "edit room expenses" on public.expenses
  for update using (public.is_room_member(room_id));

create policy "view expense splits" on public.expense_splits
  for select using (
    exists (select 1 from public.expenses e where e.id = expense_id and public.is_room_member(e.room_id))
  );
create policy "add expense splits" on public.expense_splits
  for insert with check (
    exists (select 1 from public.expenses e where e.id = expense_id and public.is_room_member(e.room_id))
  );

create policy "view room payments" on public.payments
  for select using (public.is_room_member(room_id));
create policy "add room payments" on public.payments
  for insert with check (public.is_room_member(room_id) and payer_id = auth.uid());

create policy "view room chores" on public.chores
  for select using (public.is_room_member(room_id));
create policy "add room chores" on public.chores
  for insert with check (public.is_room_member(room_id) and created_by = auth.uid());
create policy "edit room chores" on public.chores
  for update using (public.is_room_member(room_id));

create policy "view move in items" on public.move_in_items
  for select using (public.is_room_member(room_id));
create policy "add move in items" on public.move_in_items
  for insert with check (public.is_room_member(room_id));
create policy "edit move in items" on public.move_in_items
  for update using (public.is_room_member(room_id));

create policy "view room history" on public.history
  for select using (public.is_room_member(room_id));
create policy "add room history" on public.history
  for insert with check (public.is_room_member(room_id));

-- ============================================================
-- Auto-create a profile row whenever someone signs up
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
