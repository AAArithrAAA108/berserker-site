# Per-Color Image Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit, never-editable `product_colors.image_index` range system with an explicit `product_images.color_id` relation, so admins can assign any number of photos to a color with one marked as thumbnail, and fix the "two swatches selected" PDP bug as a structural consequence.

**Architecture:** Add `product_images.color_id` (nullable FK) and `product_colors.created_at` (new ordering key, replacing `image_index`); backfill both from current data so nothing changes on the live site until an admin edits something; rewire `data.ts`/`render.ts` to group by the explicit relation instead of slicing a range; rewrite the admin panel's Images/Colors sections to expose real assignment, thumbnail-picking, and serial-numbered captions.

**Tech Stack:** Supabase Postgres (SQL migrations), Deno/TypeScript (Edge Function), vanilla JS admin panel.

**Spec:** `docs/superpowers/specs/2026-08-16-color-image-assignment-design.md`

## Global Constraints

- Every SQL migration follows the existing project convention: filename `YYYYMMDDHHMMSS_description.sql` in `supabase/migrations/`, applied via `supabase db push --linked` from this worktree (`C:\Users\anind\berserker-site\.worktrees\color-image-assignment`).
- All Deno-side TypeScript changes live in `supabase/functions/publish-site/`; run `deno check supabase/functions/publish-site/index.ts` and `deno test` (from that directory) after every code task.
- Admin panel changes touch `admin/dashboard/products.js` directly on `main` (not this feature branch) — mirror every admin-panel edit to `C:\Users\anind\Downloads\berserker\admin\dashboard\` per the project's standing Downloads-mirroring workflow, diffing before overwriting.
- No task in this plan can exercise a real authenticated admin session (no live browser automation for Supabase auth in this environment) — verify by reading the code against the established pattern and via live-data spot-checks after deploy, not a live admin browser session. Same limitation every prior plan in this project has hit.
- Every existing product's swatch order and image-to-color mapping must resolve **identically** after the migration as before it — this is a structural refactor of dead/fragile plumbing, not a data-visible change, until an admin explicitly edits something.
- **`checkout/review` (hand-authored, outside the publish pipeline) needs no task in this plan.** Checked directly during planning: it contains no `colorForIndex`/`selectSwatchForIndex`/`data-img-count` pattern (grep returned zero matches) — only the same non-buggy modal-swatch pattern already confirmed safe in `shell.ts`'s card quick-add flow. Nothing in this plan touches that file.

---

## Task 1: Migration — `product_images.color_id`, `product_colors.created_at`, backfill both, drop `image_index`

**Files:**
- Create: `supabase/migrations/20260816170000_product_images_color_id.sql`

**Interfaces:**
- Produces: `product_images.color_id` (nullable, FK to `product_colors.id`, `on delete set null`); `product_colors.created_at` (`timestamptz not null default now()`). Both consumed by Task 2.
- Removes: `product_colors.image_index` — no consumer after Task 2 lands.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push --linked` (from this worktree)
Expected: migration applies with no errors.

- [ ] **Step 3: Verify against live data before moving on**

Run these against the linked project (e.g. via `supabase db execute` or the SQL editor) and confirm:

```sql
-- Every image on a product that has at least one color should now have a
-- color_id (the only exception: a product photographed before any color was
-- added, or a genuinely orphan photo -- inspect any hits manually, don't
-- assume they're errors).
select p.id, p.slug, count(*) filter (where pi.color_id is null) as unassigned_count
from product_images pi
join products p on p.id = pi.product_id
where exists (select 1 from product_colors pc where pc.product_id = p.id)
group by p.id, p.slug
having count(*) filter (where pi.color_id is null) > 0;

-- Spot-check the 21-color/42-image product data.ts's own comments reference
-- (find its slug first): every color should now own exactly 2 images.
select pc.label, count(pi.id) as image_count
from product_colors pc
left join product_images pi on pi.color_id = pc.id
where pc.product_id = (select id from products where slug = '<the 21-color product's slug>')
group by pc.label
order by pc.label;

-- Every color now has a cover_image_id (unless it owns zero images).
select count(*) from product_colors pc
where pc.cover_image_id is null
  and exists (select 1 from product_images pi where pi.color_id = pc.id);
-- Expected: 0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260816170000_product_images_color_id.sql
git commit -m "Replace product_colors.image_index range system with explicit product_images.color_id"
```

---

## Task 2: `data.ts` — group images by `color_id` instead of slicing an index range

