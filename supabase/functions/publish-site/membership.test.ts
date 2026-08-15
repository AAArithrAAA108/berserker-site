import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInCollection, brandFolderFor, COLLECTION_SLUGS } from "./membership.ts";

Deno.test("isInCollection: t-shirts includes both t-shirt and compression", () => {
  assertEquals(isInCollection({ category: "t-shirt" }, "t-shirts"), true);
  assertEquals(isInCollection({ category: "compression" }, "t-shirts"), true);
  assertEquals(isInCollection({ category: "jacket" }, "t-shirts"), false);
});

Deno.test("isInCollection: compressions only includes compression", () => {
  assertEquals(isInCollection({ category: "compression" }, "compressions"), true);
  assertEquals(isInCollection({ category: "t-shirt" }, "compressions"), false);
});

Deno.test("isInCollection: the other four collections are exact 1:1", () => {
  assertEquals(isInCollection({ category: "pants" }, "pants"), true);
  assertEquals(isInCollection({ category: "jacket" }, "jackets"), true);
  assertEquals(isInCollection({ category: "dress" }, "dresses"), true);
  assertEquals(isInCollection({ category: "set" }, "sets"), true);
  assertEquals(isInCollection({ category: "jacket" }, "pants"), false);
});

Deno.test("brandFolderFor: returns the product's own brandFolder field directly, no matching", () => {
  assertEquals(brandFolderFor({ brandFolder: "youngla" }), "youngla");
});

Deno.test("COLLECTION_SLUGS has the expected count", () => {
  assertEquals(COLLECTION_SLUGS.length, 6);
});
