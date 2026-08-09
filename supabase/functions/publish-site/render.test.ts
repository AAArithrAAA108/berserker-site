import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderProductCard, esc } from "./render.ts";
import type { CatalogProduct } from "./data.ts";

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

Deno.test("renderProductCard marks out-of-stock size as disabled", () => {
  const html = renderProductCard(sampleProduct);
  assertStringIncludes(html, 'data-size="L" data-in-stock="false"');
});

Deno.test("renderProductCard includes category and sleeve-length data attributes for filtering", () => {
  const html = renderProductCard(sampleProduct);
  assertStringIncludes(html, 'data-category="compression"');
  assertStringIncludes(html, 'data-sleeve="half"');
  assertStringIncludes(html, 'data-colors="Black"');
});

Deno.test("renderProductCard escapes admin-editable text instead of emitting raw markup", () => {
  assertEquals(esc(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;");

  const hostile: CatalogProduct = {
    ...sampleProduct,
    name: `Onyx" onload="alert(1)`,
    brand: "<script>alert(1)</script>",
    category: `compression" data-x="`,
    colors: [{ ...sampleProduct.colors[0], label: `Stealth "Black" & <b>bold</b>` }],
  };
  const html = renderProductCard(hostile);

  // No unescaped tag or attribute-breaking quote from the injected data survives.
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(html, 'alt="Onyx&quot; onload=&quot;alert(1)"');
  assertStringIncludes(html, 'data-category="compression&quot; data-x=&quot;"');
  assertStringIncludes(html, 'title="Stealth &quot;Black&quot; &amp; &lt;b&gt;bold&lt;/b&gt;"');
});
