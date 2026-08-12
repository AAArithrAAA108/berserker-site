import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInCollection, brandFolderFor, COLLECTION_SLUGS, BRAND_FOLDERS } from "./membership.ts";

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

Deno.test("brandFolderFor: exact brand name matches its folder", () => {
  assertEquals(brandFolderFor({ brand: "Gymshark" }), "gymshark");
  assertEquals(brandFolderFor({ brand: "Skims" }), "skims");
});

Deno.test("brandFolderFor: collab brand text still matches via prefix", () => {
  assertEquals(brandFolderFor({ brand: "YoungLA × Batman" }), "youngla");
  assertEquals(brandFolderFor({ brand: "YoungLA × Superman" }), "youngla");
  assertEquals(brandFolderFor({ brand: "YoungLA × Gold's Gym" }), "youngla");
  assertEquals(brandFolderFor({ brand: "Chrome Hearts × Mastermind" }), "chromehearts");
  assertEquals(brandFolderFor({ brand: "Cactus Jack x Travis Scott" }), "cactusjack");
});

Deno.test("brandFolderFor: unmatched brand returns null", () => {
  assertEquals(brandFolderFor({ brand: "Some Random Brand" }), null);
});

Deno.test("COLLECTION_SLUGS and BRAND_FOLDERS have the expected counts", () => {
  assertEquals(COLLECTION_SLUGS.length, 6);
  assertEquals(BRAND_FOLDERS.length, 7);
});
