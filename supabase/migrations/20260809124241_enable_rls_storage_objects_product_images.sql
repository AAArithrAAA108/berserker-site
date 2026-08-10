create policy "admin write product-images objects"
on storage.objects
for all
using (bucket_id = 'product-images' and is_admin())
with check (bucket_id = 'product-images' and is_admin());
