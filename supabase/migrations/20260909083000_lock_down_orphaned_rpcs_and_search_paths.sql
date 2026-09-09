-- Fixes for the remaining WARN-level items from `supabase db advisors`,
-- surfaced while investigating the "table publicly accessible" email.
--
-- 1) create_order is dead code that is still dangerously reachable. The
--    comment atop supabase/functions/create-verified-order/index.ts says
--    it plainly: that Edge Function was written specifically to replace
--    this RPC, because create_order trusted whatever price/discount/
--    payment_method/razorpay_payment_id the browser sent with zero
--    server-side verification -- exactly the kind of tampering the
--    verified-order rewrite exists to prevent. create-verified-order
--    inserts into `orders` directly via its own service-role client; it
--    never calls this RPC, and nothing else in the repo does either. But
--    EXECUTE was never revoked when the Edge Function replaced it, so
--    anyone could still bypass all of that verification by calling
--    POST /rest/v1/rpc/create_order directly with fabricated totals and a
--    fake payment id. Locking it to service_role/postgres only.
revoke execute on function public.create_order(
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_address_line1 text, p_address_line2 text, p_city text, p_state text,
  p_pincode text, p_country text, p_items jsonb, p_subtotal numeric,
  p_discount numeric, p_coupon_code text, p_order_total numeric,
  p_payment_method text, p_amount_paid numeric, p_balance_due numeric,
  p_razorpay_payment_id text
) from public;
revoke execute on function public.create_order(
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_address_line1 text, p_address_line2 text, p_city text, p_state text,
  p_pincode text, p_country text, p_items jsonb, p_subtotal numeric,
  p_discount numeric, p_coupon_code text, p_order_total numeric,
  p_payment_method text, p_amount_paid numeric, p_balance_due numeric,
  p_razorpay_payment_id text
) from authenticated;

-- 2) The admin-mutation RPCs (create/delete/rename brand, delete/reposition
--    product) already guard themselves with `if not is_admin() then raise
--    exception` -- a non-admin caller was never actually able to do
--    anything through them. But `anon` (an unauthenticated visitor) has no
--    legitimate reason to reach these at all; narrowing PostgREST exposure
--    to `authenticated` (the admin panel's own signed-in session role)
--    removes the surface entirely instead of relying only on the internal
--    check. is_admin()/is_super_admin() are deliberately NOT touched here:
--    they're referenced directly inside RLS policies on products, brands,
--    orders, etc. that apply to every role (see `admin write products` and
--    friends), so anon/authenticated must keep EXECUTE on them just to
--    evaluate those policies at all -- revoking it would break every
--    query against those tables, not just admin ones.
revoke execute on function public.create_collab_brand(p_name text, p_parent_folder_slug text) from anon;
revoke execute on function public.create_primary_brand(p_name text, p_folder_slug text, p_thumbnail_storage_path text) from anon;
revoke execute on function public.delete_brand_cascade(p_brand_id uuid) from anon;
revoke execute on function public.delete_product_and_renumber(p_product_id uuid) from anon;
revoke execute on function public.rename_brand_folder(p_old_slug text, p_new_slug text) from anon;
revoke execute on function public.set_product_position(p_product_id uuid, p_new_position integer) from anon;

-- 3) Function Search Path Mutable: a SECURITY DEFINER function with no
--    fixed search_path resolves unqualified identifiers (like `orders`,
--    `admin_profiles`, `coupons`) using the *caller's* search_path, not a
--    trusted one -- a caller able to create objects in a schema ahead of
--    `public` on their own search_path could shadow those references.
--    The admin-mutation RPCs above already set this; these five didn't.
alter function public.create_order(
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_address_line1 text, p_address_line2 text, p_city text, p_state text,
  p_pincode text, p_country text, p_items jsonb, p_subtotal numeric,
  p_discount numeric, p_coupon_code text, p_order_total numeric,
  p_payment_method text, p_amount_paid numeric, p_balance_due numeric,
  p_razorpay_payment_id text
) set search_path = public;
alter function public.is_admin() set search_path = public;
alter function public.is_super_admin() set search_path = public;
alter function public.validate_coupon(p_code text, p_qty integer) set search_path = public;
alter function public.classify_color_group(hex text, label text) set search_path = public;
