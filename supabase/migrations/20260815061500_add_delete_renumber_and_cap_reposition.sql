-- Two admin-panel gaps: deleting a product left a permanent hole in the
-- position sequence (nothing renumbered the rows above it), and
-- set_product_position accepted any positive integer, including one far
-- beyond the actual product count -- which itself creates a hole, since the
-- product being moved is already one of the counted rows (moving it to
-- count+1 leaves its old neighbourhood one short). Both fixed as
-- SECURITY DEFINER functions with an is_admin() gate, matching the existing
-- set_product_position pattern.

create or replace function delete_product_and_renumber(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position int;
begin
  if not is_admin() then
    raise exception 'delete_product_and_renumber: admin privileges required';
  end if;

  select position into v_position from products where id = p_product_id;
  if v_position is null then
    raise exception 'delete_product_and_renumber: no product found with id %', p_product_id;
  end if;

  delete from products where id = p_product_id;

  -- Every product above the deleted one's slot shifts down by exactly one,
  -- closing the gap. This is safe without deferring the uniqueness
  -- constraint: the deleted row's old position is now vacant, so each
  -- shifted row lands on a value nothing else holds, regardless of the
  -- order Postgres processes the rows in.
  update products set position = position - 1 where position > v_position;
end;
$$;

create or replace function set_product_position(p_product_id uuid, p_new_position int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_position int;
  v_count int;
begin
  if not is_admin() then
    raise exception 'set_product_position: admin privileges required';
  end if;

  set constraints products_position_unique deferred;

  select position into v_old_position from products where id = p_product_id;

  if v_old_position is null then
    raise exception 'set_product_position: no product found with id %', p_product_id;
  end if;

  select count(*) into v_count from products;

  -- The product being moved is already one of v_count rows, so the highest
  -- valid target is v_count itself (moving it to "last") -- v_count + 1
  -- would leave its old neighbourhood one position short. New products get
  -- their own position (count + 1 at the time, before this move) assigned
  -- separately at insert time, which this function doesn't touch.
  if p_new_position > v_count then
    raise exception 'set_product_position: position % exceeds the current product count (%)', p_new_position, v_count;
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
