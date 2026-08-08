# Foundation: Data Model & Publish Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase the real source of truth for Berserker's product catalog (position, category, sleeve length, color grouping, per-variant stock, images in Storage) and stand up a Supabase Edge Function that regenerates the static storefront from that data and pushes it live.

**Architecture:** Postgres migrations add the new columns/tables and a `set_product_position` reordering function; a one-time data backfill populates them from the existing hardcoded HTML and the already-connected `products`/`product_colors` tables; a Deno Edge Function (`publish-site`) renders every storefront page from a shared template and commits+pushes the result to GitHub, which Vercel auto-deploys.

**Tech Stack:** Supabase Postgres (via `mcp__supabase__*` tools), Deno (Supabase Edge Functions), GitHub REST API, existing vanilla HTML/CSS/JS storefront.

## Global Constraints

- Every meaningful edit is mirrored to `C:\Users\anind\Downloads\berserker\` (working copy) in addition to `C:\Users\anind\berserker-site\` (repo clone) — diff before overwriting since the two can diverge — then the repo clone is committed **and pushed to GitHub** without stopping to confirm the push each time (standing authorization from the user).
- This is a live production site (Vercel-deployed, real Razorpay live key in checkout) — verify each task's changes independently before building the next task on top of it. Do not let a broken migration or a broken generator reach `main` unverified.
- Fixed size set: `S`, `M`, `L`, `XL` — no other sizes.
- Category enum: `t-shirt`, `compression`, `pants`, `jacket`, `dress`, `set`.
- Sleeve length enum (nullable, only meaningful for `t-shirt`/`compression`): `half`, `full`, `sleeveless`.
- Supabase project ref: `gvddahtgbhbqusyczxuo`. Existing row counts as of this plan: `products` 41, `product_colors` 219, `coupons` 2, `customers` 0, `orders` 2.
- GitHub repo: `AAArithrAAA108/berserker-site`, branch `main`, `gh` CLI already authenticated. Vercel is connected to this repo and auto-deploys on push to `main`.
- Resend/email setup is explicitly OUT OF SCOPE for this plan (user asked for it to be done last, in the order-emails plan).

---

## File Structure

- `supabase/schema.sql` — existing hand-maintained schema doc; updated to match every migration in this plan (kept as the human-readable source of truth alongside the real migrations applied via MCP).
- `supabase/functions/_shared/color-group.sql` *(new, doc-only mirror)* — not executed directly; documents the `classify_color_group` Postgres function defined in Task 3 so it's visible in the repo, not just in the live DB.
- `supabase/functions/publish-site/index.ts` *(new)* — Edge Function entrypoint: fetch data → render pages → commit to GitHub.
- `supabase/functions/publish-site/data.ts` *(new)* — typed Supabase queries returning the full catalog as one structured object.
- `supabase/functions/publish-site/render.ts` *(new)* — pure functions that turn catalog data into HTML strings (no I/O), one function per page type.
- `supabase/functions/publish-site/github.ts` *(new)* — pure-ish helper wrapping the GitHub Contents API for committing multiple files in one commit.
- `supabase/functions/publish-site/render.test.ts` *(new)* — Deno tests for `render.ts` against fixture data.
- `scripts/migrate-images-to-storage.ts` *(new, one-off)* — Deno script run locally once to upload existing repo images to Supabase Storage and populate `product_images`.

---

## Task 1: Add core product columns

**Files:**
- Migration applied via `mcp__supabase__apply_migration` (name: `add_product_position_category_sleeve`)
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `products.position int unique not null`, `products.category text not null check (...)`, `products.sleeve_length text null check (...)`, `products.description text null`

- [ ] **Step 1: Write and apply the migration**

```sql
alter table products
  add column position int,
  add column category text,
  add column sleeve_length text,
  add column description text;

alter table products
  add constraint products_category_check
    check (category in ('t-shirt','compression','pants','jacket','dress','set')),
  add constraint products_sleeve_length_check
    check (sleeve_length is null or sleeve_length in ('half','full','sleeveless'));
