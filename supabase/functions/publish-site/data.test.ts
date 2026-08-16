import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchCatalog, fetchPrimaryBrands } from "./data.ts";

// Minimal fake Supabase query builder: records .order(...) calls and, once
// awaited, applies them to the fixture rows the same way Postgres ORDER BY
// would (first key primary, later keys as tiebreakers). This lets a test
// assert on the *final row order* fetchCatalog receives -- the same thing a
// wrong/missing .order() column in the real query would get wrong.
function fakeTable(rows: Record<string, unknown>[]) {
  const orders: { column: string; ascending: boolean }[] = [];
  const filters: { column: string; value: unknown }[] = [];
  const builder = {
    select(_cols: string) {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return builder;
    },
    order(column: string, opts: { ascending: boolean }) {
      orders.push({ column, ascending: opts.ascending });
      return builder;
    },
    then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
      const filtered = rows.filter((r) => filters.every((f) => r[f.column] === f.value));
      const sorted = [...filtered].sort((a, b) => {
        for (const o of orders) {
          const av = a[o.column] as string | number;
          const bv = b[o.column] as string | number;
          if (av < bv) return o.ascending ? -1 : 1;
          if (av > bv) return o.ascending ? 1 : -1;
        }
        return 0;
      });
      resolve({ data: sorted, error: null });
    },
  };
  return builder;
}

function fakeSupabase(tables: {
  products: Record<string, unknown>[];
  product_colors: Record<string, unknown>[];
  product_images: Record<string, unknown>[];
  product_variants: Record<string, unknown>[];
  brands: Record<string, unknown>[];
}) {
  return {
    from(table: keyof typeof tables) {
      return fakeTable(tables[table]);
    },
    storage: {
      from(_bucket: string) {
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://fake.test/${path}` } };
          },
        };
      },
    }
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("fetchCatalog: orders a product's colors by created_at, not by row id (regression: swatch 1 showed 'Variant 6')", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Retro Oversized T-Shirt", slug: "ch-retro", price: 4799, cod_advance: 500, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      // Row id order (alphabetical) is the exact reverse of the real
      // intended created_at order -- this is what a random-looking UUID
      // sort produced in production.
      { id: "zzz-row", product_id: "p1", label: "Variant 3", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:02Z", color_group: "Black" },
      { id: "mmm-row", product_id: "p1", label: "Variant 2", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:01Z", color_group: "Black" },
      { id: "aaa-row", product_id: "p1", label: "Variant 1", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
    ],
    product_images: [],
    product_variants: [],
    brands: [{ id: "b1", name: "Chrome Hearts", folder_slug: "chromehearts", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const labels = catalog.products[0].colors.map((c) => c.label);
  assertEquals(labels, ["Variant 1", "Variant 2", "Variant 3"]);
});

Deno.test("fetchCatalog: colors with a tied created_at fall back to id order deterministically", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "New Product", slug: "gs-new", price: 1999, cod_advance: 200, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "b-row", product_id: "p1", label: "Second Added", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
      { id: "a-row", product_id: "p1", label: "First Added", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
    ],
    product_images: [],
    product_variants: [],
    brands: [{ id: "b1", name: "Gymshark", folder_slug: "gymshark", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const labels = catalog.products[0].colors.map((c) => c.label);
  assertEquals(labels, ["First Added", "Second Added"]);
});

Deno.test("fetchCatalog: a color with no cover assigned yet still gets a real cover from its own first assigned photo, not a broken src", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Cotton Pant", slug: "skims-cotton-pants", price: 4000, cod_advance: 500, position: 1, category: "pants", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "c1", product_id: "p1", label: "Snow White", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "White" },
    ],
    product_images: [
      { id: "img1", product_id: "p1", storage_path: "skims-cotton-pants/photo.jpg", sort_order: 0, color_id: "c1" },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Skims", folder_slug: "skims", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const color = catalog.products[0].colors[0];
  assertEquals(color.coverImageUrl, "https://fake.test/skims-cotton-pants/photo.jpg");
});

Deno.test("fetchCatalog: each color's images come only from its own explicit color_id, unassigned images belong to no color (regression: image_index ranges silently defaulted new colors to 0, colliding with an existing color's images)", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Retro Hoodie", slug: "ch-hoodie", price: 4799, cod_advance: 500, position: 1, category: "jacket", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "c1", product_id: "p1", label: "Black", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
      { id: "c2", product_id: "p1", label: "Green", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:01Z", color_group: "Green" },
    ],
    product_images: [
      // Black owns 0 and 3 (non-contiguous -- an unassigned lifestyle shot
      // and a Green photo sit between them). A range-based system could
      // never express this; explicit color_id can.
      { id: "img0", product_id: "p1", storage_path: "ch-hoodie/0.jpg", sort_order: 0, color_id: "c1" },
      { id: "img1", product_id: "p1", storage_path: "ch-hoodie/1.jpg", sort_order: 1, color_id: "c2" },
      { id: "img2", product_id: "p1", storage_path: "ch-hoodie/lifestyle.jpg", sort_order: 2, color_id: null },
      { id: "img3", product_id: "p1", storage_path: "ch-hoodie/3.jpg", sort_order: 3, color_id: "c1" },
      { id: "img4", product_id: "p1", storage_path: "ch-hoodie/4.jpg", sort_order: 4, color_id: "c2" },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Chrome Hearts", folder_slug: "chromehearts", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const [black, green] = catalog.products[0].colors;
  assertEquals(black.images.map((im) => im.url), [
    "https://fake.test/ch-hoodie/0.jpg",
    "https://fake.test/ch-hoodie/3.jpg",
  ]);
  assertEquals(green.images.map((im) => im.url), [
    "https://fake.test/ch-hoodie/1.jpg",
    "https://fake.test/ch-hoodie/4.jpg",
  ]);
  const allOwnedUrls = [...black.images, ...green.images].map((im) => im.url);
  if (allOwnedUrls.includes("https://fake.test/ch-hoodie/lifestyle.jpg")) {
    throw new Error("an unassigned (color_id: null) image must not be owned by any color");
  }
  assertEquals(
    catalog.products[0].images.map((im) => im.url).includes("https://fake.test/ch-hoodie/lifestyle.jpg"),
    true,
  );
});

Deno.test("fetchCatalog: a color's cover_image_id pointing at an image reassigned to a different color falls back to the color's own first image", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Test Product", slug: "test-product", price: 1000, cod_advance: 100, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      // cover_image_id still points at img0, but img0 has since been
      // reassigned to color c2 -- the fallback must not show another
      // color's photo as this color's cover.
      { id: "c1", product_id: "p1", label: "Black", hex: null, cover_image_id: "img0", created_at: "2026-01-01T00:00:00Z", color_group: "Black" },
      { id: "c2", product_id: "p1", label: "White", hex: null, cover_image_id: null, created_at: "2026-01-01T00:00:01Z", color_group: "White" },
    ],
    product_images: [
      { id: "img0", product_id: "p1", storage_path: "test-product/0.jpg", sort_order: 0, color_id: "c2" },
      { id: "img1", product_id: "p1", storage_path: "test-product/1.jpg", sort_order: 1, color_id: "c1" },
    ],
    product_variants: [],
    brands: [{ id: "b1", name: "Gymshark", folder_slug: "gymshark", is_primary: true, thumbnail_storage_path: null }],
  });

  const catalog = await fetchCatalog(supabase);
  const [black] = catalog.products[0].colors;
  assertEquals(black.coverImageUrl, "https://fake.test/test-product/1.jpg");
});

