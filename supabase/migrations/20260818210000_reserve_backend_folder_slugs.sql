-- Adds the repo's backend/tooling folder names (docs, scripts, supabase,
-- images) to the reserved-slug checks in create_primary_brand and
-- rename_brand_folder. These names are already reserved client-side
-- (admin/dashboard/brands.js) and in publish-site (membership.ts's
-- RESERVED_BRAND_SLUGS); this migration keeps the server-side RPCs -- the
-- authoritative check -- in sync. Without this, a brand folder named e.g.
-- "docs" would collide with the repo's own docs/ directory on publish.

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
