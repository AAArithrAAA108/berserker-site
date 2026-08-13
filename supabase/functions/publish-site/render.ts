import type { Catalog, CatalogProduct } from "./data.ts";
import { brandFolderFor } from "./membership.ts";

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
