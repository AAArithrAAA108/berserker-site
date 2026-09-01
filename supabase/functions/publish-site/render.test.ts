import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderProductCard, esc, renderSliderCss, renderListingPage, renderCollectionPage, renderBrandPage, renderBrandsIndexPage, renderPdpPage, swatchDisplayText, productColorGroups } from "./render.ts";
import type { CatalogProduct, PrimaryBrand } from "./data.ts";
import type { Catalog } from "./data.ts";

const sampleProduct: CatalogProduct = {
  id: "p1", brand: "Gymshark", brandFolder: "gymshark", name: "Onyx 5.0 Seamless Compression Half Sleeve",
  slug: "gymshark-onyx-5-half-sleeve", price: 4799, codAdvance: 500, position: 1,
  category: "compression", sleeveLength: "half", description: null,
  colors: [
    {
      id: "c1", label: "Stealth Black", hex: "#1a1a1a", colorGroup: "Black", secondaryColorGroup: null, variantLabel: null,
      coverImageUrl: "https://example.supabase.co/storage/v1/object/public/product-images/gymshark-onyx-5-half-sleeve/img-0001.jpg",
      images: [{ url: "https://example.supabase.co/.../img-0001.jpg", thumbUrl: "https://example.supabase.co/.../img-0001.jpg", thumbAvifUrl: "https://example.supabase.co/.../img-0001.jpg", sortOrder: 0 }],
      variants: [
        { size: "S", inStock: true }, { size: "M", inStock: true },
        { size: "L", inStock: false }, { size: "XL", inStock: true },
      ],
    },
  ],
  images: [{ url: "https://example.supabase.co/storage/v1/object/public/product-images/gymshark-onyx-5-half-sleeve/img-0001.jpg", thumbUrl: "https://example.supabase.co/storage/v1/object/public/product-images/gymshark-onyx-5-half-sleeve/img-0001.jpg", thumbAvifUrl: "https://example.supabase.co/storage/v1/object/public/product-images/gymshark-onyx-5-half-sleeve/img-0001.jpg", sortOrder: 0 }],
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
  id: "p1", brand: "Gymshark", brandFolder: "gymshark", name: "Onyx 5.0 Seamless Compression Half Sleeve",
  slug: "gymshark-onyx-5-half-sleeve", price: 4799, codAdvance: 500, position: 1,
  category: "compression", sleeveLength: "half", description: null,
  colors: [
    {
      id: "c1", label: "Forest Green", hex: "#1a4a1a", colorGroup: "Green", secondaryColorGroup: null, variantLabel: null,
      coverImageUrl: "https://example.supabase.co/.../green.jpg",
      images: [], variants: [{ size: "S", inStock: true }],
    },
    {
      id: "c2", label: "Stealth Black", hex: "#1a1a1a", colorGroup: "Black", secondaryColorGroup: null, variantLabel: null,
      coverImageUrl: "https://example.supabase.co/.../black.jpg",
      images: [], variants: [{ size: "S", inStock: true }],
    },
  ],
  images: [
    { url: "https://example.supabase.co/.../green.jpg", thumbUrl: "https://example.supabase.co/.../green.jpg", thumbAvifUrl: "https://example.supabase.co/.../green.jpg", sortOrder: 0 },
    { url: "https://example.supabase.co/.../black.jpg", thumbUrl: "https://example.supabase.co/.../black.jpg", thumbAvifUrl: "https://example.supabase.co/.../black.jpg", sortOrder: 1 },
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

Deno.test("renderProductCard: slider <img> src uses each image's small thumbUrl, not the full-resolution url (card display is ~300px, full-res would waste egress)", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    images: [
      { url: "https://example.supabase.co/.../green-full.jpg", thumbUrl: "https://example.supabase.co/.../thumbs/green-full.jpg", thumbAvifUrl: "https://example.supabase.co/.../thumbs/green-full.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../black-full.jpg", thumbUrl: "https://example.supabase.co/.../thumbs/black-full.jpg", thumbAvifUrl: "https://example.supabase.co/.../thumbs/black-full.jpg", sortOrder: 1 },
    ],
  };
  const html = renderProductCard(product);
  assertStringIncludes(html, "thumbs/green-full.jpg");
  assertStringIncludes(html, "thumbs/black-full.jpg");
  if (html.includes('src="https://example.supabase.co/.../green-full.jpg"') || html.includes('src="https://example.supabase.co/.../black-full.jpg"')) {
    throw new Error("slider <img> src should use thumbUrl, not the full-resolution url");
  }
});

Deno.test("renderProductCard: only the first slider image has a real src -- the rest carry data-src so they aren't fetched until hover (Chrome Hearts SKUs upload 40+ photos; loading=lazy alone doesn't help since the whole card is already in-viewport)", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    images: [
      { url: "https://example.com/full-0.jpg", thumbUrl: "https://example.com/thumbs/0.jpg", thumbAvifUrl: "https://example.com/thumbs/0.jpg", sortOrder: 0 },
      { url: "https://example.com/full-1.jpg", thumbUrl: "https://example.com/thumbs/1.jpg", thumbAvifUrl: "https://example.com/thumbs/1.jpg", sortOrder: 1 },
      { url: "https://example.com/full-2.jpg", thumbUrl: "https://example.com/thumbs/2.jpg", thumbAvifUrl: "https://example.com/thumbs/2.jpg", sortOrder: 2 },
    ],
  };
  const html = renderProductCard(product);
  assertStringIncludes(html, ' src="https://example.com/thumbs/0.jpg"');
  // Leading space distinguishes a real `src=` from `data-src=` -- bare
  // `.includes('src="...")` would false-positive-match inside
  // `data-src="..."` since that string literally contains `src="..."`.
  if (html.includes(' src="https://example.com/thumbs/1.jpg"') || html.includes(' src="https://example.com/thumbs/2.jpg"')) {
    throw new Error("images after the first should not have a real src attribute -- they should be data-src only");
  }
  assertStringIncludes(html, 'data-src="https://example.com/thumbs/1.jpg"');
  assertStringIncludes(html, 'data-src="https://example.com/thumbs/2.jpg"');
});

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

Deno.test("renderProductCard: swatch data-img-index matches that color's slider position, not a color-group string", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'data-img-index="0"'); // Forest Green is the first slider image
  assertStringIncludes(html, 'data-img-index="1"'); // Stealth Black is the second
  if (html.includes('data-color-group=')) {
    throw new Error("data-color-group should no longer be emitted — real site JS reads data-img-index");
  }
});

