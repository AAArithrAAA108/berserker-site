-- Finding 7: Task 9's backfill pointed every colour of a product at that
-- product's FIRST image, discarding the real per-colour image_index values that
-- 179 of 219 rows carry (the live storefront slider still uses them via
-- data-img-index). Re-map each colour to its own image.
--
-- NOTE the +1: product_images.sort_order is 1-based (verified: every product's
-- sort_order is a dense 1..N) while product_colors.image_index is 0-based
-- (verified against the live storefront markup, where data-img-index="0" is the
-- card's first <img>). Matching sort_order = image_index directly would be off
-- by one on every non-zero row.
update product_colors pc
set cover_image_id = coalesce(
  (select pi.id from product_images pi
    where pi.product_id = pc.product_id and pi.sort_order = pc.image_index + 1),
  (select pi.id from product_images pi
    where pi.product_id = pc.product_id order by pi.sort_order asc limit 1)
);