Deno.test("fetchCatalog: joins brand name and folder onto each product", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand_id: "b1", name: "Batman Jacket", slug: "yl-batman", price: 100, cod_advance: 10, position: 1, category: "jacket", sleeve_length: null, description: null },
    ],
    product_colors: [],
    product_images: [],
    product_variants: [],
    brands: [
      { id: "b1", name: "YoungLA × Batman", folder_slug: "youngla", is_primary: false, thumbnail_storage_path: null },
    ],
  });
  const catalog = await fetchCatalog(supabase);
  assertEquals(catalog.products[0].brand, "YoungLA × Batman");
  assertEquals(catalog.products[0].brandFolder, "youngla");
});

Deno.test("fetchPrimaryBrands: returns only primary rows, with their thumbnail URL", async () => {
  const supabase = fakeSupabase({
    products: [], product_colors: [], product_images: [], product_variants: [],
    brands: [
      { id: "b1", name: "Gymshark", folder_slug: "gymshark", is_primary: true, thumbnail_storage_path: "_brands/gymshark-1.jpg" },
      { id: "b2", name: "YoungLA × Batman", folder_slug: "youngla", is_primary: false, thumbnail_storage_path: null },
    ],
  });
  const brands = await fetchPrimaryBrands(supabase);
  assertEquals(brands, [{ name: "Gymshark", folderSlug: "gymshark", thumbnailUrl: "https://fake.test/_brands/gymshark-1.jpg" }]);
});
