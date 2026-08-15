-- supabase/migrations/20260815120000_create_brands_table.sql
create table brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  folder_slug text not null,
  is_primary boolean not null default true,
  thumbnail_storage_path text,
  created_at timestamptz not null default now()
);

-- Exactly one primary (folder-owning) row per folder.
create unique index brands_one_primary_per_folder
  on brands (folder_slug) where is_primary;

-- Only a primary row's thumbnail is ever shown (one card per folder on
-- /brands/) -- a collab row carrying its own thumbnail would be silently
-- ignored by the renderer, so reject it at the data layer instead.
alter table brands add constraint brands_collab_no_thumbnail
  check (is_primary or thumbnail_storage_path is null);

alter table brands enable row level security;

create policy "public read brands"
  on brands for select
  using (true);

create policy "admin write brands"
  on brands for all
  using (is_admin())
  with check (is_admin());