Deno.test("renderProductCard: swatch carries that color's real per-size stock as data-variants, for the Add to Cart size picker to grey out unavailable sizes", () => {
  const mixedStockProduct: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      {
        ...twoColorProduct.colors[0],
        variants: [
          { size: "S", inStock: true },
          { size: "M", inStock: false },
        ],
      },
    ],
  };
  const html = renderProductCard(mixedStockProduct);
  assertStringIncludes(html, "data-variants=");
  // HTML-escaped JSON -- quotes come through as &quot;.
  assertStringIncludes(html, "&quot;size&quot;:&quot;S&quot;,&quot;inStock&quot;:true");
  assertStringIncludes(html, "&quot;size&quot;:&quot;M&quot;,&quot;inStock&quot;:false");
});

Deno.test("renderProductCard: slider shows every uploaded photo, and swatches point at each color's own start position, not its array index (regression: extra angle shots weren't mapped to their own color)", () => {
  const multiPhotoProduct: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      // Forest Green owns 1 photo, Stealth Black owns 2 -- variable per-color counts.
      { ...twoColorProduct.colors[0], id: "c1", coverImageUrl: "https://example.com/green-1.jpg" },
      { ...twoColorProduct.colors[1], id: "c2", coverImageUrl: "https://example.com/black-1.jpg" },
    ],
    images: [
      { url: "https://example.com/green-1.jpg", thumbUrl: "https://example.com/green-1.jpg", thumbAvifUrl: "https://example.com/green-1.jpg", sortOrder: 0 },
      { url: "https://example.com/black-1.jpg", thumbUrl: "https://example.com/black-1.jpg", thumbAvifUrl: "https://example.com/black-1.jpg", sortOrder: 1 },
      { url: "https://example.com/black-2.jpg", thumbUrl: "https://example.com/black-2.jpg", thumbAvifUrl: "https://example.com/black-2.jpg", sortOrder: 2 },
    ],
  };
  const html = renderProductCard(multiPhotoProduct);
  // Every photo appears in the slider markup regardless of whether it loads
  // eagerly (src, image 0 only) or is hover-deferred (data-src, the rest --
  // see the "only the first slider image has a real src" test above).
  const sliderImgCount = [...html.matchAll(/<img (?:src|data-src)="https:\/\/example\.com\//g)].length;
  assertEquals(sliderImgCount, 3);
  assertStringIncludes(html, "black-2.jpg"); // the extra angle shot is actually reachable
  // Forest Green's swatch points at index 0 (its own photo); Stealth Black's
  // swatch points at index 1 (its first photo), not "1" by array coincidence.
  assertStringIncludes(html, 'title="Forest Green" data-img-index="0"');
  assertStringIncludes(html, 'title="Stealth Black" data-img-index="1"');
});

Deno.test("renderProductCard: Add to Cart button carries the real codAdvance (regression: checkout charged full price for any product missing from a hardcoded table)", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, `data-cod-advance="${twoColorProduct.codAdvance}"`);
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

Deno.test("renderProductCard: slider track/img widths are inline, computed from total image count (4 images)", () => {
  const fourImageProduct: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], id: "c1", coverImageUrl: "https://example.com/1.jpg" },
      { ...twoColorProduct.colors[1], id: "c2", coverImageUrl: "https://example.com/2.jpg" },
    ],
    images: [
      { url: "https://example.com/1.jpg", thumbUrl: "https://example.com/1.jpg", thumbAvifUrl: "https://example.com/1.jpg", sortOrder: 0 },
      { url: "https://example.com/2.jpg", thumbUrl: "https://example.com/2.jpg", thumbAvifUrl: "https://example.com/2.jpg", sortOrder: 1 },
      { url: "https://example.com/3.jpg", thumbUrl: "https://example.com/3.jpg", thumbAvifUrl: "https://example.com/3.jpg", sortOrder: 2 },
      { url: "https://example.com/4.jpg", thumbUrl: "https://example.com/4.jpg", thumbAvifUrl: "https://example.com/4.jpg", sortOrder: 3 },
    ],
  };
  const html = renderProductCard(fourImageProduct);
  assertStringIncludes(html, 'class="slider-track" style="width:400%;"');
  const imgMatches = [...html.matchAll(/<img[^>]*style="width:25%;"[^>]*>/g)];
  assertEquals(imgMatches.length, 4);
});

Deno.test("renderProductCard: zero images renders an empty slider track without dividing by zero", () => {
  const zeroColorProduct: CatalogProduct = { ...twoColorProduct, colors: [], images: [] };
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
  // brand and brandFolder are independent now that brand is a real FK
  // (brand is just display text; brandFolder is the joined folder_slug) --
  // an empty brandFolder is what triggers the fallback, not an unrecognized
  // brand string.
  const unknownBrandProduct: CatalogProduct = { ...twoColorProduct, brandFolder: "" };
  const html = renderProductCard(unknownBrandProduct);
  assertStringIncludes(html, 'href="/all-products/"');
  if (html.includes('href="/null/')) {
    throw new Error("must not emit a link to /null/...");
  }
});

const sampleCatalog: Catalog = {
  products: [
    { ...twoColorProduct, id: "p1", position: 1, category: "compression", brand: "Gymshark" },
    { ...twoColorProduct, id: "p2", position: 2, category: "jacket", brand: "YoungLA × Batman", brandFolder: "youngla", slug: "yl-batman-jacket", name: "Batman Jacket" },
    { ...twoColorProduct, id: "p3", position: 3, category: "pants", brand: "Gymshark", slug: "gs-joggers", name: "Joggers" },
  ],
};

Deno.test("renderSliderCss: emits one @keyframes + hover rule per product, keyed to that product's own position", () => {
  const css = renderSliderCss(sampleCatalog.products);
  assertStringIncludes(css, "#product-1:hover .slider-track");
  assertStringIncludes(css, "@keyframes slideProduct1");
  assertStringIncludes(css, "#product-3:hover .slider-track");
});

Deno.test("renderSliderCss: uses linear easing, not steps() (regression: steps() re-subdivides every keyframe segment)", () => {
  const css = renderSliderCss(sampleCatalog.products);
  assertStringIncludes(css, "linear infinite");
  if (css.includes("steps(")) {
    throw new Error("must not use steps() timing -- it subdivides each keyframe segment into extra micro-jumps");
  }
});

