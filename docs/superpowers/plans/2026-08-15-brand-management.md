# Brand Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin panel real brand management — create/rename brands (and their live folder), upload/replace a brand thumbnail, and pick a product's brand from a dropdown instead of typing it.

**Architecture:** A new `brands` table replaces the hardcoded `BRAND_PREFIX_MAP` in `membership.ts` and the free-text `products.brand` column. Collab brands ("YoungLA × Batman") are their own rows sharing a parent's folder. Publish gains a `brands/index.html` generated page and a rename-cleanup path that deletes a renamed brand's old folder in the same commit as writing its new one.

**Tech Stack:** Supabase Postgres (migrations, SECURITY DEFINER RPCs), Deno/TypeScript (`supabase/functions/publish-site`), vanilla JS admin panel (`admin/dashboard`).

**Spec:** `docs/superpowers/specs/2026-08-15-brand-management-design.md` — read this for full rationale on every decision below; this plan implements it task-by-task.

## Global Constraints

- Every SQL migration follows the existing project convention: filename `YYYYMMDDHHMMSS_description.sql` in `supabase/migrations/`, applied via `supabase db push --linked` from the linked worktree (`C:\Users\anind\berserker-site\.worktrees\live-storefront-generation`).
- Every privileged mutation (brand create, brand rename) is a `SECURITY DEFINER` function with `set search_path = public` and an `is_admin()` gate at the top — matching `set_product_position`/`delete_product_and_renumber` exactly (see `supabase/migrations/20260815061500_add_delete_renumber_and_cap_reposition.sql`).
- Reserved folder slugs (never allowed as a brand's `folder_slug`): `admin`, `checkout`, `collections`, `all-products`, `about-berserker`, `contact-berserker`, `returns-and-refunds`, `shipping-info`, `brands`.
- All Deno-side TypeScript changes live in `supabase/functions/publish-site/`; run `deno check supabase/functions/publish-site/index.ts` and `deno test` (from that directory) after every code task.
- Admin panel changes touch `admin/dashboard/index.html` and `admin/dashboard/products.js` (plus a new `admin/dashboard/brands.js`) directly on `main` (not this feature branch) — mirror every admin-panel edit to `C:\Users\anind\Downloads\berserker\admin\dashboard\` per the project's standing Downloads-mirroring workflow, diffing before overwriting.
- No task in this plan can exercise a real authenticated admin session (no live browser automation for Supabase auth in this environment) — RPC/RLS-gated behavior is verified by reading the SQL and confirming it matches the established pattern, not by a live admin call. This is the same limitation Foundation and live-storefront-generation both hit and documented; be explicit about it in each task's report rather than overclaiming.

---

## Task 1: `brands` table — schema, constraints, RLS

**Files:**
- Create: `supabase/migrations/20260815120000_create_brands_table.sql`

**Interfaces:**
- Produces: table `brands(id uuid pk, name text unique not null, folder_slug text not null, is_primary boolean not null default true, thumbnail_storage_path text, created_at timestamptz not null default now())`, unique index `brands_one_primary_per_folder`, check constraint `brands_collab_no_thumbnail`.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run: `cd C:\Users\anind\berserker-site\.worktrees\live-storefront-generation && supabase db push --linked`
Expected: `"migrations":["20260815120000_create_brands_table.sql"]` in the output, no errors.

- [ ] **Step 3: Verify the constraint actually rejects a second primary per folder**

Run: `supabase db query "insert into brands (name, folder_slug) values ('Test A', 'testfolder'); insert into brands (name, folder_slug) values ('Test B', 'testfolder');" --linked`
Expected: the second insert fails with a unique-violation on `brands_one_primary_per_folder`.

- [ ] **Step 4: Clean up the test rows and verify the collab-thumbnail check**

Run: `supabase db query "delete from brands where folder_slug = 'testfolder'; insert into brands (name, folder_slug, is_primary, thumbnail_storage_path) values ('Test Collab', 'gymshark', false, '_brands/x.jpg');" --linked`
Expected: fails with a check-violation on `brands_collab_no_thumbnail` (since `is_primary` is false but `thumbnail_storage_path` is set).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815120000_create_brands_table.sql
git commit -m "Add brands table with primary/collab folder-sharing model"
git push origin feature/live-storefront-generation
```

---

## Task 2: Brand RPCs — create_primary_brand, create_collab_brand, rename_brand_folder

**Files:**
- Create: `supabase/migrations/20260815120100_add_brand_rpcs.sql`

**Interfaces:**
- Consumes: `brands` table (Task 1), `is_admin()` (existing function, used by every other admin RPC in this project).
- Produces: `create_primary_brand(p_name text, p_folder_slug text, p_thumbnail_storage_path text) returns uuid`, `create_collab_brand(p_name text, p_parent_folder_slug text) returns uuid`, `rename_brand_folder(p_old_slug text, p_new_slug text) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260815120100_add_brand_rpcs.sql
create or replace function create_primary_brand(p_name text, p_folder_slug text, p_thumbnail_storage_path text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'create_primary_brand: admin privileges required';
  end if;

  if p_folder_slug in ('admin', 'checkout', 'collections', 'all-products', 'about-berserker', 'contact-berserker', 'returns-and-refunds', 'shipping-info', 'brands') then
    raise exception 'create_primary_brand: % is a reserved folder name', p_folder_slug;
  end if;

  if exists (select 1 from brands where folder_slug = p_folder_slug and is_primary) then
    raise exception 'create_primary_brand: folder % already exists', p_folder_slug;
  end if;

  insert into brands (name, folder_slug, is_primary, thumbnail_storage_path)
  values (p_name, p_folder_slug, true, p_thumbnail_storage_path)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function create_collab_brand(p_name text, p_parent_folder_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'create_collab_brand: admin privileges required';
  end if;

  if not exists (select 1 from brands where folder_slug = p_parent_folder_slug and is_primary) then
    raise exception 'create_collab_brand: no primary brand owns folder %', p_parent_folder_slug;
  end if;

  insert into brands (name, folder_slug, is_primary, thumbnail_storage_path)
  values (p_name, p_parent_folder_slug, false, null)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function rename_brand_folder(p_old_slug text, p_new_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'rename_brand_folder: admin privileges required';
  end if;

  if p_new_slug in ('admin', 'checkout', 'collections', 'all-products', 'about-berserker', 'contact-berserker', 'returns-and-refunds', 'shipping-info', 'brands') then
    raise exception 'rename_brand_folder: % is a reserved folder name', p_new_slug;
  end if;

  if p_old_slug = p_new_slug then
    return;
  end if;

  if not exists (select 1 from brands where folder_slug = p_old_slug) then
    raise exception 'rename_brand_folder: no brand owns folder %', p_old_slug;
  end if;

  if exists (select 1 from brands where folder_slug = p_new_slug) then
    raise exception 'rename_brand_folder: folder % already exists', p_new_slug;
  end if;

  update brands set folder_slug = p_new_slug where folder_slug = p_old_slug;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push --linked`
Expected: migration applied, no errors.

- [ ] **Step 3: Verify reserved-slug rejection**

Run: `supabase db query "select proname from pg_proc where proname in ('create_primary_brand','create_collab_brand','rename_brand_folder');" --linked`
Expected: all three listed (confirms they compiled and exist — the `is_admin()` gate means this environment's non-authenticated `db query` connection cannot exercise the happy path, same limitation noted in Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260815120100_add_brand_rpcs.sql
git commit -m "Add create_primary_brand/create_collab_brand/rename_brand_folder RPCs"
git push origin feature/live-storefront-generation
```

---

## Task 3: Backfill brand rows for existing data

**Files:**
- Create: `supabase/migrations/20260815120200_backfill_brands.sql`

**Interfaces:**
- Consumes: `brands` table (Task 1).
- Produces: 15 rows in `brands` — 7 primary, 8 collab — exactly matching every distinct `products.brand` string in production today, plus one primary (`Cactus Jack`) with no direct product usage (it exists to own the `cactusjack` folder/thumbnail; only its collabs are currently used by products).

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push --linked`
Expected: migration applied, no errors (note the escaped apostrophes in `Gold''s Gym` / `McDonald''s`).

- [ ] **Step 3: Verify every distinct existing product brand string has a matching row**

Run: `supabase db query "select p.brand from products p left join brands b on b.name = p.brand where b.id is null;" --linked`
Expected: zero rows returned (every product's current brand string matches a brand row's `name` exactly).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260815120200_backfill_brands.sql
git commit -m "Backfill brand rows matching every distinct existing product brand"
git push origin feature/live-storefront-generation
```

---

## Task 4: Migrate the 7 existing thumbnail images into Storage

**Files:**
- Create: `scripts/migrate-brand-thumbnails.ts`

**Interfaces:**
- Consumes: local files at `brands/images/<folder_slug>.jpg` (repo root, 7 files, already confirmed present), `brands` table (Task 3).
- Produces: 7 objects in the `product-images` Storage bucket under `_brands/`, and each matching primary row's `thumbnail_storage_path` populated.

- [ ] **Step 1: Write the script**

```typescript
// scripts/migrate-brand-thumbnails.ts
//
// One-off migration: uploads the 7 existing hand-authored brand thumbnails
// (brands/images/<folder_slug>.jpg) into the product-images Storage bucket
// under a _brands/ prefix, and records each path on the matching primary
// brands row. Run once, after Task 3's row backfill.
//
// Run with:
//   deno run --allow-net --allow-env --allow-read --env-file=.env.local scripts/migrate-brand-thumbnails.ts
//
// Required env vars (see .env.local):
//   SUPABASE_URL               e.g. https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role secret

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FOLDER_SLUGS = ["gymshark", "youngla", "breathedivinity", "chromehearts", "cactusjack", "skims", "lululemon"];

for (const slug of FOLDER_SLUGS) {
  const localPath = `./brands/images/${slug}.jpg`;
  const bytes = await Deno.readFile(localPath);
  const storagePath = `_brands/${slug}-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(storagePath, bytes, { contentType: "image/jpeg" });
  if (uploadError) throw new Error(`upload failed for ${slug}: ${uploadError.message}`);

  const { error: updateError } = await supabase
    .from("brands")
    .update({ thumbnail_storage_path: storagePath })
    .eq("folder_slug", slug)
    .eq("is_primary", true);
  if (updateError) throw new Error(`update failed for ${slug}: ${updateError.message}`);

  console.log(`${slug} -> ${storagePath}`);
}

console.log(`Migrated ${FOLDER_SLUGS.length} brand thumbnails.`);
```

- [ ] **Step 2: Run it**

Run: `cd C:\Users\anind\berserker-site\.worktrees\live-storefront-generation && deno run --allow-net --allow-env --allow-read --env-file=.env.local scripts/migrate-brand-thumbnails.ts`
Expected: 7 lines of `<slug> -> _brands/<slug>-<timestamp>.jpg`, then the summary line.

- [ ] **Step 3: Verify all 7 primary rows now have a thumbnail**

Run: `supabase db query "select folder_slug, thumbnail_storage_path from brands where is_primary order by folder_slug;" --linked`
Expected: all 7 rows have a non-null `thumbnail_storage_path` starting with `_brands/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-brand-thumbnails.ts
git commit -m "Add and run one-off script migrating brand thumbnails into Storage"
git push origin feature/live-storefront-generation
```

---

## Task 5: `products.brand_id` foreign key — add, backfill, lock, drop old column

**Files:**
- Create: `supabase/migrations/20260815120300_products_brand_id.sql`

**Interfaces:**
- Consumes: `brands` table fully backfilled (Task 3), `products.brand` (existing text column).
- Produces: `products.brand_id uuid not null references brands(id)`; `products.brand` no longer exists.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260815120300_products_brand_id.sql
-- Nullable first so the backfill UPDATE has something to target; every
-- distinct products.brand string is already guaranteed to match a brands.name
-- row (verified in Task 3 Step 3), so the NOT NULL lock below is safe.
alter table products add column brand_id uuid references brands(id);

update products p
set brand_id = b.id
from brands b
where b.name = p.brand;

-- Fail loudly here rather than silently locking a column with nulls in it --
-- if this raises, some product's brand string didn't match any brands.name
-- row and Task 3's backfill needs a fix before proceeding.
do $$
begin
  if exists (select 1 from products where brand_id is null) then
    raise exception 'products_brand_id backfill incomplete -- % products have no matching brand', (select count(*) from products where brand_id is null);
  end if;
end $$;

alter table products alter column brand_id set not null;
alter table products drop column brand;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push --linked`
Expected: migration applied, no errors (the `do $$ ... $$` block would raise and abort the whole migration if any product were unmatched).

- [ ] **Step 3: Verify the column swap**

Run: `supabase db query "select column_name from information_schema.columns where table_name = 'products' and column_name in ('brand','brand_id');" --linked`
Expected: only `brand_id` listed, not `brand`.

- [ ] **Step 4: Verify product/brand data round-trips correctly**

Run: `supabase db query "select p.name, b.name as brand_name, b.folder_slug from products p join brands b on b.id = p.brand_id where b.name = 'YoungLA × Batman';" --linked`
Expected: the one YoungLA × Batman product, with `folder_slug = 'youngla'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815120300_products_brand_id.sql
git commit -m "Replace products.brand text column with a strict brand_id foreign key"
git push origin feature/live-storefront-generation
```

---

## Task 6: `membership.ts` — retire prefix matching

**Files:**
- Modify: `supabase/functions/publish-site/membership.ts`
- Modify: `supabase/functions/publish-site/membership.test.ts`

**Interfaces:**
- Produces: `brandFolderFor(product: { brandFolder: string }): string` (was `{ brand: string }`, prefix-matched against `BRAND_PREFIX_MAP`). `BRAND_PREFIX_MAP` and `BRAND_FOLDERS` are removed from this file (folder list now comes from `data.ts`, Task 7).

- [ ] **Step 1: Write the failing test**

```typescript
// membership.test.ts -- replace the existing brandFolderFor tests with:
Deno.test("brandFolderFor: returns the product's own brandFolder field directly, no matching", () => {
  assertEquals(brandFolderFor({ brandFolder: "youngla" }), "youngla");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd C:\Users\anind\berserker-site\.worktrees\live-storefront-generation\supabase\functions\publish-site && deno test membership.test.ts`
Expected: FAIL — old `brandFolderFor` signature takes `{ brand: string }` and does prefix matching, not `{ brandFolder: string }`.

- [ ] **Step 3: Remove BRAND_PREFIX_MAP/BRAND_FOLDERS, simplify brandFolderFor**

Delete the `BRAND_PREFIX_MAP` and `BRAND_FOLDERS` exports and replace the function:

```typescript
export function brandFolderFor(product: { brandFolder: string }): string {
  return product.brandFolder;
}
```

Delete the old `brandFolderFor: exact brand name matches its folder` and `brandFolderFor: collab brand text still matches via prefix` tests (they tested the retired prefix-matching behavior) and the `COLLECTION_SLUGS and BRAND_FOLDERS have the expected counts` test's `BRAND_FOLDERS` half (keep the `COLLECTION_SLUGS` half, since that constant is untouched).

- [ ] **Step 4: Run it to see it pass**

Run: `deno test membership.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/membership.ts supabase/functions/publish-site/membership.test.ts
git commit -m "Retire brand-prefix matching now that brand carries its own folder"
git push origin feature/live-storefront-generation
```

---

## Task 7: `data.ts` — join brands, expose brandFolder and the primary-brand list

**Files:**
- Modify: `supabase/functions/publish-site/data.ts`
- Modify: `supabase/functions/publish-site/data.test.ts`

**Interfaces:**
- Consumes: `products.brand_id` (Task 5).
- Produces: `CatalogProduct.brand: string` (unchanged shape, now sourced via join instead of a raw column), new `CatalogProduct.brandFolder: string`; new `export interface PrimaryBrand { name: string; folderSlug: string; thumbnailUrl: string }` and `export async function fetchPrimaryBrands(supabase: SupabaseClient): Promise<PrimaryBrand[]>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// data.test.ts -- add:
Deno.test("fetchCatalog: joins brand name and folder onto each product", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Batman Jacket", slug: "yl-batman", price: 100, cod_advance: 10, position: 1, category: "jacket", sleeve_length: null, description: null },
    ],
    product_colors: [],
    product_images: [],
    product_variants: [],
    brands: [
      { id: "b1", name: "YoungLA × Batman", folder_slug: "youngla", is_primary: false, thumbnail_storage_path: null },
    ],
  });
  const catalog = await fetchCatalog(supabase);
  assertEquals(catalog.products[0].brand, "YoungLA × Batman");
  assertEquals(catalog.products[0].brandFolder, "youngla");
});

Deno.test("fetchPrimaryBrands: returns only primary rows, with their thumbnail URL", async () => {
  const supabase = fakeSupabase({
    products: [], product_colors: [], product_images: [], product_variants: [],
    brands: [
      { id: "b1", name: "Gymshark", folder_slug: "gymshark", is_primary: true, thumbnail_storage_path: "_brands/gymshark-1.jpg" },
      { id: "b2", name: "YoungLA × Batman", folder_slug: "youngla", is_primary: false, thumbnail_storage_path: null },
    ],
  });
  const brands = await fetchPrimaryBrands(supabase);
  assertEquals(brands, [{ name: "Gymshark", folderSlug: "gymshark", thumbnailUrl: "https://fake.test/_brands/gymshark-1.jpg" }]);
});
```

Extend `fakeSupabase`'s `tables` parameter type to also accept a `brands` array, matching the existing `product_colors`/`product_images`/`product_variants` pattern already in the file.

- [ ] **Step 2: Run them to see them fail**

Run: `deno test data.test.ts`
Expected: FAIL — `fetchCatalog` doesn't select `brand_id` or join brands yet; `fetchPrimaryBrands` doesn't exist.

- [ ] **Step 3: Implement**

In `fetchCatalog`, change the products select from `"id, brand, name, slug, price, cod_advance, position, category, sleeve_length, description"` to `"id, brand_id, name, slug, price, cod_advance, position, category, sleeve_length, description"`, add a brands fetch alongside the existing colors/images/variants fetches:

```typescript
const { data: brands, error: brandsError } = await supabase
  .from("brands")
  .select("id, name, folder_slug");
if (brandsError) throw new Error(`fetchCatalog brands: ${brandsError.message}`);

const brandById = new Map((brands ?? []).map((b) => [b.id, b]));
```

In the final `products.map(...)`, replace `brand: p.brand,` with:

```typescript
brand: brandById.get(p.brand_id)?.name ?? "",
brandFolder: brandById.get(p.brand_id)?.folder_slug ?? "",
```

Add `brandFolder: string;` to the `CatalogProduct` interface, next to `brand: string;`.

Add the new export at the bottom of the file:

```typescript
export interface PrimaryBrand { name: string; folderSlug: string; thumbnailUrl: string }

export async function fetchPrimaryBrands(supabase: SupabaseClient): Promise<PrimaryBrand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("name, folder_slug, thumbnail_storage_path")
    .eq("is_primary", true)
    .order("name", { ascending: true });
  if (error) throw new Error(`fetchPrimaryBrands: ${error.message}`);

  const publicUrl = (path: string) =>
    supabase.storage.from(STORAGE_BASE).getPublicUrl(path).data.publicUrl;

  return (data ?? []).map((b) => ({
    name: b.name,
    folderSlug: b.folder_slug,
    thumbnailUrl: b.thumbnail_storage_path ? publicUrl(b.thumbnail_storage_path) : "",
  }));
}
```

- [ ] **Step 4: Run tests to see them pass**

Run: `deno test data.test.ts`
Expected: PASS. Also run the full suite (`deno test`) — the existing `fetchCatalog` tests' fixtures need a `brands` array added to their `fakeSupabase(...)` calls (previously omitted since brand was a raw column); add a minimal one-row `brands` fixture to each existing test that constructs a product, matching its `brand_id`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/data.ts supabase/functions/publish-site/data.test.ts
git commit -m "Join brands in fetchCatalog; add fetchPrimaryBrands for the brands index page"
git push origin feature/live-storefront-generation
```

