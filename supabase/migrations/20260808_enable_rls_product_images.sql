-- Enable RLS and add policies for product_images table
-- Task 2: product_images table completion

alter table product_images enable row level security;

drop policy if exists "public read product_images" on product_images;
create policy "public read product_images" on product_images for select using (true);

drop policy if exists "admin write product_images" on product_images;
create policy "admin write product_images" on product_images for all using (is_admin()) with check (is_admin());
