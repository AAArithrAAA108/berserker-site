# Live Storefront Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Berserker admin panel's Publish button actually regenerate the real storefront (all-products, 6 collection pages, 7 brand pages, 41 product detail pages) from the database, replacing the disconnected placeholder file it writes today.

**Architecture:** Extract the real page shell (nav/footer/cart/size-picker/base CSS) into a reusable Deno template function; rewrite the product-card renderer to emit markup byte-compatible with the existing, unchanged cart/size-picker JS; add explicit collection/brand membership rules; add a PDP renderer; verify all 55 pages' generated output structurally against the real live pages BEFORE pointing the Edge Function's write path at them.

**Tech Stack:** Deno/TypeScript (existing `supabase/functions/publish-site/`), Supabase Postgres, GitHub Contents API (existing `github.ts`, unchanged).

## Global Constraints

- Card markup must preserve exact compatibility with the site's existing, unmodified cart/size-picker JS: `.product-price`'s current price must be a bare first-child text node (read via `childNodes[0].textContent`); swatches must carry `data-img-index` (index into that card's flattened slider image list, not a color-group string); the image slider structure is `.product-img.product-img-slider > .slider-track > img` × one per color.
- Strikethrough price formula (already correct, unchanged): `Math.ceil((price * 2.7) / 1000) * 1000 - 1`. Rendered as `<span class="original">` (real, pre-existing CSS class — confirmed at `all-products/index.html:430-437`: line-through, `color: var(--muted)`, `font-size: 14px`, `margin-left: 8px`), trailing the bare price text node.
- No per-card size buttons — sizing happens exclusively via the shared `#size-modal`, populated from card DOM at click time by existing JS. Do not emit `.product-sizes`/`.size-btn` on cards.
- Collection category mapping (exact): `t-shirts: ['t-shirt','compression']`, `compressions: ['compression']`, `pants: ['pants']`, `jackets: ['jacket']`, `dresses: ['dress']`, `sets: ['set']`.
- Brand folder → canonical prefix (exact, case-sensitive `startsWith` match against `products.brand`): `gymshark→"Gymshark"`, `youngla→"YoungLA"`, `breathedivinity→"BreatheDivinity"`, `chromehearts→"Chrome Hearts"`, `cactusjack→"Cactus Jack"`, `skims→"Skims"`, `lululemon→"Lululemon"`.
- One image per color in the slider (each color's `cover_image_id`), not multiple — this is a deliberate, spec-approved simplification, not a bug to "fix."
- The unified shell is the all-products/collections family (file-path logos, variant-label-capable size-picker) — brand pages give up their base64-logo/older-picker shell entirely.
- Standing project workflow: real site pages get mirrored to `C:\Users\anind\Downloads\berserker\` in addition to the repo, diffed before overwrite, committed and pushed without stopping to confirm. This applies to files a task *hand-edits*; the generator's own TypeScript source files (`shell.ts`, `render.ts`, `membership.ts`, `data.ts`, `index.ts`) are backend code, not site pages — no Downloads mirror needed for them. The 55 generated HTML files are machine output committed by the Edge Function itself (via `github.ts`, unchanged) — no manual Downloads mirroring applies to them either.
- The final cutover (pointing `index.ts` at the real file paths) must not trigger a real GitHub commit as part of automated task verification — add a dry-run mode so the implementer can verify generated output without publishing, and leave the first real (non-dry-run) invocation for the controller to trigger consciously with the user, per the spec's Rollout section.

---

## File Structure

- `supabase/functions/publish-site/membership.ts` *(new)* — `COLLECTION_CATEGORY_MAP`, `BRAND_PREFIX_MAP`, `isInCollection(product, collectionSlug)`, `brandFolderFor(product)` (returns the matching folder slug or `null`).
- `supabase/functions/publish-site/shell.ts` *(new)* — `renderShell({ title, activeNav, bodyContent, perPageStyle }): string`, extracted verbatim from the real `all-products/index.html` shell (nav/off-canvas/footer/back-to-top/size-modal/cart-sidebar/scripts + base CSS), parameterized for reuse across all page types.
- `supabase/functions/publish-site/data.ts` *(modify)* — extend `CatalogProduct`/`fetchCatalog` with `description` (already a DB column, just not selected yet) and confirm `CatalogColor.coverImageUrl` is what card/PDP rendering needs (it already is, from Foundation).
- `supabase/functions/publish-site/render.ts` *(rewrite `renderProductCard`, add new functions)* — `renderProductCard`, `renderSliderCss(products)` (per-page `@keyframes`/`#product-N` CSS), `renderListingPage(catalog)`, `renderCollectionPage(catalog, slug)`, `renderBrandPage(catalog, folder)`, `renderPdpPage(product)`.
- `supabase/functions/publish-site/render.test.ts` *(extend)* — new tests for all of the above.
- `supabase/functions/publish-site/index.ts` *(modify)* — commit all 55 files instead of the one placeholder; add dry-run support.
- `supabase/migrations/<timestamp>_backfill_product_descriptions.sql` *(new)* — one-time backfill of `products.description` from the 41 real PDPs' current text.

---

## Task 1: `membership.ts` — collection & brand membership rules

**Files:**
- Create: `supabase/functions/publish-site/membership.ts`
- Test: `supabase/functions/publish-site/membership.test.ts`

**Interfaces:**
- Consumes: `CatalogProduct` (from `data.ts` — has `brand: string`, `category: string`)
- Produces: `isInCollection(product: { category: string }, collectionSlug: string): boolean`, `brandFolderFor(product: { brand: string }): string | null`, exported `COLLECTION_SLUGS: string[]` (the 6 slugs), exported `BRAND_FOLDERS: string[]` (the 7 folders) — later tasks iterate these to know which pages to generate.

- [ ] **Step 1: Write the failing tests**

```typescript
// supabase/functions/publish-site/membership.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInCollection, brandFolderFor, COLLECTION_SLUGS, BRAND_FOLDERS } from "./membership.ts";

Deno.test("isInCollection: t-shirts includes both t-shirt and compression", () => {
  assertEquals(isInCollection({ category: "t-shirt" }, "t-shirts"), true);
  assertEquals(isInCollection({ category: "compression" }, "t-shirts"), true);
  assertEquals(isInCollection({ category: "jacket" }, "t-shirts"), false);
});

Deno.test("isInCollection: compressions only includes compression", () => {
  assertEquals(isInCollection({ category: "compression" }, "compressions"), true);
  assertEquals(isInCollection({ category: "t-shirt" }, "compressions"), false);
});

Deno.test("isInCollection: the other four collections are exact 1:1", () => {
  assertEquals(isInCollection({ category: "pants" }, "pants"), true);
  assertEquals(isInCollection({ category: "jacket" }, "jackets"), true);
  assertEquals(isInCollection({ category: "dress" }, "dresses"), true);
  assertEquals(isInCollection({ category: "set" }, "sets"), true);
  assertEquals(isInCollection({ category: "jacket" }, "pants"), false);
});

Deno.test("brandFolderFor: exact brand name matches its folder", () => {
  assertEquals(brandFolderFor({ brand: "Gymshark" }), "gymshark");
  assertEquals(brandFolderFor({ brand: "Skims" }), "skims");
});

Deno.test("brandFolderFor: collab brand text still matches via prefix", () => {
  assertEquals(brandFolderFor({ brand: "YoungLA × Batman" }), "youngla");
  assertEquals(brandFolderFor({ brand: "YoungLA × Superman" }), "youngla");
  assertEquals(brandFolderFor({ brand: "YoungLA × Gold's Gym" }), "youngla");
  assertEquals(brandFolderFor({ brand: "Chrome Hearts × Mastermind" }), "chromehearts");
  assertEquals(brandFolderFor({ brand: "Cactus Jack x Travis Scott" }), "cactusjack");
});

Deno.test("brandFolderFor: unmatched brand returns null", () => {
  assertEquals(brandFolderFor({ brand: "Some Random Brand" }), null);
});

Deno.test("COLLECTION_SLUGS and BRAND_FOLDERS have the expected counts", () => {
  assertEquals(COLLECTION_SLUGS.length, 6);
  assertEquals(BRAND_FOLDERS.length, 7);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/publish-site/membership.test.ts`
Expected: FAIL — `membership.ts` does not exist.

- [ ] **Step 3: Implement `membership.ts`**

```typescript
// supabase/functions/publish-site/membership.ts

export const COLLECTION_CATEGORY_MAP: Record<string, string[]> = {
  "t-shirts": ["t-shirt", "compression"],
  "compressions": ["compression"],
  "pants": ["pants"],
  "jackets": ["jacket"],
  "dresses": ["dress"],
  "sets": ["set"],
};

export const COLLECTION_SLUGS = Object.keys(COLLECTION_CATEGORY_MAP);

export const BRAND_PREFIX_MAP: Record<string, string> = {
  gymshark: "Gymshark",
  youngla: "YoungLA",
  breathedivinity: "BreatheDivinity",
  chromehearts: "Chrome Hearts",
  cactusjack: "Cactus Jack",
  skims: "Skims",
  lululemon: "Lululemon",
};

export const BRAND_FOLDERS = Object.keys(BRAND_PREFIX_MAP);

export function isInCollection(product: { category: string }, collectionSlug: string): boolean {
  const categories = COLLECTION_CATEGORY_MAP[collectionSlug];
  if (!categories) return false;
  return categories.includes(product.category);
}

export function brandFolderFor(product: { brand: string }): string | null {
  for (const folder of BRAND_FOLDERS) {
    if (product.brand.startsWith(BRAND_PREFIX_MAP[folder])) return folder;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/publish-site/membership.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Live cross-check against the real 41 products**

Run via `mcp__supabase__execute_sql` (this is the real acceptance check — the unit tests above use synthetic data, this confirms the logic against production data):
```sql
select brand, category from products order by brand;
```
For each of the 41 rows, manually verify (or write a short one-off Deno script reading this output) that `brandFolderFor` returns a non-null folder for every row — if any real product's brand doesn't match one of the 7 prefixes, that's a real gap to resolve before continuing (either the brand text has an unexpected format, or a new prefix variant needs adding to `BRAND_PREFIX_MAP`). Paste the full 41-row query output and your matching results in your task report.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/publish-site/membership.ts supabase/functions/publish-site/membership.test.ts
git commit -m "Add collection/brand membership rules for storefront generation"
git push origin feature/live-storefront-generation
```

## Task 2: `shell.ts` — extract the real page shell

**Files:**
- Create: `supabase/functions/publish-site/shell.ts`
- Read (source to extract from): `all-products/index.html` (exact line ranges below, verified against the current file)

**Interfaces:**
- Produces: `function renderShell(opts: { title: string; activeNav?: string; bodyContent: string; perPageStyle?: string }): string` — returns a complete HTML document. Later tasks (Task 5, Task 6) call this with their own `bodyContent`.

This task is primarily careful extraction, not new logic — copy real content verbatim, do not paraphrase or "clean up" anything, since any drift from the real markup risks breaking the shared cart/size-picker JS this shell wraps.

- [ ] **Step 1: Read the exact source ranges from `all-products/index.html`**

Read these line ranges from the current file (already verified to exist at these exact boundaries):
- Lines 1-11: doctype/`<head>` opening, meta tags, favicon `<link>`, Google Fonts `<link>`s (the `<title>` at line 7 and `<link rel="icon">` at line 8 must become parameterized — see Step 2).
- Lines 12-867: the base `<style>` content — design tokens through size-picker CSS. **Do not include lines 868-1827** (the per-product slider `@keyframes`/`#product-N` CSS) — that's page-specific and generated fresh per page in Task 5, passed in via the `perPageStyle` parameter.
- Line 1828: `</head>`, line 1829: `<body>`.
- Lines 1832-1843: `<nav>...</nav>`.
- Lines 1845-1862: off-canvas menu overlay + sidebar + search form.
- Lines 3051-3093: `<footer>...</footer>`.
- Line 3095: back-to-top button.
- Lines 3099-3115: `#size-modal` markup.
- Lines 3116-3132: `#cart-overlay` + `#cart-sidebar` markup.
- Lines 3133-3451: first `<script>` block (cart logic + size-picker logic — `addToCart`, `updateCart`, `openSizePicker`, `confirmSize`, etc.).
- Lines 3454-3481: second `<script>` block (nav-toggle + search-form-submit).
- **Do NOT include** lines 3484-3515 (the all-products-page-only `?q=` search-filter script — that's specific to the all-products page, not part of the shared shell; Task 5 adds it back only for the all-products page specifically if needed, or it's dropped since collection/brand pages never had it anyway — confirm current behavior by checking whether `collections/jackets/index.html` has this same script block; if it doesn't, this behavior is genuinely all-products-only and should stay that way, added by `renderListingPage` in Task 5, not by the shared shell).

- [ ] **Step 2: Write `shell.ts`**

Build a template-literal-returning function using the extracted content verbatim, with these specific substitution points:
- `<title>` (line 7 in the source) → `${opts.title}`
- Anywhere the source has an "active nav" concept for the current page (check the extracted nav markup at 1832-1843 for any class/attribute that varies by page — if none exists today, i.e. no page currently highlights itself as active in its own nav, then `opts.activeNav` is accepted but unused for now; do not invent a highlighting feature that doesn't exist in the source)
- The per-product slider CSS gap (originally lines 868-1827) → `${opts.perPageStyle ?? ''}`, injected right after the base CSS and before `</style>`
- The product-grid content area (where the real page's own `<section id="all-products-grid">...</section>` normally sits, roughly where line 1864 begins in the source) → `${opts.bodyContent}`, injected between the off-canvas menu block and the footer

Structure:
```typescript
// supabase/functions/publish-site/shell.ts
export interface ShellOptions {
  title: string;
  activeNav?: string;
  bodyContent: string;
  perPageStyle?: string;
}

export function renderShell(opts: ShellOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- meta/favicon/fonts extracted verbatim from all-products/index.html:1-11 -->
<title>${opts.title}</title>
<style>
/* base CSS extracted verbatim from all-products/index.html:12-867 */
${opts.perPageStyle ?? ''}
</style>
</head>
<body>
<!-- nav extracted verbatim from all-products/index.html:1832-1843 -->
<!-- off-canvas menu extracted verbatim from all-products/index.html:1845-1862 -->
${opts.bodyContent}
<!-- footer extracted verbatim from all-products/index.html:3051-3093 -->
<!-- back-to-top extracted verbatim from all-products/index.html:3095 -->
<!-- size-modal extracted verbatim from all-products/index.html:3099-3115 -->
<!-- cart-overlay/cart-sidebar extracted verbatim from all-products/index.html:3116-3132 -->
<script>
/* cart/size-picker logic extracted verbatim from all-products/index.html:3133-3451 */
</script>
<script>
/* nav-toggle/search-form-submit extracted verbatim from all-products/index.html:3454-3481 */
</script>
</body>
</html>`;
}
```
(The implementer replaces every `<!-- extracted verbatim from ... -->` comment above with the ACTUAL extracted content from those exact line ranges — these comments mark what goes where, they are not meant to ship as literal comments in the final file.)

- [ ] **Step 2b: Confirm the `?q=` search script's actual scope**

Run: `grep -l "nav-search-form" all-products/index.html collections/jackets/index.html gymshark/index.html` and `grep -c "highlightSearchResults\|filterProducts" all-products/index.html collections/jackets/index.html gymshark/index.html` (or whatever function name the lines 3484-3515 script actually defines — read those lines first to get the real name). Confirm whether this behavior is genuinely all-products-exclusive (expected) or also present on collection/brand pages (would mean it belongs in the shared shell instead). Report which is true.

- [ ] **Step 3: Verify with a smoke test**

```typescript
// Add to render.test.ts (or a new shell.test.ts if you prefer — your call)
import { renderShell } from "./shell.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("renderShell produces a complete document with the title and body content in the right places", () => {
  const html = renderShell({ title: "Test Page — BERSERKER", bodyContent: "<section>HELLO</section>" });
  assertStringIncludes(html, "<title>Test Page — BERSERKER</title>");
  assertStringIncludes(html, "<section>HELLO</section>");
  assertStringIncludes(html, "<nav>");
  assertStringIncludes(html, "</footer>");
  assertStringIncludes(html, "addToCart"); // confirms the cart script made it in
});
```

Run: `deno test supabase/functions/publish-site/render.test.ts` (or wherever you placed it). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/publish-site/shell.ts
git commit -m "Extract real page shell into a reusable renderShell() template"
git push origin feature/live-storefront-generation
```

## Task 3: `data.ts` — add `description` to the fetched catalog

**Files:**
- Modify: `supabase/functions/publish-site/data.ts`

**Interfaces:**
- Consumes: nothing new (Foundation's `fetchCatalog` already exists)
- Produces: `CatalogProduct.description` is now always populated from the DB (it's already declared as `description: string | null` in the interface from Foundation — only the `.select(...)` column list and the mapped return object were missing it)

- [ ] **Step 1: Confirm the gap**

Read `supabase/functions/publish-site/data.ts`'s `fetchCatalog` function. Confirm whether `description` is already in the `products` `.select(...)` column list and the final `.map(...)` — per Foundation's original code it should already be there (`select("id, brand, name, slug, price, cod_advance, position, category, sleeve_length, description")` and `description: p.description` in the map). If it's already present, this task is a no-op — report that clearly and skip to Step 3 without making any code change. If it's missing, add it to both the select and the map.

- [ ] **Step 2: If a change was needed, verify**

```bash
deno check supabase/functions/publish-site/data.ts
```
Expected: no type errors.

- [ ] **Step 3: Commit (only if a change was made in Step 1)**

```bash
git add supabase/functions/publish-site/data.ts
git commit -m "Ensure fetchCatalog selects product description"
git push origin feature/live-storefront-generation
```
If Step 1 found no gap, skip this step and report the task as complete with no commit.

## Task 4: `render.ts` — rewrite `renderProductCard` for real markup parity

**Files:**
- Modify: `supabase/functions/publish-site/render.ts`
- Modify: `supabase/functions/publish-site/render.test.ts`

**Interfaces:**
- Consumes: `CatalogProduct`, `CatalogColor` (from `data.ts`, unchanged shape)
- Produces: `renderProductCard(product: CatalogProduct): string` — same function name as before, entirely new implementation and output shape. Later tasks (5, 6) call this.

This is the highest-risk task in this plan — the output feeds existing, unmodified cart/size-picker JS that reads specific DOM shapes. Every discrepancy from the Global Constraints above is a real bug, not a style choice.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to supabase/functions/publish-site/render.test.ts (keep existing tests, add these)
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderProductCard } from "./render.ts";
import type { CatalogProduct } from "./data.ts";

const twoColorProduct: CatalogProduct = {
  id: "p1", brand: "Gymshark", name: "Onyx 5.0 Seamless Compression Half Sleeve",
  slug: "gymshark-onyx-5-half-sleeve", price: 4799, codAdvance: 500, position: 1,
  category: "compression", sleeveLength: "half", description: null,
  colors: [
    {
      id: "c1", label: "Forest Green", hex: "#1a4a1a", colorGroup: "Green",
      coverImageUrl: "https://example.supabase.co/.../green.jpg",
      images: [], variants: [{ size: "S", inStock: true }],
    },
    {
      id: "c2", label: "Stealth Black", hex: "#1a1a1a", colorGroup: "Black",
      coverImageUrl: "https://example.supabase.co/.../black.jpg",
      images: [], variants: [{ size: "S", inStock: true }],
    },
  ],
};

Deno.test("renderProductCard: image slider has one <img> per color, in color order", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'class="product-img-slider"');
  assertStringIncludes(html, 'class="slider-track"');
  const greenPos = html.indexOf("green.jpg");
  const blackPos = html.indexOf("black.jpg");
  if (greenPos === -1 || blackPos === -1 || greenPos > blackPos) {
    throw new Error("expected green.jpg image before black.jpg image in slider order");
  }
});

Deno.test("renderProductCard: swatch data-img-index matches that color's slider position, not a color-group string", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'data-img-index="0"'); // Forest Green is the first slider image
  assertStringIncludes(html, 'data-img-index="1"'); // Stealth Black is the second
  if (html.includes('data-color-group=')) {
    throw new Error("data-color-group should no longer be emitted — real site JS reads data-img-index");
  }
});

