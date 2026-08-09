-- Finding 5 reconciliation: product_colors.color_group is NOT NULL in the live
-- database, but Task 7 applied that lock outside the migration system, so no
-- recorded migration ever produced it and a replay from migrations alone would
-- have diverged from production. Recorded here, idempotently.
--
-- It carries a 2026-08-09 version (rather than sitting next to the other Task 7
-- work on 2026-08-08) because that is genuinely when it entered the migration
-- history. Ordering is harmless: on a fresh database product_colors is empty
-- when this runs, and the statements are no-ops when re-applied.
update product_colors set color_group = classify_color_group(hex) where color_group is null;
alter table product_colors alter column color_group set not null;
