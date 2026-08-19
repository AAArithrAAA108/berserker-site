-- Tracks order-creation attempts (successful or not) by IP so
-- create-verified-order can reject a burst of requests from the same
-- source -- e.g. a script probing for valid product/color/size
-- combinations or hammering the (now server-verified, so no longer
-- profitable, but still cost-to-serve) endpoint. No RLS policies: only
-- ever touched by the Edge Function's service-role client.
create table if not exists order_creation_attempts (
  id bigint generated always as identity primary key,
  ip_address text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_creation_attempts_ip_time_idx
  on order_creation_attempts (ip_address, created_at desc);
