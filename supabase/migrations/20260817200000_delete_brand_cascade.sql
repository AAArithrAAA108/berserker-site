-- supabase/migrations/20260817200000_delete_brand_cascade.sql
--
-- Brand deletion never existed as an admin capability. This adds it,
-- cascading to every product under the brand and, for a primary (folder-
-- owning) brand, every collab sharing its folder too -- deleting a folder
-- means deleting everything that lives in it, not leaving orphaned collab
-- rows pointing at a folder slug nothing else claims.
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
  -- sequence -- delete_product_and_renumber's single-row shift doesn't
  -- generalize cleanly to a multi-row delete, so re-sequence everything
  -- that's left instead. Only touches rows whose position actually changed.
  with ranked as (
    select id, row_number() over (order by position) as rn from products
  )
  update products p set position = r.rn
  from ranked r
  where p.id = r.id and p.position != r.rn;
end;
$$;
