-- Lets a color/variant option carry a secondary color group alongside its
-- existing (primary) color_group, so a product can be found under either
-- when filtering the storefront by color -- e.g. a mostly-black hoodie
-- with a green print can be filtered under both "Black" (primary) and
-- "Green" (secondary). Nullable: most colors only need a primary group.
-- No auto-suggestion for this one (classify_color_group only infers a
-- single dominant color from hex/label) -- purely a manual admin choice.
alter table product_colors add column if not exists secondary_color_group text;
