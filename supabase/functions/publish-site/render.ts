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
