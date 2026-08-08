-- BERSERKER admin database schema (Supabase / Postgres)
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: uses "create table if not exists" / "or replace" throughout.

-- ── ORDER NUMBER SEQUENCE ──
-- Human-facing order numbers start at 12092006 and increment by 1 per order.
create sequence if not exists order_number_seq start with 12092006 increment by 1;

-- ── ADMIN ROLES ──
-- Linked 1:1 to Supabase Auth users (auth.users). The first row you insert
-- for your own account (see bottom of this file) should have role = 'super_admin'.
create table if not exists admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  created_at timestamptz not null default now()
);

-- ── PRODUCTS ──
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  name text not null,
  slug text unique not null,
  price numeric(10,2) not null,
  cod_advance numeric(10,2) not null default 0,
  position int,
  category text,
  sleeve_length text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_check check (category in ('t-shirt','compression','pants','jacket','dress','set')),
  constraint products_sleeve_length_check check (sleeve_length is null or sleeve_length in ('half','full','sleeveless'))
);

create table if not exists product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  label text not null,
  hex text,
  image_index int not null default 0
);

create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0
);

create index if not exists product_images_product_id_idx on product_images(product_id);

-- ── COUPONS ──
-- Not publicly readable as a table (see validate_coupon() RPC below) so the
-- full code list can't just be scraped from the API.
create table if not exists coupons (
  code text primary key,
  discount_percent numeric(5,2) not null,
  min_qty int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── CUSTOMERS ──
-- Kept separate from orders so repeat customers can be looked up by phone/email.
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  created_at timestamptz not null default now()
);

