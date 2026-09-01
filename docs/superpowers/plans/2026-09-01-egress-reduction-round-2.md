# Egress Reduction Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Supabase Storage egress further after the two-tier WebP thumbnail work (2026-09-01 earlier session), by fixing a real caching bug, killing wasted image downloads on listing pages, and adding a smaller AVIF derivative with safe fallback.

**Architecture:** Three independent tracks against the existing `berserker-site` repo (Supabase Edge Function `publish-site` renders the storefront; `gunjaisanuska/dashboard` is the admin panel that uploads images to the `product-images` Storage bucket):
- **Track A** fixes Storage objects being served `Cache-Control: no-cache` (a known-but-never-fixed bug from earlier this session) for all future uploads, and backfills the ~782 objects already in the bucket via a one-off Edge Function (avoids needing a local service-role key).
- **Track B** stops the product-card hover-slider from downloading every uploaded photo (up to 40+ for some SKUs) the moment a card scrolls into view. `loading="lazy"` currently does nothing useful here because the images are inside an in-viewport card — this switches images after the first to `data-src`, populated by a `mouseenter`/`touchstart` listener, matching the card's own hover-reveal mechanism already used for the Add to Cart button.
- **Track C** adds an AVIF derivative for the thumbnail size only (where the volume is), served via `<picture>` with WebP fallback, with a runtime feature-detection check so it degrades safely on browsers where canvas can't encode AVIF (notably older Firefox).

**Tech Stack:** Deno (Supabase Edge Functions, `deno test`), plain browser JS (admin panel, no build step, no test harness — matches existing `products.js`/`brands.js`/`shell.ts` convention), Supabase Storage + supabase-js v2.

