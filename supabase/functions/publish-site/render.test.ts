import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderProductCard, esc, renderSliderCss, renderListingPage, renderCollectionPage, renderBrandPage } from "./render.ts";
import type { CatalogProduct } from "./data.ts";
import type { Catalog } from "./data.ts";

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

// NOTE: the two Foundation-era tests that used to live here ("marks
// out-of-stock size as disabled" and "includes category and sleeve-length
// data attributes for filtering") tested markup this rewrite intentionally
// removes. Task 5's architecture filters products into separate
// collection/brand pages server-side (isInCollection/brandFolderFor), so
// cards no longer need data-category/data-sleeve/data-colors attributes for
// client-side filtering; and per this task's brief, per-size stock is no
// longer rendered as buttons on the card at all — sizing happens in the
// shared #size-modal (confirmed against shell.ts's real cart JS, which reads
// size selection from #size-modal's own .size-btn elements, not from cards).
// Superseded by the new tests below ("no size buttons on the card", "links
// to the real PDP path", etc.).

Deno.test("renderProductCard escapes admin-editable text instead of emitting raw markup", () => {
  assertEquals(esc(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;");

  const hostile: CatalogProduct = {
    ...sampleProduct,
    name: `Onyx" onload="alert(1)`,
    brand: "<script>alert(1)</script>",
    colors: [{ ...sampleProduct.colors[0], label: `Stealth "Black" & <b>bold</b>` }],
  };
  const html = renderProductCard(hostile);

  // No unescaped tag or attribute-breaking quote from the injected data survives.
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(html, 'alt="Onyx&quot; onload=&quot;alert(1)"');
  assertStringIncludes(html, 'title="Stealth &quot;Black&quot; &amp; &lt;b&gt;bold&lt;/b&gt;"');
});

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
  // Real shell CSS/JS (shell.ts) requires BOTH classes on the same element:
  // `.product-img` supplies the card's base image-box styling (aspect-ratio,
  // background) and is also the exact selector the unmodified cart JS uses
  // (`card.querySelector('.product-img img')`) to read the cart thumbnail;
  // `.product-img-slider` supplies the slider-specific overflow/position
  // rules. Combined class list (not a single "product-img-slider" class) is
  // required for both the CSS cascade and cart JS to work.
  assertStringIncludes(html, 'class="product-img product-img-slider"');
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

Deno.test("renderProductCard: slider track/img widths are inline, computed from color count (2 colors)", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'class="slider-track" style="width:200%;"');
  const imgMatches = [...html.matchAll(/<img[^>]*style="width:50%;"[^>]*>/g)];
  assertEquals(imgMatches.length, 2);
});

Deno.test("renderProductCard: slider track/img widths are inline, computed from color count (4 colors)", () => {
  const fourColorProduct: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], id: "c1", coverImageUrl: "https://example.com/1.jpg" },
      { ...twoColorProduct.colors[1], id: "c2", coverImageUrl: "https://example.com/2.jpg" },
      { ...twoColorProduct.colors[0], id: "c3", coverImageUrl: "https://example.com/3.jpg" },
      { ...twoColorProduct.colors[1], id: "c4", coverImageUrl: "https://example.com/4.jpg" },
    ],
  };
  const html = renderProductCard(fourColorProduct);
  assertStringIncludes(html, 'class="slider-track" style="width:400%;"');
  const imgMatches = [...html.matchAll(/<img[^>]*style="width:25%;"[^>]*>/g)];
  assertEquals(imgMatches.length, 4);
});

Deno.test("renderProductCard: zero colors renders an empty slider track without dividing by zero", () => {
  const zeroColorProduct: CatalogProduct = { ...twoColorProduct, colors: [] };
  const html = renderProductCard(zeroColorProduct);
  assertStringIncludes(html, 'class="slider-track"');
  // No <img> tags inside an empty slider, and no NaN/Infinity leaking into style attrs.
  if (html.includes("<img")) {
    throw new Error("expected zero <img> tags in the slider for a zero-color product");
  }
  if (html.includes("NaN") || html.includes("Infinity")) {
    throw new Error("zero-color product must not produce NaN/Infinity in inline styles");
  }
});

Deno.test("renderProductCard: falls back to /all-products/ link when brand has no known folder", () => {
  const unknownBrandProduct: CatalogProduct = { ...twoColorProduct, brand: "Some Unlisted Brand" };
  const html = renderProductCard(unknownBrandProduct);
  assertStringIncludes(html, 'href="/all-products/"');
  if (html.includes('href="/null/')) {
    throw new Error("must not emit a link to /null/...");
  }
});

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
