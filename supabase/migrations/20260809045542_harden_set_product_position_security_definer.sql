-- Finding 2: since products.position is NOT NULL, a null v_old_position can only
-- mean "no such product". The old branch silently shifted every product up by one
-- and then matched zero rows on the final UPDATE, corrupting the sequence with no
-- error. Replace it with an explicit exception. Also make the function
-- SECURITY DEFINER with a pinned search_path and an internal is_admin() gate, so a
-- non-admin caller gets a hard error instead of a silent RLS no-op.
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

  set constraints products_position_unique deferred;

  select position into v_old_position from products where id = p_product_id;

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
