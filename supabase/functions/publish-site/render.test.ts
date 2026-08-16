import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderProductCard, esc, renderSliderCss, renderListingPage, renderCollectionPage, renderBrandPage, renderBrandsIndexPage, renderPdpPage } from "./render.ts";
import type { CatalogProduct, PrimaryBrand } from "./data.ts";
import type { Catalog } from "./data.ts";

const sampleProduct: CatalogProduct = {
  id: "p1", brand: "Gymshark", brandFolder: "gymshark", name: "Onyx 5.0 Seamless Compression Half Sleeve",
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
  images: [{ url: "https://example.supabase.co/storage/v1/object/public/product-images/gymshark-onyx-5-half-sleeve/img-0001.jpg", sortOrder: 0 }],
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
  images: [
    { url: "https://example.supabase.co/.../green.jpg", sortOrder: 0 },
    { url: "https://example.supabase.co/.../black.jpg", sortOrder: 1 },
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
      { url: "https://example.com/green-1.jpg", sortOrder: 0 },
      { url: "https://example.com/black-1.jpg", sortOrder: 1 },
      { url: "https://example.com/black-2.jpg", sortOrder: 2 },
    ],
  };
  const html = renderProductCard(multiPhotoProduct);
  const sliderImgCount = [...html.matchAll(/<img src="https:\/\/example\.com\//g)].length;
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
      { url: "https://example.com/1.jpg", sortOrder: 0 },
      { url: "https://example.com/2.jpg", sortOrder: 1 },
      { url: "https://example.com/3.jpg", sortOrder: 2 },
      { url: "https://example.com/4.jpg", sortOrder: 3 },
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
    images: Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}.jpg`, sortOrder: i })),
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

Deno.test("renderPdpPage: marks an out-of-stock size as disabled", () => {
  const html = renderPdpPage(sampleProduct); // sampleProduct's only color has L: inStock:false
  assertStringIncludes(html, 'data-size="L" disabled');
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
      { url: "https://example.supabase.co/.../1.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../2.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../3.jpg", sortOrder: 2 },
      { url: "https://example.supabase.co/.../4.jpg", sortOrder: 3 },
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
      { url: "https://example.supabase.co/.../1.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../2.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../3.jpg", sortOrder: 2 },
      { url: "https://example.supabase.co/.../4.jpg", sortOrder: 3 },
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
          { url: "https://example.supabase.co/.../0.jpg", sortOrder: 0 },
          { url: "https://example.supabase.co/.../2.jpg", sortOrder: 2 },
        ],
      },
      {
        ...twoColorProduct.colors[1],
        coverImageUrl: "https://example.supabase.co/.../1.jpg",
        images: [{ url: "https://example.supabase.co/.../1.jpg", sortOrder: 1 }],
      },
    ],
    images: [
      { url: "https://example.supabase.co/.../0.jpg", sortOrder: 0 },
      { url: "https://example.supabase.co/.../1.jpg", sortOrder: 1 },
      { url: "https://example.supabase.co/.../2.jpg", sortOrder: 2 },
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