```

Apply via `mcp__supabase__apply_migration` with `name: "add_product_position_category_sleeve"`. Columns start nullable — `position`/`category` are backfilled in Task 6, then locked to `not null` + `position` to `unique` in Task 6's final step (can't add `not null`/`unique` before the 41 existing rows have values).

- [ ] **Step 2: Verify the migration applied**

Run `mcp__supabase__execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'products' and column_name in ('position','category','sleeve_length','description');
```
Expected: 4 rows returned, all `is_nullable = 'YES'` (not locked down yet).

- [ ] **Step 3: Update `supabase/schema.sql` to match**

Add the four new columns and two check constraints to the `create table products (...)` block in `supabase/schema.sql`, matching Step 1 exactly.

- [ ] **Step 4: Mirror, commit, push**

Diff `supabase/schema.sql` between `C:\Users\anind\berserker-site\` and `C:\Users\anind\Downloads\berserker\` (they should currently match on this file); apply the same edit to the Downloads copy. Then:
```bash
git add supabase/schema.sql
git commit -m "Add position/category/sleeve_length/description columns to products"
git push origin main
```

## Task 2: `product_images` table

**Files:**
- Migration via `mcp__supabase__apply_migration` (name: `add_product_images_table`)
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `product_images(id uuid pk, product_id uuid fk->products, storage_path text not null, sort_order int not null)`

- [ ] **Step 1: Write and apply the migration**

```sql
create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0
);
create index product_images_product_id_idx on product_images(product_id);
```

- [ ] **Step 2: Verify**

`mcp__supabase__execute_sql`: `select * from product_images limit 1;` — expect an empty result set with no error (table exists, correctly shaped).

- [ ] **Step 3: Update `supabase/schema.sql`, mirror, commit, push**

Add the `create table product_images (...)` block. Same mirror/diff/commit/push procedure as Task 1 Step 4.

## Task 3: `product_colors` additions + color classifier

**Files:**
- Migration via `mcp__supabase__apply_migration` (name: `add_color_group_and_classifier`)
- Modify: `supabase/schema.sql`
- Create: `supabase/functions/_shared/color-group.sql` (doc mirror, not executed)

**Interfaces:**
- Produces: `product_colors.color_group text`, `product_colors.cover_image_id uuid null fk->product_images`, Postgres function `classify_color_group(hex text) returns text`

- [ ] **Step 1: Write and apply the migration**

```sql
alter table product_colors
  add column color_group text,
  add column cover_image_id uuid references product_images(id);

create or replace function classify_color_group(hex text)
returns text
language plpgsql
immutable
as $$
declare
  r int; g int; b int;
  palette text[] := array['Black','White','Grey','Red','Blue','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Denim'];
  palette_hex text[] := array['#141414','#f0ede8','#8a8a8a','#c41e1e','#1c4aa0','#1c8a3a','#5a1ca0','#c41e8a','#c46a1e','#1c2c4a','#5a1a1a','#c4a01c','#5a3f2a','#ede9e3','#6b9fd4'];
  best_name text := 'Black';
  best_dist float8 := 'Infinity'::float8;
  i int;
  pr int; pg int; pb int;
  dist float8;
begin
  if hex is null or length(hex) != 7 then
    return 'Uncategorized';
  end if;
  r := ('x' || substr(hex, 2, 2))::bit(8)::int;
  g := ('x' || substr(hex, 4, 2))::bit(8)::int;
  b := ('x' || substr(hex, 6, 2))::bit(8)::int;
  for i in 1 .. array_length(palette, 1) loop
    pr := ('x' || substr(palette_hex[i], 2, 2))::bit(8)::int;
    pg := ('x' || substr(palette_hex[i], 4, 2))::bit(8)::int;
    pb := ('x' || substr(palette_hex[i], 6, 2))::bit(8)::int;
    dist := pow(r - pr, 2) + pow(g - pg, 2) + pow(b - pb, 2);
    if dist < best_dist then
      best_dist := dist;
      best_name := palette[i];
    end if;
  end loop;
  return best_name;
end;
$$;
```

- [ ] **Step 2: Verify with known values**

`mcp__supabase__execute_sql`:
```sql
select classify_color_group('#1a1a2e') as dark_knight,   -- expect Black or Navy (near-black navy)
       classify_color_group('#2a2a2a') as stealth,        -- expect Grey or Black
       classify_color_group(null) as null_case;           -- expect Uncategorized
```
Expected: `dark_knight` and `stealth` both resolve to a dark neutral (`Black`, `Grey`, or `Navy` — inspect the actual output and sanity-check it looks right by eye, since this is a nearest-neighbor heuristic, not an exact match); `null_case` = `Uncategorized`.

- [ ] **Step 3: Update `supabase/schema.sql` and create the doc mirror**

Add the two new `product_colors` columns to `supabase/schema.sql`. Create `supabase/functions/_shared/color-group.sql` containing a copy of the `classify_color_group` function from Step 1, with a one-line comment noting it's a read-only mirror of the live DB function for repo visibility.

- [ ] **Step 4: Mirror, commit, push** (same procedure as Task 1 Step 4, for both changed/created files)

## Task 4: `product_variants` table (stock tracking)

**Files:**
- Migration via `mcp__supabase__apply_migration` (name: `add_product_variants_table`)
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `product_variants(id uuid pk, product_id uuid fk, color_id uuid fk->product_colors, size text, in_stock boolean not null default true, unique(product_id, color_id, size))`

- [ ] **Step 1: Write and apply the migration**

```sql
create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  color_id uuid not null references product_colors(id) on delete cascade,
  size text not null check (size in ('S','M','L','XL')),
  in_stock boolean not null default true,
  unique (product_id, color_id, size)
);
create index product_variants_product_id_idx on product_variants(product_id);
```

- [ ] **Step 2: Verify**

`mcp__supabase__execute_sql`: attempt an insert with an invalid size to confirm the check constraint is live:
```sql
insert into product_variants (product_id, color_id, size)
select id, (select id from product_colors where product_id = products.id limit 1), 'XXL'
from products limit 1;
```
Expected: error citing `product_variants_size_check` (or the auto-named check constraint) — confirms validation works. No cleanup needed since the insert fails.

- [ ] **Step 3: Update `supabase/schema.sql`, mirror, commit, push**

## Task 5: `set_product_position` reordering function

**Files:**
- Migration via `mcp__supabase__apply_migration` (name: `add_set_product_position_function`)
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: `products.position` (Task 1)
- Produces: `set_product_position(p_product_id uuid, p_new_position int) returns void` — atomically moves a product to `p_new_position`, shifting every product between the old and new position by one to make room. Used by the admin editor (later plan) for both reordering an existing product and placing a newly created one.

- [ ] **Step 1: Write and apply the migration**

```sql
create or replace function set_product_position(p_product_id uuid, p_new_position int)
returns void
language plpgsql
as $$
declare
  v_old_position int;