Deno.test("renderSliderCss: 2-color product gets a 2.3s loop (1 transition x 0.3s slide + 2.0s hold)", () => {
  const css = renderSliderCss(sampleCatalog.products);
  // sampleCatalog's products all use twoColorProduct's 2 colors.
  assertStringIncludes(css, "animation: slideProduct1 2.3000s linear infinite");
});

Deno.test("renderSliderCss: translateX is scaled by 100/imgCount, not a flat 100% per step (regression: flat scaling overshoots the track)", () => {
  const css = renderSliderCss(sampleCatalog.products);
  // 2 colors: image 1 sits at -50% of the track's own width, not -100%.
  assertStringIncludes(css, "translateX(-50.0000%)");
  if (css.includes("translateX(-100%)") || css.includes("translateX(-100.0000%)")) {
    throw new Error("2-color slider must not translateX by a full -100% (that's the 8-image-flat-scale bug)");
  }
});

Deno.test("renderSliderCss: matches the real reference's exact keyframe percentages for an 8-image product (all-products/index.html:871-895)", () => {
  const eightColorProduct: CatalogProduct = {
    ...twoColorProduct,
    position: 9,
    colors: Array.from({ length: 8 }, (_, i) => ({ ...twoColorProduct.colors[0], id: `c${i}` })),
    images: Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}.jpg`, thumbUrl: `https://example.com/${i}.jpg`, thumbAvifUrl: `https://example.com/${i}.jpg`, sortOrder: i })),
  };
  const css = renderSliderCss([eightColorProduct]);
  assertStringIncludes(css, "animation: slideProduct9 16.1000s linear infinite");
  // Verified point-by-point against the real hand-authored keyframes.
  assertStringIncludes(css, "1.8634% { transform: translateX(-12.5000%); }");
  assertStringIncludes(css, "14.2857% { transform: translateX(-12.5000%); }");
  assertStringIncludes(css, "30.4348% { transform: translateX(-37.5000%); }");
  assertStringIncludes(css, "42.8571% { transform: translateX(-37.5000%); }");
  assertStringIncludes(css, "87.5776% { transform: translateX(-87.5000%); }");
  assertStringIncludes(css, "100% { transform: translateX(-87.5000%); }");
});

Deno.test("renderListingPage: includes every product regardless of category/brand", () => {
  const html = renderListingPage(sampleCatalog);
  assertStringIncludes(html, "Onyx 5.0 Seamless Compression Half Sleeve");
  assertStringIncludes(html, "Batman Jacket");
  assertStringIncludes(html, "Joggers");
});

Deno.test("renderListingPage: includes the ?q= search-filter script (regression: dropped entirely during the live-storefront-generation rewrite, so search silently matched nothing)", () => {
  const html = renderListingPage(sampleCatalog);
  assertStringIncludes(html, "new URLSearchParams(window.location.search)");
  assertStringIncludes(html, "params.get('q')");
  assertStringIncludes(html, "querySelectorAll('.product-card')");
  assertStringIncludes(html, "No such product in stock :(");
});

Deno.test("renderCollectionPage/renderBrandPage: do NOT include the search-filter script (listing-page-only, matching the feature's original scope)", () => {
  // "new URLSearchParams" alone no longer proves SEARCH_FILTER_SCRIPT is
  // present -- COLOR_FILTER_SCRIPT (legitimately on brand pages) also
  // reads it, to re-derive the ?q= match on every filter change, and
  // "nav-search-input" is the shared nav search box present on every page
  // regardless. "No such product in stock" is emitted only by
  // SEARCH_FILTER_SCRIPT's zero-results message -- the one real marker.
  const collectionHtml = renderCollectionPage(sampleCatalog, "jackets");
  const brandHtml = renderBrandPage(sampleCatalog, "youngla");
  for (const html of [collectionHtml, brandHtml]) {
    if (html.includes("No such product in stock")) {
      throw new Error("search-filter script should only render on the all-products listing page");
    }
  }
  if (collectionHtml.includes("new URLSearchParams")) {
    throw new Error("collection pages should have neither the search filter nor the color filter script");
  }
});

Deno.test("renderListingPage/renderBrandPage: include the sort-by dropdown (Relevance/Price asc/Price desc) and its sort script", () => {
  for (const html of [renderListingPage(sampleCatalog), renderBrandPage(sampleCatalog, "youngla")]) {
    assertStringIncludes(html, '<select id="sort-select">');
    assertStringIncludes(html, '<option value="relevance">Relevance</option>');
    assertStringIncludes(html, '<option value="price-asc">Price: Low to High</option>');
    assertStringIncludes(html, '<option value="price-desc">Price: High to Low</option>');
    assertStringIncludes(html, "document.getElementById('sort-select')");
    assertStringIncludes(html, "querySelector('.product-grid')");
  }
});

Deno.test("renderCollectionPage: does NOT include the sort-by dropdown (outside this feature's requested scope: brand pages, all-products, and search only)", () => {
  const html = renderCollectionPage(sampleCatalog, "jackets");
  if (html.includes('id="sort-select"')) {
    throw new Error("sort dropdown should not render on collection pages");
  }
});

Deno.test("renderListingPage/renderBrandPage: sort script reads price from the same bare-text-node position the cart's Add-to-Cart handler already reads (shell.ts), and relevance from the card's id=\"product-${position}\"", () => {
  const html = renderBrandPage(sampleCatalog, "youngla");
  assertStringIncludes(html, "priceEl.childNodes[0]");
  assertStringIncludes(html, "(card.id || '').replace('product-', '')");
});

// ── COLOR FILTER ──

Deno.test("productColorGroups: collects every distinct primary + secondary group across a product's colors", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], colorGroup: "Black", secondaryColorGroup: "Green" },
      { ...twoColorProduct.colors[1], colorGroup: "Navy", secondaryColorGroup: null },
    ],
  };
  const groups = productColorGroups(product);
  assertEquals(groups.sort(), ["Black", "Green", "Navy"]);
});

Deno.test("productColorGroups: deduplicates when the same group appears as primary on one color and secondary on another", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], colorGroup: "Black", secondaryColorGroup: null },
      { ...twoColorProduct.colors[1], colorGroup: "Navy", secondaryColorGroup: "Black" },
    ],
  };
  assertEquals(productColorGroups(product).sort(), ["Black", "Navy"]);
});

