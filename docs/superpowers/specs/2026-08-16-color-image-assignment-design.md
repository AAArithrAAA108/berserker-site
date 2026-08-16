# Per-color image assignment — design spec

Date: 2026-08-16
Status: approved, ready for implementation planning

## Background

There is no real per-color image assignment anywhere in the system today. `product_colors.cover_image_id` — the dropdown shown in the admin panel's Colors & Stock section — is dead: `fetchCatalog()` never reads it. Instead, which uploaded photos belong to which color is inferred from `product_colors.image_index`, a number meant to mark where in the product's flat, `sort_order`-ordered image list that color's photos start, with everything up to the next color's `image_index` implicitly belonging to it (`data.ts`'s "color-range" comment). **The admin panel has no UI to set `image_index` at all** — every color added via the admin panel defaults to `image_index = 0`, silently colliding with whatever color already legitimately owns that range.

That single gap is the root cause of four separate symptoms reported together:
- Admins can't assign more than one photo to a color, because there is no real assignment UI — only the decorative, non-functional cover dropdown.
- The PDP's swatch-highlighting script (`render.ts`'s inline PDP script, `selectSwatchForIndex`) marks a swatch "selected" by checking whether the currently-viewed image index falls inside that swatch's own `[image_index, image_index + count)` range. When two colors' ranges overlap — trivially possible today since new colors default to 0 — both swatches match and both light up.
- The cart/checkout thumbnail (`imgSrc` passed to `addToCart`) is already wired to show *some* image per color; it just picks whichever image happens to sit at the (possibly wrong) computed range start.
- There's nowhere in the admin UI a color's name is shown next to the photos actually assigned to it, because no real assignment is tracked to name.

This spec replaces the implicit range system with an explicit relation, fixing the display bug as a structural consequence rather than a patched symptom, and adds two small admin-UI additions (serial numbers on images, in both the flat image grid and any dropdown that lists images) that ride along with the same UI rewrite.

## Decisions (confirmed with the user)

1. **One color per image.** Every uploaded photo belongs to at most one color (or none, if not yet assigned) — not a many-to-many relation. Matches how products are actually photographed (one shoot per colorway); keeps the assignment UI a single dropdown per image rather than a multi-select.
2. **The color name is shown under each image thumbnail in the admin panel's image grid** — not (only) on the live PDP, which already shows a color label under its main image via the existing `pdp-image-label` element once a swatch is clicked.
3. **Reuse `product_colors.cover_image_id`** as the real thumbnail pointer rather than adding a new column — it already exists in the schema and is already nullable; it is simply never read today. No new "is_thumbnail" flag needed.
4. **`product_colors.image_index` is removed entirely**, not deprecated-in-place. Once every image has an explicit `color_id`, an index-range column serves no purpose and keeping it around invites exactly the kind of silent drift that caused this bug.

## Data model

```sql
alter table product_images add column color_id uuid references product_colors(id) on delete set null;
```

Nullable: an image starts **unassigned** immediately after upload (`color_id is null`) until an admin assigns it to a color. This matches the natural upload flow — photos are uploaded in a batch, then sorted into colors — rather than forcing a color choice at the moment of upload.

