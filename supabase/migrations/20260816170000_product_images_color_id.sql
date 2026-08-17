-- supabase/migrations/20260816170000_product_images_color_id.sql
--
-- Replaces product_colors.image_index (an implicit "this color owns every
-- image from my index up to the next color's index" range, never exposed in
-- the admin UI, defaulting every admin-added color to index 0 and silently
-- colliding with whatever color already owned that range) with an explicit
-- product_images.color_id relation. See docs/superpowers/specs/
-- 2026-08-16-color-image-assignment-design.md for the full rationale.

alter table product_images add column color_id uuid references product_colors(id) on delete set null;
create index if not exists product_images_color_id_idx on product_images(color_id);

-- image_index was also the only thing ordering a product's color swatches
-- (fetchCatalog explicitly avoids ordering by row id -- see migration
-- 20260809050957's regression this guarded against: "swatch 1 showed
-- 'Variant 6'"). created_at replaces it as the ordering key, matching every
-- other table in this schema.
alter table product_colors add column created_at timestamptz not null default now();

-- Backfill color_id: replay the *current* range algorithm (data.ts's
-- fetchCatalog) so every image ends up assigned to exactly the color it
-- already effectively renders under today. For each product, a color owns
-- every image from its own image_index up to (but not including) the next
-- color's image_index (colors ordered by image_index, then id); the last
-- color owns the rest.
with ranked_images as (
  select id, product_id,
    row_number() over (partition by product_id order by sort_order, id) - 1 as img_pos
  from product_images
),
color_ranges as (
  select id as color_id, product_id, image_index,
    lead(image_index) over (partition by product_id order by image_index, id) as next_image_index
  from product_colors
)
update product_images pi
set color_id = cr.color_id
from ranked_images ri
join color_ranges cr
  on cr.product_id = ri.product_id
  and ri.img_pos >= cr.image_index
  and (cr.next_image_index is null or ri.img_pos < cr.next_image_index)
where pi.id = ri.id;

-- Backfill cover_image_id: the first (lowest sort_order) image each color now
-- owns, mirroring data.ts's current `ownImages[0]` fallback -- cover_image_id
-- has always existed on this table but was never populated by anything, so
-- every color's Thumbnail dropdown would otherwise start on "(no cover)"
-- immediately after this ships even though a perfectly good default exists.
with first_owned as (
  select distinct on (color_id) color_id, id as image_id
  from product_images
  where color_id is not null
  order by color_id, sort_order, id
)
update product_colors pc
set cover_image_id = fo.image_id
from first_owned fo
where pc.id = fo.color_id;

-- Backfill created_at: preserve each product's current image_index-derived
-- color order exactly, using a fixed base epoch offset by each color's
-- current rank within its product. Real colors created after this migration
-- get a real now() timestamp (Postgres default), which sorts after every
-- backfilled 2020-epoch value -- new colors correctly land at the end of the
-- swatch list instead of colliding at the start the way image_index=0 used to.
with ordered as (
  select id, row_number() over (partition by product_id order by image_index, id) as rn
  from product_colors
)
update product_colors pc
set created_at = timestamptz '2020-01-01 00:00:00+00' + (ordered.rn || ' seconds')::interval
from ordered
where pc.id = ordered.id;

alter table product_colors drop column image_index;