Deno.test("renderProductCard: price is a bare text node, strikethrough price in .original span", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, '<div class="product-price">₹4,799<span class="original">₹12,999</span></div>');
});

Deno.test("renderProductCard: no size buttons on the card", () => {
  const html = renderProductCard(twoColorProduct);
  if (html.includes('product-sizes') || html.includes('size-btn')) {
    throw new Error("cards must not render size buttons — sizing happens in the shared #size-modal");
  }
});

Deno.test("renderProductCard: links to the real PDP path", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'href="/gymshark/gymshark-onyx-5-half-sleeve/"');
});

Deno.test("renderProductCard: escapes admin-editable text (regression, carried over from Foundation)", () => {
  const hostile: CatalogProduct = {
    ...twoColorProduct,
    name: '<script>alert(1)</script>',
    colors: [{ ...twoColorProduct.colors[0], label: '"><b>x</b>' }],
  };
  const html = renderProductCard(hostile);
  if (html.includes('<script>alert(1)</script>') || html.includes('<b>x</b>')) {
    throw new Error("admin-editable text must be HTML-escaped");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/publish-site/render.test.ts`
Expected: FAIL — current `renderProductCard` output doesn't match any of the new assertions.

- [ ] **Step 3: Rewrite `renderProductCard`**

Keep the existing `esc()` and `strikethroughPrice()` helper functions from Foundation unchanged (they're correct and already tested). Replace `renderProductCard` with:

```typescript
export function renderProductCard(product: CatalogProduct): string {
  const wasPrice = strikethroughPrice(product.price);
  const sliderImages = product.colors.map((c) => c.coverImageUrl);
  const sliderImgs = sliderImages
    .map((url) => `<img src="${esc(url)}" alt="${esc(product.name)}" />`)
    .join("");
  const swatches = product.colors
    .map(
      (c, i) =>
        `<div class="swatch" style="background:${esc(c.hex ?? "#333")};" title="${esc(c.label)}" data-img-index="${i}"></div>`
    )
    .join("");
  const pdpPath = `/${brandFolderForCard(product)}/${product.slug}/`;

  return `
<div class="product-card fade-in" id="product-${product.position}">
  <a href="${esc(pdpPath)}" class="product-img product-img-slider">
    <div class="slider-track">${sliderImgs}</div>
  </a>
  <div class="product-info">
    <div class="product-brand">${esc(product.brand)}</div>
    <a href="${esc(pdpPath)}"><div class="product-name">${esc(product.name)}</div></a>
    <div class="product-price">${formatInr(product.price)}<span class="original">${formatInr(wasPrice)}</span></div>
    <div class="product-swatches">${swatches}</div>
  </div>
  <button class="product-add">Add to Cart</button>
</div>`.trim();
}
```

Note: `brandFolderForCard` here refers to `brandFolderFor` from `membership.ts` (Task 1) — import it: `import { brandFolderFor } from "./membership.ts";` and call `brandFolderFor(product)` directly (rename the call site above accordingly, the placeholder name was just to avoid a naming collision with any local variable — use the real imported function name). If `brandFolderFor` returns `null` for some product (shouldn't happen per Task 1 Step 5's live cross-check, but defend anyway), fall back to linking to `/all-products/` instead of a broken path — do not emit a link to `/null/...`.

`formatInr` is the existing helper from Foundation, unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/publish-site/render.test.ts`
Expected: all tests (old + new) PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "Rewrite renderProductCard for real markup/cart-JS compatibility"
git push origin feature/live-storefront-generation
```

## Task 5: `render.ts` — listing, collection, and brand page assembly

**Files:**
- Modify: `supabase/functions/publish-site/render.ts`
- Modify: `supabase/functions/publish-site/render.test.ts`

**Interfaces:**
- Consumes: `renderProductCard` (Task 4), `renderShell` (Task 2), `isInCollection`/`brandFolderFor`/`COLLECTION_SLUGS`/`BRAND_FOLDERS` (Task 1), `Catalog` (from `data.ts`)
- Produces: `renderSliderCss(products: CatalogProduct[]): string`, `renderListingPage(catalog: Catalog): string`, `renderCollectionPage(catalog: Catalog, slug: string): string`, `renderBrandPage(catalog: Catalog, folder: string): string`

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to render.test.ts
import { renderSliderCss, renderListingPage, renderCollectionPage, renderBrandPage } from "./render.ts";
import type { Catalog } from "./data.ts";

const sampleCatalog: Catalog = {
  products: [
    { ...twoColorProduct, id: "p1", position: 1, category: "compression", brand: "Gymshark" },
    { ...twoColorProduct, id: "p2", position: 2, category: "jacket", brand: "YoungLA × Batman", slug: "yl-batman-jacket", name: "Batman Jacket" },
    { ...twoColorProduct, id: "p3", position: 3, category: "pants", brand: "Gymshark", slug: "gs-joggers", name: "Joggers" },
  ],
};

Deno.test("renderSliderCss: emits one @keyframes + hover rule per product, keyed to that product's own position", () => {
  const css = renderSliderCss(sampleCatalog.products);
  assertStringIncludes(css, "#product-1:hover .slider-track");
  assertStringIncludes(css, "@keyframes slideProduct1");
  assertStringIncludes(css, "#product-3:hover .slider-track");
});

Deno.test("renderListingPage: includes every product regardless of category/brand", () => {
  const html = renderListingPage(sampleCatalog);
  assertStringIncludes(html, "Onyx 5.0 Seamless Compression Half Sleeve");
  assertStringIncludes(html, "Batman Jacket");
  assertStringIncludes(html, "Joggers");
});

Deno.test("renderCollectionPage: jackets only includes the jacket-category product", () => {
  const html = renderCollectionPage(sampleCatalog, "jackets");
  assertStringIncludes(html, "Batman Jacket");
  if (html.includes("Onyx 5.0") || html.includes("Joggers")) {
    throw new Error("jackets collection should not include compression/pants products");
  }
});

Deno.test("renderBrandPage: youngla includes the collab-brand product via prefix match", () => {
  const html = renderBrandPage(sampleCatalog, "youngla");
  assertStringIncludes(html, "Batman Jacket");
  if (html.includes("Onyx 5.0") || html.includes("Joggers")) {
    throw new Error("youngla brand page should only include YoungLA-prefixed products");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/publish-site/render.test.ts`
Expected: FAIL — these functions don't exist yet.

- [ ] **Step 3: Implement**

```typescript
export function renderSliderCss(products: CatalogProduct[]): string {
  return products
    .map((p) => {
      const imgCount = p.colors.length;
      if (imgCount <= 1) return "";
      const framePercent = (100 / imgCount).toFixed(4);
      const steps = p.colors
        .map((_, i) => `${(i * Number(framePercent)).toFixed(4)}% { transform: translateX(-${i * 100}%); }`)
        .join("\n    ");
      return `
  #product-${p.position}:hover .slider-track { animation: slideProduct${p.position} ${imgCount * 1.2}s steps(${imgCount}) infinite; }
  @keyframes slideProduct${p.position} {
    ${steps}
    100% { transform: translateX(-${(imgCount - 1) * 100}%); }
  }`;
    })
    .join("\n");
}

export function renderListingPage(catalog: Catalog): string {
  const sorted = catalog.products.slice().sort((a, b) => a.position - b.position);
  const cards = sorted.map(renderProductCard).join("\n");
  const bodyContent = `
<section class="section" id="all-products-grid">
  <h2 class="section-title">ALL<br><span>PRODUCTS</span></h2>
  <div class="product-grid">${cards}</div>
</section>`;
  return renderShell({
    title: "All Products — BERSERKER",
    bodyContent,
    perPageStyle: renderSliderCss(sorted),
  });
}

export function renderCollectionPage(catalog: Catalog, slug: string): string {
  const filtered = catalog.products
    .filter((p) => isInCollection(p, slug))
    .sort((a, b) => a.position - b.position);
  const cards = filtered.map(renderProductCard).join("\n");
  const heading = slug.replace(/-/g, " ").toUpperCase();
  const bodyContent = `
<section class="section" id="all-products-grid">
  <h2 class="section-title">${esc(heading)}</h2>
  <div class="product-grid">${cards}</div>
</section>`;
  return renderShell({
    title: `${heading} — BERSERKER`,
    bodyContent,
    perPageStyle: renderSliderCss(filtered),
  });
}

export function renderBrandPage(catalog: Catalog, folder: string): string {
  const filtered = catalog.products
    .filter((p) => brandFolderFor(p) === folder)
    .sort((a, b) => a.position - b.position);
  const cards = filtered.map(renderProductCard).join("\n");
  const brandName = BRAND_PREFIX_MAP[folder] ?? folder;
  const bodyContent = `
<section class="section" id="all-products-grid">
  <h2 class="section-title">${esc(brandName.toUpperCase())}</h2>
  <div class="product-grid">${cards}</div>
</section>`;
  return renderShell({
    title: `${brandName} — BERSERKER`,
    bodyContent,
    perPageStyle: renderSliderCss(filtered),
  });
}
```

Note on `renderSliderCss`: this is a reasonable, from-scratch reconstruction of a hover-cycling keyframe animation (equal-duration steps through each color's image) — it does not need to reproduce the exact easing/timing of the original hand-authored CSS byte-for-byte (that CSS was itself likely hand-tuned per product with inconsistent values), but it must produce valid CSS that actually cycles through all of a product's slider images on hover. If you want higher fidelity, read 2-3 real examples of the original per-product `@keyframes` blocks (e.g. `all-products/index.html:868-901` for product 1) and match their structure/timing approach rather than inventing your own — use your judgment and note which you did in your report.

Add imports at the top of `render.ts`: `import { renderShell } from "./shell.ts";` and `import { isInCollection, brandFolderFor, BRAND_PREFIX_MAP } from "./membership.ts";` and `import type { Catalog } from "./data.ts";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/publish-site/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "Add listing/collection/brand page assembly"
git push origin feature/live-storefront-generation
```

## Task 6: `render.ts` — PDP page assembly

**Files:**
- Modify: `supabase/functions/publish-site/render.ts`
- Modify: `supabase/functions/publish-site/render.test.ts`
- Read (source to extract PDP-specific markup shape from): `gymshark/gymshark-onyx-5-half-sleeve/index.html` (a real, representative PDP)

**Interfaces:**
- Consumes: `CatalogProduct`, `renderShell` (Task 2)
- Produces: `renderPdpPage(product: CatalogProduct): string`

- [ ] **Step 1: Read the real PDP's content-specific markup**

Read `gymshark/gymshark-onyx-5-half-sleeve/index.html` in full, focusing on: the `.pdp-grid` section (gallery column with main image + thumbnails + caption, info column with brand/title/price/cod-advance/swatches/size-grid/add-button/trust-badges/description), the PDP-specific `<style>` block that follows it, and the third `<script>` block containing the hardcoded `images[]`/`swatchList` arrays and the direct `addToCart(...)` call. Note the exact class names used (`.pdp-gallery`, `.pdp-main-image` or similar id, `.pdp-thumb`, `.pdp-info`, `.pdp-title`, `.pdp-price`, `.pdp-cod`, `.pdp-swatches`, `.modal-swatch` reused, `.pdp-size-grid`, `.size-btn` reused, `#pdp-add-btn`, `.pdp-trust`, `.pdp-description`).

- [ ] **Step 2: Write the failing test**

```typescript
// Add to render.test.ts
import { renderPdpPage } from "./render.ts";

Deno.test("renderPdpPage: includes product info, all color swatches, and a description", () => {
  const withDescription: CatalogProduct = { ...twoColorProduct, description: "A great compression shirt." };
  const html = renderPdpPage(withDescription);
  assertStringIncludes(html, "Onyx 5.0 Seamless Compression Half Sleeve");
  assertStringIncludes(html, "₹4,799");
  assertStringIncludes(html, "Forest Green");
  assertStringIncludes(html, "Stealth Black");
  assertStringIncludes(html, "A great compression shirt.");
  assertStringIncludes(html, "addToCart(");
});

Deno.test("renderPdpPage: handles a null description without crashing or emitting the literal word null", () => {
  const html = renderPdpPage(twoColorProduct); // description is null in the shared fixture
  if (html.includes(">null<") || html.includes("null.")) {
    throw new Error("null description should render as empty, not the literal string 'null'");
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test supabase/functions/publish-site/render.test.ts`
Expected: FAIL — `renderPdpPage` doesn't exist.

- [ ] **Step 4: Implement `renderPdpPage`**

Using the exact class/id names you found in Step 1, write a function with this shape (fill in the real markup structure you read — the skeleton below shows the required data wiring, not the final CSS classes verbatim, since those must come from your Step 1 reading):

```typescript
export function renderPdpPage(product: CatalogProduct): string {
  const images = product.colors.map((c) => c.coverImageUrl);
  const thumbs = images
    .map((url, i) => `<img class="pdp-thumb" data-index="${i}" src="${esc(url)}" />`)
    .join("");
  const swatches = product.colors
    .map(
      (c, i) =>
        `<div class="modal-swatch" style="background:${esc(c.hex ?? "#333")};" title="${esc(c.label)}" data-index="${i}"></div>`
    )
    .join("");
  const sizeButtons = (product.colors[0]?.variants ?? [])
    .map(
      (v) =>
        `<button class="size-btn" data-size="${v.size}" ${v.inStock ? "" : "disabled"}>${v.size}</button>`
    )
    .join("");
  const wasPrice = strikethroughPrice(product.price);

  const bodyContent = `
<section id="product-detail">
  <div class="pdp-grid">
    <div class="pdp-gallery">
      <img id="pdp-main-image" src="${esc(images[0] ?? "")}" />
      <div class="pdp-thumbs">${thumbs}</div>
    </div>
    <div class="pdp-info">
      <div class="product-brand">${esc(product.brand)}</div>
      <h1 class="pdp-title">${esc(product.name)}</h1>
      <div class="pdp-price">${formatInr(product.price)}<span class="original">${formatInr(wasPrice)}</span></div>
      <div class="pdp-cod">COD Advance Amount: ${formatInr(product.codAdvance)}</div>
      <div class="pdp-swatches">${swatches}</div>
      <div class="pdp-size-grid">${sizeButtons}</div>
      <button id="pdp-add-btn">Select Size &amp; Color</button>
      <div class="pdp-description">${esc(product.description ?? "")}</div>
    </div>
  </div>
</section>
<script>
  var images = ${JSON.stringify(images)};
  var swatchList = ${JSON.stringify(product.colors.map((c, i) => ({ label: c.label, hex: c.hex, imgIndex: i })))};
  var selectedSizeLocal = null;
  var selectedColor = null;
  document.querySelectorAll('.pdp-size-grid .size-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.pdp-size-grid .size-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      selectedSizeLocal = btn.dataset.size;
    });
  });
  document.querySelectorAll('.pdp-swatches .modal-swatch').forEach(function(sw) {
    sw.addEventListener('click', function() {
      selectedColor = sw.title;
      var idx = parseInt(sw.dataset.index, 10);
      document.getElementById('pdp-main-image').src = images[idx];
    });
  });
  document.getElementById('pdp-add-btn').addEventListener('click', function() {
    if (!selectedSizeLocal || !selectedColor) { alert('Please select a size and color.'); return; }
    var fullName = ${JSON.stringify(product.name)} + ' — ' + selectedColor + ' / ' + selectedSizeLocal;
    addToCart(${JSON.stringify(product.brand)}, fullName, ${product.price}, document.getElementById('pdp-main-image').src);
    openCart();
  });
</script>`;

  return renderShell({ title: `${product.name} — BERSERKER`, bodyContent });
}
```

Adjust the exact class/id names and the PDP-specific `<style>` block (which Task 1's reading found lives inline right after `.pdp-grid` in the real page — you'll need to fold that into `bodyContent` too, or into `perPageStyle` via `renderShell`, your call — whichever keeps the output closest to the real page's structure) to match what you actually read in Step 1. The skeleton above shows the required *data wiring* (real image URLs, real swatch/size data, the exact `addToCart(brand, name, price, imgSrc)` call signature preserved) — that part must not change; the surrounding markup/CSS should match the real PDP as closely as your Step 1 reading allows.

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/publish-site/render.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "Add PDP page rendering"
git push origin feature/live-storefront-generation
```

## Task 7: Backfill `products.description` from the 41 real PDPs

**Files:**
- SQL applied via `mcp__supabase__apply_migration`, committed to `supabase/migrations/<timestamp>_backfill_product_descriptions.sql`
- Read: all 41 `<brand-folder>/<slug>/index.html` PDP files' `.pdp-description` content

**Interfaces:**
- Produces: `products.description` populated for all 41 rows (currently `null` for all of them)

- [ ] **Step 1: Extract each PDP's description text**

For each of the 41 products (get the full list with `select brand, name, slug from products order by brand, name;` via `mcp__supabase__execute_sql`), find its PDP file (`<brand-folder>/<slug>/index.html` — brand-folder mapping is the same as `membership.ts`'s `BRAND_PREFIX_MAP` keys, e.g. `gymshark/`, `youngla/`, etc.) and read its `.pdp-description` block's text content.

- [ ] **Step 2: Write and apply the backfill**

Build one `UPDATE` statement per product (or a single batched statement using a `CASE`/`VALUES` join keyed by `slug`, whichever is more convenient given the actual extracted text) setting `description` to the real extracted text, escaping single quotes for SQL. Apply via `mcp__supabase__apply_migration` with name `backfill_product_descriptions`.

- [ ] **Step 3: Verify**

```sql
select count(*) as total, count(*) filter (where description is not null and description != '') as with_description from products;
```
Expected: `total = 41`, `with_description = 41`. If any product's PDP genuinely has no description text in the real page (unlikely but possible), that row staying null is correct — don't invent text — but confirm by re-reading that specific PDP file before accepting a null.

- [ ] **Step 4: Update `supabase/schema.sql` and migration file, commit**

`supabase/schema.sql`'s `products` table already documents the `description` column from Foundation — no schema.sql change needed here since this is a data backfill, not a schema change. Just commit the migration file:
```bash
git add supabase/migrations/
git commit -m "Backfill product descriptions from existing PDP content"
git push origin feature/live-storefront-generation
```

## Task 8: Structural verification — generate all 55 pages locally, diff against real pages

**Files:**
- Create: `scripts/verify-storefront-generation.ts` (a local, one-off Deno script — not deployed, just a verification harness)

**Interfaces:**
- Consumes: `renderListingPage`, `renderCollectionPage`, `renderBrandPage`, `renderPdpPage` (Tasks 5, 6), `fetchCatalog` (Task 3), `COLLECTION_SLUGS`, `BRAND_FOLDERS` (Task 1)
- Produces: no code interface — this task's output is a verification report in its task report file, and it does NOT modify any real site page or commit anything to GitHub.

- [ ] **Step 1: Write the script**

```typescript
// scripts/verify-storefront-generation.ts
// Run with: deno run --allow-net --allow-env scripts/verify-storefront-generation.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchCatalog } from "../supabase/functions/publish-site/data.ts";
import { renderListingPage, renderCollectionPage, renderBrandPage, renderPdpPage } from "../supabase/functions/publish-site/render.ts";
import { COLLECTION_SLUGS, BRAND_FOLDERS, brandFolderFor } from "../supabase/functions/publish-site/membership.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const catalog = await fetchCatalog(supabase);
console.log(`Fetched ${catalog.products.length} products.`);

const outDir = "./scratch-generated-pages";
await Deno.mkdir(outDir, { recursive: true });

await Deno.writeTextFile(`${outDir}/all-products.html`, renderListingPage(catalog));
for (const slug of COLLECTION_SLUGS) {
  await Deno.writeTextFile(`${outDir}/collection-${slug}.html`, renderCollectionPage(catalog, slug));
}
for (const folder of BRAND_FOLDERS) {
  await Deno.writeTextFile(`${outDir}/brand-${folder}.html`, renderBrandPage(catalog, folder));
}
for (const product of catalog.products) {
  const folder = brandFolderFor(product) ?? "unknown";
  await Deno.writeTextFile(`${outDir}/pdp-${folder}-${product.slug}.html`, renderPdpPage(product));
}

console.log(`Wrote ${1 + COLLECTION_SLUGS.length + BRAND_FOLDERS.length + catalog.products.length} files to ${outDir}/`);
```

Run this locally with your own Supabase service-role key set as an env var (do not commit the key anywhere — same handling discipline as Foundation's image migration script). This writes 55 files to a local scratch directory, touching nothing live.

- [ ] **Step 2: Spot-check product-set correctness**

For at least these three cases, confirm the generated output matches expectations:
1. `scratch-generated-pages/collection-t-shirts.html` should contain every product whose category is `t-shirt` OR `compression` (count them, compare against `select count(*) from products where category in ('t-shirt','compression');`).
2. `scratch-generated-pages/collection-compressions.html` should contain only `category = 'compression'` products, and every one of those should also appear in `collection-t-shirts.html` (the documented superset relationship).
3. `scratch-generated-pages/brand-youngla.html` should include every product whose brand starts with "YoungLA", including any `"YoungLA × ..."` collab entries — cross-check against `select name, brand from products where brand like 'YoungLA%';`.

- [ ] **Step 3: Spot-check cart-JS compatibility on a sample card**

Open `scratch-generated-pages/all-products.html` and manually inspect one product's card HTML: confirm `.product-price`'s first child is the bare price text (not wrapped in a span), confirm each swatch has `data-img-index` with a value that's a valid index into that card's slider images, confirm the slider has one `<img>` per color.

- [ ] **Step 4: Spot-check shell fidelity**

Diff `scratch-generated-pages/collection-jackets.html`'s nav/footer/cart-sidebar/size-modal markup against the real `collections/jackets/index.html`'s corresponding sections (visually or via a text diff of those specific regions) — confirm they match. Minor, expected differences: the per-page slider CSS content (recomputed, not byte-identical to the original) and the product grid content itself (from the DB now, not hand-authored) — everything else should match closely.

- [ ] **Step 5: Report**

Write your findings for all of Steps 2-4 into your task report, including any discrepancies found and whether they were fixed (if you found and fixed a bug in Tasks 1/4/5/6/7's code as a result of this verification, note which commit contains the fix — do not silently patch without documenting it here). Do NOT commit `scratch-generated-pages/` — add it to a local `.gitignore` entry if needed, or just don't `git add` it.

- [ ] **Step 6: Commit** (the verification script only, not its output)

```bash
git add scripts/verify-storefront-generation.ts
echo "scratch-generated-pages/" >> .gitignore
git add .gitignore
git commit -m "Add local verification script for generated storefront pages"
git push origin feature/live-storefront-generation
```

## Task 9: Cutover — point `index.ts` at the real 55 file paths, with a dry-run safety mode

**Files:**
- Modify: `supabase/functions/publish-site/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6
- Produces: `index.ts`'s request handler now accepts an optional `dryRun` flag; when true, generates all 55 files' content and returns them in the response (or a summary — see Step 2) WITHOUT calling `commitFiles`. When false/absent (the default, matching current behavior), it commits for real exactly as before, just with the full 55-file set instead of the one placeholder.

This is the highest-blast-radius task in this plan — a non-dry-run invocation will overwrite 55 real live pages in one commit. This task deploys the capability but does NOT trigger a real invocation itself; that's a deliberate, separate step for the controller to take consciously with the user afterward.

- [ ] **Step 1: Read the current `index.ts`**

Confirm its current structure (the admin-auth check, then the `try` block calling `fetchCatalog`/`renderAllProductsPage`/`commitFiles` against the single placeholder path) — this should be unchanged from Phase 1/2's final state (including the CORS headers and admin-auth hardening from Phase 2's final review — do not remove or weaken either of those).

- [ ] **Step 2: Modify the publish logic**

Replace the single-file `renderAllProductsPage`/`commitFiles` call with generation of all 55 files, and add dry-run support:

```typescript
// Inside the existing try block, after the admin-auth check passes:
const catalog = await fetchCatalog(supabase);

const files: Record<string, string> = {
  "all-products/index.html": renderListingPage(catalog),
};
for (const slug of COLLECTION_SLUGS) {
  files[`collections/${slug}/index.html`] = renderCollectionPage(catalog, slug);
}
for (const folder of BRAND_FOLDERS) {
  files[`${folder}/index.html`] = renderBrandPage(catalog, folder);
}
for (const product of catalog.products) {
  const folder = brandFolderFor(product);
  if (!folder) continue; // defensive — Task 1 Step 5 confirmed this shouldn't happen for real data
  files[`${folder}/${product.slug}/index.html`] = renderPdpPage(product);
}

let dryRun = false;
try {
  const body = await req.json();
  dryRun = body?.dryRun === true;
} catch {
  // no JSON body sent — dryRun stays false, matches current behavior of a bodyless POST
}

if (dryRun) {
  return json({ ok: true, dryRun: true, fileCount: Object.keys(files).length, filePaths: Object.keys(files) });
}

const githubToken = Deno.env.get("GITHUB_TOKEN")!;
const { commitSha } = await commitFiles(
  files,
  `Publish: regenerate storefront from ${catalog.products.length} products (${Object.keys(files).length} files)`,
  githubToken
);

return json({ ok: true, commitSha, productCount: catalog.products.length, fileCount: Object.keys(files).length });
```

Also delete the old `all-products/index.generated.html` placeholder from the repo as part of this task (it's no longer needed):
```bash
git rm all-products/index.generated.html
```

Add the necessary imports at the top: `renderListingPage`, `renderCollectionPage`, `renderBrandPage`, `renderPdpPage` from `./render.ts`; `COLLECTION_SLUGS`, `BRAND_FOLDERS`, `brandFolderFor` from `./membership.ts`.

- [ ] **Step 3: Type-check and deploy**

```bash
deno check supabase/functions/publish-site/index.ts
```
Expected: no errors. Deploy via `mcp__supabase__deploy_edge_function` with `name: "publish-site"`, same entrypoint, including the current content of every file in `supabase/functions/publish-site/` (`index.ts`, `data.ts`, `render.ts`, `github.ts`, `shell.ts`, `membership.ts`) read fresh from disk.

- [ ] **Step 4: Verify via dry-run ONLY — do not perform a real invocation**

Get a real admin session's access token is NOT available in this environment (same limitation noted throughout this project) — but the dry-run path doesn't need one differently than before; it still requires the same admin-JWT auth check to pass, which still can't be faked here without a real browser session. So this step's verification is necessarily limited to:
1. Confirm the function deployed successfully and is ACTIVE (`mcp__supabase__get_edge_function` with slug `publish-site`).
2. Confirm the unauthenticated-rejection path still works exactly as before (curl with the anon key, expect the same 401 `"Unauthorized: not a signed-in user"` with CORS headers present — this proves the auth/CORS hardening from Phase 2 wasn't accidentally broken by this change).
3. Do NOT attempt to invoke the dry-run path for real (that would still require a real admin session, which isn't available here) — report clearly that the dry-run capability is deployed and type-checked, but its actual live behavior (via a real admin session) is the controller's responsibility to verify next, alongside the eventual real (non-dry-run) cutover invocation.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/index.ts all-products/index.generated.html
git commit -m "Cut over publish-site to generate all 55 real storefront pages"
git push origin feature/live-storefront-generation
```

---

## Plan Self-Review Notes

- **Spec coverage**: shell unification (Task 2), card template rewrite (Task 4), membership rules (Task 1), PDP templating (Task 6), description backfill (Task 7), and the deliberate build-verify-then-cutover sequencing (Tasks 8 then 9) all map directly to the spec's decisions and architecture sections.
- **Verification discipline**: Task 9 explicitly stops short of a real (non-dry-run) invocation, consistent with the spec's Rollout & Safety section — the actual first real Publish, and sharing a generated-output sample with the user, is left to the controller running this plan, not automated within it.
- **Known limitation carried forward**: like Phase 2's Tasks 5 and 8, no task in this plan can fully exercise a real authenticated admin session (no live browser automation in this environment) — Task 9's Step 4 is explicit about the resulting verification boundary rather than overclaiming.
- **Task 2 and Task 6 are extraction-heavy**: rather than inlining ~1300 lines of real HTML/CSS/JS into this plan document, they give exact source file line ranges and precise extraction/substitution instructions. The implementer must copy real content verbatim from the cited locations, not paraphrase or invent equivalent-looking markup — any drift risks breaking the unchanged cart/size-picker JS these pages depend on.
