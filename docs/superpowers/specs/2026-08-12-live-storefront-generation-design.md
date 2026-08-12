# Live storefront generation — design spec

Date: 2026-08-12
Status: approved, ready for implementation planning

## Background

Phase 1 (Foundation) and Phase 2 (Admin Product Editor) of the Berserker overhaul made Supabase the real source of truth for the product catalog and built a working admin panel with a Publish button. Both merged (PR #1, PR #2). The Publish button was proven live on 2026-08-12 — three real commits landed from a real admin session, correctly picking up a newly-added product.

But Publish only ever wrote to `all-products/index.generated.html`, a placeholder file created during Phase 1 specifically to prove the pipeline safely without touching the real site. It was never wired to the real storefront. The real pages — `all-products/index.html`, 6 collection pages, 7 brand pages, and 41 individually hand-authored product detail pages (PDPs) — remain 100% hand-written static HTML, completely disconnected from the database. This was discovered when the user added a real product via the admin panel, clicked Publish, and it didn't appear anywhere on the live site.

This spec covers making Publish regenerate the real storefront from the database.

## Research findings (established fact, from a full Explore pass over the current repo)

- **Two page-shell families exist today** and genuinely diverge, not just in per-page text: brand pages (`gymshark/index.html` etc.) use base64-embedded logos, `footer-privacy`/`footer-terms` ids, and an older size-picker with no "Variant N" label support. `all-products/index.html` and all 6 collection pages use file-path logos, no footer ids, and a newer size-picker that does support variant labels. Design tokens (`:root` CSS custom properties) are byte-identical across every page type checked — only shell markup/JS diverges.
- **`render.ts`'s current `renderProductCard()` output does not match real markup** and would break real page behavior if used as-is: no image slider (real cards cycle one `<img>` per color via `.product-img-slider > .slider-track`), wrong swatch attribute (`data-color-group` instead of the `data-img-index` the real cart JS reads via `parseInt(dataset.imgIndex)`), price wrapped in non-existent CSS classes instead of a bare text node (the real cart JS reads price via `card.querySelector('.product-price')?.childNodes[0]?.textContent`), an invented `.product-sizes`/`.size-btn` block with no matching CSS anywhere on the real site, and no product-detail-page link wiring.
- **A real CSS class already exists for strikethrough pricing**: `all-products/index.html:430-437` defines `.product-price .original` (line-through, muted, smaller, `font-weight: 400`) — confirmed by direct read, not assumption.
- **Brand-page membership is prefix matching, not equality**: e.g. `youngla/index.html` includes `"YoungLA"`, `"YoungLA × Batman"`, `"YoungLA × Superman"`, and `"YoungLA × Gold's Gym"` — a strict equality filter would drop 3 of 7 products. Same pattern for Chrome Hearts and Cactus Jack collabs.
- **Collection-page membership is not 1:1 with the category enum**: `collections/t-shirts/` = `category IN ('t-shirt','compression')` (27 cards, confirmed a strict superset of `collections/compressions/`'s 12 cards). The other four collections (pants/jackets/dresses/sets) are simple 1:1 with their matching category value.
- **All 41 products have a real, individually hand-authored PDP** at `<brand-folder>/<slug>/index.html`, sharing head/nav/footer/cart-sidebar/size-modal markup with listing pages (the size-picker machinery is present but unused there) but with a distinct two-column `.pdp-grid` main content and a third inline `<script>` per page hardcoding that product's own image array and calling the shared `addToCart(...)` directly, bypassing the modal flow entirely.
- **Cart mechanics are shared and must not break**: single `localStorage` key `berserkerCart`, global `addToCart(brand, name, price, imgSrc)`, and on listing pages a shared `openSizePicker(...)` that reads the clicked card's own DOM at click-time — not from any data payload. Whatever markup shape the generator produces is a load-bearing input contract to this existing, unchanged JS.
- **No CSS files exist anywhere** — every page carries its own full inline `<style>` block; design tokens have not drifted across page types, only feature-level CSS (size-picker, footer) differs between the two shell families.

## Decisions (confirmed with the user)

1. **Shell unification**: all generated pages (all-products, collections, AND brand pages) use the newer shell — file-path logos, the size-picker that supports "Variant N" labels. One shell to maintain going forward; Chrome Hearts' variant swatches get correctly labeled on its brand page, which they don't today.
2. **Source of truth**: once this ships, the database is the only supported way to edit these 55 pages' content. Any future direct hand-edit to one of them will be silently overwritten on the next Publish. This is the intended, explicit behavior — the whole point of the admin panel work.
3. **Description backfill**: before PDP generation goes live, a one-time migration extracts each of the 41 PDPs' current hand-written `.pdp-description` text into `products.description` (currently empty for all 41 rows), so no product's description goes blank on cutover.
4. **Per-color slider images**: the current data model gives each color exactly one representative image (`cover_image_id`) — there's no stored concept of multiple images per color. Some original hand-authored cards used 2 images per color for a subtle hover-flip effect; faithfully reproducing that would need a schema change (an image *range* per color) that's out of scope here. Generated cards use one image per color in the slider — correct and buildable within the existing schema, flagged as a small, deliberate visual simplification versus today's hand-authored cards for the subset of products that had multi-image colors.

## Architecture

New files under `supabase/functions/publish-site/`:
- `shell.ts` — the one canonical page shell (head/CSS/nav/off-canvas menu/footer/cart-sidebar/size-picker-modal/shared JS: cart, size-picker with variant-label support, nav toggle, search), built from the all-products/collections shell family. Every generated page wraps its content in this.
- `membership.ts` — the collection-category and brand-prefix mapping tables (below).
- `data.ts` (extended) — fetches everything a PDP needs (images, description) alongside what listing pages already need.
- `render.ts` (rewritten) — `renderProductCard()` emits real, cart-JS-compatible markup (below). New `renderListingPage()`, `renderCollectionPage()`, `renderBrandPage()`, `renderPdpPage()` compose `shell.ts` + page-specific content, including per-page slider `@keyframes`/`#product-N` CSS computed fresh from that page's own local card ordering.

`publish-site`'s output grows from 1 placeholder file to 55 real files per Publish: `all-products/index.html`, 6 `collections/<slug>/index.html`, 7 `<brand-folder>/index.html`, 41 `<brand-folder>/<slug>/index.html`. `all-products/index.generated.html` is deleted once the real paths are wired.

### Card template (`renderProductCard`)

- **Image slider**: `.product-img.product-img-slider > .slider-track > <img>` × one image per color (each color's `cover_image_id`, in color order) — not the single flat `<img>` render.ts emits today.
- **Swatches**: `data-img-index="N"` = that color's position in the slider.
- **Price**: `<div class="product-price">₹4,799<span class="original">₹12,999</span></div>` — bare text node first (cart JS compatibility), strikethrough "was" price in the confirmed-real `.original` class. Strikethrough formula unchanged: `ceil(price*2.7/1000)*1000-1`.
- **No per-card size buttons** — matches real pages exactly; sizing happens in the shared `#size-modal` populated from card DOM at click time. Render.ts's invented `.product-sizes` block (no matching CSS anywhere) is removed.
- **PDP link**: card links to `/<brand-folder>/<slug>/`, replacing the separate hand-maintained `productLinks` JS map every page currently carries.
- **Variant-numbered swatches** (Chrome Hearts style): supported via the unified shell's newer size-picker, based on whether a color's label is a generic placeholder vs. a real name.

### Membership rules (`membership.ts`)

```
Collection category mapping:
  t-shirts:     ['t-shirt', 'compression']
  compressions: ['compression']
  pants:        ['pants']
  jackets:      ['jacket']
  dresses:      ['dress']
  sets:         ['set']

Brand folder → canonical brand-text prefix:
  gymshark → "Gymshark"                youngla → "YoungLA"
  breathedivinity → "BreatheDivinity"  chromehearts → "Chrome Hearts"
  cactusjack → "Cactus Jack"           skims → "Skims"
  lululemon → "Lululemon"
```
A product belongs to a brand folder if `products.brand` starts with that folder's canonical prefix (case-sensitive) — so `"Chrome Hearts × Mastermind"` still lands on `chromehearts/`.

### PDP templating

One shared `renderPdpPage(product)` replaces the 41 hand-maintained files. Reproduces the real PDP shape (`.pdp-grid` gallery + info column, thumbnails, swatches, size grid, description) and generates the per-product inline script from real DB data (image array, swatch list) instead of hand-typed literals — but keeps the existing direct-`addToCart()`-on-select interaction pattern (not routed through the shared modal), since that's the current, working PDP flow and changing it isn't this project's goal.

## Rollout & safety

Verification happens before the switch is flipped, not after, given this replaces 55 live pages at once (versus today's 1 harmless placeholder):

1. Build and test the new `render.ts`/`shell.ts`/`membership.ts` logic in isolation (same TDD approach Foundation used for `render.ts`).
2. Generate all 55 pages' content without publishing; structurally diff a representative sample against the current real pages — nav/footer/design tokens, correct product set per page (spot-check the T-Shirts/Compressions overlap and a collab-brand page), cart-JS-compatible card markup (`data-img-index` resolves correctly, price is a bare text node).
3. Only after that passes does `index.ts` get pointed at the real file paths instead of the placeholder — a deliberate, separate, reviewed step, not bundled into the render rewrite.
4. The first real Publish after cutover happens with the user consciously aware it's about to replace all 55 files at once, with a sample of generated output (one collection page, one brand page, one PDP) shared for a sanity check.

## Non-goals / out of scope

- Multiple images per color in the slider (would need a schema change; see Decision 4).
- Changing the PDP's direct-`addToCart()` interaction pattern to route through the shared modal.
- Any new storefront feature (filters, sort, scrollbar, etc.) — those are separate, already-scoped later phases of the overall overhaul, and depend on this work being done first.
- Legal-page footer links (`footer-privacy`/`footer-terms` ids) — a later phase's concern, not reintroduced here even though the old brand-page shell had them, since the newer shell being standardized on doesn't have them yet either.