Deno.test("renderProductCard: carries every distinct color group as a comma-joined data-color-groups attribute, for the filter script to read", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], colorGroup: "Black", secondaryColorGroup: "Green" },
      { ...twoColorProduct.colors[1], colorGroup: "Navy", secondaryColorGroup: null },
    ],
  };
  const html = renderProductCard(product);
  assertStringIncludes(html, 'data-color-groups="Black,Green,Navy"');
});

Deno.test("renderListingPage/renderBrandPage: include a color-filter checkbox for every distinct group present in the given products, and the filter script", () => {
  // sampleCatalog's products all reuse twoColorProduct's colors: Green + Black.
  for (const html of [renderListingPage(sampleCatalog), renderBrandPage(sampleCatalog, "youngla")]) {
    assertStringIncludes(html, '<button type="button" id="filter-toggle-btn" class="filter-toggle">Filter</button>');
    assertStringIncludes(html, '<input type="checkbox" class="color-filter-checkbox" value="Black" /><span class="color-filter-swatch" style="background:#141414;"></span>Black');
    assertStringIncludes(html, '<input type="checkbox" class="color-filter-checkbox" value="Green" /><span class="color-filter-swatch" style="background:#1c8a3a;"></span>Green');
    assertStringIncludes(html, "document.querySelectorAll('.color-filter-checkbox, .sleeve-filter-checkbox')");
    assertStringIncludes(html, "card.dataset.colorGroups");
  }
});

Deno.test("renderListingPage/renderBrandPage: Color and Sleeve Length render as side-by-side facet columns, not stacked one above the other", () => {
  const html = renderListingPage(sampleCatalog);
  assertStringIncludes(html, '<div class="filter-facets">');
  assertStringIncludes(html, '<div class="filter-facet"><div class="filter-section-label">Color</div>');
  assertStringIncludes(html, '<div class="filter-facet"><div class="filter-section-label">Sleeve Length</div>');
  // Both facet columns must sit inside the same .filter-facets row, not one
  // per top-level section like the old stacked layout.
  const facetsIdx = html.indexOf('<div class="filter-facets">');
  const colorFacetIdx = html.indexOf('<div class="filter-facet"><div class="filter-section-label">Color</div>');
  const sleeveFacetIdx = html.indexOf('<div class="filter-facet"><div class="filter-section-label">Sleeve Length</div>');
  if (!(facetsIdx < colorFacetIdx && colorFacetIdx < sleeveFacetIdx)) {
    throw new Error("Color and Sleeve Length facets must both be nested inside .filter-facets, in that order");
  }
});

Deno.test("renderListingPage/renderBrandPage: include a sleeve-length checkbox for every distinct sleeve length present in the given products, and filter cards on it via AND with the color facet", () => {
  // sampleCatalog's products all reuse twoColorProduct's sleeveLength: "half".
  for (const html of [renderListingPage(sampleCatalog), renderBrandPage(sampleCatalog, "youngla")]) {
    assertStringIncludes(html, '<div class="filter-section-label">Sleeve Length</div>');
    assertStringIncludes(html, '<input type="checkbox" class="sleeve-filter-checkbox" value="half" />Half Sleeve');
    if (html.includes('value="full"') || html.includes('value="sleeveless"')) {
      throw new Error("should not offer a sleeve-length option with no matching products");
    }
    assertStringIncludes(html, "card.dataset.sleeveLength");
  }
});

Deno.test("renderProductCard: carries data-sleeve-length so the filter script can match on it, empty string when unset", () => {
  const withSleeve = renderProductCard(twoColorProduct);
  assertStringIncludes(withSleeve, 'data-sleeve-length="half"');
  const withoutSleeve = renderProductCard({ ...twoColorProduct, sleeveLength: null });
  assertStringIncludes(withoutSleeve, 'data-sleeve-length=""');
});

Deno.test("renderColorFilterBar (via renderBrandPage): each checkbox's swatch dot uses that exact group's representative hex, not a generic placeholder", () => {
  const multiGroupProduct: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], colorGroup: "Navy", secondaryColorGroup: "Gold" },
      { ...twoColorProduct.colors[1], colorGroup: "Cream", secondaryColorGroup: null },
    ],
  };
  const html = renderBrandPage({ products: [multiGroupProduct] }, "gymshark");
  assertStringIncludes(html, '<span class="color-filter-swatch" style="background:#1c2c4a;"></span>Navy');
  assertStringIncludes(html, '<span class="color-filter-swatch" style="background:#c4a01c;"></span>Gold');
  assertStringIncludes(html, '<span class="color-filter-swatch" style="background:#ede9e3;"></span>Cream');
});

Deno.test("renderListingPage/renderBrandPage: filter panel starts closed via a real CSS class toggle, not the [hidden] attribute (regression: shell.ts's own .filter-panel rule set display:flex unconditionally, and since [hidden] and .filter-panel tie in CSS specificity, this stylesheet's later position in the cascade silently kept the panel visible on page load)", () => {
  for (const html of [renderListingPage(sampleCatalog), renderBrandPage(sampleCatalog, "youngla")]) {
    assertStringIncludes(html, '<div id="filter-panel" class="filter-panel">');
    if (html.includes('id="filter-panel" class="filter-panel" hidden')) {
      throw new Error("must not rely on the [hidden] attribute for the closed state");
    }
    assertStringIncludes(html, "panel.classList.toggle('open')");
  }
});

Deno.test("renderColorFilterBar (via renderListingPage): omits a checkbox for a group with zero products on that page", () => {
  const html = renderListingPage(sampleCatalog);
  if (html.includes('value="Denim"')) {
    throw new Error("should not offer a color filter option with no matching products");
  }
});

Deno.test("renderBrandPage: emits no filter bar at all when the brand's products have no color groups and no sleeve length set (regression: an empty checkbox panel is worse than no button)", () => {
  const emptyFacetsProduct: CatalogProduct = { ...twoColorProduct, colors: [], sleeveLength: null };
  const html = renderBrandPage({ products: [emptyFacetsProduct] }, "gymshark");
  if (html.includes('id="filter-toggle-btn"')) {
    throw new Error("should not render a Filter button with nothing to filter by");
  }
});

