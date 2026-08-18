-- supabase/migrations/20260818200000_order_email_webhook.sql
--
-- Phase 5 of the admin/storefront overhaul: fire order-confirmation emails
-- (owner notification + customer confirmation) reliably regardless of
-- client behavior -- a client-side send would silently miss a closed tab
-- right after payment, exactly the moment it matters most. A Postgres
-- trigger on `orders` insert calls the new send-order-emails Edge Function
-- via pg_net (Supabase's standard async-HTTP-from-Postgres extension),
-- which is non-blocking -- a slow/failed email send can never roll back or
-- delay the actual order insert.
--
-- The shared secret this trigger sends as a bearer token was created
-- separately via `vault.create_secret(...)` (Supabase Vault, encrypted at
-- rest) rather than being embedded in this file -- there is no plaintext
-- secret anywhere in this migration or the git history.

create extension if not exists pg_net;

create or replace function notify_order_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_webhook_secret text;
begin
  select decrypted_secret into v_webhook_secret
  from vault.decrypted_secrets
  where name = 'order_email_webhook_secret';

  if v_webhook_secret is null then
    raise warning 'notify_order_created: order_email_webhook_secret not found in vault -- order email not sent for order %', new.order_number;
    return new;
  end if;

  -- Async (queued, non-blocking) -- a slow or failing Resend call never
  -- delays or fails the order insert itself.
  perform net.http_post(
    url := 'https://gvddahtgbhbqusyczxuo.supabase.co/functions/v1/send-order-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_webhook_secret),
    body := jsonb_build_object('order_number', new.order_number)
  );

  return new;
end;
$$;

drop trigger if exists orders_notify_email on orders;
create trigger orders_notify_email
  after insert on orders
  for each row execute function notify_order_created();