begin
  select position into v_old_position from products where id = p_product_id;

  if v_old_position is null then
    -- new product being placed for the first time: make room, then set it
    update products set position = position + 1
    where position >= p_new_position;
    update products set position = p_new_position where id = p_product_id;
    return;
  end if;

  if p_new_position = v_old_position then
    return;
  elsif p_new_position < v_old_position then
    update products set position = position + 1
    where position >= p_new_position and position < v_old_position and id != p_product_id;
  else
    update products set position = position - 1
    where position > v_old_position and position <= p_new_position and id != p_product_id;
  end if;

  update products set position = p_new_position where id = p_product_id;
end;
$$;
```

- [ ] **Step 2: Verify with a scratch test in a transaction (rolled back, not committed)**

`mcp__supabase__execute_sql`:
```sql
begin;
  select id, position from products order by position limit 5;
  select set_product_position(
    (select id from products order by position limit 1 offset 2),
    1
  );
  select id, position from products order by position limit 5;
rollback;
```
Expected: the second `select` shows the product that was at position 3 now at position 1, and the products previously at positions 1–2 shifted to 2–3, with no duplicate position values. Since it's wrapped in `begin`/`rollback`, no real data changes — this is safe to run even before Task 6's position backfill exists (it will just move nulls around; if `position` is still null for all rows at this point, skip this verification and re-run it after Task 6 instead).

- [ ] **Step 3: Update `supabase/schema.sql`, mirror, commit, push**

## Task 6: Backfill `category`, `sleeve_length`, and `position`; lock down constraints

**Files:**
- SQL run via `mcp__supabase__execute_sql`
- Read: `C:\Users\anind\berserker-site\all-products\index.html` (for position order)

**Interfaces:**
- Consumes: `products.name`, `products.brand` (existing), `products.position`/`category`/`sleeve_length` (Task 1, currently null)
- Produces: every `products` row has non-null `position` and `category`; `sleeve_length` set where derivable, `position` becomes `unique not null`, `category` becomes `not null`

- [ ] **Step 1: Backfill `category` from name keywords**

Run via `mcp__supabase__execute_sql`:
```sql
update products set category = case
  when lower(name) like '%set' then 'set'
  when lower(name) like '%dress%' then 'dress'
  when lower(name) like '%compression%' then 'compression'
  when lower(name) like '%sweatpant%' or lower(name) like '%jogger%' or lower(name) like '%jeans%' then 'pants'
  when lower(name) like '%hoodie%' or lower(name) like '%jacket%' then 'jacket'
  when lower(name) like '%t-shirt%' then 't-shirt'
  else null
end;
```

- [ ] **Step 2: Verify no product was left uncategorized**

```sql
select brand, name from products where category is null;
```
Expected: 0 rows. If any come back, inspect the name and add a matching `when` clause to Step 1's `case` for that specific keyword pattern, then re-run Step 1 (it's idempotent) and re-check.

- [ ] **Step 3: Backfill `sleeve_length` from name keywords, restricted to tops**

```sql
update products set sleeve_length = case
  when category not in ('t-shirt','compression') then null
  when lower(name) like '%sleeveless%' then 'sleeveless'
  when lower(name) like '%half sleeve%' then 'half'
  when lower(name) like '%full sleeve%' or lower(name) like '%long sleeve%' then 'full'
  else null
