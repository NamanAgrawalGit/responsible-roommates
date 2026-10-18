-- Responsible Roommates: notifications (fixes "declined payment sends nothing")
-- Apply AFTER schema_update_security_payments.sql. Safe to rerun.
--
-- Adds:
--   * public.notifications table. Users can only READ their own rows.
--     Nobody can insert/update/delete directly; rows are created inside
--     validated SECURITY DEFINER functions and marked read via RPCs.
--   * notify_user(): internal helper (not callable by app users).
--   * mark_notification_read() / mark_all_notifications_read() RPCs.
--   * respond_to_payment() now notifies the PAYER when their payment is
--     declined (with the reason) or confirmed.

-- ------------------------------------------------------------------
-- 1. Table + RLS
-- ------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  type text not null,            -- e.g. 'payment_declined', 'payment_confirmed'
  message text not null,
  related_type text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_room_idx
  on public.notifications (user_id, room_id, is_read, created_at desc);

alter table public.notifications enable row level security;

do $$
declare
  policy_row record;
begin
  -- Remove any pre-existing policies so only the SELECT policy below remains.
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
  loop
    execute format('drop policy %I on public.notifications', policy_row.policyname);
  end loop;
end;
$$;

create policy "view own notifications" on public.notifications
  for select using (user_id = auth.uid());

revoke insert, update, delete on public.notifications from anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Internal helper: create a notification for a user in a room.
-- Only other SECURITY DEFINER functions can call it.
-- ------------------------------------------------------------------
create or replace function public.notify_user(
  user_id_input uuid,
  room_id_input uuid,
  type_input text,
  message_input text,
  related_type_input text default null,
  related_id_input uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (user_id, room_id, type, message, related_type, related_id)
  values (user_id_input, room_id_input, type_input, message_input, related_type_input, related_id_input);
end;
$$;

revoke all on function public.notify_user(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Mark notifications read (own rows only)
-- ------------------------------------------------------------------
create or replace function public.mark_notification_read(notification_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  update public.notifications
  set is_read = true
  where id = notification_id_input
    and user_id = auth.uid();
end;
$$;

create or replace function public.mark_all_notifications_read(room_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  update public.notifications
  set is_read = true
  where user_id = auth.uid()
    and room_id = room_id_input
    and is_read = false;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 4. respond_to_payment: same validation as before, plus a notification
-- to the payer. Status change, history row and notification all happen
-- in one transaction.
-- ------------------------------------------------------------------
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
  caller_name text;
  amount_text text;
  clean_reason text := nullif(trim(reason_input), '');
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

  amount_text := to_char(payment_row.amount, 'FM999999990.00');
  select coalesce(nullif(trim(pr.name), ''), 'A roommate') into caller_name
  from public.profiles pr
  where pr.id = caller_id;
  caller_name := coalesce(caller_name, 'A roommate');

  if new_status_input = 'confirmed' then
    history_detail := 'Confirmed a payment of $' || amount_text;
  else
    history_detail := 'Declined a payment of $' || amount_text;
    if clean_reason is not null then
      history_detail := history_detail || ': ' || clean_reason;
    end if;
  end if;

  insert into public.history (room_id, actor_id, action, details, related_type, related_id)
  values (payment_row.room_id, caller_id, 'payment_' || new_status_input, history_detail, 'payment', payment_row.id);

  -- Tell the person who said they paid what happened to their payment.
  if new_status_input = 'confirmed' then
    perform public.notify_user(
      payment_row.payer_id,
      payment_row.room_id,
      'payment_confirmed',
      caller_name || ' confirmed your payment of $' || amount_text || '.',
      'payment',
      payment_row.id
    );
  else
    perform public.notify_user(
      payment_row.payer_id,
      payment_row.room_id,
      'payment_declined',
      caller_name || ' declined your payment of $' || amount_text ||
        case when clean_reason is not null then '. Reason: ' || clean_reason else '.' end,
      'payment',
      payment_row.id
    );
  end if;
end;
$$;

revoke all on function public.respond_to_payment(uuid, text, text) from public;
grant execute on function public.respond_to_payment(uuid, text, text) to authenticated;