**Spec:** This document — derived from conversation with the user; no separate spec file. Explicitly OUT OF SCOPE per user: no database/storage-provider migration, no mobile-specific smaller thumbnail/`srcset` variant, no Cloudflare dashboard changes (Cache Rules require dashboard access this session doesn't have — noted as a follow-up, not built).

## Global Constraints

- Never touch `.worktrees/` — historical one-off migration scripts (`scripts/migrate-images-to-storage.ts`, `scripts/migrate-brand-thumbnails.ts`) are NOT edited; they already ran and won't run again.
- All Storage bucket writes stay in the existing `product-images` bucket on the existing Supabase project — no new bucket, no new provider.
- Every code change that touches `render.ts`/`data.ts` must keep `deno test` green in `supabase/functions/publish-site/`.
- Mirror every edit to both `C:\Users\anind\berserker-site` (git repo, source of truth) and `C:\Users\anind\Downloads\berserker` (mirror) per established workflow — diff before overwriting.
- Follow existing code style: no comments explaining WHAT, only non-obvious WHY (this repo's existing comment density is a good reference).

---

## Track A: Fix Cache-Control on Storage uploads

### Task A1: Add `cacheControl` to every live upload call

**Files:**
- Modify: `gunjaisanuska/dashboard/products.js:464-465` (main image upload), `products.js:478` (thumb upload)
- Modify: `gunjaisanuska/dashboard/brands.js:94`, `brands.js:273` (brand thumbnail uploads)

**Interfaces:**
- Consumes: nothing new — same `sb.storage.from('product-images').upload(path, blob, opts)` call already in place.
- Produces: uploaded objects now carry `Cache-Control: max-age=31536000` instead of the current no-cache default, for every future upload.

- [ ] **Step 1: Edit products.js main-image upload**

In `products.js`, change:
```js
var { error: uploadError } = mainBlob
  ? await sb.storage.from('product-images').upload(storagePath, mainBlob, { contentType: 'image/webp' })
  : await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
```
to:
```js
var { error: uploadError } = mainBlob
  ? await sb.storage.from('product-images').upload(storagePath, mainBlob, { contentType: 'image/webp', cacheControl: '31536000' })
  : await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type, cacheControl: '31536000' });
```

- [ ] **Step 2: Edit products.js thumb upload**

Change:
```js
var { error: thumbError } = await sb.storage.from('product-images').upload(thumbPath, thumbBlob, { contentType: 'image/webp' });
```
to:
```js
var { error: thumbError } = await sb.storage.from('product-images').upload(thumbPath, thumbBlob, { contentType: 'image/webp', cacheControl: '31536000' });
```

- [ ] **Step 3: Edit brands.js's two upload calls**

Both `brands.js:94` and `brands.js:273` currently read:
```js
var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
```
Change both to:
```js
var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type, cacheControl: '31536000' });
```

- [ ] **Step 4: Manual verification**

In the admin panel (`/gunjaisanuska/`), upload a test image to any product, then check its response headers:
```bash
curl -sI "https://<project-ref>.supabase.co/storage/v1/object/public/product-images/<path-just-uploaded>"
```
Expected: `cache-control: max-age=31536000` in the response (not `no-cache`). Delete the test image afterward.

- [ ] **Step 5: Commit**

```bash
git add gunjaisanuska/dashboard/products.js gunjaisanuska/dashboard/brands.js
git commit -m "Set long-lived Cache-Control on all Storage uploads (was defaulting to no-cache)"
```

### Task A2: Backfill Cache-Control on existing objects via a one-off Edge Function

Storage doesn't support updating an object's Cache-Control without re-uploading its bytes, so the ~782 existing objects (395 main + 387 thumbs, per the 2026-09-01 storage inventory) need a real re-upload. No local `SUPABASE_SERVICE_ROLE_KEY` is available in this environment (`.env.local` doesn't exist), but Edge Functions get `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` auto-injected at runtime (confirmed via existing functions' `Deno.env.get` calls) — so this runs as a temporary deployed function instead of a local script.

**Files:**
- Create: `supabase/functions/backfill-cache-control/index.ts`

**Interfaces:**
- Consumes: Supabase Storage `list`/`download`/`upload` API via the auto-injected service-role client.
- Produces: an HTTP endpoint that, when invoked, re-uploads every object in `product-images` in place with `cacheControl: '31536000', upsert: true`, and returns `{ processed, failed: string[] }` as JSON.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/backfill-cache-control/index.ts
//
// One-off: re-uploads every object already in the product-images bucket
// with a long-lived Cache-Control header, since Storage only applies
// cacheControl at upload time -- objects uploaded before the products.js/
// brands.js fix are stuck serving the old no-cache default until their
// bytes are re-written. Deploy, invoke once, then delete this function.
//
// Invoke with:
//   curl -X POST https://<project-ref>.supabase.co/functions/v1/backfill-cache-control \
//     -H "Authorization: Bearer <anon-or-service-key>"

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "product-images";
const CACHE_CONTROL = "31536000";

// Storage's list() is not recursive -- walks top-level product/brand
// folders first, then each folder's own files plus its thumbs/ subfolder,
// mirroring the two path shapes this bucket actually contains:
// "<slug>/<file>", "<slug>/thumbs/<file>", "_brands/<file>".
async function listAllPaths(): Promise<string[]> {
  const paths: string[] = [];
  const { data: topEntries, error: topError } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (topError) throw new Error(`list root failed: ${topError.message}`);

  for (const entry of topEntries ?? []) {
    if (entry.id === null) {
      // Folder (no id) -- list its direct files, then its thumbs/ subfolder.
      const { data: files, error: filesError } = await supabase.storage.from(BUCKET).list(entry.name, { limit: 1000 });
      if (filesError) throw new Error(`list ${entry.name} failed: ${filesError.message}`);
      for (const f of files ?? []) {
        if (f.id !== null) paths.push(`${entry.name}/${f.name}`);
      }
      const { data: thumbFiles } = await supabase.storage.from(BUCKET).list(`${entry.name}/thumbs`, { limit: 1000 });
      for (const f of thumbFiles ?? []) {
        if (f.id !== null) paths.push(`${entry.name}/thumbs/${f.name}`);
      }
    } else {
      paths.push(entry.name);
    }
  }
  return paths;
}

async function reuploadOne(path: string): Promise<void> {
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError) throw new Error(`download ${path}: ${downloadError.message}`);
  const contentType = blob.type || "application/octet-stream";
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType, cacheControl: CACHE_CONTROL, upsert: true });
  if (uploadError) throw new Error(`upload ${path}: ${uploadError.message}`);
}