---

## Task 8: `render.ts` — renderBrandsIndexPage

**Files:**
- Modify: `supabase/functions/publish-site/render.ts`
- Modify: `supabase/functions/publish-site/render.test.ts`

**Interfaces:**
- Consumes: `PrimaryBrand[]` (Task 7), `esc()`, `renderShell()` (existing).
- Produces: `export function renderBrandsIndexPage(brands: PrimaryBrand[]): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// render.test.ts -- add:
import { fetchPrimaryBrands } from "./data.ts"; // for the PrimaryBrand type only, via `import type`
// (add PrimaryBrand to the existing `import type { ... } from "./data.ts"` line instead of a new import)

Deno.test("renderBrandsIndexPage: one .cat-card per brand, linking to its folder with its thumbnail and label", () => {
  const html = renderBrandsIndexPage([
    { name: "Gymshark", folderSlug: "gymshark", thumbnailUrl: "https://fake.test/_brands/gymshark-1.jpg" },
    { name: "YoungLA", folderSlug: "youngla", thumbnailUrl: "https://fake.test/_brands/youngla-1.jpg" },
  ]);
  assertStringIncludes(html, '<a href="/gymshark/" class="cat-card"');
  assertStringIncludes(html, 'src="https://fake.test/_brands/gymshark-1.jpg"');
  assertStringIncludes(html, '<div class="cat-label">Gymshark</div>');
  assertStringIncludes(html, '<a href="/youngla/" class="cat-card"');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `deno test render.test.ts`
Expected: FAIL — `renderBrandsIndexPage` is not defined.

- [ ] **Step 3: Implement**

Add near the other page-level render functions (`renderListingPage`, `renderCollectionPage`, `renderBrandPage`):

```typescript
export function renderBrandsIndexPage(brands: PrimaryBrand[]): string {
  const cards = brands
    .map(
      (b) =>
        `<a href="/${esc(b.folderSlug)}/" class="cat-card" style="display:block;text-decoration:none;">
      <img src="${esc(b.thumbnailUrl)}" alt="${esc(b.name)}" style="width:100%;height:100%;object-fit:cover;" />
      <div class="cat-label">${esc(b.name)}</div>
    </a>`
    )
    .join("\n");
  const bodyContent = `
<section class="section">
  <h2 class="section-title">ALL<br><span>BRANDS</span></h2>
  <div class="cat-grid">${cards}</div>
</section>`;
  return renderShell({ title: "Brands — BERSERKER", bodyContent });
}
```

Add `PrimaryBrand` to the existing `import type { CatalogProduct, ... } from "./data.ts"` line at the top of the file.

- [ ] **Step 4: Run it to see it pass**

Run: `deno test render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "Add renderBrandsIndexPage"
git push origin feature/live-storefront-generation
```

---

## Task 9: `github.ts` — support deleting paths in the same commit

**Files:**
- Modify: `supabase/functions/publish-site/github.ts`

**Interfaces:**
- Produces: `commitFiles(files: Record<string, string>, message: string, githubToken: string, deletePaths?: string[]): Promise<{ commitSha: string }>` (new optional 4th parameter; existing 3-argument call sites in `index.ts` are unaffected).

- [ ] **Step 1: Implement**

GitHub's Git Data API tree endpoint deletes a path from the base tree when its entry has `sha: null` (no separate delete endpoint needed for a tree-based commit). Change the signature and the tree-entries construction:

```typescript
export async function commitFiles(
  files: Record<string, string>,
  message: string,
  githubToken: string,
  deletePaths: string[] = []
): Promise<{ commitSha: string }> {
```

After the existing `treeEntries` (blob-creation) block, add:

```typescript
  const deleteEntries = deletePaths.map((path) => ({ path, mode: "100644", type: "blob" as const, sha: null }));
```

And change the tree-creation call's `tree` field from `treeEntries` to `[...treeEntries, ...deleteEntries]`.

- [ ] **Step 2: Type-check**

Run: `cd C:\Users\anind\berserker-site\.worktrees\live-storefront-generation && deno check supabase/functions/publish-site/index.ts`
Expected: no errors (the new parameter is optional and defaults to `[]`, so `index.ts`'s existing 3-argument calls still compile).

There is no unit test for this function (it makes real GitHub API calls; the existing codebase has never unit-tested `github.ts` for the same reason — verified by its absence from the test suite). Task 10's live verification covers this in practice.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/publish-site/github.ts
git commit -m "Let commitFiles delete paths in the same commit as writing new ones"
git push origin feature/live-storefront-generation
```

---

## Task 10: `index.ts` — generate brands/index.html; handle folder-rename cleanup

**Files:**
- Modify: `supabase/functions/publish-site/index.ts`

**Interfaces:**
- Consumes: `fetchPrimaryBrands` (Task 7), `renderBrandsIndexPage` (Task 8), `commitFiles(..., deletePaths?)` (Task 9).
- Produces: the publish handler's request body gains two optional fields, `renameFrom?: string` and `renameTo?: string`; when both are present, the response's file list still reflects the normal generation, but the commit additionally deletes the old folder's files.

- [ ] **Step 1: Add the brands page to the generated file set**

In the file-generation block (after the existing PDP loop), add:

```typescript
const primaryBrands = await fetchPrimaryBrands(supabase);
files["brands/index.html"] = renderBrandsIndexPage(primaryBrands);
```

Add `fetchPrimaryBrands` to the existing `import { fetchCatalog } from "./data.ts";` line and `renderBrandsIndexPage` to the existing `import { renderListingPage, ... } from "./render.ts";` line.

- [ ] **Step 2: Add rename-cleanup support**

`req.json()` can only be consumed once per request, so `renameFrom`/`renameTo` must be read from the *same* `try { const body = await req.json(); ... }` block that already parses `dryRun` — not a second call. Replace the existing block:

```typescript
let dryRun = false;
try {
  const body = await req.json();
  dryRun = body?.dryRun === true;
} catch {
  // no JSON body sent — dryRun stays false, matches current behavior of a bodyless POST
}
```

with:

```typescript
let dryRun = false;
let renameFrom: string | undefined;
let renameTo: string | undefined;
try {
  const body = await req.json();
  dryRun = body?.dryRun === true;
  renameFrom = typeof body?.renameFrom === "string" ? body.renameFrom : undefined;
  renameTo = typeof body?.renameTo === "string" ? body.renameTo : undefined;
} catch {
  // no JSON body sent — dryRun stays false, renameFrom/renameTo stay undefined
}
```

Immediately before the `commitFiles(...)` call, compute the delete paths when a rename is in progress:

```typescript
const deletePaths: string[] = [];
if (renameFrom && renameTo) {
  deletePaths.push(`${renameFrom}/index.html`);
  for (const product of catalog.products) {
    if (product.brandFolder === renameTo) {
      deletePaths.push(`${renameFrom}/${product.slug}/index.html`);
    }
  }
}
```

Change the `commitFiles` call from `commitFiles(files, ..., githubToken)` to `commitFiles(files, ..., githubToken, deletePaths)`.

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/publish-site/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/publish-site/index.ts
git commit -m "Generate brands/index.html; delete a renamed brand's old folder in the same commit"
git push origin feature/live-storefront-generation
```

---

## Task 11: Deploy and verify against real data

**Files:** none (verification task).

- [ ] **Step 1: Deploy**

Run: `cd C:\Users\anind\berserker-site\.worktrees\live-storefront-generation && supabase functions deploy publish-site --use-api`
Expected: `"message":"Deployed Functions."`.

- [ ] **Step 2: Regenerate locally and verify the brands page**

Run: `deno run --allow-net --allow-env --allow-read --allow-write --env-file=.env.local scripts/verify-storefront-generation.ts`

Then inspect `scratch-generated-pages/brands.html` (note: the verification script writes top-level pages as `<name>.html` for pages with no slug — if `brands/index.html`'s scratch filename isn't already covered by the script's existing pattern, add one line to `scripts/verify-storefront-generation.ts` alongside its `all-products.html` write: `await Deno.writeTextFile(`${outDir}/brands.html`, renderBrandsIndexPage(await fetchPrimaryBrands(supabase)));`).

Expected: 7 `.cat-card` entries, one per primary brand, each with a real `_brands/...jpg` thumbnail URL and correct `/​<folder>/` link — confirm by grep, same discipline as every other verification pass this project has done:

```bash
grep -o 'cat-card' scratch-generated-pages/brands.html | wc -l
```

Expected: 14 (each card contributes one open + this counts substring occurrences of the class name itself once per card in the `<a class="cat-card"` opening tag — adjust the exact count check to however many `<a href="/[a-z]*/" class="cat-card"` matches appear; the concrete number to look for is exactly 7, one per primary brand).

- [ ] **Step 3: Verify a collab product still resolves to its parent's folder**

```bash
grep -A3 'youngla-batman-jacket' scratch-generated-pages/all-products.html
```

Expected: the card's PDP link is `/youngla/<slug>/`, not `/youngla-x-batman/` or any other new path — confirms the FK-based `brandFolder` join produces the same routing as the old prefix-matching did.

- [ ] **Step 4: Report**

Write findings into this task's report: whether the brands page rendered correctly, whether collab routing matched pre-migration behavior, and explicitly note that the rename-cleanup path (Task 10) has not been exercised end-to-end here — that requires a real admin session to call `rename_brand_folder` and then trigger publish with `renameFrom`/`renameTo`, which is the same "no live browser automation for auth" limitation as every other task, and is deferred to manual verification once Task 13's admin UI ships.

---

## Task 12: Admin panel — Brands tab

**Files:**
- Create: `admin/dashboard/brands.js`
- Modify: `admin/dashboard/index.html`

**Interfaces:**
- Consumes: `sb` (the existing global Supabase client, initialized in `index.html`'s inline script), `esc`/`fmtMoney` (existing globals from `index.html`), the three RPCs (Task 2), storage upload pattern (matching `products.js`'s existing `sb.storage.from('product-images').upload(...)`).
- Produces: a working "Brands" tab: list (primary brands with thumbnail, name, folder; collabs nested under their parent), add-primary form, add-collab form, rename, thumbnail replace.

- [ ] **Step 1: Add the tab button and panel shell to index.html**

In the `.tabs` div, after the existing `products` button:

```html
<button class="tab-btn" data-tab="brands">Brands</button>
```

In `<main>`, after the `panel-products` section closes:

```html
<!-- BRANDS -->
<section class="panel" id="panel-brands">
  <div class="panel-title">Brands</div>
  <button class="btn secondary" id="show-add-brand-btn" style="margin-bottom:16px;">+ Add New Brand</button>
  <button class="btn secondary" id="show-add-collab-btn" style="margin-bottom:16px;">+ Add Collab</button>
  <div id="add-brand-form-wrap" style="display:none;"></div>
  <div id="add-collab-form-wrap" style="display:none;"></div>
  <div id="brands-loading" class="loading-note">Loading brands...</div>
  <div class="table-wrap" id="brands-table-wrap" style="display:none;">
    <table>
      <thead><tr><th>Thumbnail</th><th>Name</th><th>Folder</th><th>Actions</th></tr></thead>
      <tbody id="brands-tbody"></tbody>
    </table>
  </div>
</section>
```

Add `<script src="brands.js"></script>` after the existing `<script src="products.js"></script>` line.

- [ ] **Step 2: Wire tab loading**

Find the existing tab-click handler (`document.querySelectorAll('.tab-btn').forEach(...)`) and its per-tab load dispatch (there's already a pattern here for `orders`/`coupons`/`products`/`admins` — follow it exactly). Add a `brands` case that calls a new `loadBrandsList()` (defined in `brands.js`).

- [ ] **Step 3: Write brands.js — list rendering**

```javascript
// admin/dashboard/brands.js
// Depends on globals from index.html's inline script, loaded first: sb, esc.

var brandsCache = [];

async function loadBrandsList() {
  var { data, error } = await sb.from('brands').select('*').order('name', { ascending: true });
  document.getElementById('brands-loading').style.display = 'none';
  if (error) {
    document.getElementById('brands-loading').style.display = 'block';
    document.getElementById('brands-loading').textContent = 'Failed to load brands: ' + error.message;
    return;
  }
  brandsCache = data;
  document.getElementById('brands-table-wrap').style.display = 'block';
  renderBrandsTable();
}

function renderBrandsTable() {
  var tbody = document.getElementById('brands-tbody');
  tbody.innerHTML = '';
  var primaries = brandsCache.filter(function(b) { return b.is_primary; });
  primaries.forEach(function(primary) {
    tbody.appendChild(brandRow(primary, false));
    brandsCache.filter(function(b) { return !b.is_primary && b.folder_slug === primary.folder_slug; })
      .forEach(function(collab) { tbody.appendChild(brandRow(collab, true)); });
  });
  wireBrandRowButtons();
}

function brandRow(b, isCollab) {
  var thumbUrl = b.thumbnail_storage_path ? sb.storage.from('product-images').getPublicUrl(b.thumbnail_storage_path).data.publicUrl : '';
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td>' + (thumbUrl ? '<img src="' + esc(thumbUrl) + '" style="width:36px;height:36px;object-fit:cover;" />' : '<span style="color:var(--muted);">—</span>') + '</td>' +
    '<td>' + (isCollab ? '&nbsp;&nbsp;↳ ' : '') + esc(b.name) + '</td>' +
    '<td>' + esc(b.folder_slug) + '</td>' +
    '<td class="btn-row">' +
      '<button class="btn secondary rename-brand-btn" data-id="' + b.id + '" data-primary="' + b.is_primary + '">Rename</button>' +
      (b.is_primary ? '<button class="btn secondary replace-thumb-btn" data-id="' + b.id + '" data-folder="' + esc(b.folder_slug) + '" data-path="' + esc(b.thumbnail_storage_path || '') + '">Replace Thumbnail</button>' : '') +
    '</td>';
  return tr;
}
```

- [ ] **Step 4: Write brands.js — add primary brand form**

```javascript
document.getElementById('show-add-brand-btn').addEventListener('click', function() {
  var wrap = document.getElementById('add-brand-form-wrap');
  if (wrap.style.display === 'none') { wrap.style.display = 'block'; renderAddBrandForm(); }
  else { wrap.style.display = 'none'; }
});

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function renderAddBrandForm() {
  var wrap = document.getElementById('add-brand-form-wrap');
  wrap.innerHTML =
    '<form class="add-form" id="add-brand-form">' +
      '<div class="field"><label>Name</label><input type="text" name="name" required style="width:200px;" /></div>' +
      '<div class="field"><label>Folder Slug</label><input type="text" name="folder_slug" required style="width:160px;" /></div>' +
      '<div class="field"><label>Thumbnail</label><input type="file" name="thumbnail" accept="image/*" required /></div>' +
      '<button type="submit" class="btn">Create Brand</button>' +
      '<p class="msg" id="add-brand-msg"></p>' +
    '</form>';

  var nameInput = wrap.querySelector('input[name="name"]');
  var slugInput = wrap.querySelector('input[name="folder_slug"]');
  var slugTouched = false;
  slugInput.addEventListener('input', function() { slugTouched = true; });
  nameInput.addEventListener('input', function() {
    if (!slugTouched) slugInput.value = slugify(nameInput.value);
  });

  document.getElementById('add-brand-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById('add-brand-msg');
    var file = form.thumbnail.files[0];
    var folderSlug = form.folder_slug.value.trim();
    var storagePath = '_brands/' + folderSlug + '-' + Date.now() + '.' + file.name.split('.').pop();

    var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
    if (uploadError) { msg.style.color = '#ff3c1e'; msg.textContent = 'Thumbnail upload failed: ' + uploadError.message; return; }

    var { error } = await sb.rpc('create_primary_brand', {
      p_name: form.name.value.trim(),
      p_folder_slug: folderSlug,
      p_thumbnail_storage_path: storagePath,
    });
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Brand created.';
      form.reset();
      loadBrandsList();
    }
  });
}
```

- [ ] **Step 5: Write brands.js — add collab form**

```javascript
document.getElementById('show-add-collab-btn').addEventListener('click', function() {
  var wrap = document.getElementById('add-collab-form-wrap');
  if (wrap.style.display === 'none') { wrap.style.display = 'block'; renderAddCollabForm(); }
  else { wrap.style.display = 'none'; }
});