end;
```

- [ ] **Step 4: Verify sleeve_length spot-check**

```sql
select brand, name, category, sleeve_length from products
where category in ('t-shirt','compression')
order by brand, name;
```
Expected: products with "Half Sleeve"/"Full Sleeve"/"Long Sleeve"/"Sleeveless" in the name have the matching value; plain compression/t-shirt names without an explicit sleeve indicator (e.g. "VoidTech Berserker Compression") show `null` — that's correct, those get filled in later via the admin editor, not guessed.

- [ ] **Step 5: Extract current display order from the storefront**

Run:
```bash
grep -oE '(product-brand">[^<]+|product-name">[^<]+)' C:\Users\anind\berserker-site\all-products\index.html
```
This prints alternating `product-brand">BRAND` / `product-name">NAME` lines in DOM order (one pair per product). Pair them up in order (1st brand+1st name = product 1, 2nd+2nd = product 2, etc.) to build an ordered list of `(brand, name)` matching the `products` table's `brand`/`name` columns.

- [ ] **Step 6: Apply position from the extracted order**

For the ordered list from Step 5, run one `mcp__supabase__execute_sql` call per product (or batch them into a single statement using a `case` keyed on `id`, whichever is more convenient given the actual extracted list):
```sql
update products set position = 1 where brand = '<brand-1>' and name = '<name-1>';
update products set position = 2 where brand = '<brand-2>' and name = '<name-2>';
-- ... one per product, using the exact brand/name text extracted in Step 5
```
Use the brand/name text exactly as it appears in the grep output (trim whitespace only).

- [ ] **Step 7: Verify every product has a unique position**

```sql
select count(*) as total, count(distinct position) as distinct_positions, count(*) filter (where position is null) as nulls
from products;
```
Expected: `total = 41`, `distinct_positions = 41`, `nulls = 0`. If `distinct_positions < total`, find the duplicate with `select position, array_agg(name) from products group by position having count(*) > 1;` and fix the mismatched row(s) by re-checking Step 5's extraction against the file.

- [ ] **Step 8: Lock down constraints now that every row is populated**

```sql
alter table products
  alter column position set not null,
  alter column category set not null,
  add constraint products_position_unique unique (position);
```

- [ ] **Step 9: Verify constraints are active**

```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'products' and column_name in ('position','category');
```
Expected: both rows show `is_nullable = 'NO'`.

- [ ] **Step 10: Update `supabase/schema.sql` to mark these columns `not null`/`unique`, mirror, commit, push**

## Task 7: Backfill `color_group` for all existing colors

**Files:**
- SQL via `mcp__supabase__execute_sql`

**Interfaces:**
- Consumes: `classify_color_group` (Task 3)
- Produces: every `product_colors` row has a non-null `color_group`

- [ ] **Step 1: Apply the classifier to every row**

```sql
update product_colors set color_group = classify_color_group(hex) where color_group is null;
```

- [ ] **Step 2: Verify and spot-check the distribution**

```sql
select color_group, count(*) from product_colors group by color_group order by count(*) desc;
```
Expected: 15 or fewer distinct groups (matching the palette in Task 3), every one of the 219 rows accounted for, no `null` group (an `Uncategorized` bucket is fine if any `hex` values are null — check with `select count(*) from product_colors where color_group = 'Uncategorized';` and inspect those rows to confirm they genuinely have no hex value before moving on).

- [ ] **Step 3: Lock down the column**

```sql
alter table product_colors alter column color_group set not null;
```
Verify: `select is_nullable from information_schema.columns where table_name = 'product_colors' and column_name = 'color_group';` expect `NO`.

## Task 8: Backfill `product_variants` (stock rows for every existing product × color × size)

**Files:**
- SQL via `mcp__supabase__execute_sql`

**Interfaces:**
- Consumes: `product_colors` (existing 219 rows)
- Produces: `product_variants` populated with one row per `(color, size)` for every existing color, all `in_stock = true`

- [ ] **Step 1: Seed all variants**

```sql
insert into product_variants (product_id, color_id, size, in_stock)
select pc.product_id, pc.id, size, true
from product_colors pc
cross join (values ('S'),('M'),('L'),('XL')) as sizes(size);
```

- [ ] **Step 2: Verify row count**

```sql
select count(*) from product_variants;
```
Expected: `219 * 4 = 876` (or the current `product_colors` row count × 4, if it's drifted since this plan was written — check `select count(*) from product_colors;` first if the number doesn't match).

## Task 9: Migrate existing images to Supabase Storage

**Files:**
- Create: `scripts/migrate-images-to-storage.ts`
- Read: all `images/` directories under `C:\Users\anind\berserker-site\` (e.g. `all-products/images/`, `gymshark/images/`, `gymshark/gymshark-onyx-5-half-sleeve/images/`, etc.)

**Interfaces:**
- Produces: a Supabase Storage bucket `product-images` containing every existing product image; `product_images` rows created for each; `product_colors.cover_image_id` set to a matching image.

- [ ] **Step 1: Create the Storage bucket**

`mcp__supabase__execute_sql` cannot manage Storage buckets directly — create it via the Supabase dashboard (Storage → New bucket, name `product-images`, public read access) since this is a one-time console action, not something worth scripting. Confirm it exists before continuing: `mcp__supabase__execute_sql`: `select * from storage.buckets where name = 'product-images';` should return 1 row.

- [ ] **Step 2: Get the project URL and a service-role key for the script**

Run `mcp__supabase__get_project_url` to confirm the base URL. The service role key is required for the upload script (publishable/anon key can't write to Storage) — get it from the Supabase dashboard's API settings (Project Settings → API → `service_role` secret) and pass it to the script via an environment variable, never hardcoded in the file.

- [ ] **Step 3: Write the migration script**

```typescript
// scripts/migrate-images-to-storage.ts
// Run with: deno run --allow-net --allow-env --allow-read scripts/migrate-images-to-storage.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REPO_ROOT = "C:\\Users\\anind\\berserker-site";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface ImageFile {
  productSlug: string;
  localPath: string;
  fileName: string;
}