Deno.test("renderBrandPage: still renders the filter bar (sleeve length only, no color section) when products have a sleeve length but no color groups", () => {
  const noColorProduct: CatalogProduct = { ...twoColorProduct, colors: [] };
  const html = renderBrandPage({ products: [noColorProduct] }, "gymshark");
  assertStringIncludes(html, 'id="filter-toggle-btn"');
  assertStringIncludes(html, '<div class="filter-section-label">Sleeve Length</div>');
  if (html.includes('<div class="filter-section-label">Color</div>')) {
    throw new Error("should not render an empty Color section with zero color groups");
  }
});

Deno.test("renderCollectionPage: does NOT include the color filter bar or script (outside this feature's requested scope)", () => {
  const html = renderCollectionPage(sampleCatalog, "jackets");
  if (html.includes('id="filter-toggle-btn"') || html.includes("color-filter-checkbox")) {
    throw new Error("color filter should not render on collection pages");
  }
});

Deno.test("renderCollectionPage: jackets only includes the jacket-category product", () => {
  const html = renderCollectionPage(sampleCatalog, "jackets");
  assertStringIncludes(html, "Batman Jacket");
  if (html.includes("Onyx 5.0") || html.includes("Joggers")) {
    throw new Error("jackets collection should not include compression/pants products");
  }
});

Deno.test("renderBrandPage: youngla includes the collab-brand product via its own brandFolder", () => {
  const html = renderBrandPage(sampleCatalog, "youngla");
  assertStringIncludes(html, "Batman Jacket");
  if (html.includes("Onyx 5.0") || html.includes("Joggers")) {
    throw new Error("youngla brand page should only include YoungLA-prefixed products");
  }
});

Deno.test("renderBrandPage: uses the passed brandName for its heading, falling back to the folder slug if omitted", () => {
  const withName = renderBrandPage(sampleCatalog, "youngla", "YoungLA");
  assertStringIncludes(withName, "YOUNGLA"); // heading is .toUpperCase()'d
  assertStringIncludes(withName, "<title>YoungLA — BERSERKER</title>");

  const withoutName = renderBrandPage(sampleCatalog, "youngla");
  assertStringIncludes(withoutName, "YOUNGLA");
});

Deno.test("renderBrandPage: escapes admin-editable brandName in the <title> tag (regression)", () => {
  const html = renderBrandPage(sampleCatalog, "youngla", `<script>alert(1)</script>`);
  if (html.includes("<title><script>alert(1)</script> — BERSERKER</title>")) {
    throw new Error("brandName must be HTML-escaped in the <title> tag");
  }
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt; — BERSERKER</title>");
});

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