function renderAddCollabForm() {
  var wrap = document.getElementById('add-collab-form-wrap');
  var primaries = brandsCache.filter(function(b) { return b.is_primary; });
  wrap.innerHTML =
    '<form class="add-form" id="add-collab-form">' +
      '<div class="field"><label>Name</label><input type="text" name="name" required placeholder="e.g. YoungLA × Batman" style="width:240px;" /></div>' +
      '<div class="field"><label>Shares Folder Of</label><select name="parent_folder" required>' +
        primaries.map(function(p) { return '<option value="' + esc(p.folder_slug) + '">' + esc(p.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<button type="submit" class="btn">Create Collab</button>' +
      '<p class="msg" id="add-collab-msg"></p>' +
    '</form>';

  document.getElementById('add-collab-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById('add-collab-msg');
    var { error } = await sb.rpc('create_collab_brand', {
      p_name: form.name.value.trim(),
      p_parent_folder_slug: form.parent_folder.value,
    });
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Collab brand created.';
      form.reset();
      loadBrandsList();
    }
  });
}
```

- [ ] **Step 6: Write brands.js — rename and thumbnail replace**

```javascript
function wireBrandRowButtons() {
  document.querySelectorAll('.rename-brand-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var b = brandsCache.find(function(x) { return x.id === btn.dataset.id; });
      var newName = prompt('New name:', b.name);
      if (newName === null || newName.trim() === '') return;
      if (b.is_primary) {
        var newSlug = prompt('New folder slug:', b.folder_slug);
        if (newSlug === null || newSlug.trim() === '') return;
        if (newSlug.trim() !== b.folder_slug) {
          var { error: renameError } = await sb.rpc('rename_brand_folder', { p_old_slug: b.folder_slug, p_new_slug: newSlug.trim() });
          if (renameError) { alert('Rename failed: ' + renameError.message); return; }
          // Trigger a scoped publish to move the folder's live pages -- same
          // publish-site function, with renameFrom/renameTo so it deletes
          // the old folder's files in the same commit it writes the new one.
          var { data: sessionData } = await sb.auth.getSession();
          await fetch(SUPABASE_URL + '/functions/v1/publish-site', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionData.session.access_token },
            body: JSON.stringify({ renameFrom: b.folder_slug, renameTo: newSlug.trim() }),
          });
        }
      }
      var { error } = await sb.from('brands').update({ name: newName.trim() }).eq('id', b.id);
      if (error) { alert('Rename failed: ' + error.message); return; }
      loadBrandsList();
    });
  });

  document.querySelectorAll('.replace-thumb-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async function() {
        var file = input.files[0];
        if (!file) return;
        var storagePath = '_brands/' + btn.dataset.folder + '-' + Date.now() + '.' + file.name.split('.').pop();
        var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
        if (uploadError) { alert('Upload failed: ' + uploadError.message); return; }
        var { error } = await sb.from('brands').update({ thumbnail_storage_path: storagePath }).eq('id', btn.dataset.id);
        if (error) { alert('Update failed: ' + error.message); return; }
        if (btn.dataset.path) {
          await sb.storage.from('product-images').remove([btn.dataset.path]);
        }
        loadBrandsList();
      });
      input.click();
    });
  });
}
```

- [ ] **Step 7: Mirror to Downloads and verify**

Per the project's standing workflow (diff before overwriting, since the Downloads copy is sometimes edited independently):

```bash
diff --strip-trailing-cr "C:\Users\anind\Downloads\berserker\admin\dashboard\index.html" "C:\Users\anind\berserker-site\admin\dashboard\index.html"
```

Expected: only this task's own changes appear in the diff (the new tab button, the new `panel-brands` section, the new `<script src="brands.js">` line, the new tab-load-dispatch case) — if anything else differs, reconcile before overwriting rather than blindly copying. Once confirmed:

```bash
sed 's/\r$//' "C:\Users\anind\berserker-site\admin\dashboard\index.html" > "C:\Users\anind\Downloads\berserker\admin\dashboard\index.html"
sed 's/\r$//' "C:\Users\anind\berserker-site\admin\dashboard\brands.js" > "C:\Users\anind\Downloads\berserker\admin\dashboard\brands.js"
diff --strip-trailing-cr "C:\Users\anind\Downloads\berserker\admin\dashboard\index.html" "C:\Users\anind\berserker-site\admin\dashboard\index.html" && echo MATCH
diff --strip-trailing-cr "C:\Users\anind\Downloads\berserker\admin\dashboard\brands.js" "C:\Users\anind\berserker-site\admin\dashboard\brands.js" && echo MATCH
```

Expected: both print `MATCH`.

- [ ] **Step 8: Commit**

```bash
git add admin/dashboard/index.html admin/dashboard/brands.js
git commit -m "Add Brands tab: create/rename primary and collab brands, thumbnail upload/replace"
git push origin main
```

(This commits to `main`, not this feature branch — matching how every other admin-panel change today was handled, since `admin/` isn't part of the publish pipeline this feature branch touches.)

---

## Task 13: Admin panel — Products tab brand dropdown

**Files:**
- Modify: `admin/dashboard/products.js`

**Interfaces:**
- Consumes: `brandsCache` (Task 12) — call `loadBrandsList()` before rendering either product form if `brandsCache` is empty, so the dropdown has data even if the admin hasn't opened the Brands tab yet this session.

- [ ] **Step 1: Update the products list query and display**

Change `loadProductsList`'s select from `'*, product_colors(...)'` to also join brands:

```javascript
.select('*, brands(name), product_colors(id, label, hex, color_group, cover_image_id)')
```

Change the table-row rendering's `esc(p.brand)` (currently reading a column that no longer exists) to `esc(p.brands.name)`.

- [ ] **Step 2: Replace the brand input with a dropdown in both forms**

In `renderEditForm`, replace:

```javascript
'<div class="field"><label>Brand</label><input type="text" name="brand" value="' + esc(product.brand) + '" required style="width:160px;" /></div>' +
```

with:

```javascript
'<div class="field"><label>Brand</label><select name="brand_id" required>' + brandOptions(product.brand_id) + '</select></div>' +
```

In `renderAddProductForm`, replace the equivalent free-text input with:

```javascript
'<div class="field"><label>Brand</label><select name="brand_id" required>' + brandOptions(null) + '</select></div>' +
```

Add the shared helper (grouping collabs under their parent, matching the Brands tab's list grouping):

```javascript
function brandOptions(selectedId) {
  var primaries = brandsCache.filter(function(b) { return b.is_primary; });
  return primaries.map(function(primary) {
    var opts = '<option value="' + primary.id + '"' + (primary.id === selectedId ? ' selected' : '') + '>' + esc(primary.name) + '</option>';
    opts += brandsCache.filter(function(b) { return !b.is_primary && b.folder_slug === primary.folder_slug; })
      .map(function(collab) { return '<option value="' + collab.id + '"' + (collab.id === selectedId ? ' selected' : '') + '>&nbsp;&nbsp;↳ ' + esc(collab.name) + '</option>'; })
      .join('');
    return opts;
  }).join('');
}
```

- [ ] **Step 3: Update both forms' submit handlers**

In `renderEditForm`'s submit handler, change `brand: form.brand.value.trim(),` to `brand_id: form.brand_id.value,`.

In `renderAddProductForm`'s submit handler, change `brand: form.brand.value.trim(),` to `brand_id: form.brand_id.value,`.

- [ ] **Step 4: Ensure brandsCache is populated before either form renders**

At the top of both `renderEditForm(product)` and `renderAddProductForm()`, add:

```javascript
if (!brandsCache.length) { await loadBrandsList(); }
```

(Both functions need `async` added to their signature if not already present — `renderEditForm` currently isn't async; add it and update its one call site, inside the edit-button click handler in `wireEditButtons`, to `await renderEditForm(product);` with that handler itself already being `async` per the existing pattern.)

- [ ] **Step 5: Mirror to Downloads, verify, commit**

```bash
diff --strip-trailing-cr "C:\Users\anind\Downloads\berserker\admin\dashboard\products.js" "C:\Users\anind\berserker-site\admin\dashboard\products.js"
```

Expected: only this task's own changes appear (the query/display change, the two form field swaps, the two submit-handler field renames, `brandOptions`, the `brandsCache` population guards). Once confirmed:

```bash
sed 's/\r$//' "C:\Users\anind\berserker-site\admin\dashboard\products.js" > "C:\Users\anind\Downloads\berserker\admin\dashboard\products.js"
diff --strip-trailing-cr "C:\Users\anind\Downloads\berserker\admin\dashboard\products.js" "C:\Users\anind\berserker-site\admin\dashboard\products.js" && echo MATCH
```

Expected: prints `MATCH`.

```bash
git add admin/dashboard/products.js
git commit -m "Make product brand a dropdown sourced from the brands table"
git push origin main
```

---

## Task 14: Final whole-branch review

**Files:** none (review task).

- [ ] **Step 1: Run the full test suite one more time**

Run: `cd C:\Users\anind\berserker-site\.worktrees\live-storefront-generation\supabase\functions\publish-site && deno test`
Expected: all tests pass.

- [ ] **Step 2: Whole-branch review**

Per this project's established discipline (Foundation's final review caught 3 Critical + 5 Important cross-task bugs no single task's review could see — most notably a reorder function silently broken by a constraint a *later* task added), do a full review of every file this plan touched, together, not task-by-task. Pay particular attention to:

- Does every place that used to read `product.brand` as a raw column now correctly go through the join (Task 7), with no leftover reference to a `products.brand` column that Task 5 dropped?
- Does the reserved-slug list match exactly between the spec, `create_primary_brand`, and `rename_brand_folder` (Task 2)?
- Does `admin/dashboard/products.js`'s brand dropdown correctly submit `brand_id` in both the add and edit paths, with no leftover `brand:` field submission anywhere?
- Does the Downloads mirror (Tasks 12-13) actually match the repo copy byte-for-byte (modulo line endings), per the standing workflow's diff-before-overwrite discipline?

- [ ] **Step 3: Report**

Document findings and any fixes applied, following the same fix-wave pattern Foundation and live-storefront-generation both used.
