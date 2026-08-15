import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchCatalog } from "./data.ts";

// Minimal fake Supabase query builder: records .order(...) calls and, once
// awaited, applies them to the fixture rows the same way Postgres ORDER BY
// would (first key primary, later keys as tiebreakers). This lets a test
// assert on the *final row order* fetchCatalog receives -- the same thing a
// wrong/missing .order() column in the real query would get wrong.
function fakeTable(rows: Record<string, unknown>[]) {
  const orders: { column: string; ascending: boolean }[] = [];
  const builder = {
    select(_cols: string) {
      return builder;
    },
    order(column: string, opts: { ascending: boolean }) {
      orders.push({ column, ascending: opts.ascending });
      return builder;
    },
    then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
      const sorted = [...rows].sort((a, b) => {
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

Deno.test("fetchCatalog: orders a product's colors by image_index, not by row id (regression: swatch 1 showed 'Variant 6')", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand: "Chrome Hearts", name: "Retro Oversized T-Shirt", slug: "ch-retro", price: 4799, cod_advance: 500, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      // Row id order (alphabetical) is the exact reverse of the real
      // intended image_index order -- this is what a random-looking UUID
      // sort produced in production.
      { id: "zzz-row", product_id: "p1", label: "Variant 3", hex: null, image_index: 2, color_group: "Black" },
      { id: "mmm-row", product_id: "p1", label: "Variant 2", hex: null, image_index: 1, color_group: "Black" },
      { id: "aaa-row", product_id: "p1", label: "Variant 1", hex: null, image_index: 0, color_group: "Black" },
    ],
    product_images: [],
    product_variants: [],
  });

  const catalog = await fetchCatalog(supabase);
  const labels = catalog.products[0].colors.map((c) => c.label);
  assertEquals(labels, ["Variant 1", "Variant 2", "Variant 3"]);
});

Deno.test("fetchCatalog: colors with a tied image_index (e.g. new admin-added colors defaulting to 0) fall back to id order deterministically", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand: "Gymshark", name: "New Product", slug: "gs-new", price: 1999, cod_advance: 200, position: 1, category: "t-shirt", sleeve_length: null, description: null },
    ],
    product_colors: [
      { id: "b-row", product_id: "p1", label: "Second Added", hex: null, image_index: 0, color_group: "Black" },
      { id: "a-row", product_id: "p1", label: "First Added", hex: null, image_index: 0, color_group: "Black" },
    ],
    product_images: [],
    product_variants: [],
  });

  const catalog = await fetchCatalog(supabase);
  const labels = catalog.products[0].colors.map((c) => c.label);
  assertEquals(labels, ["First Added", "Second Added"]);
});

Deno.test("fetchCatalog: a color with no photos yet still gets a real cover from the product's first uploaded photo, not a broken src", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand: "Skims", name: "Cotton Pant", slug: "skims-cotton-pants", price: 4000, cod_advance: 500, position: 1, category: "pants", sleeve_length: null, description: null },
    ],
    product_colors: [
      // Color created before any photo was uploaded -- image_index points
      // at position 0, which now exists.
      { id: "c1", product_id: "p1", label: "Snow White", hex: null, image_index: 0, color_group: "White" },
    ],
    product_images: [
      { id: "img1", product_id: "p1", storage_path: "skims-cotton-pants/photo.jpg", sort_order: 0 },
    ],
    product_variants: [],
  });

  const catalog = await fetchCatalog(supabase);
  const color = catalog.products[0].colors[0];
  assertEquals(color.coverImageUrl, "https://fake.test/skims-cotton-pants/photo.jpg");
});

Deno.test("fetchCatalog: each color owns every image up to the next color's image_index -- variable counts per color (regression: extra angle shots weren't mapped to their own color's swatch)", async () => {
  const supabase = fakeSupabase({
    products: [
      { id: "p1", brand: "Chrome Hearts", name: "Retro Hoodie", slug: "ch-hoodie", price: 4799, cod_advance: 500, position: 1, category: "hoodie", sleeve_length: null, description: null },
    ],
    product_colors: [
      // 1 image, 3 images, 2 images -- not a fixed count per color.
      { id: "c1", product_id: "p1", label: "Black", hex: null, image_index: 0, color_group: "Black" },
      { id: "c2", product_id: "p1", label: "Green", hex: null, image_index: 1, color_group: "Green" },
      { id: "c3", product_id: "p1", label: "Grey", hex: null, image_index: 4, color_group: "Grey" },
    ],
    product_images: Array.from({ length: 6 }, (_, i) => ({
      id: `img${i}`, product_id: "p1", storage_path: `ch-hoodie/${i}.jpg`, sort_order: i,
    })),
    product_variants: [],
  });

  const catalog = await fetchCatalog(supabase);
  const [black, green, grey] = catalog.products[0].colors;
  assertEquals(black.images.map((im) => im.url), ["https://fake.test/ch-hoodie/0.jpg"]);
  assertEquals(green.images.map((im) => im.url), [
    "https://fake.test/ch-hoodie/1.jpg",
    "https://fake.test/ch-hoodie/2.jpg",
    "https://fake.test/ch-hoodie/3.jpg",
  ]);
  assertEquals(grey.images.map((im) => im.url), [
    "https://fake.test/ch-hoodie/4.jpg",
    "https://fake.test/ch-hoodie/5.jpg",
  ]);
  // Each color's cover is its own first image, not another color's.
  assertEquals(black.coverImageUrl, "https://fake.test/ch-hoodie/0.jpg");
  assertEquals(green.coverImageUrl, "https://fake.test/ch-hoodie/1.jpg");
  assertEquals(grey.coverImageUrl, "https://fake.test/ch-hoodie/4.jpg");
});
