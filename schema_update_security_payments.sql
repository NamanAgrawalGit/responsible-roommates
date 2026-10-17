-- Responsible Roommates: security and repayment repair migration
-- Apply this AFTER schema.sql and schema_update_rooms.sql.
-- Review the live policies first if you have manually created policies in Supabase.
-- This migration does not delete existing room, expense, chore, or payment rows.

-- -------------------------------------------------------------------
-- 1. Room membership must only be created through the invite-code RPC.
-- Room creation still auto-adds its owner through the SECURITY DEFINER trigger.
-- -------------------------------------------------------------------
drop policy if exists "join room" on public.room_members;

do $$
declare
  policy_row record;
begin
  -- Remove any additional INSERT policies on room_members so they cannot
  -- accidentally re-open direct self-joining around the invite-code flow.
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'room_members'
      and cmd in ('INSERT', 'ALL')
  loop
    execute format('drop policy %I on public.room_members', policy_row.policyname);
  end loop;
end;
$$;

-- Recreate a SELECT-only policy in case a previous broad ALL policy existed.
drop policy if exists "view room members" on public.room_members;
create policy "view room members" on public.room_members
  for select using (public.is_room_member(room_id));

create or replace function public.join_room_by_code(invite_code_input text)
returns table (id uuid, name text)
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

  insert into public.room_members (room_id, user_id, role, is_active, left_at)
  values (target_room.id, caller_id, 'roommate', true, null)
  on conflict (room_id, user_id) do update
    set is_active = true, left_at = null;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (target_room.id, caller_id, 'roommate_joined', 'A roommate joined the room', 'room_member', caller_id);

  return query select target_room.id, target_room.name;
end;
$$;

revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;

-- -------------------------------------------------------------------
-- 2. Payments: all inserts and status changes go through controlled RPCs.
-- This prevents users from forging another payer or changing immutable
-- payment fields while confirming.
-- -------------------------------------------------------------------
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'payments'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
  loop
    execute format('drop policy %I on public.payments', policy_row.policyname);
  end loop;
end;
$$;

-- Restore a SELECT-only policy if a broad ALL policy was removed above.
drop policy if exists "view room payments" on public.payments;
create policy "view room payments" on public.payments
  for select using (public.is_room_member(room_id));

-- Keep status values aligned with the app's pending/confirmed/declined flows.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_status_valid'
  ) then
    alter table public.payments
      add constraint payments_status_valid
      check (status in ('pending', 'confirmed', 'declined'));
  end if;
end;
$$;

-- Record a payment the current user says they sent. The payment and
-- history entry are atomic, and the recipient must be an active room member.
create or replace function public.record_outgoing_payment(
  room_id_input uuid,
  recipient_id_input uuid,
  amount_input numeric,
  note_input text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  payment_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if amount_input is null or amount_input <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if recipient_id_input is null or recipient_id_input = caller_id then
    raise exception 'Choose another roommate as the recipient.';
  end if;
  if not public.is_room_member(room_id_input) then
    raise exception 'You are not an active member of this room.';
  end if;
  if not exists (
    select 1 from public.room_members rm
    where rm.room_id = room_id_input
      and rm.user_id = recipient_id_input
      and rm.is_active = true
  ) then
    raise exception 'The recipient must be an active member of this room.';
  end if;

  insert into public.payments (room_id, payer_id, recipient_id, amount, status, note)
  values (room_id_input, caller_id, recipient_id_input, round(amount_input, 2), 'pending', nullif(trim(note_input), ''))
  returning id into payment_id;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (
    room_id_input,
    caller_id,
    'payment_marked_paid',
    'Marked $' || to_char(round(amount_input, 2), 'FM999999990.00') || ' as paid',
    'payment',
    payment_id
  );

  return payment_id;
end;
$$;

-- The recipient can record money received from another active member.
-- The function writes the payment and its history entry atomically.
create or replace function public.record_received_payment(
  room_id_input uuid,
  payer_id_input uuid,
  amount_input numeric,
  note_input text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  payment_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if amount_input is null or amount_input <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if payer_id_input is null or payer_id_input = caller_id then
    raise exception 'Choose another roommate as the payer.';
  end if;
  if not public.is_room_member(room_id_input) then
    raise exception 'You are not an active member of this room.';
  end if;
  if not exists (
    select 1 from public.room_members rm
    where rm.room_id = room_id_input
      and rm.user_id = payer_id_input
      and rm.is_active = true
  ) then
    raise exception 'The payer must be an active member of this room.';
  end if;

  insert into public.payments (room_id, payer_id, recipient_id, amount, status, note)
  values (room_id_input, payer_id_input, caller_id, round(amount_input, 2), 'confirmed', nullif(trim(note_input), ''))
  returning id into payment_id;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (
    room_id_input,
    caller_id,
    'payment_confirmed',
    'Recorded $' || to_char(round(amount_input, 2), 'FM999999990.00') || ' received',
    'payment',
    payment_id
  );

  return payment_id;
end;
$$;

-- Only the payment's recipient may confirm or decline a pending payment.
-- Updating status and writing history happen in the same transaction.
create or replace function public.respond_to_payment(
  payment_id_input uuid,
  new_status_input text,
  reason_input text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  payment_row public.payments%rowtype;
  history_detail text;
begin
  if caller_id is null then
    raise exception 'You must be signed in to respond to a payment.';
  end if;
  if new_status_input is null or new_status_input not in ('confirmed', 'declined') then
    raise exception 'Payment response must be confirmed or declined.';
  end if;

  select * into payment_row
  from public.payments p
  where p.id = payment_id_input
  for update;

  if not found then
    raise exception 'Payment not found.';
  end if;
  if payment_row.recipient_id <> caller_id then
    raise exception 'Only the recipient can respond to this payment.';
  end if;
  if payment_row.status <> 'pending' then
    raise exception 'This payment has already been responded to.';
  end if;
  if not public.is_room_member(payment_row.room_id) then
    raise exception 'You are not an active member of this room.';
  end if;

  update public.payments
  set status = new_status_input
  where id = payment_row.id;

  if new_status_input = 'confirmed' then
    history_detail := 'Confirmed a payment of $' || to_char(payment_row.amount, 'FM999999990.00');
  else
    history_detail := 'Declined a payment of $' || to_char(payment_row.amount, 'FM999999990.00');
    if nullif(trim(reason_input), '') is not null then
      history_detail := history_detail || ': ' || trim(reason_input);
    end if;
  end if;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (payment_row.room_id, caller_id, 'payment_' || new_status_input, history_detail, 'payment', payment_row.id);
end;
$$;

revoke all on function public.record_outgoing_payment(uuid, uuid, numeric, text) from public;
revoke all on function public.record_received_payment(uuid, uuid, numeric, text) from public;
revoke all on function public.respond_to_payment(uuid, text, text) from public;
grant execute on function public.record_outgoing_payment(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.record_received_payment(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.respond_to_payment(uuid, text, text) to authenticated;

-- NOTE: Do not create a direct UPDATE policy on payments. The RPC above
-- intentionally owns confirmation/decline transitions.