Deno.test("renderPdpPage: thumbnail strip uses each image's small thumbUrl, but the hero image and the JS images[] swap-array stay full-resolution (a 64x80px thumb should not pay full-res egress, but the big hero image and thumb-click swap must not lose quality)", () => {
  const product: CatalogProduct = {
    ...twoColorProduct,
    images: [
      { url: "https://example.supabase.co/.../green-full.jpg", thumbUrl: "https://example.supabase.co/.../thumbs/green-full.jpg", thumbAvifUrl: "https://example.supabase.co/.../thumbs/green-full.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../black-full.jpg", thumbUrl: "https://example.supabase.co/.../thumbs/black-full.jpg", thumbAvifUrl: "https://example.supabase.co/.../thumbs/black-full.jpg", sortOrder: 1 },
    ],
  };
  const html = renderPdpPage(product);

  // Hero <img id="pdp-main-image"> must use the full-resolution url.
  assertStringIncludes(html, 'id="pdp-main-image" src="https://example.supabase.co/.../green-full.jpg"');

  // Thumbnail strip <img class="pdp-thumb"> must use the small thumbUrl.
  const thumbTagMatches = [...html.matchAll(/<img class="pdp-thumb[^>]*>/g)];
  if (thumbTagMatches.length !== 2) throw new Error(`expected 2 pdp-thumb tags, got ${thumbTagMatches.length}`);
  if (!thumbTagMatches[0][0].includes("thumbs/green-full.jpg")) throw new Error("first pdp-thumb should use its thumbUrl");
  if (!thumbTagMatches[1][0].includes("thumbs/black-full.jpg")) throw new Error("second pdp-thumb should use its thumbUrl");
  if (thumbTagMatches.some((m) => m[0].includes("full.jpg") && !m[0].includes("thumbs/"))) {
    throw new Error("pdp-thumb <img> src should never be the full-resolution url");
  }

  // The inline script's images[] array (used to swap the hero image on thumb
  // click) must stay full-resolution too -- clicking a thumb should show the
  // real photo, not the small derivative, in the hero slot.
  const scriptMatch = html.match(/var images = (\[.*?\]);/);
  if (!scriptMatch) throw new Error("expected a `var images = [...]` array in the PDP script");
  const images = JSON.parse(scriptMatch[1]);
  if (images.some((u: string) => u.includes("thumbs/"))) {
    throw new Error("the JS images[] swap-array must use full-resolution urls, not thumbUrls");
  }
});

Deno.test("renderPdpPage: preserves the direct addToCart(brand, name, price, codAdvance, imgSrc) call signature", () => {
  const html = renderPdpPage(twoColorProduct);
  assertStringIncludes(html, "addToCart(");
  // Real PDP JS calls addToCart directly with 5 positional args, no #size-modal round-trip.
  const match = html.match(/addToCart\(([^)]*)\)/);
  if (!match) throw new Error("expected an addToCart(...) call in the rendered PDP script");
  const argCount = match[1].split(",").length;
  if (argCount !== 5) {
    throw new Error(`expected addToCart to be called with 5 args (brand, name, price, codAdvance, imgSrc), got ${argCount}`);
  }
  // The shared shell script (openSizePicker/confirmSize) is always present on
  // every page, so its mere presence isn't a signal; what matters is that the
  // PDP's own #pdp-add-btn handler calls addToCart directly rather than
  // routing through openSizePicker(...).
  const addBtnHandler = html.slice(html.indexOf("addBtn.addEventListener"));
  if (addBtnHandler.slice(0, addBtnHandler.indexOf("});")).includes("openSizePicker(")) {
    throw new Error("PDP's add-to-cart button must call addToCart directly, not route through the shared #size-modal");
  }
});

Deno.test("renderPdpPage: one gallery image per color, matching the card template's data model", () => {
  const html = renderPdpPage(twoColorProduct);
  const greenPos = html.indexOf("green.jpg");
  const blackPos = html.indexOf("black.jpg");
  if (greenPos === -1 || blackPos === -1 || greenPos > blackPos) {
    throw new Error("expected green.jpg image before black.jpg image in gallery order");
  }
  const thumbMatches = [...html.matchAll(/<img class="pdp-thumb[^"]*"/g)];
  assertEquals(thumbMatches.length, 2); // one thumb per color, not a richer multi-image gallery
});

Deno.test("renderPdpPage: escapes admin-editable text (brand, name, color label, description)", () => {
  const hostile: CatalogProduct = {
    ...twoColorProduct,
    name: "<script>alert(1)</script>",
    brand: "<b>Evil</b>",
    description: '<img src=x onerror="alert(1)">',
    colors: [{ ...twoColorProduct.colors[0], label: '"><b>x</b>' }, twoColorProduct.colors[1]],
  };
  const html = renderPdpPage(hostile);
  if (html.includes("<script>alert(1)</script>") || html.includes("<b>x</b>") || html.includes('<img src=x onerror="alert(1)">')) {
    throw new Error("admin-editable text must be HTML-escaped on the PDP");
  }
});

Deno.test("renderPdpPage: price is a bare text node, no fabricated strikethrough (real PDPs render a single bare price)", () => {
  const html = renderPdpPage(twoColorProduct);
  assertStringIncludes(html, '<div class="pdp-price">₹4,799</div>');
});

Deno.test("renderPdpPage: includes the Instagram caption present on every real PDP", () => {
  const html = renderPdpPage(twoColorProduct);
  assertStringIncludes(html, 'class="pdp-insta-note"');
  assertStringIncludes(html, "@berserker.in");
});

Deno.test("renderPdpPage: out-of-stock sizes stay clickable (no disabled attribute); stock data is embedded for client-side availability styling", () => {
  const html = renderPdpPage(sampleProduct); // sampleProduct's only color has L: inStock:false
  assertStringIncludes(html, 'data-size="L">L</button>');
  if (html.includes('data-size="L" disabled')) {
    throw new Error("out-of-stock PDP sizes must stay clickable, not disabled");
  }
  assertStringIncludes(html, '"inStock":false');
});

Deno.test("renderPdpPage: zero colors renders without crashing or dividing by zero", () => {
  const noColors: CatalogProduct = { ...twoColorProduct, colors: [], images: [] };
  const html = renderPdpPage(noColors);
  assertStringIncludes(html, "Onyx 5.0 Seamless Compression Half Sleeve");
  assertStringIncludes(html, 'id="pdp-thumbs"></div>');
});

Deno.test("renderPdpPage: gallery shows every uploaded product photo, not just one per color (regression: 1-color/multi-photo products lost extra photos)", () => {
  const oneColorFourPhotos: CatalogProduct = {
    ...twoColorProduct,
    colors: [twoColorProduct.colors[0]],
    images: [
      { url: "https://example.supabase.co/.../1.jpg", thumbUrl: "https://example.supabase.co/.../1.jpg", thumbAvifUrl: "https://example.supabase.co/.../1.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../2.jpg", thumbUrl: "https://example.supabase.co/.../2.jpg", thumbAvifUrl: "https://example.supabase.co/.../2.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../3.jpg", thumbUrl: "https://example.supabase.co/.../3.jpg", thumbAvifUrl: "https://example.supabase.co/.../3.jpg", sortOrder: 2 },
      { url: "https://example.supabase.co/.../4.jpg", thumbUrl: "https://example.supabase.co/.../4.jpg", thumbAvifUrl: "https://example.supabase.co/.../4.jpg", sortOrder: 3 },
    ],
  };
  const html = renderPdpPage(oneColorFourPhotos);
  const thumbMatches = [...html.matchAll(/<img class="pdp-thumb/g)];
  assertEquals(thumbMatches.length, 4);
});

Deno.test("renderPdpPage: a color swatch's data-img-index points at that color's cover photo within the full image list", () => {
  const oneColorFourPhotos: CatalogProduct = {
    ...twoColorProduct,
    colors: [{ ...twoColorProduct.colors[0], coverImageUrl: "https://example.supabase.co/.../3.jpg" }],
    images: [
      { url: "https://example.supabase.co/.../1.jpg", thumbUrl: "https://example.supabase.co/.../1.jpg", thumbAvifUrl: "https://example.supabase.co/.../1.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../2.jpg", thumbUrl: "https://example.supabase.co/.../2.jpg", thumbAvifUrl: "https://example.supabase.co/.../2.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../3.jpg", thumbUrl: "https://example.supabase.co/.../3.jpg", thumbAvifUrl: "https://example.supabase.co/.../3.jpg", sortOrder: 2 },
      { url: "https://example.supabase.co/.../4.jpg", thumbUrl: "https://example.supabase.co/.../4.jpg", thumbAvifUrl: "https://example.supabase.co/.../4.jpg", sortOrder: 3 },
    ],
  };
  const html = renderPdpPage(oneColorFourPhotos);
  assertStringIncludes(html, 'data-img-index="2"');
});

Deno.test("renderPdpPage: a color's swatch carries its own explicit, possibly non-contiguous image indices (regression: a start+count range couldn't express interleaved ownership)", () => {
  const nonContiguous: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      {
        ...twoColorProduct.colors[0],
        coverImageUrl: "https://example.supabase.co/.../0.jpg",
        images: [
          { url: "https://example.supabase.co/.../0.jpg", thumbUrl: "https://example.supabase.co/.../0.jpg", thumbAvifUrl: "https://example.supabase.co/.../0.jpg", sortOrder: 0 },
          { url: "https://example.supabase.co/.../2.jpg", thumbUrl: "https://example.supabase.co/.../2.jpg", thumbAvifUrl: "https://example.supabase.co/.../2.jpg", sortOrder: 2 },
        ],
      },
      {
        ...twoColorProduct.colors[1],
        coverImageUrl: "https://example.supabase.co/.../1.jpg",
        images: [{ url: "https://example.supabase.co/.../1.jpg", thumbUrl: "https://example.supabase.co/.../1.jpg", thumbAvifUrl: "https://example.supabase.co/.../1.jpg", sortOrder: 1 }],
      },
    ],
    images: [
      { url: "https://example.supabase.co/.../0.jpg", thumbUrl: "https://example.supabase.co/.../0.jpg", thumbAvifUrl: "https://example.supabase.co/.../0.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../1.jpg", thumbUrl: "https://example.supabase.co/.../1.jpg", thumbAvifUrl: "https://example.supabase.co/.../1.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../2.jpg", thumbUrl: "https://example.supabase.co/.../2.jpg", thumbAvifUrl: "https://example.supabase.co/.../2.jpg", sortOrder: 2 },
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

Deno.test("renderPdpPage: a zero-image color never causes two swatches to render selected at once (regression: the initial-render path used the same -1-to-0 index fallback the interactive path was fixed to avoid)", () => {
  const zeroImageColorFirst: CatalogProduct = {
    ...twoColorProduct,
    colors: [
      { ...twoColorProduct.colors[0], label: "Denim Black", coverImageUrl: "", images: [] },
      { ...twoColorProduct.colors[1], label: "Denim Blue", coverImageUrl: "https://example.supabase.co/.../black.jpg", images: [{ url: "https://example.supabase.co/.../black.jpg", thumbUrl: "https://example.supabase.co/.../black.jpg", thumbAvifUrl: "https://example.supabase.co/.../black.jpg", sortOrder: 0 }] },
    ],
    images: [{ url: "https://example.supabase.co/.../black.jpg", thumbUrl: "https://example.supabase.co/.../black.jpg", thumbAvifUrl: "https://example.supabase.co/.../black.jpg", sortOrder: 0 }],
  };
  const html = renderPdpPage(zeroImageColorFirst);
  const selectedCount = (html.match(/class="modal-swatch selected"/g) || []).length;
  assertEquals(selectedCount, 1);
  assertStringIncludes(html, '<span id="pdp-color-label">Denim Blue</span>');
});

Deno.test("renderBrandsIndexPage: one .cat-card per brand, linking to its folder with its thumbnail and label", () => {
  const html = renderBrandsIndexPage([
    { name: "Gymshark", folderSlug: "gymshark", thumbnailUrl: "https://fake.test/_brands/gymshark-1.jpg" },
    { name: "YoungLA", folderSlug: "youngla", thumbnailUrl: "https://fake.test/_brands/youngla-1.jpg" },
  ]);
  assertStringIncludes(html, '<a href="/gymshark/" class="cat-card"');
  assertStringIncludes(html, 'src="https://fake.test/_brands/gymshark-1.jpg"');
  assertStringIncludes(html, '<div class="cat-label">Gymshark</div>');
  assertStringIncludes(html, '<a href="/youngla/" class="cat-card"');
});

// ── PRODUCT OPTIONS: color / variant / both ──
// A color-mode row (real hex, no variant_label) shows no swatch text; a
// variant-only row (hex null -- label itself IS the variant text) shows
// its label; a both-mode row (real hex + variant_label) shows the variant
// text overlaid on the real color. See swatchDisplayText's doc comment.

Deno.test("swatchDisplayText: color-only row (real hex, no variant_label) shows no text", () => {
  assertEquals(swatchDisplayText({ hex: "#1a1a1a", label: "Black", variantLabel: null }), "");
});

Deno.test("swatchDisplayText: variant-only row (hex null) shows its label as the text", () => {
  assertEquals(swatchDisplayText({ hex: null, label: "V1", variantLabel: null }), "V1");
});

Deno.test("swatchDisplayText: both-mode row (real hex + variant_label) shows the variant text, not the color label", () => {
  assertEquals(swatchDisplayText({ hex: "#1a1a1a", label: "Black", variantLabel: "V1" }), "V1");
});

const variantOnlyProduct: CatalogProduct = {
  ...twoColorProduct,
  colors: [
    { ...twoColorProduct.colors[0], label: "V1", hex: null, variantLabel: null },
    { ...twoColorProduct.colors[1], label: "V2", hex: null, variantLabel: null },
  ],
};

const bothModeProduct: CatalogProduct = {
  ...twoColorProduct,
  colors: [
    { ...twoColorProduct.colors[0], label: "Forest Green", hex: "#1a4a1a", variantLabel: "V1" },
    { ...twoColorProduct.colors[1], label: "Stealth Black", hex: "#1a1a1a", variantLabel: "V2" },
  ],
};

Deno.test("renderProductCard: card swatch carries data-variant and data-has-color so the Add to Cart popup (shell.ts) can read them", () => {
  const html = renderProductCard(bothModeProduct);
  assertStringIncludes(html, 'data-variant="V1"');
  assertStringIncludes(html, 'data-variant="V2"');
  assertStringIncludes(html, 'data-has-color="true"');
});

Deno.test("renderProductCard: variant-only row emits data-has-color=\"false\" and an empty data-variant (label itself is the variant text)", () => {
  const html = renderProductCard(variantOnlyProduct);
  assertStringIncludes(html, 'data-has-color="false"');
  assertStringIncludes(html, 'data-variant=""');
});

// ── VARIANT-MODE SWATCHES SHOW A REAL PRIMARY/SECONDARY COLOR ──
// A 'variant'-mode row (hex null) used to always render a flat "#333"
// placeholder regardless of its Primary/Secondary Color selection --
// these confirm it now derives an actual color from that data instead,
// on both the card swatch and the PDP/size-picker modal swatch.

const variantWithColorsProduct: CatalogProduct = {
  ...twoColorProduct,
  colors: [
    { ...twoColorProduct.colors[0], label: "1", hex: null, colorGroup: "Black", secondaryColorGroup: "Green", variantLabel: null },
    { ...twoColorProduct.colors[1], label: "2", hex: null, colorGroup: "Navy", secondaryColorGroup: null, variantLabel: null },
  ],
};

Deno.test("renderProductCard: variant-only card swatch background is derived from its Primary Color, not a flat placeholder", () => {
  const html = renderProductCard(variantWithColorsProduct);
  assertStringIncludes(html, 'style="background:#141414;"'); // Black
  assertStringIncludes(html, 'style="background:#1c2c4a;"'); // Navy
  if (html.includes('style="background:#333;"')) {
    throw new Error("a variant row with a real Primary Color set should never fall back to the flat placeholder");
  }
});

Deno.test("renderProductCard: variant-only card swatch carries the Secondary Color's representative hex as data-secondary-hex, resolved server-side (not the raw group name)", () => {
  const html = renderProductCard(variantWithColorsProduct);
  assertStringIncludes(html, 'data-secondary-hex="#1c8a3a"'); // Green
});

Deno.test("renderProductCard: variant-only card swatch with no Secondary Color set emits an empty data-secondary-hex", () => {
  const html = renderProductCard(variantWithColorsProduct);
  var navyCardMatch = html.match(/background:#1c2c4a;"[^>]*data-secondary-hex="([^"]*)"/);
  if (!navyCardMatch) throw new Error("could not locate the Navy swatch to check its data-secondary-hex");
  assertEquals(navyCardMatch[1], "");
});

Deno.test("renderProductCard: a color/both-mode row (real hex) is unaffected -- still uses its own hex, not a Primary-Color-derived one", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'style="background:#1a4a1a;"'); // Forest Green's own hex, unchanged
  assertStringIncludes(html, 'style="background:#1a1a1a;"'); // Stealth Black's own hex, unchanged
});

Deno.test("renderPdpPage: variant-only modal swatch background is Primary-Color-derived, and carries a swatch-secondary-dot for its Secondary Color", () => {
  const html = renderPdpPage(variantWithColorsProduct);
  assertStringIncludes(html, 'style="background:#141414;"'); // Black, selected swatch (index 0)
  assertStringIncludes(html, '<span class="swatch-secondary-dot" style="background:#1c8a3a;"></span>'); // Green accent
});

Deno.test("renderPdpPage: variant-only modal swatch with no Secondary Color set omits the swatch-secondary-dot entirely", () => {
  const singleColorNoSecondary: CatalogProduct = {
    ...variantWithColorsProduct,
    colors: [variantWithColorsProduct.colors[1]], // Navy, secondaryColorGroup: null
  };
  const html = renderPdpPage(singleColorNoSecondary);
  // renderPdpPage returns the full shell-wrapped page, which always carries
  // the shared .swatch-secondary-dot CSS rule regardless of use -- check
  // for an actual element with that class, not just the string anywhere.
  if (html.includes('class="swatch-secondary-dot"')) {
    throw new Error("should not render a secondary-color dot when no secondary color is set");
  }
});

Deno.test("renderPdpPage: both-mode swatch (real hex) never gets a swatch-secondary-dot, even if secondaryColorGroup happens to be set (would overload the swatch alongside the real color + variant-text overlay)", () => {
  const bothModeWithSecondary: CatalogProduct = {
    ...bothModeProduct,
    colors: [{ ...bothModeProduct.colors[0], secondaryColorGroup: "Red" }],
  };
  const html = renderPdpPage(bothModeWithSecondary);
  if (html.includes('class="swatch-secondary-dot"')) {
    throw new Error("both-mode (real hex) swatches should not render the variant-only secondary-color accent dot");
  }
});

Deno.test("renderProductCard: color-only row (unchanged existing behavior) emits data-has-color=\"true\" and an empty data-variant", () => {
  const html = renderProductCard(twoColorProduct);
  assertStringIncludes(html, 'data-has-color="true"');
  assertStringIncludes(html, 'data-variant=""');
});

Deno.test("renderPdpPage: variant-only product shows a \"Variant —\" section label, not \"Color —\"", () => {
  const html = renderPdpPage(variantOnlyProduct);
  assertStringIncludes(html, '<div class="pdp-section-label">Variant — <span id="pdp-color-label">V1</span></div>');
  if (html.includes('<div class="pdp-section-label">Color —')) {
    throw new Error("a pure-variant product should never show the \"Color —\" section label");
  }
});

Deno.test("renderPdpPage: color-only and both-mode products keep the \"Color —\" section label (both still have a real, pickable color)", () => {
  assertStringIncludes(renderPdpPage(twoColorProduct), '<div class="pdp-section-label">Color — <span id="pdp-color-label">Forest Green</span></div>');
  assertStringIncludes(renderPdpPage(bothModeProduct), '<div class="pdp-section-label">Color — <span id="pdp-color-label">Forest Green</span></div>');
});

Deno.test("renderPdpPage: variant-only swatch renders its label as visible text on the swatch, with the modal-swatch-text class", () => {
  const html = renderPdpPage(variantOnlyProduct);
  assertStringIncludes(html, 'class="modal-swatch modal-swatch-text selected"');
  assertStringIncludes(html, ">V1</div>");
  assertStringIncludes(html, ">V2</div>");
});

Deno.test("renderPdpPage: both-mode swatch keeps its real color background AND overlays the variant text", () => {
  const html = renderPdpPage(bothModeProduct);
  assertStringIncludes(html, 'style="background:#1a4a1a;"');
  assertStringIncludes(html, 'class="modal-swatch modal-swatch-text selected"');
  assertStringIncludes(html, ">V1</div>");
});

Deno.test("renderPdpPage: color-only swatch (unchanged existing behavior) has no modal-swatch-text class on its swatch div and no visible text", () => {
  const html = renderPdpPage(twoColorProduct);
  // renderPdpPage returns the full shell-wrapped page, which always carries
  // the shared .modal-swatch-text CSS rule regardless of use -- check the
  // swatch element's own class list, not just "does this string appear
  // anywhere on the page".
  if (html.includes('class="modal-swatch modal-swatch-text')) {
    throw new Error("a plain color-mode product's swatch divs should never carry the variant-text class");
  }
  assertStringIncludes(html, '<div class="modal-swatch selected" style="background:#1a4a1a;"');
});

Deno.test("renderPdpPage: swatchList JSON carries each color's variant field for the client-side script to build the composed cart-item name", () => {
  const html = renderPdpPage(bothModeProduct);
  assertStringIncludes(html, '"variant":"V1"');
  assertStringIncludes(html, '"variant":"V2"');
  // The color-only fixture's colors have no variant_label -- swatchList
  // should still carry the field, just null, not omit it.
  const plainHtml = renderPdpPage(twoColorProduct);
  assertStringIncludes(plainHtml, '"variant":null');
});

Deno.test("renderPdpPage: composed cart-item name folds in the variant as \"Label (Variant)\" when present, and stays plain \"Label\" when not (regression: extending the format must not change the existing color-only product's cart-item name string, since checkout parsing depends on it)", () => {
  const bothHtml = renderPdpPage(bothModeProduct);
  assertStringIncludes(bothHtml, "selectedColor.variant ? (selectedColor.label + ' (' + selectedColor.variant + ')') : selectedColor.label");
  const plainHtml = renderPdpPage(twoColorProduct);
  assertStringIncludes(plainHtml, "var colorIdentity = selectedColor.variant ? (selectedColor.label + ' (' + selectedColor.variant + ')') : selectedColor.label;");
});
