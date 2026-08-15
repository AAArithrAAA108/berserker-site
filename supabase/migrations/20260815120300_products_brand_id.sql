-- supabase/migrations/20260815120300_products_brand_id.sql
-- Nullable first so the backfill UPDATE has something to target; every
-- distinct products.brand string is already guaranteed to match a brands.name
-- row (verified in Task 3 Step 3), so the NOT NULL lock below is safe.
alter table products add column brand_id uuid references brands(id);

update products p
set brand_id = b.id
from brands b
where b.name = p.brand;

-- Fail loudly here rather than silently locking a column with nulls in it --
-- if this raises, some product's brand string didn't match any brands.name
-- row and Task 3's backfill needs a fix before proceeding.
do $$
begin
  if exists (select 1 from products where brand_id is null) then
    raise exception 'products_brand_id backfill incomplete -- % products have no matching brand', (select count(*) from products where brand_id is null);
  end if;
end $$;

alter table products alter column brand_id set not null;
alter table products drop column brand;