async function findProductImages(): Promise<ImageFile[]> {
  const results: ImageFile[] = [];
  for await (const entry of walk(REPO_ROOT, { match: [/images[\\/][^\\/]+\.(jpg|jpeg|png|webp)$/i] })) {
    if (!entry.isFile) continue;
    const parts = entry.path.split(/[\\/]/);
    const imagesIdx = parts.lastIndexOf("images");
    const productSlug = parts[imagesIdx - 1] ?? "unknown";
    results.push({ productSlug, localPath: entry.path, fileName: parts[parts.length - 1] });
  }
  return results;
}

async function uploadOne(img: ImageFile): Promise<string> {
  const bytes = await Deno.readFile(img.localPath);
  const storagePath = `${img.productSlug}/${img.fileName}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(storagePath, bytes, { upsert: true, contentType: `image/${img.fileName.split(".").pop()}` });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  return storagePath;
}

async function main() {
  const images = await findProductImages();
  console.log(`Found ${images.length} images to migrate.`);
  let uploaded = 0;
  for (const img of images) {
    const storagePath = await uploadOne(img);
    uploaded++;
    if (uploaded % 20 === 0) console.log(`${uploaded}/${images.length} uploaded...`);
  }
  console.log(`Done. Uploaded ${uploaded} images. Now run the product_images population SQL from Task 9 Step 5.`);
}

await main();
```

- [ ] **Step 4: Run the script and verify upload count**

```bash
cd /c/Users/anind/berserker-site
SUPABASE_URL="https://gvddahtgbhbqusyczxuo.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<from dashboard>" deno run --allow-net --allow-env --allow-read scripts/migrate-images-to-storage.ts
```
Expected: script prints a final "Uploaded N images" matching the count of image files found. Spot-check by listing the bucket: `mcp__supabase__execute_sql`: `select count(*) from storage.objects where bucket_id = 'product-images';` should equal N.

- [ ] **Step 5: Populate `product_images` and `product_colors.cover_image_id`**

This requires mapping each uploaded `storage_path` back to the correct `product_id` via slug — since `products.slug` should match the folder name used under each per-product `images/` directory. Run:
```sql
-- one row per uploaded object, product_id resolved by matching storage_path's folder prefix to products.slug
insert into product_images (product_id, storage_path, sort_order)
select p.id, o.name, row_number() over (partition by p.id order by o.name)
from storage.objects o
join products p on o.name like p.slug || '/%'
where o.bucket_id = 'product-images';
```
Then verify every object got matched:
```sql
select count(*) from storage.objects where bucket_id = 'product-images';
select count(*) from product_images;
```
Expected: the two counts match. If `product_images` has fewer rows, some `storage_path` prefixes didn't match any `products.slug` — inspect with `select o.name from storage.objects o where o.bucket_id = 'product-images' and not exists (select 1 from products p where o.name like p.slug || '/%');` and reconcile the slug mismatch (the shared image pool under `all-products/images/` won't map to a single product slug this way — assign those to `sort_order` per-product manually based on which products' cards reference each `img-NNNN.jpg` file, cross-referencing `all-products/index.html`).

Then set a cover image per color as a reasonable default (first image for that product):
```sql
update product_colors pc
set cover_image_id = (
  select pi.id from product_images pi
  where pi.product_id = pc.product_id
  order by pi.sort_order asc limit 1
)
where cover_image_id is null;
```

- [ ] **Step 6: Commit the migration script**

```bash
git add scripts/migrate-images-to-storage.ts
git commit -m "Add one-off script to migrate product images into Supabase Storage"
git push origin main
```
(No Downloads mirror needed for this one — it's a build/ops script, not a site page.)

## Task 10: `publish-site` Edge Function — data layer

**Files:**
- Create: `supabase/functions/publish-site/data.ts`

**Interfaces:**
- Produces: `async function fetchCatalog(supabase: SupabaseClient): Promise<Catalog>` where
  ```typescript
  interface Catalog {
    products: Array<{
      id: string; brand: string; name: string; slug: string;
      price: number; codAdvance: number; position: number;
      category: string; sleeveLength: string | null; description: string | null;
      colors: Array<{
        id: string; label: string; hex: string | null; colorGroup: string;
        coverImageUrl: string;
        images: Array<{ url: string; sortOrder: number }>;
        variants: Array<{ size: string; inStock: boolean }>;
      }>;
    }>;
  }
  ```

- [ ] **Step 1: Write `data.ts`**

```typescript
// supabase/functions/publish-site/data.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface CatalogVariant { size: string; inStock: boolean; }
export interface CatalogImage { url: string; sortOrder: number; }
export interface CatalogColor {
  id: string; label: string; hex: string | null; colorGroup: string;
  coverImageUrl: string; images: CatalogImage[]; variants: CatalogVariant[];
}
export interface CatalogProduct {
  id: string; brand: string; name: string; slug: string;
  price: number; codAdvance: number; position: number;
  category: string; sleeveLength: string | null; description: string | null;
  colors: CatalogColor[];
}
export interface Catalog { products: CatalogProduct[]; }

const STORAGE_BASE = "product-images";

export async function fetchCatalog(supabase: SupabaseClient): Promise<Catalog> {
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, brand, name, slug, price, cod_advance, position, category, sleeve_length, description")
    .order("position", { ascending: true });
  if (productsError) throw new Error(`fetchCatalog products: ${productsError.message}`);

  const { data: colors, error: colorsError } = await supabase
    .from("product_colors")
    .select("id, product_id, label, hex, color_group, cover_image_id");
  if (colorsError) throw new Error(`fetchCatalog colors: ${colorsError.message}`);

  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select("id, product_id, storage_path, sort_order")
    .order("sort_order", { ascending: true });
  if (imagesError) throw new Error(`fetchCatalog images: ${imagesError.message}`);

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("color_id, size, in_stock");
  if (variantsError) throw new Error(`fetchCatalog variants: ${variantsError.message}`);

  const publicUrl = (path: string) =>
    supabase.storage.from(STORAGE_BASE).getPublicUrl(path).data.publicUrl;

  const imagesByProduct = new Map<string, CatalogImage[]>();
  for (const img of images ?? []) {
    const list = imagesByProduct.get(img.product_id) ?? [];
    list.push({ url: publicUrl(img.storage_path), sortOrder: img.sort_order });
    imagesByProduct.set(img.product_id, list);
  }

  const variantsByColor = new Map<string, CatalogVariant[]>();
  for (const v of variants ?? []) {
    const list = variantsByColor.get(v.color_id) ?? [];
    list.push({ size: v.size, inStock: v.in_stock });
    variantsByColor.set(v.color_id, list);
  }

  const imageUrlById = new Map<string, string>();
  for (const [, list] of imagesByProduct) {
    for (const img of list) imageUrlById.set(img.url, img.url);
  }
  const imageById = new Map<string, CatalogImage>();
  for (const img of images ?? []) {
    imageById.set(img.id, { url: publicUrl(img.storage_path), sortOrder: img.sort_order });
  }

  const colorsByProduct = new Map<string, CatalogColor[]>();
  for (const c of colors ?? []) {
    const list = colorsByProduct.get(c.product_id) ?? [];
    list.push({
      id: c.id,
      label: c.label,
      hex: c.hex,
      colorGroup: c.color_group,
      coverImageUrl: c.cover_image_id ? (imageById.get(c.cover_image_id)?.url ?? "") : "",
      images: imagesByProduct.get(c.product_id) ?? [],
      variants: variantsByColor.get(c.id) ?? [],
    });
    colorsByProduct.set(c.product_id, list);
  }

  return {
    products: (products ?? []).map((p) => ({
      id: p.id, brand: p.brand, name: p.name, slug: p.slug,
      price: Number(p.price), codAdvance: Number(p.cod_advance), position: p.position,
      category: p.category, sleeveLength: p.sleeve_length, description: p.description,
      colors: colorsByProduct.get(p.id) ?? [],
    })),
  };
}
```

- [ ] **Step 2: Deploy and smoke-test**

Deploy via `mcp__supabase__deploy_edge_function` is for the full function (done in Task 12) — for now, verify `data.ts` compiles standalone:
```bash
cd /c/Users/anind/berserker-site
deno check supabase/functions/publish-site/data.ts
```
Expected: no type errors.

- [ ] **Step 3: Commit** (`supabase/functions/publish-site/data.ts`, no Downloads mirror — this is backend code, not a site page)

## Task 11: `publish-site` Edge Function — HTML rendering

**Files:**
- Create: `supabase/functions/publish-site/render.ts`
- Create: `supabase/functions/publish-site/render.test.ts`
- Read (for reference, to match existing visual structure): `C:\Users\anind\berserker-site\all-products\index.html`

**Interfaces:**
- Consumes: `Catalog`, `CatalogProduct` (Task 10)
- Produces: `function renderAllProductsPage(catalog: Catalog): string`, `function renderProductCard(product: CatalogProduct): string` — both pure functions (no I/O), which later tasks (collection pages, brand pages, individual PDPs — covered in the Storefront UX plan, not this one) will reuse.

- [ ] **Step 1: Write the failing test for `renderProductCard`**

```typescript
// supabase/functions/publish-site/render.test.ts
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderProductCard } from "./render.ts";
import type { CatalogProduct } from "./data.ts";

const sampleProduct: CatalogProduct = {
  id: "p1", brand: "Gymshark", name: "Onyx 5.0 Seamless Compression Half Sleeve",
  slug: "gymshark-onyx-5-half-sleeve", price: 4799, codAdvance: 500, position: 1,
  category: "compression", sleeveLength: "half", description: null,
  colors: [
    {
      id: "c1", label: "Stealth Black", hex: "#1a1a1a", colorGroup: "Black",
      coverImageUrl: "https://example.supabase.co/storage/v1/object/public/product-images/gymshark-onyx-5-half-sleeve/img-0001.jpg",
      images: [{ url: "https://example.supabase.co/.../img-0001.jpg", sortOrder: 0 }],
      variants: [
        { size: "S", inStock: true }, { size: "M", inStock: true },
        { size: "L", inStock: false }, { size: "XL", inStock: true },
      ],
    },
  ],
};

Deno.test("renderProductCard includes brand, name, and strikethrough price", () => {
  const html = renderProductCard(sampleProduct);
  assertStringIncludes(html, "Gymshark");
  assertStringIncludes(html, "Onyx 5.0 Seamless Compression Half Sleeve");
  assertStringIncludes(html, "₹4,799");
  assertStringIncludes(html, "₹12,999"); // ceil(4799*2.7/1000)*1000-1
});

Deno.test("renderProductCard marks out-of-stock size as disabled", () => {
  const html = renderProductCard(sampleProduct);
  assertStringIncludes(html, 'data-size="L" data-in-stock="false"');
});

Deno.test("renderProductCard includes category and sleeve-length data attributes for filtering", () => {
  const html = renderProductCard(sampleProduct);
  assertStringIncludes(html, 'data-category="compression"');
  assertStringIncludes(html, 'data-sleeve="half"');
  assertStringIncludes(html, 'data-colors="Black"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test --allow-none supabase/functions/publish-site/render.test.ts
```
Expected: FAIL — `render.ts` does not exist yet / `renderProductCard` is not exported.

- [ ] **Step 3: Implement `render.ts`**

```typescript
// supabase/functions/publish-site/render.ts
import type { Catalog, CatalogProduct } from "./data.ts";

export function strikethroughPrice(price: number): number {
  return Math.ceil((price * 2.7) / 1000) * 1000 - 1;
}

function formatInr(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

export function renderProductCard(product: CatalogProduct): string {
  const wasPrice = strikethroughPrice(product.price);
  const colorGroups = [...new Set(product.colors.map((c) => c.colorGroup))].join(",");
  const swatches = product.colors
    .map(
      (c) =>
        `<div class="swatch" style="background:${c.hex ?? "#333"};" title="${c.label}" data-color-group="${c.colorGroup}"></div>`
    )
    .join("");
  const sizeButtons = (product.colors[0]?.variants ?? [])
    .map(
      (v) =>
        `<button class="size-btn" data-size="${v.size}" data-in-stock="${v.inStock}" ${v.inStock ? "" : "disabled"}>${v.size}</button>`
    )
    .join("");
  const coverImage = product.colors[0]?.coverImageUrl ?? "";

  return `
<div class="product-card fade-in" id="product-${product.position}"
     data-category="${product.category}"
     ${product.sleeveLength ? `data-sleeve="${product.sleeveLength}"` : ""}
     data-colors="${colorGroups}"
     data-price="${product.price}">
  <div class="product-img"><img src="${coverImage}" alt="${product.name}" /></div>
  <div class="product-info">
    <div class="product-brand">${product.brand}</div>
    <div class="product-name">${product.name}</div>
    <div class="product-price">
      <span class="price-now">${formatInr(product.price)}</span>
      <span class="price-was">${formatInr(wasPrice)}</span>
    </div>
    <div class="product-swatches">${swatches}</div>
    <div class="product-sizes">${sizeButtons}</div>
  </div>
  <button class="product-add">Add to Cart</button>
</div>`.trim();
}

