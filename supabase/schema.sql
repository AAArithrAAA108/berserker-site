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

-- ── BRANDS ──
-- A `is_primary` row owns a folder (e.g. YoungLA owns /youngla/). A collab row
-- (is_primary = false) shares its parent's folder_slug instead of carrying its
-- own -- e.g. "YoungLA x Batman" has folder_slug = 'youngla' too, and its
-- products publish under /youngla/<product-slug>/ alongside YoungLA's own.
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  folder_slug text not null,
  is_primary boolean not null default true,
  thumbnail_storage_path text,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'brands_one_primary_per_folder') then
    create unique index brands_one_primary_per_folder on brands (folder_slug) where is_primary;
  end if;
end $$;

-- Only a primary row's thumbnail is ever shown (one card per folder on
-- /brands/) -- a collab row carrying its own thumbnail would be silently
-- ignored by the renderer, so reject it at the data layer instead.
alter table brands drop constraint if exists brands_collab_no_thumbnail;
alter table brands add constraint brands_collab_no_thumbnail
  check (is_primary or thumbnail_storage_path is null);

-- ── PRODUCTS ──
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  name text not null,
  slug text unique not null,
  price numeric(10,2) not null,
  cod_advance numeric(10,2) not null default 0,
  position int not null,
  category text not null,
  sleeve_length text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_check check (category in ('t-shirt','compression','pants','jacket','dress','set')),
  constraint products_sleeve_length_check check (sleeve_length is null or sleeve_length in ('half','full','sleeveless')),
  -- DEFERRABLE so set_product_position() can shift a block of rows without the
  -- intermediate (momentarily colliding) state tripping the uniqueness check.
  constraint products_position_unique unique (position) deferrable initially immediate
);

-- product_images must be created BEFORE product_colors: product_colors.cover_image_id
-- has a foreign key onto it, so the reverse order fails a fresh top-to-bottom run
-- with "relation product_images does not exist".
create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0
);

create index if not exists product_images_product_id_idx on product_images(product_id);

create table if not exists product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  label text not null,
  hex text,
  color_group text not null,
  cover_image_id uuid references product_images(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Added via ALTER (not the product_images CREATE TABLE above) because
-- product_images is deliberately created before product_colors (see the
-- comment above that table) -- a color_id FK onto product_colors can only be
-- added once product_colors exists.
alter table product_images add column if not exists color_id uuid references product_colors(id) on delete set null;
create index if not exists product_images_color_id_idx on product_images(color_id);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  color_id uuid not null references product_colors(id) on delete cascade,
  size text not null check (size in ('S','M','L','XL')),
  in_stock boolean not null default true,
  unique (product_id, color_id, size)
);

create index if not exists product_variants_product_id_idx on product_variants(product_id);

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
alter table brands enable row level security;
alter table products enable row level security;
alter table product_colors enable row level security;
alter table product_images enable row level security;
alter table product_variants enable row level security;
alter table coupons enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;