Deno.serve(async () => {
  const paths = await listAllPaths();
  let processed = 0;
  const failed: string[] = [];
  for (const path of paths) {
    try {
      await reuploadOne(path);
      processed++;
    } catch (err) {
      failed.push(`${path}: ${(err as Error).message}`);
    }
  }
  return new Response(JSON.stringify({ total: paths.length, processed, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Deploy the function**

Use the `mcp__supabase__deploy_edge_function` tool with the file above (slug `backfill-cache-control`).

- [ ] **Step 3: Invoke it once**

Get the project URL (`mcp__supabase__get_project_url`) and a publishable/anon key (`mcp__supabase__get_publishable_keys`), then:
```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/backfill-cache-control" \
  -H "Authorization: Bearer <anon-key>" --max-time 300
```
Expected: JSON with `processed` close to `total` (782ish) and an empty or near-empty `failed` array. If the function times out (782 sequential download+upload round-trips may exceed a single invocation's limit), re-invoke it — `upsert: true` makes it safe to re-run against already-fixed objects.

- [ ] **Step 4: Verify a sample object**

```bash
curl -sI "https://<project-ref>.supabase.co/storage/v1/object/public/product-images/<any-real-path-from-the-response>"
```
Expected: `cache-control: max-age=31536000`.

- [ ] **Step 5: Delete the one-off function**

Once `failed` is empty (or only contains objects worth investigating separately), remove the function from the Supabase dashboard (Edge Functions -> backfill-cache-control -> Delete) — it has no ongoing purpose once the backfill is done. Do not delete the source file from the repo; leave `supabase/functions/backfill-cache-control/index.ts` as a record, but note the deletion in the commit message.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/backfill-cache-control/index.ts
git commit -m "Add one-off backfill function to set Cache-Control on existing Storage objects (run once, then deleted from Supabase)"
```

---

## Track B: Defer product-card slider images until hover

Currently every image in `product.images` renders eagerly (`<img src=...>`) except the first, which only gets `loading="lazy"` — a no-op here since the whole card (all its images) is inside one small, already-in/near-viewport element. This is the direct cause of the Chrome Hearts 40-42-image-per-SKU outlier costing so much on listing pages. Fix: images after the first get no `src` at all until the card is hovered/tapped (same trigger the CSS already uses to reveal the Add to Cart button, so there's no new interaction surface).

### Task B1: Render deferred images as `data-src`, not `src`

**Files:**
- Modify: `supabase/functions/publish-site/render.ts:83-88` (`renderProductCard`'s `sliderImgs`)
- Test: `supabase/functions/publish-site/render.test.ts`

**Interfaces:**
- Consumes: `CatalogImage.thumbUrl` (existing field, `data.ts:10`).
- Produces: slider markup where image 0 has `src`, images 1..N have `data-src` (no `src` attribute) — this is what Task B2's client JS reads.

- [ ] **Step 1: Write the failing test**

Add to `render.test.ts`, near the existing thumbUrl test (~line 116):

```ts
Deno.test("renderProductCard: only the first slider image has a real src -- the rest carry data-src so they aren't fetched until hover (Chrome Hearts SKUs upload 40+ photos; loading=lazy alone doesn't help since the whole card is already in-viewport)", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    images: [
      { url: "https://example.com/full-0.jpg", thumbUrl: "https://example.com/thumbs/0.jpg", sortOrder: 0 },
      { url: "https://example.com/full-1.jpg", thumbUrl: "https://example.com/thumbs/1.jpg", sortOrder: 1 },
      { url: "https://example.com/full-2.jpg", thumbUrl: "https://example.com/thumbs/2.jpg", sortOrder: 2 },
    ],
  };
  const html = renderProductCard(product);
  assertStringIncludes(html, 'src="https://example.com/thumbs/0.jpg"');
  if (html.includes('src="https://example.com/thumbs/1.jpg"') || html.includes('src="https://example.com/thumbs/2.jpg"')) {
    throw new Error("images after the first should not have a real src attribute -- they should be data-src only");
  }
  assertStringIncludes(html, 'data-src="https://example.com/thumbs/1.jpg"');
  assertStringIncludes(html, 'data-src="https://example.com/thumbs/2.jpg"');
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd supabase/functions/publish-site && deno test --allow-none render.test.ts --filter "only the first slider image"
```
Expected: FAIL (images 1/2 currently have `src`, not `data-src`).

- [ ] **Step 3: Implement**

In `render.ts`, change the `sliderImgs` mapping (currently lines 83-88):
```ts
const sliderImgs = product.images
  .map(
    (img, i) =>
      `<img src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;"${i === 0 ? "" : ' loading="lazy"'} decoding="async" />`
  )
  .join("");
```
to:
```ts
// Image 0 loads eagerly (it's the always-visible card thumbnail). Every
// later image is a hover-slider frame the shopper only sees by hovering
// (see shell.ts's mouseenter/touchstart listener on .product-img-slider) --
// giving it a real `src` here would defeat the point: native loading="lazy"
// doesn't help because the whole card, and every image inside it, is
// already in/near the viewport as soon as the card scrolls into view, so
// the browser fetches all of them regardless (this is what let Chrome
// Hearts' 40-42-image SKUs blow up listing-page egress). data-src only
// becomes src on that hover/tap trigger.
const sliderImgs = product.images
  .map(
    (img, i) =>
      i === 0
        ? `<img src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" decoding="async" />`
        : `<img data-src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" loading="lazy" decoding="async" />`
  )
  .join("");
```
(`loading="lazy"` is kept on the deferred images as a harmless no-op fallback in case JS is disabled and some future code path ever does assign `src` directly.)

- [ ] **Step 4: Run the test again**

```bash
cd supabase/functions/publish-site && deno test --allow-none render.test.ts
```
Expected: the new test passes, and the full `render.test.ts` suite (all pre-existing tests) still passes — in particular the thumbUrl test at line 102 (it only asserts the thumb URL string appears somewhere in the HTML, not specifically inside `src=`, so it stays green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "Defer product-card slider images beyond the first until hover/tap instead of eager-loading all of them"
```

### Task B2: Populate `data-src` on hover/tap

**Files:**
- Modify: `supabase/functions/publish-site/shell.ts` (add near the existing `.product-add` wiring, ~line 1524, inside the same top-level `<script>` block at line 1196)
- Test: `supabase/functions/publish-site/shell.test.ts` (check existing test style first — see Step 1)

**Interfaces:**
- Consumes: `data-src` attribute from Task B1's markup, `.product-img-slider` class (already emitted by `renderProductCard`, line 112 in current numbering).
- Produces: on first `mouseenter` or `touchstart` of a `.product-img-slider`, every descendant `img[data-src]` gets `img.src = img.dataset.src` and loses the `data-src` attribute. Runs before the `.product-add` click handler can fire (that button only becomes visible via `.product-card:hover`, i.e. after this same hover has already started), so `card.querySelectorAll('.product-img img')` (used at `shell.ts:1505` to build `allCardImgs` for the size-picker modal) sees real `.src` values by click time.

- [ ] **Step 1: Write the failing test**

`shell.test.ts` asserts via string-matching against `renderShell({ title, bodyContent })`'s output (confirmed by reading the file — e.g. the existing `"renderShell produces a complete document..."` test at line 4). Add:
```ts
Deno.test("renderShell: product-img-slider populates data-src images on hover/tap, not on page load", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  assertStringIncludes(html, "querySelectorAll('.product-img-slider')");
  assertStringIncludes(html, "addEventListener('mouseenter', populate)");
  assertStringIncludes(html, "addEventListener('touchstart', populate");
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd supabase/functions/publish-site && deno test --allow-none shell.test.ts --filter "product-img-slider"
```

- [ ] **Step 3: Implement**

In `shell.ts`, inside the existing top-level `<script>` block (after the `.product-add` `forEach` wiring that ends around line 1524, before the `// Init` / `updateCart()` call), add:

```ts
  // Slider images beyond the first are data-src only (see render.ts's
  // renderProductCard) -- populate real src on the same hover/tap trigger
  // the CSS already uses to reveal the Add to Cart button (.product-card:hover
  // .product-add), so by the time that button is clickable, allCardImgs
  // above already reads real .src values instead of empty/undefined ones.
  document.querySelectorAll('.product-img-slider').forEach(slider => {
    let populated = false;
    const populate = () => {
      if (populated) return;
      populated = true;
      slider.querySelectorAll('img[data-src]').forEach(img => {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
      });
    };
    slider.addEventListener('mouseenter', populate);
    slider.addEventListener('touchstart', populate, { passive: true });
  });
```

- [ ] **Step 4: Run the test again**

```bash
cd supabase/functions/publish-site && deno test --allow-none shell.test.ts render.test.ts
```
Expected: all pass.

- [ ] **Step 5: Manual browser verification (required — this is DOM/event behavior a string-matching test can't fully cover per the project's own "verify live rendering, not just source" lesson)**

Run the storefront locally or against a deploy preview, open a listing page with a multi-image product (Chrome Hearts SKUs are the extreme case), open DevTools Network tab filtered to `product-images`:
- On page load: confirm only ONE thumb request per product card fires.
- Hover one card: confirm the rest of that card's thumb requests fire only now.
- Click "Add to Cart" on a hovered card, open the size picker, switch color swatches: confirm the correct image still shows per swatch (this is the `allCardImgs`/`imgIndex` path Task B2 must not break).
- On a touch device or Chrome DevTools device-emulation with touch, tap a card: confirm the same behavior fires via `touchstart`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/publish-site/shell.ts supabase/functions/publish-site/shell.test.ts
git commit -m "Populate deferred slider images on hover/tap instead of on page load"
```

### Task B3: Regenerate and publish the storefront

**Files:**
- Whatever the existing publish flow regenerates (same mechanism as the "Publish: regenerate storefront from 42 products" commits already in `git log`).

- [ ] **Step 1:** Deploy the updated `publish-site` Edge Function (`mcp__supabase__deploy_edge_function` for `supabase/functions/publish-site/`).
- [ ] **Step 2:** Trigger a publish the same way prior "Publish: regenerate storefront" commits were produced (via the admin panel's existing Publish button/flow — do not hand-edit the generated `index.html`/per-page files).
- [ ] **Step 3:** Confirm the regenerated pages contain `data-src` on non-first slider images (`grep -c data-src index.html` or similar spot check).
- [ ] **Step 4: Commit** (this will be a "Publish: regenerate storefront..." commit produced by the existing flow, not hand-written).

---

## Track C: AVIF thumbnail derivative with safe fallback

AVIF runs ~20-30% smaller than WebP at comparable quality, and the thumb size is where the volume is (387 thumb objects vs 395 mains, and thumbs are what listing pages request repeatedly). Canvas-based AVIF encoding isn't universally supported (notably inconsistent on non-Chromium browsers) — the admin upload flow already tolerates a failed derivative (see `products.js`'s existing "logged but never blocks" comment for the WebP thumb), so this extends that same tolerance: attempt AVIF, verify the browser actually produced one (check `blob.type`), skip it silently if not. WebP stays the guaranteed derivative; AVIF is a bonus when available.

### Task C1: Generate an AVIF thumb derivative alongside the existing WebP one

**Files:**
- Modify: `gunjaisanuska/dashboard/products.js` (new `thumbAvifStoragePath` helper near `thumbStoragePath`, ~line 392; new upload step in the upload handler, ~line 476-482)

**Interfaces:**
- Consumes: existing `resizeToWebp` pattern (`products.js:413`) as a template — new capability is "does this browser's canvas actually support AVIF encoding", not a new resize algorithm.
- Produces: a `_brands/`-parallel path convention: `<dir>/thumbs-avif/<file>` alongside the existing `<dir>/thumbs/<file>`, uploaded with `contentType: 'image/avif'` and `cacheControl: '31536000'` (per Track A) only when the browser actually encoded one.

- [ ] **Step 1: Add the path helper**

Next to `thumbStoragePath` (~`products.js:392`):
```js
// Mirrors thumbStoragePath but into a thumbs-avif/ sibling dir -- kept
// separate from thumbs/ (not overwriting it) since AVIF generation can
// silently fail per-browser (see resizeToAvifIfSupported), so a product
// must never end up with only an AVIF derivative and no WebP fallback.
function thumbAvifStoragePath(storagePath) {
  var slashIdx = storagePath.lastIndexOf('/');
  return storagePath.slice(0, slashIdx) + '/thumbs-avif/' + storagePath.slice(slashIdx + 1);
}
```

- [ ] **Step 2: Add a feature-detecting AVIF resize function**

Next to `resizeToWebp` (~`products.js:440`):
```js
// Same resize logic as resizeToWebp, but for AVIF, with an explicit
// support check: canvas.toBlob silently falls back to PNG on a browser
// that can't encode the requested type (spec-defined behavior), so this
// checks the returned blob's actual MIME type and resolves null if it
// isn't really AVIF -- the caller must treat null as "skip this
// derivative", never as "upload whatever came back".
function resizeToAvifIfSupported(file, maxDim, quality) {
  return new Promise(function (resolve) {
    var img = new Image();
    var objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) {
        resolve(blob && blob.type === 'image/avif' ? blob : null);
      }, 'image/avif', quality);
    };
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}
```

- [ ] **Step 3: Upload the AVIF derivative in the upload handler**

After the existing thumb-upload block (`products.js:475-482`), add:
```js
      var thumbAvifPath = thumbAvifStoragePath(storagePath);
      var thumbAvifBlob = await resizeToAvifIfSupported(file, 380, 0.6);
      if (thumbAvifBlob) {
        var { error: avifError } = await sb.storage.from('product-images').upload(thumbAvifPath, thumbAvifBlob, { contentType: 'image/avif', cacheControl: '31536000' });
        if (avifError) console.warn('AVIF thumbnail upload failed for ' + file.name + ':', avifError.message);
      }
```
(0.6 quality for AVIF vs 0.8 for WebP: AVIF's encoder is more efficient per quality step, so a lower numeric quality setting produces comparable visual output — standard guidance for this format.)

- [ ] **Step 4: Update deletion to also remove the AVIF derivative**

`products.js`'s delete-image handler currently does:
```js
var { error: removeError } = await sb.storage.from('product-images').remove([btn.dataset.storagePath, thumbStoragePath(btn.dataset.storagePath)]);
```
Change to:
```js
var { error: removeError } = await sb.storage.from('product-images').remove([btn.dataset.storagePath, thumbStoragePath(btn.dataset.storagePath), thumbAvifStoragePath(btn.dataset.storagePath)]);
```
(Supabase's `remove()` doesn't error on a path that doesn't exist, so this is safe for older images that never got an AVIF derivative.)

- [ ] **Step 5: Manual verification**

In the admin panel, upload a new image in Chrome (or another AVIF-capable browser) and confirm (via Supabase dashboard Storage browser, or `mcp__supabase__list_tables`/direct Storage listing) that a `thumbs-avif/<filename>` object was created alongside `thumbs/<filename>`. Then delete that same image and confirm all three objects (main, thumb, thumb-avif) are gone.

- [ ] **Step 6: Commit**

```bash
git add gunjaisanuska/dashboard/products.js
git commit -m "Generate an AVIF thumbnail derivative on upload, with safe per-browser fallback"
```

### Task C2: Serve AVIF via `<picture>` with WebP fallback

**Files:**
- Modify: `supabase/functions/publish-site/data.ts` (`CatalogImage` interface + `fetchCatalog`'s image-building loop)
- Modify: `supabase/functions/publish-site/render.ts` (`renderProductCard`'s `sliderImgs`, and the PDP thumbnail-strip block at ~line 585)
- Test: `supabase/functions/publish-site/data.test.ts`, `render.test.ts`

**Interfaces:**
- Consumes: Task C1's `thumbs-avif/` path convention.
- Produces: `CatalogImage` gains `thumbAvifUrl: string` (empty string when no AVIF derivative exists — Storage's `getPublicUrl` always returns a URL string even for a path that doesn't exist, so this can't distinguish missing-object at generation time; the `<picture>` markup below handles a 404 AVIF source by falling through to the `<img>` WebP fallback, which is the browser's normal `<picture>`/broken-source behav0r, not something render.ts needs to special-case).

- [ ] **Step 1: Write the failing data.test.ts test**

`data.test.ts`'s `fakeSupabase` mock's `getPublicUrl(path)` just returns `https://fake.test/${path}` — the real `thumbs-avif/` path transform happens in `data.ts` itself before that call, so a test can assert on the exact resulting URL. Add (matching the existing `fakeSupabase(...)` fixture shape, e.g. the "joins brand name and folder" test at line 195):
```ts
Deno.test("fetchCatalog: each image's thumbAvifUrl points at the thumbs-avif/ derivative path", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Test Product", slug: "test-product", price: 100, cod_advance: 10, position: 1, category: "jacket", sleeve_length: null, description: null },
    ],
    product_colors: [],
    product_images: [
      { id: "i1", product_id: "p1", storage_path: "test-product/img-0001.webp", sort_order: 0, color_id: null },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Test Brand", folder_slug: "test", is_primary: false, thumbnail_storage_path: null }],
  });
  const catalog = await fetchCatalog(supabase);
  assertEquals(catalog.products[0].images[0].thumbAvifUrl, "https://fake.test/test-product/thumbs-avif/img-0001.webp");
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd supabase/functions/publish-site && deno test --allow-none data.test.ts --filter "avif"
```

- [ ] **Step 3: Implement in data.ts**

Update the interface (line 10):
```ts
export interface CatalogImage { url: string; thumbUrl: string; thumbAvifUrl: string; sortOrder: number; }
```
Add an `avifPath` helper next to `thumbPath` (~line 73):
```ts
  const avifPath = (path: string) => {
    const slashIdx = path.lastIndexOf("/");
    return slashIdx === -1 ? `thumbs-avif/${path}` : `${path.slice(0, slashIdx)}/thumbs-avif/${path.slice(slashIdx + 1)}`;
  };
```
Update the image-building loop (~line 81-85):
```ts
  for (const img of images ?? []) {
    const url = publicUrl(img.storage_path);
    const thumbUrl = publicUrl(thumbPath(img.storage_path));
    const thumbAvifUrl = publicUrl(avifPath(img.storage_path));
    imageUrlById.set(img.id, url);
    const catalogImg: CatalogImage = { url, thumbUrl, thumbAvifUrl, sortOrder: img.sort_order };
```

- [ ] **Step 4: Run data.test.ts again, confirm pass**

- [ ] **Step 5: Write the failing render.test.ts tests**

Important constraint driving this test: a `<picture><source>` element is evaluated and fetched as soon as it's inserted into the document, independent of whether the sibling `<img>` has a real `src` or only `data-src` — the `data-src` trick that defers loading in Track B only works because a plain `<img>` with no `src` attribute has nothing to fetch. Wrapping a deferred (`i > 0`) slider image in `<picture><source type="image/avif">` would silently reintroduce eager loading for exactly the AVIF-capable browsers this feature targets, undoing Track B. So: only the always-visible first slider image (`i === 0`, which already loads eagerly) gets the AVIF `<picture>` wrapper; images beyond it stay plain `data-src` `<img>` tags with no AVIF variant (they're rarely fetched at all — hover-only — so losing the AVIF saving there is the right tradeoff against re-adding an eager fetch). Add:
```ts
Deno.test("renderProductCard: only the first (eager) slider image is wrapped in <picture> with an AVIF source -- later images stay plain <img data-src> so wrapping them doesn't reintroduce eager loading via <source>", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    images: [
      { url: "https://example.com/full-0.jpg", thumbUrl: "https://example.com/thumbs/0.jpg", thumbAvifUrl: "https://example.com/thumbs-avif/0.jpg", sortOrder: 0 },
      { url: "https://example.com/full-1.jpg", thumbUrl: "https://example.com/thumbs/1.jpg", thumbAvifUrl: "https://example.com/thumbs-avif/1.jpg", sortOrder: 1 },
    ],
  };
  const html = renderProductCard(product);
  assertStringIncludes(html, '<source type="image/avif" srcset="https://example.com/thumbs-avif/0.jpg" />');
  assertStringIncludes(html, '<img src="https://example.com/thumbs/0.jpg"');
  assertStringIncludes(html, 'data-src="https://example.com/thumbs/1.jpg"');
  if (html.includes("thumbs-avif/1.jpg")) {
    throw new Error("the second (hover-only) slider image must not reference an AVIF source -- <source> fetches eagerly regardless of the sibling img's data-src, which would defeat the hover-deferred loading Track B added");
  }
});
```

- [ ] **Step 6: Run it to confirm it fails**

- [ ] **Step 7: Implement in render.ts**

Update `sliderImgs` (from Task B1's version) — only `i === 0` gets the `<picture>`/AVIF wrapper, later images are untouched from Task B1:
```ts
const sliderImgs = product.images
  .map(
    (img, i) =>
      i === 0
        ? `<picture><source type="image/avif" srcset="${esc(img.thumbAvifUrl)}" /><img src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" decoding="async" /></picture>`
        : `<img data-src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" loading="lazy" decoding="async" />`
  )
  .join("");
```
Check whether `.slider-track img` CSS selectors in `shell.ts` (grep for `slider-track img`) need a `.slider-track picture` companion rule for width/display on that first image — `<picture>` is inline by default like `<img>`, but confirm the existing CSS doesn't rely on `img` being a direct child of `.slider-track` in a way `<picture><img></picture>` breaks (e.g. a `>` direct-child selector). If it does, add the equivalent `.slider-track picture` rule alongside.

For the PDP thumbnail-strip block (`render.ts` ~line 585), ALL images there already render with a real `src` (Track B only touched the listing-page card slider, not the PDP strip), so there's no eager-`<source>`-vs-deferred-`<img>` conflict — wrap every thumbnail there in the same `<picture>`/AVIF pattern using `thumbUrls`/`img.thumbAvifUrl`.

- [ ] **Step 8: Run tests, then manual browser verification**

```bash
cd supabase/functions/publish-site && deno test --allow-none
```
Then in DevTools Network tab: confirm an AVIF request fires for image 0 immediately, and that NO `thumbs-avif/*` request fires for any other slider image until that card is hovered (same trigger checked in Track B2 Step 5, extended here to confirm no AVIF source sneaks in for the deferred images). Confirm Chrome actually requests the `.avif` URL (not the WebP one) for image 0 when both are present, and that a product with no `thumbs-avif/` object for some image (e.g. one uploaded before this feature) doesn't show a broken image — it should silently fall through to the WebP `<img>`.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/publish-site/data.ts supabase/functions/publish-site/data.test.ts supabase/functions/publish-site/render.ts supabase/functions/publish-site/render.test.ts
git commit -m "Serve AVIF thumbnails via <picture> with WebP fallback"
```

### Task C3: Deploy and regenerate

- [ ] **Step 1:** Deploy `publish-site` (`mcp__supabase__deploy_edge_function`).
- [ ] **Step 2:** Trigger a full storefront regeneration via the existing admin Publish flow.
- [ ] **Step 3:** Spot-check one regenerated product page's HTML for `<picture>`/`thumbs-avif` markup.
- [ ] **Step 4:** Mirror the final repo state to `C:\Users\anind\Downloads\berserker` per the established workflow (diff first).

---

## Explicitly not built this round

- **Cloudflare "Cache Everything" page rule** — would need Cloudflare dashboard/API access not available in this session. Track A's real Cache-Control fix is the correct long-term solution anyway (Cloudflare's current 88% hit rate is riding on default heuristic caching despite `no-cache`, which is fragile); revisit only if Track A's backfill doesn't measurably improve the edge hit rate.
- **Mobile-specific smaller thumbnail / `srcset` breakpoints** — explicitly deferred by the user.
- Any change to PDP hero image sizing, or to the historical one-off migration scripts.