export function renderAllProductsPage(catalog: Catalog): string {
  const cards = catalog.products
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(renderProductCard)
    .join("\n");
  return cards; // wrapped into the full page shell in Task 12
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test --allow-none supabase/functions/publish-site/render.test.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit** (`render.ts`, `render.test.ts` — backend code, no Downloads mirror)

## Task 12: `publish-site` Edge Function — GitHub commit + entrypoint

**Files:**
- Create: `supabase/functions/publish-site/github.ts`
- Create: `supabase/functions/publish-site/index.ts`

**Interfaces:**
- Consumes: `fetchCatalog` (Task 10), `renderAllProductsPage` (Task 11)
- Produces: `async function commitFiles(files: Record<string,string>, message: string): Promise<{ commitSha: string }>`; the deployed `publish-site` function itself, invoked via `POST /functions/v1/publish-site`

- [ ] **Step 1: Write `github.ts`**

```typescript
// supabase/functions/publish-site/github.ts
const OWNER = "AAArithrAAA108";
const REPO = "berserker-site";
const BRANCH = "main";

export async function commitFiles(
  files: Record<string, string>,
  message: string,
  githubToken: string
): Promise<{ commitSha: string }> {
  const api = (path: string) =>
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
      },
    });

  const refRes = await api(`/git/ref/heads/${BRANCH}`);
  const ref = await refRes.json();
  const baseCommitSha = ref.object.sha;

  const commitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits/${baseCommitSha}`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
  });
  const baseCommit = await commitRes.json();
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blobRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      const blob = await blobRes.json();
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  const treeRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  const newTree = await treeRes.json();

  const newCommitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
  });
  const newCommit = await newCommitRes.json();

  await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return { commitSha: newCommit.sha };
}
```

- [ ] **Step 2: Write `index.ts`**

```typescript
// supabase/functions/publish-site/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchCatalog } from "./data.ts";
import { renderAllProductsPage } from "./render.ts";
import { commitFiles } from "./github.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const catalog = await fetchCatalog(supabase);
    const allProductsHtml = renderAllProductsPage(catalog);

    const githubToken = Deno.env.get("GITHUB_TOKEN")!;
    const { commitSha } = await commitFiles(
      { "all-products/index.generated.html": allProductsHtml },
      `Publish: regenerate storefront from ${catalog.products.length} products`,
      githubToken
    );

    return new Response(JSON.stringify({ ok: true, commitSha, productCount: catalog.products.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

Note: this task commits to a placeholder file (`index.generated.html`) rather than overwriting `all-products/index.html` directly — this plan stops at proving the pipeline end-to-end works safely. The Storefront UX plan (next plan, not this one) is responsible for building the full page shell (nav/header/footer/cart/filters), swapping the real `all-products/index.html` over to fully generated output, and extending this same pattern to collection/brand/PDP pages.

- [ ] **Step 3: Deploy the function**

Use `mcp__supabase__deploy_edge_function` with `name: "publish-site"`, `entrypoint_path: "index.ts"`, `verify_jwt: true`, and `files` containing the contents of `index.ts`, `data.ts`, `render.ts`, `github.ts` read from disk.

Set the `GITHUB_TOKEN` secret (a GitHub PAT with `repo` scope, generated via `gh auth token` or the GitHub UI) via the Supabase dashboard's Edge Function secrets — not committed anywhere in the repo.

- [ ] **Step 4: Verify end-to-end with a real invocation**

```bash
curl -X POST "https://gvddahtgbhbqusyczxuo.supabase.co/functions/v1/publish-site" \
  -H "Authorization: Bearer <a valid Supabase anon or service key>"
```
Expected: JSON response `{"ok":true,"commitSha":"...","productCount":41}`. Then verify the commit landed:
```bash
git -C /c/Users/anind/berserker-site pull
```
Expected: pulls down a new commit adding `all-products/index.generated.html` with 41 rendered product cards, authored by the GitHub token's associated account. Open the file and spot-check 2–3 product cards against the live DB data (name, price, strikethrough price, category/sleeve data attributes) to confirm correctness.

- [ ] **Step 5: Mirror the new file to Downloads, commit note**

Copy `all-products/index.generated.html` to the equivalent path under `C:\Users\anind\Downloads\berserker\` for consistency with the standing mirror workflow, since it's now a real repo artifact going forward.

---

## Plan Self-Review Notes

- **Spec coverage**: this plan covers spec Section 1 in full (schema, migration, publish pipeline) and intentionally stops short of swapping the real storefront pages over to generated output — that's called out explicitly at the end of Task 12 and handed to the next plan (Storefront UX), which also owns collection/brand/PDP page rendering and the admin editor's dependency on a fully-wired publish step.
- **Verification discipline**: every schema task ends with a `select`-based check before the next task builds on it; the riskiest step (pushing to `main` on a live site) is proven first against a throwaway generated file rather than overwriting the real `all-products/index.html`, so a bug in `render.ts` can't break the live site before it's caught.
- **Known follow-up**: Task 9 Step 5's slug-matching SQL will not correctly attribute the shared `all-products/images/img-NNNN.jpg` pool (those aren't under a per-product folder) — flagged inline in that step with the manual reconciliation procedure, since the actual file listing wasn't available while writing this plan.
