-- Finding 1: products_position_unique was NOT DEFERRABLE, so the intermediate
-- state produced by set_product_position()'s shift UPDATE raised unique_violation
-- on every reorder. Make it deferrable and defer it inside the function.
alter table products drop constraint products_position_unique;
alter table products add constraint products_position_unique unique (position) deferrable initially immediate;

create or replace function set_product_position(p_product_id uuid, p_new_position int)
returns void
language plpgsql
as $$
declare
  v_old_position int;
begin
  set constraints products_position_unique deferred;

  select position into v_old_position from products where id = p_product_id;

  if v_old_position is null then
    -- new product being placed for the first time: make room, then set it
    update products set position = position + 1
    where position >= p_new_position;
    update products set position = p_new_position where id = p_product_id;
    return;
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
