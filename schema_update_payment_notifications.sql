-- Responsible Roommates: payment notifications + one pending payment per pair
-- Apply AFTER schema_update_notifications.sql. Safe to rerun.
--
-- Changes:
--   * record_outgoing_payment ("I Paid This"):
--       - rejects a new payment to a roommate while an earlier one to that
--         same roommate is still pending confirmation
--       - notifies the RECIPIENT that a payment is waiting for them to
--         confirm or decline
--   * record_received_payment ("They Paid Me"):
--       - notifies the PAYER that the recipient recorded a payment from them
--   * A partial unique index backs up the "one pending payment per pair"
--     rule against two requests arriving at the same instant. If your data
--     already contains duplicate pending payments, the index is skipped
--     with a NOTICE (the function check still applies); resolve those
--     duplicates and rerun this file to add the index.

-- ------------------------------------------------------------------
-- 1. One pending payment per (room, payer, recipient)
-- ------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.payments
    where status = 'pending'
    group by room_id, payer_id, recipient_id
    having count(*) > 1
  ) then
    raise notice 'Duplicate pending payments exist; skipping unique index. Confirm or decline the extras, then rerun this file.';
  else
    create unique index if not exists payments_one_pending_per_pair
      on public.payments (room_id, payer_id, recipient_id)
      where status = 'pending';
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- 2. "I Paid This"
-- ------------------------------------------------------------------
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
  caller_name text;
  amount_text text;
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

  -- Only one unconfirmed payment per roommate at a time.
  if exists (
    select 1 from public.payments p
    where p.room_id = room_id_input
      and p.payer_id = caller_id
      and p.recipient_id = recipient_id_input
      and p.status = 'pending'
  ) then
    raise exception 'You already have a payment to this roommate waiting for confirmation.';
  end if;

  begin
    insert into public.payments (room_id, payer_id, recipient_id, amount, status, note)
    values (room_id_input, caller_id, recipient_id_input, round(amount_input, 2), 'pending', nullif(trim(note_input), ''))
    returning id into payment_id;
  exception when unique_violation then
    raise exception 'You already have a payment to this roommate waiting for confirmation.';
  end;

  amount_text := to_char(round(amount_input, 2), 'FM999999990.00');

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (
    room_id_input,
    caller_id,
    'payment_marked_paid',
    'Marked $' || amount_text || ' as paid',
    'payment',
    payment_id
  );

  select coalesce(nullif(trim(pr.name), ''), 'A roommate') into caller_name
  from public.profiles pr
  where pr.id = caller_id;
  caller_name := coalesce(caller_name, 'A roommate');

  perform public.notify_user(
    recipient_id_input,
    room_id_input,
    'payment_pending',
    caller_name || ' says they paid you $' || amount_text ||
      '. Go to Balances to confirm or decline.',
    'payment',
    payment_id
  );

  return payment_id;
end;
$$;

-- ------------------------------------------------------------------
-- 3. "They Paid Me"
-- ------------------------------------------------------------------
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
  caller_name text;
  amount_text text;
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

  amount_text := to_char(round(amount_input, 2), 'FM999999990.00');

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (
    room_id_input,
    caller_id,
    'payment_confirmed',
    'Recorded $' || amount_text || ' received',
    'payment',
    payment_id
  );

  select coalesce(nullif(trim(pr.name), ''), 'A roommate') into caller_name
  from public.profiles pr
  where pr.id = caller_id;
  caller_name := coalesce(caller_name, 'A roommate');

  perform public.notify_user(
    payer_id_input,
    room_id_input,
    'payment_received_recorded',
    caller_name || ' recorded that you paid them $' || amount_text || '.',
    'payment',
    payment_id
  );

  return payment_id;
end;
$$;

revoke all on function public.record_outgoing_payment(uuid, uuid, numeric, text) from public;
revoke all on function public.record_received_payment(uuid, uuid, numeric, text) from public;
grant execute on function public.record_outgoing_payment(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.record_received_payment(uuid, uuid, numeric, text) to authenticated;