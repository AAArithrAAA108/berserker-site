import type { Catalog, CatalogProduct } from "./data.ts";
import { brandFolderFor, isInCollection, BRAND_PREFIX_MAP } from "./membership.ts";
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

export function renderProductCard(product: CatalogProduct): string {
  const wasPrice = strikethroughPrice(product.price);
  const colorCount = product.colors.length;
  // Original hand-authored cards hardcoded slider-track/img widths in shared
  // CSS (800%/12.5%) because every card carried exactly 8 slider images.
  // Real products carry one slider image per color and color count varies
  // (2 to 10+ across the catalog), so those widths must be computed per card
  // and set inline instead of relying on a fixed shared CSS rule (shell.ts
  // Task 2 already dropped the old hardcoded rule). Guard colorCount === 0
  // so a color-less product can't divide by zero -- render an empty track.
  const trackStyle = colorCount > 0 ? ` style="width:${colorCount * 100}%;"` : "";
  const imgWidthPct = colorCount > 0 ? 100 / colorCount : 0;
  const sliderImgs = product.colors
    .map(
      (c) =>
        `<img src="${esc(c.coverImageUrl)}" alt="${esc(product.name)}" style="width:${imgWidthPct}%;" />`
    )
    .join("");
  const swatches = product.colors
    .map(
      (c, i) =>
        `<div class="swatch" style="background:${esc(c.hex ?? "#333")};" title="${esc(c.label)}" data-img-index="${i}"></div>`
    )
    .join("");
  const brandFolder = brandFolderFor(product);
  const pdpPath = brandFolder ? `/${brandFolder}/${product.slug}/` : "/all-products/";

  return `
<div class="product-card fade-in" id="product-${product.position}">
  <a href="${esc(pdpPath)}" class="product-img product-img-slider">
    <div class="slider-track"${trackStyle}>${sliderImgs}</div>
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
// Timing approach: a from-scratch reconstruction (not a byte-for-byte port
// of the original hand-authored keyframes) using equal-duration steps()
// through each color's slider image -- read against the real examples at
// all-products/index.html:868-908 for structure. The original hand-tuned a
// slide+pause percentage table per product (e.g. product-1's 8-image loop:
// "1.86% -> 12.5%, pause to 14.29%, ..."), which is inconsistent from
// product to product and encodes a fixed 8-image assumption; reproducing it
// byte-for-byte isn't meaningful for products with a different color count.
// steps(imgCount) reproduces the same instant-slide-then-pause visual
// effect for any color count while staying simple to generate/verify. One
// detail carried over from the original for fidelity: a non-hover
// `#product-N .slider-track { transform: translateX(0); transition:
// transform .4s ease; }` rule so the slider eases back to the first image on
// mouse-leave instead of snapping instantly (all-products/index.html:897-899,
// 905-908).
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
  }
  #product-${p.position} .slider-track { transform: translateX(0); transition: transform 0.4s ease; }`;
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
