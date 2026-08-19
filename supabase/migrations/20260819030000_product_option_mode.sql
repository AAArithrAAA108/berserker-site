-- Lets a product's swatches show a color, a free-text "variant" label
-- (e.g. "V1", "Edition A"), or both together as one combined option.
--
-- option_mode drives which fields the admin panel shows when adding a
-- color/option row for a given product; it does not gate rendering --
-- the storefront infers swatch display purely from the row's own data
-- (hex null => no real color; variant_label set => overlay text), so it
-- can never drift out of sync with a product's declared mode.
alter table products add column if not exists option_mode text not null default 'color'
  check (option_mode in ('color', 'variant', 'both'));

-- Only populated in 'both' mode: label stays the color name, this carries
-- the extra variant text shown alongside it. In 'variant' mode there is no
-- separate color name, so label itself holds the variant text directly and
-- this column stays null.
alter table product_colors add column if not exists variant_label text;
