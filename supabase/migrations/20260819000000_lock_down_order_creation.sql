-- Locks down the old insecure order-creation path now that
-- create-verified-order (an Edge Function that recomputes real prices from
-- the products table and verifies the Razorpay payment against Razorpay's
-- own API) has replaced it as the storefront's only way to create an
-- order. Before this, anon could INSERT into orders directly and/or call
-- create_order() with entirely client-supplied pricing and an unverified
-- razorpay_payment_id.

drop policy if exists "public can create orders" on orders;

revoke execute on function create_order(
  text, text, text, text, text, text, text, text, text,
  jsonb, numeric, numeric, text, numeric, text, numeric, numeric, text
) from anon;

-- Prevents replaying the same captured Razorpay payment across two orders.
-- Partial (WHERE razorpay_payment_id is not null) since COD orders with a
-- zero advance never populate this column.
create unique index if not exists orders_razorpay_payment_id_unique
  on orders (razorpay_payment_id)
  where razorpay_payment_id is not null;
