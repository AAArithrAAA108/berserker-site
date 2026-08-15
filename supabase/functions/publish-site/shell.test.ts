import { renderShell } from "./shell.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("renderShell produces a complete document with the title and body content in the right places", () => {
  const html = renderShell({ title: "Test Page — BERSERKER", bodyContent: "<section>HELLO</section>" });
  assertStringIncludes(html, "<title>Test Page — BERSERKER</title>");
  assertStringIncludes(html, "<section>HELLO</section>");
  assertStringIncludes(html, "<nav>");
  assertStringIncludes(html, "</footer>");
  assertStringIncludes(html, "addToCart"); // confirms the cart script made it in
});

Deno.test("renderShell uses root-relative image paths for branding assets, not relative paths", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  assertStringIncludes(html, '/all-products/images/img-0001.png');
  assertStringIncludes(html, '/all-products/images/img-0002.jpg');
  assertStringIncludes(html, '/all-products/images/img-0378.jpg');
  if (html.includes('href="images/img-0001.png"') || html.includes('src="images/img-0002.jpg"')) {
    throw new Error("branding image paths must be root-relative, not page-relative -- would break on brand/PDP pages");
  }
});

Deno.test("renderShell injects perPageStyle into the style block", () => {
  const html = renderShell({ title: "Test", bodyContent: "", perPageStyle: ".marker-xyz { color: red; }" });
  assertStringIncludes(html, ".marker-xyz { color: red; }");
});

Deno.test("renderShell does not include the productLinks map or the all-products-only search script", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  if (html.includes("productLinks")) {
    throw new Error("productLinks map should not be in the shared shell -- it's replaced by real <a href> links in the card template");
  }
  if (html.includes("visibleCount")) {
    throw new Error("the all-products-only search-filter script should not be in the shared shell");
  }
});

Deno.test("renderShell: yellow-on-black custom scrollbar applies site-wide (covers both the page and the cart sidebar, which share the same global rule)", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  assertStringIncludes(html, "scrollbar-color: var(--accent) var(--black)");
  assertStringIncludes(html, "::-webkit-scrollbar-thumb { background: var(--accent)");
  assertStringIncludes(html, "::-webkit-scrollbar-track { background: var(--black)");
});

Deno.test("renderShell: product card thumbnails use object-fit:contain, not cover (regression: oversized/wide product photos were cropped to fill the fixed 3:4 box)", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  const cardImgRule = html.match(/\.product-img img \{[^}]*\}/);
  const sliderImgRule = html.match(/\.product-img-slider \.slider-track img \{[^}]*\}/);
  if (!cardImgRule || !sliderImgRule) throw new Error("expected both .product-img img and .product-img-slider .slider-track img rules");
  assertStringIncludes(cardImgRule[0], "object-fit: contain");
  assertStringIncludes(sliderImgRule[0], "object-fit: contain");
});

Deno.test("renderShell's slider-track CSS has no hardcoded 800%/12.5% width (must be set per-card inline instead)", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  if (html.includes("width: 800%") || html.includes("width: 12.5%")) {
    throw new Error("slider-track/img widths must not be hardcoded in the shared shell -- color count varies per product");
  }
});

Deno.test("renderShell: .product-img has display:block (regression: card template wraps it in an <a>, which is inline by default and ignores aspect-ratio)", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  const rule = html.match(/\.product-img\s*\{[^}]*\}/);
  if (!rule) throw new Error(".product-img rule not found");
  assertStringIncludes(rule[0], "display: block");
});
