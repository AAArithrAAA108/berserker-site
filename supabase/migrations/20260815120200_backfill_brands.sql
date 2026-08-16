-- supabase/migrations/20260815120200_backfill_brands.sql
-- Row order matches today's BRAND_FOLDERS (membership.ts) for the primaries,
-- then every distinct collab string currently in products.brand (verified
-- 2026-08-15 via `select brand, count(*) from products group by brand`).
insert into brands (name, folder_slug, is_primary) values
  ('Gymshark', 'gymshark', true),
  ('YoungLA', 'youngla', true),
  ('BreatheDivinity', 'breathedivinity', true),
  ('Chrome Hearts', 'chromehearts', true),
  ('Cactus Jack', 'cactusjack', true),
  ('Skims', 'skims', true),
  ('Lululemon', 'lululemon', true),
  ('Chrome Hearts × Mastermind', 'chromehearts', false),
  ('YoungLA × Batman', 'youngla', false),
  ('YoungLA × Superman', 'youngla', false),
  ('YoungLA × Gold''s Gym', 'youngla', false),
  ('Cactus Jack x Travis Scott', 'cactusjack', false),
  ('Cactus Jack x Travis Scott x Fragment', 'cactusjack', false),
  ('Cactus Jack x Travis Scott x McDonald''s', 'cactusjack', false),
  ('Cactus Jack x Travis Scott x Playstation', 'cactusjack', false);
