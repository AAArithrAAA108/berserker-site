# Brand management — design spec

Date: 2026-08-15
Status: approved, ready for implementation planning

## Background

Brands are currently not a real entity anywhere in the system. `products.brand` is a free-text column, and the mapping from a product's brand string to its live URL folder (`gymshark/`, `youngla/`, etc.) is a hardcoded prefix-match table in `membership.ts` (`BRAND_PREFIX_MAP`, 7 entries) — adding a brand today means editing code and redeploying, not something an admin can do. The `/brands/` landing page is a hand-authored static file, completely outside the publish pipeline, with its 7 brand cards and thumbnail images hardcoded in HTML.

This spec adds real brand management to the admin panel: create/rename brands (and their live folder), upload/replace a brand's thumbnail, and pick a product's brand from a dropdown instead of typing it.

## Decisions (confirmed with the user)

1. **`products.brand` becomes a strict foreign key** (`products.brand_id → brands.id`), not a free-text field with a dropdown as a convenience. Renaming a brand's display name in the admin panel immediately updates every product that references it — no drift possible, and the product form's brand field is dropdown-only.
2. **Collab brands are their own selectable entries, sharing a folder with a parent brand.** "YoungLA × Batman" is its own row in `brands` with its own exact display name and its own `brand_id` that products can reference, but it's assigned to the existing `youngla` folder rather than getting a new one. It does not get its own thumbnail or its own card on `/brands/`.
3. **Renaming a brand's folder merges into the new name.** The old folder's live files (brand page + every PDP under it) are deleted in the same operation that publishes the new folder's content, so only one folder exists afterward — never both.
4. **`/brands/` becomes a generated page**, added to what Publish writes, same as `all-products/`, `collections/<slug>/`, and the brand pages already are. It becomes admin-controlled going forward; any direct hand-edit to that page after this ships will be overwritten on the next Publish.

## Data model

New table `brands`:

```sql
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

-- A non-primary (collab) row must not carry its own thumbnail --
-- the brands page only ever shows the primary row's thumbnail per folder.
alter table brands add constraint brands_collab_no_thumbnail
  check (is_primary or thumbnail_storage_path is null);
```

`products.brand_id uuid not null references brands(id)` replaces `products.brand text not null`. Backfill (see Migration below) creates all rows needed to satisfy this FK for existing data before the column swap, so the migration can be a single non-nullable `add column ... not null` in one step rather than a nullable-then-backfill-then-lock sequence.

