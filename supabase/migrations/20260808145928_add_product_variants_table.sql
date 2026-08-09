create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  color_id uuid not null references product_colors(id) on delete cascade,
  size text not null check (size in ('S','M','L','XL')),
  in_stock boolean not null default true,
  unique (product_id, color_id, size)
);
create index product_variants_product_id_idx on product_variants(product_id);