-- ── STORAGE ──
-- The `product-images` bucket (public=true, created in Foundation) has RLS
-- enabled on storage.objects by default with zero policies out of the box, meaning
-- writes are denied to everyone until an explicit policy is added. This grants
-- INSERT/UPDATE/DELETE to admins only; public GET is unaffected (public-bucket reads
-- bypass RLS entirely, they don't need a SELECT policy here).
-- create policy "admin write product-images objects" on storage.objects for all
--   using (bucket_id = 'product-images' and is_admin())
--   with check (bucket_id = 'product-images' and is_admin());

-- Helper: is the currently-authenticated user an admin (of either role)?
create or replace function is_admin() returns boolean as $$
  select exists (select 1 from admin_profiles where id = auth.uid());
$$ language sql security definer stable;

-- Helper: is the currently-authenticated user specifically a super_admin?
create or replace function is_super_admin() returns boolean as $$
  select exists (select 1 from admin_profiles where id = auth.uid() and role = 'super_admin');
$$ language sql security definer stable;

-- Brands: public storefront can read; only admins can write.
drop policy if exists "public read brands" on brands;
create policy "public read brands" on brands for select using (true);
drop policy if exists "admin write brands" on brands;
create policy "admin write brands" on brands for all using (is_admin()) with check (is_admin());

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

drop policy if exists "public read product_variants" on product_variants;
create policy "public read product_variants" on product_variants for select using (true);
drop policy if exists "admin write product_variants" on product_variants;
create policy "admin write product_variants" on product_variants for all using (is_admin()) with check (is_admin());

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

-- ── COLOR GROUP CLASSIFIER ──
-- label-aware: an earlier Foundation fix (fix_color_group_prefer_label_over_hex_distance)
-- corrected EXISTING rows via a one-time UPDATE using this same resolution order, but
-- never carried it into this function -- so any NEW color classified by hex alone would
-- reintroduce the same misclassification (e.g. Forest Green #1a4a1a landing in Black).
-- This signature replaces the old hex-only classify_color_group(hex text); label is
-- optional (defaults to null) so any 1-arg caller still works, just without the
-- label-aware improvement.
create or replace function classify_color_group(hex text, label text default null)
returns text
language plpgsql
immutable
as $$
declare
  r int; g int; b int;
  palette text[] := array['Black','White','Grey','Red','Blue','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Denim'];
  palette_hex text[] := array['#141414','#f0ede8','#8a8a8a','#c41e1e','#1c4aa0','#1c8a3a','#5a1ca0','#c41e8a','#c46a1e','#1c2c4a','#5a1a1a','#c4a01c','#5a3f2a','#ede9e3','#6b9fd4'];
  kw_words text[] := array['black','white','grey','gray','charcoal','red','crimson','blue','denim','green','teal','purple','pink','orange','navy','maroon','gold','brown','cream','beige'];
  kw_groups text[] := array['Black','White','Grey','Grey','Grey','Red','Red','Blue','Denim','Green','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Cream'];
  lower_label text;
  best_word_pos int := null;
  best_word_len int := -1;
  best_word_group text := null;
  i int;
  pos int;
  best_name text := 'Black';
  best_dist float8 := 'Infinity'::float8;
  pr int; pg int; pb int;
  dist float8;
  spread int;
begin
  lower_label := lower(coalesce(label, ''));

  -- Step 1: earliest whole-word palette colour name in the label wins (ties -> longest word)
  if lower_label <> '' then
    for i in 1 .. array_length(kw_words, 1) loop
      if lower_label ~ ('\m' || kw_words[i] || '\M') then
        pos := strpos(lower_label, kw_words[i]);
        if best_word_pos is null or pos < best_word_pos
           or (pos = best_word_pos and length(kw_words[i]) > best_word_len) then
          best_word_pos := pos;
          best_word_len := length(kw_words[i]);
          best_word_group := kw_groups[i];
        end if;
      end if;
    end loop;
    if best_word_group is not null then
      return best_word_group;
    end if;
    -- Step 2: vague neutral word
    if lower_label ~ '\mstealth\M' then
      return 'Grey';
    end if;
  end if;

  if hex is null or length(hex) != 7 or hex !~* '^#[0-9a-f]{6}$' then
    return 'Uncategorized';
  end if;
  r := ('x' || substr(hex, 2, 2))::bit(8)::int;
  g := ('x' || substr(hex, 4, 2))::bit(8)::int;
  b := ('x' || substr(hex, 6, 2))::bit(8)::int;

  -- Step 3: near-neutral hex bucketed by lightness (the distance classifier maps
  -- flat greys like #2a2a2a to Navy, which step 4 alone would get wrong)
  spread := greatest(r, g, b) - least(r, g, b);
  if spread <= 16 then
    if greatest(r, g, b) < 60 then return 'Black';
    elsif least(r, g, b) > 200 then return 'White';
    else return 'Grey';
    end if;
  end if;

  -- Step 4: fall back to nearest palette anchor by hex distance
  for i in 1 .. array_length(palette, 1) loop
    pr := ('x' || substr(palette_hex[i], 2, 2))::bit(8)::int;
    pg := ('x' || substr(palette_hex[i], 4, 2))::bit(8)::int;
    pb := ('x' || substr(palette_hex[i], 6, 2))::bit(8)::int;
    dist := pow(r - pr, 2) + pow(g - pg, 2) + pow(b - pb, 2);
    if dist < best_dist then
      best_dist := dist;
      best_name := palette[i];
    end if;
  end loop;
  return best_name;
end;
$$;

-- ── PRODUCT REORDERING ──
-- SECURITY DEFINER + internal is_admin() gate: the admin panel calls this as an
-- authenticated user, and without the definer context the shift UPDATEs would
-- silently match zero rows under RLS and look like a successful no-op.
create or replace function set_product_position(p_product_id uuid, p_new_position int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_position int;
begin
  if not is_admin() then
    raise exception 'set_product_position: admin privileges required';
  end if;

  -- Defer the uniqueness check to commit so the block shift below is legal.
  set constraints products_position_unique deferred;

  select position into v_old_position from products where id = p_product_id;

  -- products.position is NOT NULL, so a null here can only mean "no such product".
  if v_old_position is null then
    raise exception 'set_product_position: no product found with id %', p_product_id;
  end if;

  if p_new_position = v_old_position then
    return;
  elsif p_new_position < v_old_position then
    update products set position = position + 1
    where position >= p_new_position and position < v_old_position and id != p_product_id;
  else
    update products set position = position - 1
    where position > v_old_position and position <= p_new_position and id != p_product_id;
  end if;

  update products set position = p_new_position where id = p_product_id;
end;
$$;

-- ── BRAND MANAGEMENT ──
-- Reserved folder slugs: never a valid brand folder_slug, since each one is a
-- real site route. Kept in sync with the identical list in
-- supabase/functions/publish-site/membership.ts (RESERVED_BRAND_SLUGS) and
-- admin/dashboard/brands.js (client-side pre-check; this RPC is the
-- authoritative server-side check).
create or replace function create_primary_brand(p_name text, p_folder_slug text, p_thumbnail_storage_path text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'create_primary_brand: admin privileges required';
  end if;

  if p_folder_slug in ('admin', 'checkout', 'collections', 'all-products', 'about-berserker', 'contact-berserker', 'returns-and-refunds', 'shipping-info', 'brands', 'terms-of-service', 'privacy-policy', 'docs', 'scripts', 'supabase', 'images') then
    raise exception 'create_primary_brand: % is a reserved folder name', p_folder_slug;
  end if;

  if exists (select 1 from brands where folder_slug = p_folder_slug and is_primary) then
    raise exception 'create_primary_brand: folder % already exists', p_folder_slug;
  end if;

  insert into brands (name, folder_slug, is_primary, thumbnail_storage_path)
  values (p_name, p_folder_slug, true, p_thumbnail_storage_path)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function create_collab_brand(p_name text, p_parent_folder_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'create_collab_brand: admin privileges required';
  end if;

  if not exists (select 1 from brands where folder_slug = p_parent_folder_slug and is_primary) then
    raise exception 'create_collab_brand: no primary brand owns folder %', p_parent_folder_slug;
  end if;

  insert into brands (name, folder_slug, is_primary, thumbnail_storage_path)
  values (p_name, p_parent_folder_slug, false, null)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function rename_brand_folder(p_old_slug text, p_new_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'rename_brand_folder: admin privileges required';
  end if;

  if p_new_slug in ('admin', 'checkout', 'collections', 'all-products', 'about-berserker', 'contact-berserker', 'returns-and-refunds', 'shipping-info', 'brands', 'terms-of-service', 'privacy-policy', 'docs', 'scripts', 'supabase', 'images') then
    raise exception 'rename_brand_folder: % is a reserved folder name', p_new_slug;
  end if;

  if p_old_slug = p_new_slug then
    return;
  end if;

  if not exists (select 1 from brands where folder_slug = p_old_slug) then
    raise exception 'rename_brand_folder: no brand owns folder %', p_old_slug;
  end if;

  if exists (select 1 from brands where folder_slug = p_new_slug) then
    raise exception 'rename_brand_folder: folder % already exists', p_new_slug;
  end if;

  update brands set folder_slug = p_new_slug where folder_slug = p_old_slug;
end;
$$;

-- Deleting a folder means deleting everything that lives in it: for a
-- primary brand, every product under it AND every collab sharing its
-- folder go too, not just the primary row itself.
create or replace function delete_brand_cascade(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder_slug text;
  v_is_primary boolean;
begin
  if not is_admin() then
    raise exception 'delete_brand_cascade: admin privileges required';
  end if;

  select folder_slug, is_primary into v_folder_slug, v_is_primary from brands where id = p_brand_id;
  if v_folder_slug is null then
    raise exception 'delete_brand_cascade: no brand found with id %', p_brand_id;
  end if;

  if v_is_primary then
    delete from products where brand_id in (select id from brands where folder_slug = v_folder_slug);
    delete from brands where folder_slug = v_folder_slug;
  else
    delete from products where brand_id = p_brand_id;
    delete from brands where id = p_brand_id;
  end if;

  -- Deleting a batch of products can leave arbitrary gaps in the position
  -- sequence -- re-sequence everything that's left in one statement rather
  -- than adapting the single-row shift logic to a multi-row delete.
  with ranked as (
    select id, row_number() over (order by position) as rn from products
  )
  update products p set position = r.rn
  from ranked r
  where p.id = r.id and p.position != r.rn;
end;
$$;

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
