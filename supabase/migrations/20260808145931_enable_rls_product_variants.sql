alter table product_variants enable row level security;
create policy "public read product_variants" on product_variants for select using (true);
create policy "admin write product_variants" on product_variants for all using (is_admin()) with check (is_admin());
