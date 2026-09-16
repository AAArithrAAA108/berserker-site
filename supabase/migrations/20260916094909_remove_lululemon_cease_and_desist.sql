-- Removes the Lululemon brand and its product entirely, per a cease and
-- desist received 2026-09-16. Mirrors delete_brand_cascade()'s logic
-- directly (rather than calling that RPC) since this runs outside an
-- authenticated admin session, where its is_admin() check would fail.
delete from products where brand_id in (select id from brands where folder_slug = 'lululemon');
delete from brands where folder_slug = 'lululemon';

-- Re-sequence positions to close the gap left by the deleted product,
-- same as delete_brand_cascade() does after its own cascade delete.
with ranked as (
  select id, row_number() over (order by position) as rn from products
)
update products p set position = r.rn
from ranked r
where p.id = r.id and p.position != r.rn;