**Files:**
- Modify: `supabase/functions/publish-site/data.ts`
- Test: `supabase/functions/publish-site/data.test.ts`

**Interfaces:**
- Consumes: `product_images.color_id`, `product_colors.created_at` (Task 1).
- Produces: `CatalogColor.images`/`coverImageUrl` computed by direct `color_id` grouping (same field names/types as before — `render.ts` in Task 3 is the only consumer and its interface doesn't change here).

- [ ] **Step 1: Write the failing tests**

Replace the four `image_index`-based tests in `data.test.ts` (the file currently has `fakeSupabase`/`fakeTable` helpers above these — leave those untouched) with:

```ts
Deno.test("fetchCatalog: orders a product's colors by created_at, not by row id (regression: swatch 1 showed 'Variant 6')", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Retro Oversized T-Shirt", slug: "ch-retro", price: 4799, cod_advance: 500, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      // Row id order (alphabetical) is the exact reverse of the real
      // intended created_at order -- this is what a random-looking UUID
      // sort produced in production.
      { id: "zzz-row", product_id: "p1", label: "Variant 3", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:02Z", color_group: "Black" },
      { id: "mmm-row", product_id: "p1", label: "Variant 2", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:01Z", color_group: "Black" },
      { id: "aaa-row", product_id: "p1", label: "Variant 1", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
    ],
    product_images: [],
    product_variants: [],
    brands: [{ id: "b1", name: "Chrome Hearts", folder_slug: "chromehearts", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const labels = catalog.products[0].colors.map((c) => c.label);
  assertEquals(labels, ["Variant 1", "Variant 2", "Variant 3"]);
});

Deno.test("fetchCatalog: colors with a tied created_at fall back to id order deterministically", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "New Product", slug: "gs-new", price: 1999, cod_advance: 200, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "b-row", product_id: "p1", label: "Second Added", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
      { id: "a-row", product_id: "p1", label: "First Added", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
    ],
    product_images: [],
    product_variants: [],
    brands: [{ id: "b1", name: "Gymshark", folder_slug: "gymshark", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const labels = catalog.products[0].colors.map((c) => c.label);
  assertEquals(labels, ["First Added", "Second Added"]);
});

Deno.test("fetchCatalog: a color with no cover assigned yet still gets a real cover from its own first assigned photo, not a broken src", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Cotton Pant", slug: "skims-cotton-pants", price: 4000, cod_advance: 500, position: 1, category: "pants", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "c1", product_id: "p1", label: "Snow White", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "White" },
    ],
    product_images: [
      { id: "img1", product_id: "p1", storage_path: "skims-cotton-pants/photo.jpg", sort_order: 0, color_id: "c1" },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Skims", folder_slug: "skims", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const color = catalog.products[0].colors[0];
  assertEquals(color.coverImageUrl, "https://fake.test/skims-cotton-pants/photo.jpg");
});

Deno.test("fetchCatalog: each color's images come only from its own explicit color_id, unassigned images belong to no color (regression: image_index ranges silently defaulted new colors to 0, colliding with an existing color's images)", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Retro Hoodie", slug: "ch-hoodie", price: 4799, cod_advance: 500, position: 1, category: "jacket", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "c1", product_id: "p1", label: "Black", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
      { id: "c2", product_id: "p1", label: "Green", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:01Z", color_group: "Green" },
    ],
    product_images: [
      // Black owns 0 and 3 (non-contiguous -- an unassigned lifestyle shot
      // and a Green photo sit between them). A range-based system could
      // never express this; explicit color_id can.
      { id: "img0", product_id: "p1", storage_path: "ch-hoodie/0.jpg", sort_order: 0, color_id: "c1" },
      { id: "img1", product_id: "p1", storage_path: "ch-hoodie/1.jpg", sort_order: 1, color_id: "c2" },
      { id: "img2", product_id: "p1", storage_path: "ch-hoodie/lifestyle.jpg", sort_order: 2, color_id: null },
      { id: "img3", product_id: "p1", storage_path: "ch-hoodie/3.jpg", sort_order: 3, color_id: "c1" },
      { id: "img4", product_id: "p1", storage_path: "ch-hoodie/4.jpg", sort_order: 4, color_id: "c2" },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Chrome Hearts", folder_slug: "chromehearts", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const [black, green] = catalog.products[0].colors;
  assertEquals(black.images.map((im) => im.url), [
    "https://fake.test/ch-hoodie/0.jpg",
    "https://fake.test/ch-hoodie/3.jpg",
  ]);
  assertEquals(green.images.map((im) => im.url), [
    "https://fake.test/ch-hoodie/1.jpg",
    "https://fake.test/ch-hoodie/4.jpg",
  ]);
  const allOwnedUrls = [...black.images, ...green.images].map((im) => im.url);
  if (allOwnedUrls.includes("https://fake.test/ch-hoodie/lifestyle.jpg")) {
    throw new Error("an unassigned (color_id: null) image must not be owned by any color");
  }
  assertEquals(
    catalog.products[0].images.map((im) => im.url).includes("https://fake.test/ch-hoodie/lifestyle.jpg"),
    true,
  );
});

Deno.test("fetchCatalog: a color's cover_image_id pointing at an image reassigned to a different color falls back to the color's own first image", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Test Product", slug: "test-product", price: 1000, cod_advance: 100, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      // cover_image_id still points at img0, but img0 has since been
      // reassigned to color c2 -- the fallback must not show another
      // color's photo as this color's cover.
      { id: "c1", product_id: "p1", label: "Black", hex: null, cover_image_id: "img0", created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
      { id: "c2", product_id: "p1", label: "White", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:01Z", color_group: "White" },
    ],
    product_images: [
      { id: "img0", product_id: "p1", storage_path: "test-product/0.jpg", sort_order: 0, color_id: "c2" },
      { id: "img1", product_id: "p1", storage_path: "test-product/1.jpg", sort_order: 1, color_id: "c1" },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Gymshark", folder_slug: "gymshark", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const [black] = catalog.products[0].colors;
  assertEquals(black.coverImageUrl, "https://fake.test/test-product/1.jpg");
});
```

Leave the two unrelated existing tests ("fetchCatalog: joins brand name and folder onto each product" and "fetchPrimaryBrands: ...") exactly as they are.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd supabase/functions/publish-site && deno test data.test.ts`
Expected: FAIL — `product_colors`/`product_images` fixture rows carry `cover_image_id`/`created_at`/`color_id` fields the current `fetchCatalog` doesn't select or use yet, and the removed `image_index`-based tests are gone so their old assertions can't fail, but the five new/changed tests above fail against the still-range-based implementation (wrong labels/images/cover due to the old code reading `image_index`, which these fixtures no longer supply).

- [ ] **Step 3: Update `fetchCatalog`**

In `data.ts`, replace the colors query, images query, and the color-range computation block with:

```ts
  const { data: colors, error: colorsError } = await supabase
    .from("product_colors")
    .select("id, product_id, label, hex, color_group, cover_image_id, created_at")
    .order("product_id", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (colorsError) throw new Error(`fetchCatalog colors: ${colorsError.message}`);

  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select("id, product_id, storage_path, sort_order, color_id")
    .order("sort_order", { ascending: true });
  if (imagesError) throw new Error(`fetchCatalog images: ${imagesError.message}`);
```

Replace the `imagesByProduct` construction and the range-based `colorsByProduct` construction (from `const imagesByProduct = new Map...` through the end of that loop) with:

```ts
  const imagesByProduct = new Map<string, CatalogImage[]>();
  const imagesByColor = new Map<string, CatalogImage[]>();
  const imageUrlById = new Map<string, string>();
  for (const img of images ?? []) {
    const url = publicUrl(img.storage_path);
    imageUrlById.set(img.id, url);
    const catalogImg: CatalogImage = { url, sortOrder: img.sort_order };

    const productList = imagesByProduct.get(img.product_id) ?? [];
    productList.push(catalogImg);
    imagesByProduct.set(img.product_id, productList);

    if (img.color_id) {
      const colorList = imagesByColor.get(img.color_id) ?? [];
      colorList.push(catalogImg);
      imagesByColor.set(img.color_id, colorList);
    }
  }

  const variantsByColor = new Map<string, CatalogVariant[]>();
  for (const v of variants ?? []) {
    const list = variantsByColor.get(v.color_id) ?? [];
    list.push({ size: v.size, inStock: v.in_stock });
    variantsByColor.set(v.color_id, list);
  }

  // Group colors by product, preserving the query's already-correct
  // (product_id, created_at, id) order.
  const colorsByProductRaw = new Map<string, NonNullable<typeof colors>>();
  for (const c of colors ?? []) {
    const list = colorsByProductRaw.get(c.product_id) ?? [];
    list.push(c);
    colorsByProductRaw.set(c.product_id, list);
  }

  const colorsByProduct = new Map<string, CatalogColor[]>();
  for (const [productId, productColors] of colorsByProductRaw) {
    const list: CatalogColor[] = productColors.map((c) => {
      // Each image now carries its own explicit color_id (set by the admin
      // panel), so a color's photos are whatever product_images rows point
      // at it -- no index math, no "does this range overlap that one".
      const ownImages = imagesByColor.get(c.id) ?? [];
      const coverUrl = c.cover_image_id ? imageUrlById.get(c.cover_image_id) : undefined;
      // cover_image_id can point at an image since reassigned to a different
      // color (or deleted) -- only trust it if it's still actually one of
      // this color's own images; otherwise fall back to the first owned one.
      const coverImageUrl =
        (coverUrl && ownImages.some((img) => img.url === coverUrl) ? coverUrl : ownImages[0]?.url) ?? "";
      return {
        id: c.id,
        label: c.label,
        hex: c.hex,
        colorGroup: c.color_group,
        coverImageUrl,
        images: ownImages,
        variants: variantsByColor.get(c.id) ?? [],
      };
    });
    colorsByProduct.set(productId, list);
  }
```

The replacement block above is the complete span from `imagesByProduct`'s declaration through the end of the `colorsByProduct` for-loop — it already includes `variantsByColor` and `colorsByProductRaw` unchanged (their code is identical to today's, just carried along since they sit in the middle of the span being replaced). After this edit, confirm no leftover range variables remain anywhere in the file — `start`, `nextStart`, `ownImages.slice` should not appear.

Update `CatalogProduct.images`'s doc comment (currently references "each color's own images (see CatalogColor) is a slice of this same list -- see fetchCatalog's color-range comment") to:

```ts
  // Every image uploaded for this product (product_images), sorted by
  // sort_order. Each color's own `images` (see CatalogColor) is the subset
  // explicitly assigned to it (product_images.color_id) -- an image with no
  // color_id still appears here but isn't owned by any color's swatch.
  images: CatalogImage[];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd supabase/functions/publish-site && deno test data.test.ts`
Expected: PASS, all tests in this file.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd supabase/functions/publish-site && deno check index.ts && deno test`
Expected: PASS (some `render.test.ts`/`shell.test.ts` failures at this point are fine if they depend on Task 3's render.ts changes — confirm any failures are exactly the ones Task 3 will fix, not something else broken by this task).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/publish-site/data.ts supabase/functions/publish-site/data.test.ts
git commit -m "data.ts: group catalog colors' images by explicit color_id instead of an image_index range"
```

---

## Task 3: `render.ts` — PDP swatches carry explicit index lists, not a range

**Files:**
- Modify: `supabase/functions/publish-site/render.ts`
- Test: `supabase/functions/publish-site/render.test.ts`

**Interfaces:**
- Consumes: `CatalogColor.images` (Task 2's explicit per-color list).
- Produces: PDP swatch markup with `data-img-indices` (JSON array) replacing `data-img-count`; inline PDP script's `colorForIndex`/`selectSwatchForIndex` do array-membership instead of range math.

- [ ] **Step 1: Write the failing tests**

Add to `render.test.ts` (near the other `renderPdpPage` swatch tests):

```ts
Deno.test("renderPdpPage: a color's swatch carries its own explicit, possibly non-contiguous image indices (regression: a start+count range couldn't express interleaved ownership)", () => {
  const nonContiguous: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      {
        ...twoColorProduct.colors[0],
        coverImageUrl: "https://example.supabase.co/.../0.jpg",
        images: [
          { url: "https://example.supabase.co/.../0.jpg", sortOrder: 0 },
          { url: "https://example.supabase.co/.../2.jpg", sortOrder: 2 },
        ],
      },
      {
        ...twoColorProduct.colors[1],
        coverImageUrl: "https://example.supabase.co/.../1.jpg",
        images: [{ url: "https://example.supabase.co/.../1.jpg", sortOrder: 1 }],
      },
    ],
    images: [
      { url: "https://example.supabase.co/.../0.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../1.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../2.jpg", sortOrder: 2 },
    ],
  };
  const html = renderPdpPage(nonContiguous);
  assertStringIncludes(html, 'data-img-indices="[0,2]"');
  assertStringIncludes(html, 'data-img-indices="[1]"');
});

Deno.test("renderPdpPage: inline script's swatchList carries each color's indices array, not a count (regression: overlapping start+count ranges selected two swatches at once)", () => {
  const html = renderPdpPage(twoColorProduct);
  assertStringIncludes(html, '"indices"');
  if (html.includes('"count"')) {
    throw new Error("swatchList should no longer carry a count field -- indices replaces it entirely");
  }
  if (html.includes("data-img-count")) {
    throw new Error("swatch markup should no longer emit data-img-count -- data-img-indices replaces it entirely");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd supabase/functions/publish-site && deno test render.test.ts`
Expected: FAIL — current code still emits `data-img-count` and a `count` field, not `data-img-indices`/`indices`.

- [ ] **Step 3: Update `renderPdpPage`**

Replace `colorImgCount` with `colorImgIndices`:

```ts
  const images = product.images.map((img) => img.url);
  const colorImgIndex = (c: CatalogProduct["colors"][number]) => {
    const idx = images.indexOf(c.coverImageUrl);
    return idx === -1 ? 0 : idx;
  };
  // A color's own photos are no longer guaranteed to be a contiguous block
  // within the product's image list -- the admin panel lets a photo be
  // (re)assigned to any color regardless of upload order, so a swatch must
  // carry the exact list of indices it owns, not a start+count range.
  const colorImgIndices = (c: CatalogProduct["colors"][number]) =>
    c.images.map((img) => images.indexOf(img.url)).filter((i) => i !== -1);
```

Update the swatch markup:

```ts
  const swatches = product.colors
    .map((c) => {
      const imgIndex = colorImgIndex(c);
      const indicesJson = esc(JSON.stringify(colorImgIndices(c)));
      return `<div class="modal-swatch${imgIndex === 0 ? " selected" : ""}" style="background:${esc(c.hex ?? "#333")};" title="${esc(c.label)}" data-img-index="${imgIndex}" data-img-indices="${indicesJson}"></div>`;
    })
    .join("");
```

In the inline `<script>` block, update `swatchList`:

```ts
    var swatchList = ${jsonForScript(product.colors.map((c) => ({ label: c.label, imgIndex: colorImgIndex(c), indices: colorImgIndices(c) })))};
```

Update `colorForIndex` and `selectSwatchForIndex`:

```ts
    function colorForIndex(idx) {
      var matches = swatchList.filter(function(s) { return s.indices.indexOf(idx) !== -1; });
      return matches.length ? matches[0] : null;
    }

    function selectSwatchForIndex(idx) {
      colorSwatches.forEach(function(s) {
        var indices = JSON.parse(s.dataset.imgIndices || '[]');
        s.classList.toggle('selected', indices.indexOf(idx) !== -1);
      });
    }
```

Update the swatch click handler:

```ts
    colorSwatches.forEach(function(sw) {
      sw.addEventListener('click', function() {
        var imgIndex = parseInt(sw.dataset.imgIndex, 10);
        var indices = JSON.parse(sw.dataset.imgIndices || '[]');
        selectSwatchForIndex(imgIndex);
        selectedColor = { label: sw.title, imgIndex: imgIndex, indices: indices };
        colorLabel.textContent = sw.title;
        setMainImage(imgIndex, sw.title);
      });
    });
```

`addBtn`'s click handler is unchanged (it only reads `selectedColor.imgIndex`, which still exists).

Finally, update the stale architecture comment above `renderPdpPage` (the paragraph starting "One reconciliation versus the real markup: the real PDP carries 2 gallery images per color... The catalog data model this project standardizes on (Task 4) only carries one image per color... not a richer multi-image-per-color gallery the data model doesn't support.") — this is no longer true as of this task. Replace that paragraph with:

```ts
// One reconciliation versus the real markup: the real PDP carries 2 gallery
// images per color for some products (e.g. front/back shots). This is fully
// supported: each color's swatch carries the exact list of image indices it
// owns (see colorImgIndices below), not a single index, so clicking any of a
// color's thumbs correctly highlights that color's swatch and clicking the
// swatch jumps to its cover photo.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd supabase/functions/publish-site && deno test render.test.ts`
Expected: PASS, all tests in this file.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd supabase/functions/publish-site && deno check index.ts && deno test`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "render.ts: PDP swatches carry explicit image-index lists instead of a start+count range"
```

---

## Task 4: Admin panel — explicit per-color image assignment, serial-numbered captions/dropdowns

**Files:**
- Modify: `admin/dashboard/products.js` (on `main`, not this branch)

**Interfaces:**
- Consumes: `product_images.color_id` (Task 1).
- Produces: no new interfaces consumed elsewhere — this is the terminal admin-UI task for this plan.

- [ ] **Step 1: Rewrite `refreshImagesGrid`**

In `admin/dashboard/products.js`, change the function's signature from `refreshImagesGrid(productId)` to `refreshImagesGrid(product)` (it needs the full product object to re-render the Colors section after a color-assignment change), and replace its entire body with:

```js
async function refreshImagesGrid(product) {
  var productId = product.id;
  var { data: images, error } = await sb.from('product_images').select('id, storage_path, sort_order, color_id').eq('product_id', productId).order('sort_order', { ascending: true });
  var grid = document.getElementById('images-grid-' + productId);
  if (error) { grid.innerHTML = 'Failed to load images: ' + esc(error.message); return; }

  var { data: colors } = await sb.from('product_colors').select('id, label').eq('product_id', productId).order('label', { ascending: true });
  var colorLabelById = {};
  (colors || []).forEach(function(c) { colorLabelById[c.id] = c.label; });

  grid.innerHTML = images.map(function(img, i) {
    var url = sb.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl;
    var serial = '[Image #' + (i + 1) + ']';
    var assignedLabel = img.color_id ? (colorLabelById[img.color_id] || '(unknown color)') : '(unassigned)';
    var colorOptions = '<option value=""' + (!img.color_id ? ' selected' : '') + '>(unassigned)</option>' +
      (colors || []).map(function(c) {
        return '<option value="' + c.id + '"' + (c.id === img.color_id ? ' selected' : '') + '>' + esc(c.label) + '</option>';
      }).join('');
    return '<div style="position:relative;width:80px;">' +
      '<img src="' + esc(url) + '" style="width:80px;height:80px;object-fit:cover;border:1px solid var(--border);" />' +
      '<button class="btn danger delete-image-btn" data-image-id="' + img.id + '" data-storage-path="' + esc(img.storage_path) + '" style="position:absolute;top:2px;right:2px;padding:2px 6px;font-size:9px;">×</button>' +
      '<div style="font-size:10px;color:var(--muted);text-align:center;margin-top:2px;">' + serial + '</div>' +
      '<select class="image-color-select" data-image-id="' + img.id + '" style="width:80px;font-size:10px;margin-top:2px;">' + colorOptions + '</select>' +
      '<div class="image-color-caption" style="font-size:10px;color:var(--white);text-align:center;margin-top:2px;">' + esc(assignedLabel) + '</div>' +
    '</div>';
  }).join('') || '<span style="color:var(--muted);font-size:12px;">No images yet.</span>';

  var productInCache = productsCache.find(function(p) { return p.id === productId; });
  if (productInCache && images.length) {
    productInCache.cover_thumb_url = sb.storage.from('product-images').getPublicUrl(images[0].storage_path).data.publicUrl;
  }

  grid.querySelectorAll('.image-color-select').forEach(function(select) {
    select.addEventListener('change', async function() {
      var imageId = select.dataset.imageId;
      var newColorId = select.value || null;
      select.disabled = true;
      var { error: updateError } = await sb.from('product_images').update({ color_id: newColorId }).eq('id', imageId);
      select.disabled = false;
      if (updateError) { alert('Assignment failed: ' + updateError.message); return; }
      await refreshImagesGrid(product);
      renderColorsSection(product);
    });
  });

  grid.querySelectorAll('.delete-image-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this image? If it was assigned to a color, that color loses this photo (and its thumbnail, if this was the one selected).')) return;
      var msg = document.getElementById('image-upload-msg-' + productId);
      var { error: removeError } = await sb.storage.from('product-images').remove([btn.dataset.storagePath]);
      if (removeError) {
        if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: ' + removeError.message; }
        return;
      }
      var { error: deleteError } = await sb.from('product_images').delete().eq('id', btn.dataset.imageId);
      if (deleteError) {
        if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: storage object removed but database row could not be deleted (' + deleteError.message + '). Please refresh and retry.'; }
        await refreshImagesGrid(product);
        return;
      }
      if (msg) { msg.style.color = '#8fd14f'; msg.textContent = 'Image deleted.'; }
      await refreshImagesGrid(product);
      renderColorsSection(product);
    });
  });
}
```

- [ ] **Step 2: Update `refreshImagesGrid`'s two call sites**

In `renderImagesSection`, both `await refreshImagesGrid(product.id);` calls (the initial render and the one at the end of the upload `change` handler) become `await refreshImagesGrid(product);` — `product` is already in scope at both call sites (it's `renderImagesSection`'s own parameter).

- [ ] **Step 3: Rewrite `renderColorsSection`'s image-fetching and cover-dropdown logic**

Replace this block:

```js
  var { data: images } = await sb.from('product_images').select('id, storage_path').eq('product_id', product.id).order('sort_order', { ascending: true });
  var coverOptions = (images || []).map(function(img) {
    return { id: img.id, url: sb.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl };
  });
```

with:

```js
  // Same global sort_order numbering as the Images grid above, so an admin
  // can visually match a color's "Thumbnail: [Image #10]" against the photo
  // actually captioned "[Image #10]" there.
  var { data: allImages } = await sb.from('product_images').select('id, color_id').eq('product_id', product.id).order('sort_order', { ascending: true });
  var serialById = {};
  (allImages || []).forEach(function(img, i) { serialById[img.id] = i + 1; });
```

Inside the `colors.map(function(c) { ... })` block, replace:

```js
      var coverSelectOptions = coverOptions.map(function(img) {
        return '<option value="' + img.id + '"' + (img.id === c.cover_image_id ? ' selected' : '') + '>' + img.id.slice(0, 8) + '</option>';
      }).join('');
```

with:

```js
      var ownImages = (allImages || []).filter(function(img) { return img.color_id === c.id; });
      var coverSelectOptions = ownImages.map(function(img) {
        return '<option value="' + img.id + '"' + (img.id === c.cover_image_id ? ' selected' : '') + '>[Image #' + serialById[img.id] + ']</option>';
      }).join('');
```

- [ ] **Step 4: Stop seeding `cover_image_id` on Add Color**

Replace this block (the comment plus the `coverImageId` line, just above the `add-color-btn` handler's insert call):

```js
    // Inherit the product's first uploaded image as this color's cover, if one
    // exists, rather than leaving it null -- a color with no cover image and
    // (until an admin visits the stock grid below) no variant rows would make
    // Publish's storefront card show a broken image and zero size buttons for
    // the WHOLE product if this color happens to sort first. If the product
    // has no images uploaded yet, leave cover_image_id null -- that's a more
    // visible gap an admin using this tab would notice immediately.
    var coverImageId = coverOptions.length ? coverOptions[0].id : null;

    var { data: newColor, error } = await sb.from('product_colors')
      .insert({ product_id: product.id, label: label, hex: hex, color_group: colorGroup, cover_image_id: coverImageId })
      .select('id').single();
```

with:

```js
    // A brand-new color has no images assigned to it yet -- cover_image_id
    // starts null (there is nothing yet that could correctly be its cover;
    // seeding it from some other image, assigned or not, would misattribute
    // a photo to a color it doesn't show). The admin assigns photos to this
    // color from the Images grid above, then picks a Thumbnail here, same
    // immediate next step as visiting the stock grid below already is.
    var { data: newColor, error } = await sb.from('product_colors')
      .insert({ product_id: product.id, label: label, hex: hex, color_group: colorGroup, cover_image_id: null })
      .select('id').single();
```

- [ ] **Step 5: Downloads mirror**

Diff `admin/dashboard/products.js` against `C:\Users\anind\Downloads\berserker\admin\dashboard\products.js`, then copy the updated file over and verify the diff shows a byte-for-byte match.

- [ ] **Step 6: Commit**

```bash
git add admin/dashboard/products.js
git commit -m "products.js: explicit per-color image assignment with serial-numbered captions and dropdowns"
```

(This commit lands on `main`, not this feature branch — run it from `C:\Users\anind\berserker-site`, not this worktree.)

---

## Task 5: `schema.sql` / `seed.sql` — bring the bootstrap files in sync

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `supabase/seed.sql`

**Interfaces:** None — these files are the fresh-database bootstrap path (`supabase db reset`), not consumed by any runtime code. Kept in sync so that path doesn't silently break, per the lesson from the brand-management plan's final review.

- [ ] **Step 1: Update `schema.sql`**

Replace the `product_colors` table definition:

```sql
create table if not exists product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  label text not null,
  hex text,
  image_index int not null default 0,
  color_group text not null,
  cover_image_id uuid references product_images(id) on delete set null
);
```

with:

```sql
create table if not exists product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  label text not null,
  hex text,
  color_group text not null,
  cover_image_id uuid references product_images(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Added via ALTER (not the product_images CREATE TABLE above) because
-- product_images is deliberately created before product_colors (see the
-- comment above that table) -- a color_id FK onto product_colors can only be
-- added once product_colors exists.
alter table product_images add column if not exists color_id uuid references product_colors(id) on delete set null;
create index if not exists product_images_color_id_idx on product_images(color_id);
```

- [ ] **Step 2: Write and run a script to strip `image_index` from `seed.sql`**

`seed.sql` never inserts `product_images` rows (images come from real uploaded files, not seed data), so there is nothing to backfill `color_id` from — every `insert into product_colors (product_id, label, hex, image_index, color_group) values (...)` line just needs `image_index` (the column and its value) removed.

Write a one-off Node script (do not commit it — same throwaway pattern as the brand-management plan's `brand_id` seed transform):

```js
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf8');

const lineRegex = /^insert into product_colors \(product_id, label, hex, image_index, color_group\) select id, ('(?:[^']|'')*'), ('(?:[^']|'')*'), (\d+), ('(?:[^']|'')*') from products where slug = '([a-z0-9-]+)';$/gm;

let count = 0;
content = content.replace(lineRegex, (match, label, hex, _imageIndex, colorGroup, slug) => {
  count++;
  return `insert into product_colors (product_id, label, hex, color_group) select id, ${label}, ${hex}, ${colorGroup} from products where slug = '${slug}';`;
});

console.log(`Transformed ${count} lines`);
fs.writeFileSync(path, content);
```

Run it against `supabase/seed.sql`, then verify: `grep -c "insert into product_colors" supabase/seed.sql` still reports 219, and `grep -c "image_index" supabase/seed.sql` reports 0.

If the regex's exact shape doesn't match every line on the first pass (e.g. a `hex` value of literal `null` instead of a quoted string breaks the `('...)` capture group), inspect a few non-matching lines directly and adjust the regex rather than hand-editing 219 lines — but first check: every `product_colors` insert in the file supplies a real `hex` string (never `null`), matching the pattern above, since colors imported from real product photography always had a hex captured.

- [ ] **Step 3: Verify**

Run: `grep -n "image_index" supabase/schema.sql supabase/seed.sql`
Expected: no matches in either file.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql supabase/seed.sql
git commit -m "schema.sql/seed.sql: drop image_index, add product_colors.created_at and product_images.color_id"
```

---

## Task 6: Deploy and verify against real data

**Files:** none (deploy + verification task).

- [ ] **Step 1: Deploy**

Run: `supabase functions deploy publish-site --use-api`
Expected: `"message":"Deployed Functions."`

- [ ] **Step 2: Regenerate locally and inspect**

Run: `deno run --allow-net --allow-env --allow-read --allow-write --env-file=.env.local scripts/verify-storefront-generation.ts`

Inspect the generated PDP page for the 21-color/42-image product referenced in Task 1: confirm every swatch's `data-img-indices` lists exactly 2 indices, no two swatches share an index, and the swatch order matches the color order shown in the admin panel.

- [ ] **Step 3: Manual admin-panel spot-check**

Since no live browser automation is available in this environment, this step is a note for the human operator rather than something this task executes: after this ships, open a product's Edit panel, confirm the Images grid shows `[Image #N]` captions with working color-assignment dropdowns, confirm a color's Thumbnail dropdown only lists that color's own images labeled the same way, and confirm creating a new color starts it with an empty cover.

- [ ] **Step 4: Report**

Document the deploy confirmation, the 21-color product's verified index-list output, and note the manual spot-check as deferred to the human operator (same limitation every prior plan in this project has hit).

---

## Task 7: Final whole-branch review

**Files:** none (review task).

- [ ] **Step 1: Run the full test suite one more time**

Run: `cd supabase/functions/publish-site && deno check index.ts && deno test`
Expected: all tests pass.

- [ ] **Step 2: Whole-branch review**

Review every file this plan touched, together — per this project's established discipline, a task-by-task review can miss a bug that only shows up when two tasks' changes interact. Pay particular attention to:

- Does `data.ts`'s cover-fallback logic (Task 2) actually get exercised by `render.ts` (Task 3) the same way for both the card and PDP renderers — i.e. does a color with no valid cover still degrade gracefully on both surfaces, not just the one that was tested?
- Does the admin panel's `refreshImagesGrid`/`renderColorsSection` cross-refresh (Task 4) actually keep both sections' displayed state consistent after a color-assignment change, without a stale cache reference anywhere (`productsCache`, `colorLabelById`, etc.)?
- Do `schema.sql` and `seed.sql` (Task 5) actually produce a working fresh-database bootstrap — every `image_index` reference gone, the `product_images`/`product_colors` table creation order still resolves (no circular FK error on a `supabase db reset`)?
- Does the live migration's backfill (Task 1) actually preserve every existing product's swatch order and image-to-color mapping, confirmed against real data, not just the unit tests' synthetic fixtures?

- [ ] **Step 3: Report**

Document findings and any fixes applied, following the same fix-wave pattern the two prior plans in this project used (parked/fixed rulings recorded, workspace cleaned up once clean).