`product_colors.cover_image_id` (existing column, currently unused) becomes the color's thumbnail pointer. Enforced at the **admin-UI level, not a DB constraint**: the Thumbnail dropdown for a color only ever lists images already assigned to that color (`product_images.color_id = this color's id`), so a color's cover can never point at an image it doesn't own. (A DB-level cross-table check would need a trigger for no real safety benefit here — the only writer is this admin panel, and the invariant is trivial to hold by construction in the UI.)

`product_colors.image_index` is dropped once the backfill (below) completes.

## Migration (backfill existing data)

One migration, run in this order so nothing on the live site changes until an admin next edits an image/color:

1. Add `product_images.color_id` (nullable, as above).
2. Backfill `color_id` for every existing image by replaying the *current* index-range algorithm from `data.ts`'s `fetchCatalog` (for each product, each color owns images from its own `image_index` up to the next color's `image_index`, last color owns the rest) — this is the same computation already live, just materialized into real rows instead of recomputed per-request.
3. Backfill `product_colors.cover_image_id` for every color to the first image in its newly-assigned group (mirroring the current `ownImages[0]` fallback), so the dropdown starts pre-populated rather than every color showing "(no cover)" the moment this ships.
4. Drop `product_colors.image_index`.

This is a data-preserving structural migration, not a reseed — run against the live database the same way Task 5 of brand-management added `products.brand_id` (nullable add → backfill → verify zero images with an owning color yet no color_id where one should exist → drop the old column). Verification before the drop: every `product_images` row that the old algorithm would have assigned to some color now has a matching `color_id`; spot-check at least one multi-image-per-color product (e.g. the 21-color/42-image product noted in `data.ts`'s comment) resolves identically before and after.

## `data.ts` changes

- `fetchCatalog()`'s `product_colors` query drops `image_index` from its select list; a new query (or an added select column) joins `product_images.color_id`.
- The per-product color-range computation (`colorsByProductRaw` → range slicing) is replaced by a direct group-by: for each color, `ownImages = productImages.filter(img => img.colorId === color.id)`, sorted by `sort_order`. No range math, no index arithmetic, no "two colors sharing a start" edge case — each image contributes to at most one color's list by construction.
- `CatalogColor.coverImageUrl` is computed from the color's own `cover_image_id` (matched against its `ownImages`), falling back to `ownImages[0]?.url ?? ""` if `cover_image_id` is unset or points at an image no longer in that color's group (e.g. reassigned to a different color after being set as cover — a real edge case the fallback must cover).
- `CatalogProduct.images` (the full per-product list, used by the card hover-slider and PDP gallery) is unchanged — still every uploaded image regardless of assignment, ordered by `sort_order`. Unassigned images still appear in the gallery/slider; they just don't belong to any swatch.

## `render.ts` / inline PDP script changes

- Card swatches (`renderProductCard`) keep using a single `data-img-index` (the position of `coverImageUrl` within `product.images`) — unchanged shape, since the quick-add modal only ever needs one representative image per color, not a gallery.
- PDP swatches (`renderPdpPage`) currently carry `data-img-index` + `data-img-count` (a range). These become **an explicit list of indices** the color owns within `product.images` (e.g. `data-img-indices="[3,4]"` as a JSON attribute, mirroring the existing `data-variants` JSON-attribute pattern already used on card swatches).
- The inline PDP script's `colorForIndex(idx)` and `selectSwatchForIndex(idx)` change from range-membership (`idx >= start && idx < start + count`) to array-membership (`indices.includes(idx)`). Because the underlying data now guarantees each index belongs to at most one color's list, at most one swatch can ever match — the two-swatches-selected bug is structurally impossible after this change, not just harder to trigger.
- `esc()` continues to wrap every admin-editable string as today; the new JSON array attributes carry only integers, no XSS surface.

## Admin UI (`admin/dashboard/products.js`)

**Images grid** (`renderImagesSection` / `refreshImagesGrid`):
- Every image thumbnail gets a `[Image #N]` caption underneath, numbered by its position in the product's `sort_order`-ordered list (1-based, matching how the screenshot's plain numbers already work, just reformatted).
- Directly under the serial-number caption, add a `<select>` assigning that image to a color: `(unassigned)` plus every existing color's label, defaulting to the image's current `color_id` (or `(unassigned)` if null). Changing it updates `product_images.color_id` immediately (no separate Save button, matching the existing stock-toggle pattern of immediate-commit-on-change elsewhere in this file) and shows the assigned color's name as a second caption line under the image (satisfies "show the corresponding name of the color/variant under the picture").
- Reassigning an image away from a color whose `cover_image_id` pointed at it: the admin-UI-level invariant (Thumbnail dropdown only lists a color's own images) self-heals on next render — that color's Thumbnail dropdown simply no longer offers the reassigned image; if it was the selected cover, `cover_image_id` needs to be cleared or reset to that color's new first image at reassignment time (implementation detail: doing this via the same update call that sets `color_id`, checking whether the color being vacated currently points its `cover_image_id` at this image).

**Colors & Stock section** (`renderColorsSection`):
- The per-color "cover" dropdown's option source changes from *all* the product's images to only images where `color_id` equals that color's id, and each option is labeled `[Image #N]` (the same serial number used in the Images grid) instead of the current 8-character UUID prefix — so an admin can visually match "Thumbnail: [Image #10]" against the image actually captioned `[Image #10]` above.
- A color with zero assigned images shows a dropdown with only `(no cover)`, not an empty select.
- The "Add Color" flow stops seeding `cover_image_id` from the product's first image (`coverOptions[0].id`) — that image may not even belong to the new color under the new model. A newly created color starts with `cover_image_id = null` until the admin assigns it photos and picks a thumbnail; this is a visible, expected gap the admin fills in immediately after creating a color, same as it already is for a color's stock grid.

## Other surfaces to audit during implementation

`checkout/review`'s hand-authored page duplicates a `.swatch` / `openSizePicker` / `addToCart` structure similar to `shell.ts`'s card quick-add modal (confirmed via grep, not yet read in full). It appears to be the same non-buggy modal-swatch pattern (clears all `.selected` before setting the clicked one), not the PDP's range-based pattern — but this needs to be confirmed by reading the file directly as an implementation task, since it lives outside the publish pipeline and won't be touched by any of the generator changes above. If it does turn out to embed its own range-based color/image logic, it needs the equivalent membership-based fix, mirrored to Downloads per the standing workflow like every other hand-authored page.

## Testing

- `data.test.ts`: `fetchCatalog` groups a product's images by `color_id` correctly (including an image with `color_id = null` correctly excluded from every color's list but still present in `CatalogProduct.images`); `coverImageUrl` resolves from `cover_image_id` when set and valid, falls back to the first owned image when unset, and falls back correctly when `cover_image_id` points at an image no longer in that color's group.
- `render.test.ts`: PDP swatches emit `data-img-indices` as the color's real (possibly non-contiguous) index list; card swatches still emit a single `data-img-index` pointing at the resolved cover image.
- A regression test reproducing the exact bug class this spec fixes: two colors whose owned-image sets are adjacent (e.g. color A owns index 2, color B owns index 3) — verify the PDP script's swatch-selection logic (or the underlying data driving it) cannot select both for any single image index, by construction rather than by a specific patched condition.
- Migration verification (manual, against live data, same discipline as every prior migration in this project): every existing product's swatch-to-photo mapping resolves identically before and after the backfill — spot-check the 21-color/42-image product `data.ts` already references, plus at least one single-image-per-color product and one with an unassigned/edge-case image count.