RLS: `brands` follows the same admin-write / public-read pattern as `products` (public read for the publish pipeline's anon/service-role fetch; INSERT/UPDATE/DELETE gated by `is_admin()`).

Thumbnails reuse the existing `product-images` storage bucket (already has an `is_admin()`-gated write policy with no path restriction) under a `_brands/` prefix, e.g. `_brands/gymshark-<timestamp>.jpg` — no new bucket or policy needed.

## Migration (backfill existing data)

One migration creates the table, backfills all 15 rows needed for current data, uploads the 7 existing thumbnail images (already sitting in the repo at `brands/images/<slug>.jpg`) into Storage, then adds and populates `products.brand_id`, then drops `products.brand`.

Primary rows (7, matching today's `BRAND_FOLDERS`), each with its migrated thumbnail:
`Gymshark`/gymshark, `YoungLA`/youngla, `BreatheDivinity`/breathedivinity, `Chrome Hearts`/chromehearts, `Cactus Jack`/cactusjack, `Skims`/skims, `Lululemon`/lululemon.

Note `Cactus Jack` itself is not used by any current product (only its collabs are) — its primary row exists solely to own the `cactusjack` folder and thumbnail, which is expected and fine.

Collab rows (8, `is_primary = false`, no thumbnail), matching today's exact distinct `products.brand` strings so the backfill join is exact:
`Chrome Hearts × Mastermind` → chromehearts; `YoungLA × Batman`, `YoungLA × Superman`, `YoungLA × Gold's Gym` → youngla; `Cactus Jack x Travis Scott`, `Cactus Jack x Travis Scott x Fragment`, `Cactus Jack x Travis Scott x McDonald's`, `Cactus Jack x Travis Scott x Playstation` → cactusjack.

(These collab strings mix the `×` multiplication-sign character and a literal lowercase `x` — that inconsistency already exists in production data today; the backfill preserves the exact existing strings rather than normalizing them, since normalizing is out of scope for this feature.)

Uploading the 7 thumbnail files to Storage isn't expressible in pure SQL, so this backfill is two pieces run together at rollout time: the SQL migration (table, rows, FK swap) plus a one-off script (same pattern as Foundation's `migrate-images-to-storage.ts`) that uploads the images and `update`s each primary row's `thumbnail_storage_path` afterward. Once confirmed live, the now-superseded `brands/images/*.jpg` files and the hand-authored `brands/index.html` are removed from the repo (mirrored to Downloads per the usual workflow) — the generated version replaces it.

**Reserved folder slugs:** a new brand's folder_slug must not collide with an existing non-brand top-level route — `admin`, `checkout`, `collections`, `all-products`, `about-berserker`, `contact-berserker`, `returns-and-refunds`, `shipping-info`, `brands`. The admin UI's add-brand form validates against this list client-side; the rename RPC also rejects these server-side as the authoritative check (same defense-in-depth pattern as the position-cap fix).

## `membership.ts` / `data.ts` / `render.ts` changes

- `BRAND_PREFIX_MAP` and the prefix-matching in `brandFolderFor()` are deleted entirely — no longer needed once brand is a real FK with its own `folder_slug`.
- `fetchCatalog()` joins `products.brand_id → brands(name, folder_slug)`. `CatalogProduct.brand` stays a plain string (the joined `brands.name`) so every existing card/PDP render function is unaffected. A new `CatalogProduct.brandFolder: string` field carries the joined `folder_slug` directly — `brandFolderFor()` becomes a trivial `product.brandFolder` read, no matching logic at all.
- `BRAND_FOLDERS` (the constant list Task 9's `index.ts` iterates to know which brand pages to generate) becomes derived from the fetched brand data (`brands` where `is_primary`) rather than a hardcoded array — `fetchCatalog` (or a small sibling function) returns the primary-brand list alongside the product catalog.
- New `renderBrandsIndexPage(primaryBrands)` in `render.ts`, using the existing `.cat-card` markup pattern already in `shell.ts` (link → thumbnail image → `.cat-label`), one card per primary brand, matching the current hand-authored page's structure exactly.
- `index.ts` adds `brands/index.html` to the generated file set.

## RPCs

Brand creation and folder rename both need the reserved-slug check to be authoritative (not just client-side), so both go through SECURITY DEFINER, `is_admin()`-gated RPCs, matching the existing `set_product_position`/`delete_product_and_renumber` pattern:

- `create_primary_brand(name, folder_slug, thumbnail_storage_path)` — rejects a reserved or already-used folder_slug.
- `create_collab_brand(name, parent_folder_slug)` — rejects if `parent_folder_slug` doesn't already have a primary row.
- `rename_brand_folder(old_slug, new_slug)` — rejects a reserved or already-used new_slug; updates every `brands` row sharing `old_slug` to `new_slug` in one transaction.

## Folder rename

After `rename_brand_folder` succeeds, the admin panel triggers a scoped publish step that (a) generates and writes the new folder's brand page + every PDP that belongs to it, and (b) deletes every file that was under the old folder path — done together as one commit, not as a side effect of the next regular Publish (regular Publish stays purely additive/overwrite, no diffing against prior state).

## Admin UI

New "Brands" tab in the dashboard, alongside "Products":

- **List**: primary brands with their thumbnail, name, folder slug; collabs shown nested under their parent folder.
- **+ Add Brand**: name, folder slug (auto-suggested from name — lowercased, non-alphanumeric stripped, matching the existing folder-naming convention — editable before saving), thumbnail upload. Creates a new primary row (new folder).
- **+ Add Collab**: name, a dropdown to pick an existing primary brand's folder to share. Creates a non-primary row, no thumbnail field shown.
- **Edit**: rename `name` (plain update); change folder slug on a primary brand invokes the rename-and-merge flow above; replace thumbnail (delete old Storage file, upload new, update `thumbnail_storage_path` — same pattern already used for product images).
- **Products tab**: the brand field becomes a `<select>` populated from `brands` (primary and collab rows both listed, collabs visually grouped under their parent), storing `brand_id`.

Brand deletion is out of scope for this pass (not requested; would need a decision on what happens to products still referencing a deleted brand).

## Testing

- `data.test.ts`: `fetchCatalog` correctly joins brand name/folder onto products; primary-brand list excludes collabs.
- `render.test.ts`: `renderBrandsIndexPage` emits one card per primary brand with the right link/thumbnail/label, and none for collabs.
- `membership.test.ts`: existing prefix-matching tests are replaced with tests confirming `brandFolderFor` is now a direct field read (or the function is removed and callers updated to read `product.brandFolder` directly — an implementation-time call).
- Manual/live verification: after the migration, spot-check that every existing product's brand/folder still resolves identically to before (e.g. `YoungLA × Batman` still lands on `youngla/`), same discipline as today's `image_index`-range work.
