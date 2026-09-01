import type { Catalog, CatalogProduct, PrimaryBrand } from "./data.ts";
import { brandFolderFor, isInCollection } from "./membership.ts";
import { renderShell } from "./shell.ts";

export function strikethroughPrice(price: number): number {
  return Math.ceil((price * 2.7) / 1000) * 1000 - 1;
}

function formatInr(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

// Escapes text that ultimately comes from an admin-editable database column
// before it is interpolated into HTML markup or an HTML attribute value.
// Without this, a product name/brand/colour label containing `<`, `>`, `&`,
// `"` or `'` becomes stored XSS in the generated storefront page.
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Mirrors classify_color_group's own palette/palette_hex arrays (schema.sql)
// -- a representative hex per named color group, so a color with no real
// hex of its own (a 'variant'-mode row -- see swatchDisplayText) can still
// render an actual color instead of a flat placeholder tile. "Uncategorized"
// (an admin-panel-only palette entry, not part of the DB classifier's own
// list) has no representative color and falls through to the "#333"
// fallback deliberately, same as an unset color_group always has.
const GROUP_HEX: Record<string, string> = {
  Black: "#141414", White: "#f0ede8", Grey: "#8a8a8a", Red: "#c41e1e",
  Blue: "#1c4aa0", Green: "#1c8a3a", Purple: "#5a1ca0", Pink: "#c41e8a",
  Orange: "#c46a1e", Navy: "#1c2c4a", Maroon: "#5a1a1a", Gold: "#c4a01c",
  Brown: "#5a3f2a", Cream: "#ede9e3", Denim: "#6b9fd4",
};
function representativeHex(colorGroup: string): string {
  return GROUP_HEX[colorGroup] ?? "#333";
}

// Visible text to overlay on a swatch: a 'both'-mode color's variant_label
// (shown alongside its real color background), or -- when there's no real
// color at all (hex null, i.e. a 'variant'-mode row where label itself IS
// the variant text) -- the label itself. Plain color-mode rows (real hex,
// no variant_label) show no text, matching the swatch's existing look.
export function swatchDisplayText(c: { hex: string | null; label: string; variantLabel?: string | null }): string {
  if (c.variantLabel) return c.variantLabel;
  if (c.hex === null) return c.label;
  return "";
}

// Every distinct color group (primary or secondary) across a product's
// colors, e.g. a color with primary "Black" + secondary "Green" and a
// second color with primary "Navy" yields ["Black", "Green", "Navy"] --
// the color filter matches a product if ANY selected group appears here.
export function productColorGroups(product: CatalogProduct): string[] {
  const groups = new Set<string>();
  for (const c of product.colors) {
    if (c.colorGroup) groups.add(c.colorGroup);
    if (c.secondaryColorGroup) groups.add(c.secondaryColorGroup);
  }
  return Array.from(groups);
}

export function renderProductCard(product: CatalogProduct): string {
  const wasPrice = strikethroughPrice(product.price);
  // The hover-slider cycles through every uploaded photo (not one per
  // color) -- a color can own more than one photo (e.g. front/back shots;
  // see fetchCatalog's range comment), and those extra photos are real,
  // already-uploaded data a per-color-only slider would permanently hide.
  const imgCount = product.images.length;
  // Original hand-authored cards hardcoded slider-track/img widths in shared
  // CSS (800%/12.5%) because every card carried exactly 8 slider images.
  // Image count varies per product, so those widths must be computed per
  // card and set inline instead of relying on a fixed shared CSS rule
  // (shell.ts Task 2 already dropped the old hardcoded rule). Guard
  // imgCount === 0 so an image-less product can't divide by zero -- render
  // an empty track.
  const trackStyle = imgCount > 0 ? ` style="width:${imgCount * 100}%;"` : "";
  const imgWidthPct = imgCount > 0 ? 100 / imgCount : 0;
  // Image 0 loads eagerly (it's the always-visible card thumbnail). Every
  // later image is a hover-slider frame the shopper only sees by hovering
  // (see shell.ts's mouseenter/touchstart listener on .product-img-slider)
  // -- giving it a real `src` here would defeat the point: native
  // loading="lazy" doesn't help because the whole card, and every image
  // inside it, is already in/near the viewport as soon as the card scrolls
  // into view, so the browser fetches all of them regardless (this is what
  // let Chrome Hearts' 40-42-image SKUs blow up listing-page egress).
  // data-src only becomes src on that hover/tap trigger.
  // NOT wrapped in a <picture>/AVIF <source> -- <picture> selects a source
  // by type match at parse time, not by whether that URL actually resolves,
  // so an AVIF-capable browser locks onto the AVIF <source> and shows a
  // broken image if it 404s instead of falling back to this <img>'s own
  // src. Every image uploaded before the AVIF-derivative feature existed
  // has no thumbs-avif/ object, so this broke images sitewide in
  // production on 2026-09-01 (regression, reverted same day). Revisit only
  // once AVIF-derivative existence can be tracked per-image (e.g. a DB
  // column set by the upload flow) so this can gate on it instead of
  // assuming the file is there.
  const sliderImgs = product.images
    .map(
      (img, i) =>
        i === 0
          ? `<img src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" decoding="async" />`
          : `<img data-src="${esc(img.thumbUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" loading="lazy" decoding="async" />`
    )
    .join("");
  const images = product.images.map((img) => img.url);
  const swatches = product.colors
    .map((c) => {
      const idx = images.indexOf(c.coverImageUrl);
      // Stock is per color, not per product -- carried on the swatch itself
      // so the Add to Cart size-picker modal (shell.ts) can grey out
      // whichever sizes are actually out of stock for whichever color the
      // shopper picks, instead of showing every size as available.
      const variantsJson = esc(JSON.stringify(c.variants.map((v) => ({ size: v.size, inStock: v.inStock }))));
      const bg = c.hex ?? representativeHex(c.colorGroup);
      // Secondary hex is resolved server-side (rather than passing the raw
      // group name) so shell.ts's client-side JS doesn't need its own copy
      // of the GROUP_HEX palette just to read this one attribute.
      const secondaryHex = c.secondaryColorGroup ? representativeHex(c.secondaryColorGroup) : "";
      return `<div class="swatch" style="background:${esc(bg)};" title="${esc(c.label)}" data-img-index="${idx === -1 ? 0 : idx}" data-variants="${variantsJson}" data-variant="${esc(c.variantLabel ?? "")}" data-has-color="${c.hex !== null}" data-secondary-hex="${esc(secondaryHex)}"></div>`;
    })
    .join("");
  const brandFolder = brandFolderFor(product);
  const pdpPath = brandFolder ? `/${brandFolder}/${product.slug}/` : "/all-products/";
  const colorGroupsAttr = esc(productColorGroups(product).join(","));

  return `
<div class="product-card fade-in" id="product-${product.position}" data-color-groups="${colorGroupsAttr}" data-sleeve-length="${esc(product.sleeveLength ?? "")}">
  <a href="${esc(pdpPath)}" class="product-img product-img-slider">
    <div class="slider-track"${trackStyle}>${sliderImgs}</div>
  </a>
  <div class="product-info">
    <div class="product-brand">${esc(product.brand)}</div>
    <a href="${esc(pdpPath)}"><div class="product-name">${esc(product.name)}</div></a>
    <div class="product-price">${formatInr(product.price)}<span class="original">${formatInr(wasPrice)}</span></div>
    <div class="product-swatches">${swatches}</div>
  </div>
  <button class="product-add" data-cod-advance="${product.codAdvance}">Add to Cart</button>
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

// Hover-triggered slider animation CSS, one @keyframes + hover rule per
// product, keyed to that product's own grid position (matches the
// `#product-${position}` id renderProductCard emits). This is scoped to
// ANIMATION TIMING ONLY -- it deliberately does not touch track/image width
// sizing (see shell.ts's Task 2 comment and renderProductCard's Task 4
// comment): those widths are now emitted inline per-card because color count
// varies per product, so a shared/page-level CSS rule can no longer own them.
//
// Timing approach: reconstructed from-scratch to generalize to any color
// count, but matched exactly (verified point-by-point) against the real
// hand-authored keyframe table at all-products/index.html:871-895 for
// product-1's 8-image loop -- a prior version of this function used
// steps(imgCount) as the animation-timing-function instead of linear, which
// is wrong: steps() subdivides *every* keyframe segment (not the animation
// as a whole), so with multiple keyframes it produces many extra micro-jumps
// per transition instead of one clean slide. That version also scaled
// translateX by a flat `i * 100%` instead of `i * (100 / imgCount)%`, which
// is wrong relative to the track's own width (the CSS %-basis for
// translateX): with a track that's `imgCount * 100%` wide, a flat `i*100%`
// overshoots by a factor of `imgCount`, throwing later images far outside
// the visible, overflow:hidden container. Both bugs together produced fast,
// erratic cycling that never visibly reached a slider's last couple of
// images -- exactly the production symptom this rewrite fixes.
//
// Real pattern per image i (1-indexed arrival, i=1..imgCount-1): a short
// SLIDE_SECONDS transition into image i, then a HOLD_SECONDS pause on it,
// before sliding into i+1. Image 0 is already visible at t=0 with no lead-in
// hold (matches the reference: 0% -> translateX(0) is immediately followed
// by the first slide, not preceded by a pause). The last image's hold
// extends to 100%, where the `infinite` loop cuts straight back to image 0
// with no transition (matches the reference's "loop restarts here" comment).
// One detail carried over from the original for fidelity: a non-hover
// `#product-N .slider-track { transform: translateX(0); transition:
// transform .4s ease; }` rule so the slider eases back to the first image on
// mouse-leave instead of snapping instantly (all-products/index.html:897-899,
// 905-908).
const SLIDER_SLIDE_SECONDS = 0.3;
const SLIDER_HOLD_SECONDS = 2.0;

export function renderSliderCss(products: CatalogProduct[]): string {
  return products
    .map((p) => {
      const imgCount = p.images.length;
      if (imgCount <= 1) return "";

      const transitions = imgCount - 1;
      const unitSeconds = SLIDER_SLIDE_SECONDS + SLIDER_HOLD_SECONDS;
      const totalSeconds = transitions * unitSeconds;
      const slidePct = (SLIDER_SLIDE_SECONDS / totalSeconds) * 100;
      const unitPct = 100 / transitions;

      const keyframes = ["0% { transform: translateX(0); }"];
      for (let i = 1; i < imgCount; i++) {
        const arrivalPct = slidePct + (i - 1) * unitPct;
        const value = `translateX(-${((i * 100) / imgCount).toFixed(4)}%)`;
        keyframes.push(`${arrivalPct.toFixed(4)}% { transform: ${value}; }`);
        const isLast = i === imgCount - 1;
        const holdEndPct = isLast ? "100" : (arrivalPct + (unitPct - slidePct)).toFixed(4);
        keyframes.push(`${holdEndPct}% { transform: ${value}; }`);
      }

      return `
  #product-${p.position}:hover .slider-track { animation: slideProduct${p.position} ${totalSeconds.toFixed(4)}s linear infinite; }
  @keyframes slideProduct${p.position} {
    ${keyframes.join("\n    ")}
  }
  #product-${p.position} .slider-track { transform: translateX(0); transition: transform 0.4s ease; }`;
    })
    .join("\n");
}

// The shared nav's search form (shell.ts) always submits to
// /all-products/?q=<term> regardless of which page it's submitted from.
// This filter script reads that query param client-side and hides any
// `.product-card` whose brand+name text doesn't match -- it queries the
// DOM directly against whatever cards renderProductCard actually emitted
// above, so it covers every product in the current catalog (new or old)
// with no separate index to keep in sync. Listing-page-only by design,
// matching this feature's original scope (never applied to collection or
// brand pages either).
const SEARCH_FILTER_SCRIPT = `
<script>
  (function() {
    var params = new URLSearchParams(window.location.search);
    var q = (params.get('q') || '').trim().toLowerCase();
    if (!q) return;

    var input = document.getElementById('nav-search-input');
    if (input) input.value = params.get('q') || '';

    var cards = document.querySelectorAll('.product-card');
    var visibleCount = 0;
    cards.forEach(function(card) {
      var brandEl = card.querySelector('.product-brand');
      var nameEl = card.querySelector('.product-name');
      var brand = brandEl ? brandEl.textContent : '';
      var name = nameEl ? nameEl.textContent : '';
      var match = (brand + ' ' + name).toLowerCase().indexOf(q) !== -1;
      card.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });

    if (visibleCount === 0) {
      var grid = document.querySelector('.product-grid');
      if (grid) {
        var msg = document.createElement('div');
        msg.style.cssText = "grid-column:1/-1;text-align:center;padding:60px 20px;color:#888;font-family:'DM Sans',sans-serif;font-size:15px;";
        msg.textContent = 'No such product in stock :(';
        grid.appendChild(msg);
      }
    }
  })();
</script>`;

// Dropdown reused on the all-products page (which also serves search
// results -- SEARCH_FILTER_SCRIPT filters the same cards this sorts) and
// every brand page. Not on collection pages -- outside this feature's
// requested scope.
const SORT_BAR_HTML = `
<div class="sort-bar">
  <label for="sort-select">Sort by</label>
  <select id="sort-select">
    <option value="relevance">Relevance</option>
    <option value="price-asc">Price: Low to High</option>
    <option value="price-desc">Price: High to Low</option>
  </select>
</div>`;

// "Relevance" restores each card's admin-defined catalog order -- read
// from the id="product-${position}" renderProductCard already emits,
// rather than snapshotting the initial DOM order, so it stays correct
// even after multiple sort changes. Price is read the same way the cart's
// Add-to-Cart handler already does (shell.ts): the bare text node before
// the .original strikethrough span. Re-appending each card in sorted order
// moves it within .product-grid without detaching/recreating any card,
// so hover-slider state and event listeners on the cards are unaffected;
// it composes with SEARCH_FILTER_SCRIPT's display:none filtering since
// that never reorders the DOM, only hides non-matching cards.
const SORT_SCRIPT = `
<script>
  (function() {
    var select = document.getElementById('sort-select');
    var grid = document.querySelector('.product-grid');
    if (!select || !grid) return;

    function priceOf(card) {
      var priceEl = card.querySelector('.product-price');
      var text = priceEl && priceEl.childNodes[0] ? priceEl.childNodes[0].textContent : '0';
      return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
    }
    function positionOf(card) {
      return parseInt((card.id || '').replace('product-', ''), 10) || 0;
    }

    select.addEventListener('change', function() {
      var mode = select.value;
      var cards = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
      cards.sort(function(a, b) {
        if (mode === 'price-asc') return priceOf(a) - priceOf(b);
        if (mode === 'price-desc') return priceOf(b) - priceOf(a);
        return positionOf(a) - positionOf(b);
      });
      cards.forEach(function(card) { grid.appendChild(card); });
    });
  })();
</script>`;

// Sleeve-length facet: DB constraint restricts sleeve_length to these three
// values (or null) -- see products_sleeve_length_check in schema.sql. Fixed
// display order (not alphabetical, unlike colors) since there's no natural
// alphabetical order that reads well for this facet.
const SLEEVE_LABELS: Record<string, string> = { full: "Full Sleeve", half: "Half Sleeve", sleeveless: "Sleeveless" };
const SLEEVE_ORDER = ["full", "half", "sleeveless"];

// Checkbox list built from whichever color groups and sleeve lengths
// actually appear among the products passed in (a brand page only lists
// that brand's colors; the all-products page lists every color site-wide)
// -- keeps the filter from showing a "Denim" option on a brand with zero
// denim products, or a "Sleeveless" option on a brand with none. Colors are
// sorted alphabetically since there's no shared canonical palette order
// between this Deno module and the admin panel's own JS-side constant.
function renderFilterBar(products: CatalogProduct[]): string {
  const groups = new Set<string>();
  const sleeveLengths = new Set<string>();
  for (const p of products) {
    for (const g of productColorGroups(p)) groups.add(g);
    if (p.sleeveLength) sleeveLengths.add(p.sleeveLength);
  }
  const sortedGroups = Array.from(groups).sort();
  const sortedSleeves = SLEEVE_ORDER.filter((s) => sleeveLengths.has(s));
  if (sortedGroups.length === 0 && sortedSleeves.length === 0) return "";

  const colorSection = sortedGroups.length
    ? `<div class="filter-section-label">Color</div>` +
      sortedGroups
        .map(
          (g) =>
            `<label class="color-filter-option"><input type="checkbox" class="color-filter-checkbox" value="${esc(g)}" /><span class="color-filter-swatch" style="background:${esc(representativeHex(g))};"></span>${esc(g)}</label>`
        )
        .join("")
    : "";

  const sleeveSection = sortedSleeves.length
    ? `<div class="filter-section-label">Sleeve Length</div>` +
      sortedSleeves
        .map(
          (s) =>
            `<label class="color-filter-option"><input type="checkbox" class="sleeve-filter-checkbox" value="${esc(s)}" />${esc(SLEEVE_LABELS[s])}</label>`
        )
        .join("")
    : "";

  return `
<div class="filter-bar">
  <button type="button" id="filter-toggle-btn" class="filter-toggle">Filter</button>
  <div id="filter-panel" class="filter-panel">
    <div class="filter-facets">
      ${colorSection ? `<div class="filter-facet">${colorSection}</div>` : ""}
      ${sleeveSection ? `<div class="filter-facet">${sleeveSection}</div>` : ""}
    </div>
    <button type="button" id="filter-clear-btn" class="filter-clear">Clear</button>
  </div>
</div>`;
}

// A card matches the color facet if ANY selected group is in its own
// data-color-groups (set by productColorGroups at render time), and matches
// the sleeve-length facet if its data-sleeve-length is among the checked
// values -- OR within each facet (matching the "Black or Green" example in
// the feature request), AND between facets (a shopper picking both "Black"
// and "Sleeveless" wants black sleeveless items, not everything black plus
// everything sleeveless). No filters selected in a facet matches everything
// for that facet, same as the search box being empty.
//
// Re-derives the ?q= search match from scratch on every filter change
// (same logic as SEARCH_FILTER_SCRIPT) instead of relying on the DOM
// state SEARCH_FILTER_SCRIPT already applied, so combined visibility is
// correct regardless of whether the shopper touches search or the filter
// panel first -- neither script needs to know the other ran.
const FILTER_SCRIPT = `
<script>
  (function() {
    var toggleBtn = document.getElementById('filter-toggle-btn');
    var panel = document.getElementById('filter-panel');
    var clearBtn = document.getElementById('filter-clear-btn');
    var grid = document.querySelector('.product-grid');
    if (!toggleBtn || !panel || !grid) return;

    function searchMatches(card) {
      var params = new URLSearchParams(window.location.search);
      var q = (params.get('q') || '').trim().toLowerCase();
      if (!q) return true;
      var brandEl = card.querySelector('.product-brand');
      var nameEl = card.querySelector('.product-name');
      var brand = brandEl ? brandEl.textContent : '';
      var name = nameEl ? nameEl.textContent : '';
      return (brand + ' ' + name).toLowerCase().indexOf(q) !== -1;
    }

    function applyFilter() {
      var checkedColors = Array.prototype.slice.call(document.querySelectorAll('.color-filter-checkbox:checked')).map(function(cb) { return cb.value; });
      var checkedSleeves = Array.prototype.slice.call(document.querySelectorAll('.sleeve-filter-checkbox:checked')).map(function(cb) { return cb.value; });
      var cards = grid.querySelectorAll('.product-card');
      cards.forEach(function(card) {
        var groups = (card.dataset.colorGroups || '').split(',').filter(Boolean);
        var colorMatch = checkedColors.length === 0 || groups.some(function(g) { return checkedColors.indexOf(g) !== -1; });
        var sleeveMatch = checkedSleeves.length === 0 || checkedSleeves.indexOf(card.dataset.sleeveLength || '') !== -1;
        card.style.display = (colorMatch && sleeveMatch && searchMatches(card)) ? '' : 'none';
      });
    }

    toggleBtn.addEventListener('click', function() {
      panel.classList.toggle('open');
    });
    document.addEventListener('click', function(e) {
      if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== toggleBtn) panel.classList.remove('open');
    });
    document.querySelectorAll('.color-filter-checkbox, .sleeve-filter-checkbox').forEach(function(cb) {
      cb.addEventListener('change', applyFilter);
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        document.querySelectorAll('.color-filter-checkbox, .sleeve-filter-checkbox').forEach(function(cb) { cb.checked = false; });
        applyFilter();
      });
    }
  })();
</script>`;

export function renderListingPage(catalog: Catalog): string {
  const sorted = catalog.products.slice().sort((a, b) => a.position - b.position);
  const cards = sorted.map(renderProductCard).join("\n");
  const bodyContent = `
<section class="section" id="all-products-grid">
  <div class="section-header">
    <h2 class="section-title">ALL<br><span>PRODUCTS</span></h2>
    <div class="list-controls">
      ${renderFilterBar(sorted)}
      ${SORT_BAR_HTML}
    </div>
  </div>
  <div class="product-grid">${cards}</div>
</section>
${SEARCH_FILTER_SCRIPT}
${SORT_SCRIPT}
${FILTER_SCRIPT}`;
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

export function renderBrandPage(catalog: Catalog, folder: string, brandName: string = folder): string {
  const filtered = catalog.products
    .filter((p) => brandFolderFor(p) === folder)
    .sort((a, b) => a.position - b.position);
  const cards = filtered.map(renderProductCard).join("\n");
  const bodyContent = `
<section class="section" id="all-products-grid">
  <div class="section-header">
    <h2 class="section-title">${esc(brandName.toUpperCase())}</h2>
    <div class="list-controls">
      ${renderFilterBar(filtered)}
      ${SORT_BAR_HTML}
    </div>
  </div>
  <div class="product-grid">${cards}</div>
</section>
${SORT_SCRIPT}
${FILTER_SCRIPT}`;
  return renderShell({
    title: `${esc(brandName)} — BERSERKER`,
    bodyContent,
    perPageStyle: renderSliderCss(filtered),
  });
}

export function renderBrandsIndexPage(brands: PrimaryBrand[]): string {
  const cards = brands
    .map(
      (b) =>
        `<a href="/${esc(b.folderSlug)}/" class="cat-card" style="display:block;text-decoration:none;">
      ${b.thumbnailUrl ? `<img src="${esc(b.thumbnailUrl)}" alt="${esc(b.name)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" decoding="async" />` : ""}
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

// Real PDPs (e.g. gymshark/gymshark-onyx-5-half-sleeve/index.html:1280-1367,
// 1750-1830) hand-author a `.pdp-grid` with a gallery column (main image +
// caption + thumbnails) and an info column (brand/title/price/cod-advance/
// swatches/size-grid/add-button/trust-badges/description), followed by a
// PDP-specific <style> block and a third <script> that hardcodes per-product
// `images[]`/`swatchList` arrays and calls `addToCart(brand, name, price,
// imgSrc)` directly (no #size-modal — that shared modal, and its
// openSizePicker()/confirmSize() flow, is only wired to `.product-add`
// buttons on cards; the PDP has always had its own inline, direct-add flow).
// `.size-btn` and `.modal-swatch` base styles, and `.trust-item`/`.trust-icon`,
// are already shared in shell.ts (the "SIZE PICKER" and "TRUST STRIP"
// sections) and are reused here unmodified rather than redefined.
//
// One reconciliation versus the real markup: the real PDP carries 2 gallery
// images per color for some products (e.g. front/back shots). This is fully
// supported: each color's swatch carries the exact list of image indices it
// owns (see colorImgIndices below), not a single index, so clicking any of a
// color's thumbs correctly highlights that color's swatch and clicking the
// swatch jumps to its cover photo.
// JSON.stringify alone is safe to interpolate into HTML attribute/text
// context (esc() handles that) but not into a raw `<script>` block: it does
// not escape "<", so admin-editable text (product name, color label) that
// happens to contain the literal sequence "</script>" would prematurely
// close the script tag and let the rest turn into live, unescaped markup --
// a stored-XSS route through the very same admin-editable columns esc()
// exists to defend (see esc()'s doc comment above). Escaping "<" to its
// unicode escape keeps the JSON valid JS while making that breakout
// impossible.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPdpPage(product: CatalogProduct): string {
  // Gallery/thumbs enumerate every uploaded photo for the product, not one
  // per color -- a product can have more photos than colors (e.g. a single
  // color with several angle shots), and those extra photos are real,
  // already-uploaded data that a per-color-only gallery would silently hide.
  // Swatches still jump the main image to that color's own designated cover
  // shot (falling back to index 0 if a color has no cover_image_id set).
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
  // The color to show as "selected" on initial page load must be the color
  // that actually owns image 0, not whichever color's (possibly empty)
  // cover happens to resolve to index 0 via colorImgIndex's -1-to-0
  // fallback -- a color with zero owned images has an empty coverImageUrl,
  // which ALSO falls back to 0, so using colorImgIndex here would mark two
  // swatches selected at once (this was the exact production bug the whole
  // plan fixed for the interactive click path -- the initial server-rendered
  // state was never converted off the same flawed check).
  const selectedIdx = Math.max(0, product.colors.findIndex((c) => colorImgIndices(c).includes(0)));
  const firstColor = product.colors[selectedIdx];
  const firstColorLabel = firstColor?.label ?? "";
  // 'variant'-mode products have no real color at all (hex null -- label
  // IS the variant text); 'color' and 'both' modes both have a real color,
  // so "Color" still correctly describes the primary thing being picked
  // even when 'both' also carries an extra variant tag. All colors on one
  // product share the same mode, so the first color alone decides this for
  // the whole page.
  const colorSectionLabel = firstColor && firstColor.hex === null ? "Variant" : "Color";

  // Thumbnail strip uses the small derivative -- clicking one still swaps the
  // main image to the full-resolution url via the images[] JS array below
  // (data-index is unchanged), so quality is unaffected, only the strip's own
  // 64x80px <img> src is.
  const thumbUrls = product.images.map((img) => img.thumbUrl);
  // Not wrapped in a <picture>/AVIF <source> -- see renderProductCard's
  // sliderImgs comment: an AVIF-capable browser locks onto that <source>
  // and shows a broken image on a 404 instead of falling back to this
  // <img>'s own src, which is what most existing images hit (no
  // thumbs-avif/ derivative yet). Reverted same-day regression, 2026-09-01.
  const thumbs = images
    .map(
      (_url, i) =>
        `<img class="pdp-thumb${i === 0 ? " active" : ""}" data-index="${i}" src="${esc(thumbUrls[i])}" alt="View ${i + 1}"${i === 0 ? "" : ' loading="lazy"'} decoding="async" />`
    )
    .join("");

  const swatches = product.colors
    .map((c, i) => {
      const imgIndex = colorImgIndex(c);
      const indicesJson = esc(JSON.stringify(colorImgIndices(c)));
      const displayText = swatchDisplayText(c);
      const textClass = displayText ? " modal-swatch-text" : "";
      const bg = c.hex ?? representativeHex(c.colorGroup);
      // Secondary color gets a small corner accent dot -- only for a
      // 'variant'-mode row (hex null), matching this feature's scope. A
      // 'both'-mode swatch already carries a real background color plus
      // the variant-text overlay; adding a third visual element there
      // would overload a 28px circle.
      const secondaryDot =
        c.hex === null && c.secondaryColorGroup
          ? `<span class="swatch-secondary-dot" style="background:${esc(representativeHex(c.secondaryColorGroup))};"></span>`
          : "";
      return `<div class="modal-swatch${textClass}${i === selectedIdx ? " selected" : ""}" style="background:${esc(bg)};" title="${esc(c.label)}" data-img-index="${imgIndex}" data-img-indices="${indicesJson}" data-variant="${esc(c.variantLabel ?? "")}">${esc(displayText)}${secondaryDot}</div>`;
    })
    .join("");

  // Real PDP hardcodes S/M/L/XL buttons regardless of stock; this rewrite
  // instead derives which size buttons exist from the first color's real
  // variant rows (every color gets all 4 sizes seeded when created, so the
  // *set* of sizes is consistent across colors -- only in_stock varies).
  // Availability itself is applied client-side per the selected color (see
  // applySizeAvailability in the script below) rather than baked in here,
  // since the initially-selected color isn't always colors[0].
  const sizeButtons = (product.colors[0]?.variants ?? [])
    .map((v) => `<button class="size-btn" data-size="${esc(v.size)}">${esc(v.size)}</button>`)
    .join("");

  const bodyContent = `
<section class="section" id="product-detail" style="padding-top:48px;">
  <div class="pdp-grid">
    <div class="pdp-gallery">
      <div class="pdp-main-img">
        <img id="pdp-main-image" src="${esc(images[0] ?? "")}" alt="${esc(product.name)} — ${esc(firstColorLabel)}" />
      </div>
      <div class="pdp-image-label" id="pdp-image-label">${esc(firstColorLabel)}</div>
      <div class="pdp-thumbs" id="pdp-thumbs">${thumbs}</div>
      <p class="pdp-insta-note">Want to see real in-hand photos before you buy? DM us on Instagram <a href="https://instagram.com/berserker.in" target="_blank" style="color:#f5f2ee;border-bottom:1px solid #333;text-decoration:none;">@berserker.in</a> and we'll send them over.</p>
    </div>
    <div class="pdp-info">
      <div class="product-brand">${esc(product.brand)}</div>
      <h1 class="pdp-title">${esc(product.name)}</h1>
      <div class="pdp-price">${formatInr(product.price)}</div>
      <div class="pdp-cod">COD Advance Amount: ${formatInr(product.codAdvance)}</div>

      <div class="pdp-section-label">${colorSectionLabel} — <span id="pdp-color-label">${esc(firstColorLabel)}</span></div>
      <div class="pdp-swatches" id="pdp-color-swatches">${swatches}</div>

      <div class="pdp-section-label">Size</div>
      <div class="pdp-size-grid" id="pdp-size-grid">${sizeButtons}</div>

      <button class="btn-primary pdp-add-btn" id="pdp-add-btn">Select Size &amp; Color</button>

      <div class="pdp-trust">
        <div class="trust-item"><span class="trust-icon">🔍</span> Quality Verified Before Dispatch</div>
        <div class="trust-item"><span class="trust-icon">🚚</span> Free Shipping, All Over India</div>
        <div class="trust-item"><span class="trust-icon">↩️</span> 24-Hour Unboxing Video Required for Claims</div>
      </div>

      <div class="pdp-description">
        <h3>Product Details</h3>
        <p>${esc(product.description ?? "")} See <a href="/shipping-info/" style="color:#f5f2ee;border-bottom:1px solid #333;text-decoration:none;">Shipping Info</a> and <a href="/returns-and-refunds/" style="color:#f5f2ee;border-bottom:1px solid #333;text-decoration:none;">Returns &amp; Refunds</a> for full policy details.</p>
      </div>
    </div>
  </div>
</section>
<script>
  (function() {
    var images = ${jsonForScript(images)};
    // Cart-image-only lookup, kept separate from images[] above: images[]
    // feeds the hero <img> and the thumb-click swap (both must stay
    // full-resolution -- this IS the main product-page image), while the
    // cart drawer/checkout only ever display this at 72x90px, so Add to
    // Cart reads the small derivative here instead.
    var pdpThumbUrls = ${jsonForScript(thumbUrls)};
    var swatchList = ${jsonForScript(product.colors.map((c) => ({ label: c.label, imgIndex: colorImgIndex(c), indices: colorImgIndices(c), variant: c.variantLabel, variants: c.variants })))};
    var mainImg = document.getElementById('pdp-main-image');
    var imageLabel = document.getElementById('pdp-image-label');
    var thumbs = document.querySelectorAll('.pdp-thumb');
    var colorSwatches = document.querySelectorAll('#pdp-color-swatches .modal-swatch');
    var colorLabel = document.getElementById('pdp-color-label');
    var sizeBtns = document.querySelectorAll('#pdp-size-grid .size-btn');
    var addBtn = document.getElementById('pdp-add-btn');

    var selectedColor = swatchList.length ? swatchList[${selectedIdx}] : null;
    var selectedSizeLocal = null;
    var currentStockBySize = {};

    // Stock is per color, not per product -- sizes stay clickable regardless
    // of stock (mirrors shell.ts's Add-to-Cart size picker: a shopper can
    // select an out-of-stock size and see that reflected on the Add to Cart
    // button, rather than the button being unselectable). Re-applied on
    // every color change, unlike the old version which only ever reflected
    // whichever color happened to be colors[0] at render time.
    function applySizeAvailability(variants) {
      currentStockBySize = {};
      (variants || []).forEach(function(v) { currentStockBySize[v.size] = v.inStock; });
      sizeBtns.forEach(function(btn) {
        var inStock = currentStockBySize.hasOwnProperty(btn.dataset.size) ? currentStockBySize[btn.dataset.size] : true;
        btn.classList.toggle('out-of-stock', !inStock);
      });
      updateAddBtn();
    }

    function setMainImage(index, label) {
      mainImg.src = images[index];
      thumbs.forEach(function(t) { t.classList.toggle('active', parseInt(t.dataset.index, 10) === index); });
      if (imageLabel) imageLabel.textContent = label || '';
    }

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

    thumbs.forEach(function(t) {
      t.addEventListener('click', function() {
        var idx = parseInt(t.dataset.index, 10);
        var owner = colorForIndex(idx);
        if (owner) {
          selectedColor = owner;
          colorLabel.textContent = owner.label;
          selectSwatchForIndex(idx);
          applySizeAvailability(owner.variants);
        }
        setMainImage(idx, owner ? owner.label : (imageLabel ? imageLabel.textContent : ''));
      });
    });

    colorSwatches.forEach(function(sw, i) {
      sw.addEventListener('click', function() {
        var imgIndex = parseInt(sw.dataset.imgIndex, 10);
        var indices = JSON.parse(sw.dataset.imgIndices || '[]');
        selectSwatchForIndex(imgIndex);
        // swatchList and colorSwatches are built from the same product.colors
        // list in the same order, so index i in one is index i in the other
        // -- this is how the click handler gets at that color's real .variants
        // (a DOM data attribute would work too, but swatchList already has it).
        var variants = swatchList[i] ? swatchList[i].variants : [];
        selectedColor = { label: sw.title, imgIndex: imgIndex, indices: indices, variant: sw.dataset.variant || null, variants: variants };
        colorLabel.textContent = sw.title;
        setMainImage(imgIndex, sw.title);
        applySizeAvailability(variants);
      });
    });

    function updateAddBtn() {
      var bothSelected = selectedSizeLocal && selectedColor;
      var inStock = !bothSelected || (currentStockBySize.hasOwnProperty(selectedSizeLocal) ? currentStockBySize[selectedSizeLocal] : true);
      addBtn.classList.toggle('ready', !!(bothSelected && inStock));
      if (!bothSelected) {
        addBtn.textContent = 'Select Size & Color';
      } else if (!inStock) {
        addBtn.textContent = 'Out of Stock';
      } else {
        addBtn.textContent = 'Add to Cart';
      }
    }

    sizeBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        sizeBtns.forEach(function(b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedSizeLocal = btn.dataset.size;
        updateAddBtn();
      });
    });

    addBtn.addEventListener('click', function() {
      if (!selectedSizeLocal) {
        if (typeof showToast === 'function') showToast('Please select a size');
        return;
      }
      if (!selectedColor) {
        if (typeof showToast === 'function') showToast('Please select a color');
        return;
      }
      var inStock = currentStockBySize.hasOwnProperty(selectedSizeLocal) ? currentStockBySize[selectedSizeLocal] : true;
      if (!inStock) return;
      var colorIdentity = selectedColor.variant ? (selectedColor.label + ' (' + selectedColor.variant + ')') : selectedColor.label;
      var name = ${jsonForScript(product.name)} + ' — ' + colorIdentity + ' / ' + selectedSizeLocal;
      var imgSrc = pdpThumbUrls[selectedColor.imgIndex];
      if (typeof addToCart === 'function') {
        addToCart(${jsonForScript(product.brand)}, name, ${product.price}, ${product.codAdvance}, imgSrc);
        if (typeof openCart === 'function') openCart();
      }
    });

    applySizeAvailability(selectedColor ? selectedColor.variants : []);
  })();
</script>`;

  // PDP-specific CSS, folded into perPageStyle rather than the shared shell
  // (mirrors renderListingPage/renderCollectionPage/renderBrandPage using
  // renderSliderCss for their own page-local CSS) since no other page type
  // needs `.pdp-*` rules. Copied from the real page's inline <style> block
  // (gymshark/gymshark-onyx-5-half-sleeve/index.html:1337-1367); `.size-btn`,
  // `.modal-swatch`, `.trust-item`, and `.trust-icon` are deliberately NOT
  // redefined here since shell.ts already carries those shared rules.
  const perPageStyle = `
  .pdp-grid { display:grid; grid-template-columns:1.1fr 1fr; gap:64px; align-items:start; }
  .pdp-main-img { overflow:hidden; background:var(--mid); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; max-height:80vh; }
  .pdp-main-img img { width:100%; height:auto; max-height:80vh; object-fit:contain; display:block; }
  .pdp-thumbs { display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
  .pdp-thumb { width:64px; height:80px; object-fit:contain; background:var(--mid); cursor:pointer; border:1px solid var(--border); opacity:.55; transition:opacity .2s, border-color .2s; }
  .pdp-thumb:hover { opacity:.85; }
  .pdp-thumb.active { opacity:1; border-color:var(--accent); }
  .pdp-image-label { text-align:center; font-family:var(--font-mono); font-size:25px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--white); margin-top:14px; }
  .pdp-insta-note { font-size:12px; color:var(--muted); line-height:1.6; margin-top:14px; max-width:420px; }
  .pdp-title { font-family:var(--font-display); font-size:clamp(32px,3.5vw,48px); letter-spacing:.02em; line-height:1.05; color:var(--white); margin:10px 0 16px; }
  .pdp-price { font-family:var(--font-display); font-size:36px; color:var(--white); letter-spacing:.03em; }
  .pdp-cod { font-family:var(--font-mono); font-size:11px; color:var(--muted); margin-top:6px; letter-spacing:.04em; }
  .pdp-section-label { font-family:var(--font-mono); font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#888; margin:28px 0 12px; }
  .pdp-swatches { display:flex; gap:10px; flex-wrap:wrap; }
  .pdp-size-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; max-width:320px; }
  .pdp-add-btn { width:100%; max-width:320px; margin-top:28px; opacity:.4; pointer-events:none; }
  .pdp-add-btn.ready { opacity:1; pointer-events:auto; }
  .pdp-trust { display:flex; flex-direction:column; gap:10px; margin-top:32px; padding-top:28px; border-top:1px solid var(--border); }
  .pdp-description { margin-top:32px; padding-top:28px; border-top:1px solid var(--border); max-width:520px; }
  .pdp-description h3 { font-family:var(--font-display); font-size:20px; letter-spacing:.04em; color:var(--white); margin-bottom:12px; }
  .pdp-description p { color:#aaa; font-size:14px; line-height:1.8; }
  @media(max-width:1100px) {
    .pdp-grid { grid-template-columns:1fr; gap:32px; }
    #product-detail { padding:60px 40px; }
  }
  @media(max-width:640px) {
    #product-detail { padding:48px 24px; }
    .pdp-thumb { width:52px; height:66px; }
  }`;

  // esc() here because renderShell (Task 2) interpolates `opts.title`
  // straight into `<title>` with no escaping of its own -- product.name is
  // admin-editable, so an unescaped title would be a stored-XSS route via
  // the <title> tag (a hostile name containing `</title><script>` would
  // otherwise break out of the tag).
  return renderShell({ title: `${esc(product.name)} — BERSERKER`, bodyContent, perPageStyle });
}
