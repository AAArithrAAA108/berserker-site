create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0
);
create index product_images_product_id_idx on product_images(product_id);
