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

Deno.test("renderShell's slider-track CSS has no hardcoded 800%/12.5% width (must be set per-card inline instead)", () => {
  const html = renderShell({ title: "Test", bodyContent: "" });
  if (html.includes("width: 800%") || html.includes("width: 12.5%")) {
    throw new Error("slider-track/img widths must not be hardcoded in the shared shell -- color count varies per product");
  }
});