-- ── ORDERS ──
create table if not exists orders (
  order_number bigint primary key default nextval('order_number_seq'),
  customer_id uuid references customers(id),

  -- Shipping snapshot at time of order (kept even if the customer record changes later)
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  pincode text not null,
  country text not null default 'India',

  -- Order contents & pricing
  items jsonb not null,               -- [{brand, name, qty, price, imgSrc}, ...]
  subtotal numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  coupon_code text,
  order_total numeric(10,2) not null, -- subtotal - discount

  -- Payment
  payment_method text not null check (payment_method in ('full', 'cod')),
  amount_paid numeric(10,2) not null, -- what was actually charged via Razorpay right now
  balance_due numeric(10,2) not null default 0, -- remaining amount owed on delivery (0 if payment_method = 'full')
  razorpay_payment_id text,

  status text not null default 'placed' check (status in ('placed', 'cancelled', 'delivered')),
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_customer_phone_idx on orders (customer_phone);

-- ── ROW LEVEL SECURITY ──
alter table admin_profiles enable row level security;
alter table products enable row level security;
alter table product_colors enable row level security;
alter table product_images enable row level security;
alter table coupons enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;

-- Helper: is the currently-authenticated user an admin (of either role)?
create or replace function is_admin() returns boolean as $$
  select exists (select 1 from admin_profiles where id = auth.uid());
$$ language sql security definer stable;

-- Helper: is the currently-authenticated user specifically a super_admin?
create or replace function is_super_admin() returns boolean as $$
  select exists (select 1 from admin_profiles where id = auth.uid() and role = 'super_admin');
$$ language sql security definer stable;

-- Products: public storefront can read; only admins can write.
drop policy if exists "public read products" on products;
create policy "public read products" on products for select using (true);
drop policy if exists "admin write products" on products;
create policy "admin write products" on products for all using (is_admin()) with check (is_admin());

drop policy if exists "public read product_colors" on product_colors;
create policy "public read product_colors" on product_colors for select using (true);
drop policy if exists "admin write product_colors" on product_colors;
create policy "admin write product_colors" on product_colors for all using (is_admin()) with check (is_admin());

drop policy if exists "public read product_images" on product_images;
create policy "public read product_images" on product_images for select using (true);
drop policy if exists "admin write product_images" on product_images;
create policy "admin write product_images" on product_images for all using (is_admin()) with check (is_admin());

-- Coupons: no public read policy at all (deliberately) — only reachable via validate_coupon() below.
drop policy if exists "admin manage coupons" on coupons;
create policy "admin manage coupons" on coupons for all using (is_admin()) with check (is_admin());

-- Customers: admin-only.
drop policy if exists "admin manage customers" on customers;
create policy "admin manage customers" on customers for all using (is_admin()) with check (is_admin());

-- Orders: anyone (the storefront, unauthenticated) can INSERT a new order;
-- only admins can read, update, or delete existing orders.
drop policy if exists "public can create orders" on orders;
create policy "public can create orders" on orders for insert with check (true);
drop policy if exists "admin read orders" on orders;
create policy "admin read orders" on orders for select using (is_admin());
drop policy if exists "admin update orders" on orders;
create policy "admin update orders" on orders for update using (is_admin()) with check (is_admin());
drop policy if exists "admin delete orders" on orders;
create policy "admin delete orders" on orders for delete using (is_admin());

-- Admin profiles: admins can see the admin list; only super_admins can add/remove/promote admins.
drop policy if exists "admin read admin_profiles" on admin_profiles;
create policy "admin read admin_profiles" on admin_profiles for select using (is_admin());
drop policy if exists "super_admin manage admin_profiles" on admin_profiles;
create policy "super_admin manage admin_profiles" on admin_profiles for all using (is_super_admin()) with check (is_super_admin());

-- ── SECURE COUPON VALIDATION (callable by the public storefront) ──
create or replace function validate_coupon(p_code text, p_qty int)
returns table(valid boolean, discount_percent numeric, message text) as $$
declare
  c coupons%rowtype;
begin
  select * into c from coupons where code = upper(p_code) and active = true;
  if not found then
    return query select false, 0::numeric, 'Invalid coupon code.';
    return;
  end if;
  if p_qty < c.min_qty then
    return query select false, 0::numeric,
      'This code needs at least ' || c.min_qty || ' items in your cart (you have ' || p_qty || ').';
    return;
  end if;
  return query select true, c.discount_percent, c.discount_percent || '% discount applied!';
end;
$$ language plpgsql security definer;

grant execute on function validate_coupon(text, int) to anon;

-- ── SECURE ORDER CREATION (callable by the public storefront) ──
-- The storefront runs as the anon role, which can INSERT into orders but
-- cannot SELECT from it (admin-only). Postgres applies the SELECT policy to
-- the RETURNING clause of an INSERT too, so a plain `insert().select()` from
-- the client silently returns no row and the order number never comes back.
-- This function inserts as security definer and returns just the order
-- number, without exposing any other order's data to the caller.
create or replace function create_order(
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_country text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_coupon_code text,
  p_order_total numeric,
  p_payment_method text,
  p_amount_paid numeric,
  p_balance_due numeric,
  p_razorpay_payment_id text
)
returns bigint as $$
declare
  v_order_number bigint;
begin
  insert into orders (
    customer_name, customer_phone, customer_email,
    address_line1, address_line2, city, state, pincode, country,
    items, subtotal, discount, coupon_code, order_total,
    payment_method, amount_paid, balance_due, razorpay_payment_id
  ) values (
    p_customer_name, p_customer_phone, p_customer_email,
    p_address_line1, p_address_line2, p_city, p_state, p_pincode, p_country,
    p_items, p_subtotal, p_discount, p_coupon_code, p_order_total,
    p_payment_method, p_amount_paid, p_balance_due, p_razorpay_payment_id
  )
  returning order_number into v_order_number;

  return v_order_number;
end;
$$ language plpgsql security definer;

grant execute on function create_order(
  text, text, text, text, text, text, text, text, text,
  jsonb, numeric, numeric, text, numeric, text, numeric, numeric, text
) to anon;

-- ── SEED DATA ──
-- Existing BRSKR25 coupon, matching what's already live on the site.
insert into coupons (code, discount_percent, min_qty, active)
values ('BRSKR25', 25, 10, true)
on conflict (code) do nothing;

-- ── ONE-TIME SETUP: making yourself super_admin ──
-- 1. Go to Authentication -> Users in the Supabase dashboard and create a user
--    with email bis.arithra65@gmail.com and a password you choose there directly
--    (not the one typed in chat).
-- 2. Copy that user's UID from the Authentication -> Users table.
-- 3. Run this, with the UID substituted in:
--
-- insert into admin_profiles (id, email, role)
-- values ('PASTE-USER-UID-HERE', 'bis.arithra65@gmail.com', 'super_admin');
