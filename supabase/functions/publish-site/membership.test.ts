import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInCollection, brandFolderFor, COLLECTION_SLUGS, renameDeletePaths } from "./membership.ts";

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

Deno.test("renameDeletePaths: normal rename deletes the old folder page and its products' old PDPs", () => {
  const products = [
    { brandFolder: "younglainc", slug: "youngla-batman-half-sleeve" },
    { brandFolder: "younglainc", slug: "youngla-revenge-hoodie" },
    { brandFolder: "gymshark", slug: "gymshark-onyx-5-half-sleeve" },
  ];
  const result = renameDeletePaths(products, "youngla", "younglainc", ["younglainc", "gymshark"], {});
  assertEquals(result.sort(), [
    "youngla/index.html",
    "youngla/youngla-batman-half-sleeve/index.html",
    "youngla/youngla-revenge-hoodie/index.html",
  ].sort());
});

Deno.test("renameDeletePaths: refuses to delete a reserved route even if passed as renameFrom", () => {
  const result = renameDeletePaths([], "checkout", "youngla", ["youngla"], {});
  assertEquals(result, []);
});

Deno.test("renameDeletePaths: refuses to delete a folder still owned by a live primary brand (stale/racing rename)", () => {
  const result = renameDeletePaths([], "youngla", "younglainc", ["youngla", "younglainc"], {});
  assertEquals(result, []);
});

Deno.test("renameDeletePaths: never deletes a path this same publish is about to (re)write", () => {
  const products = [{ brandFolder: "younglainc", slug: "youngla-batman-half-sleeve" }];
  const files = { "youngla/index.html": "<html></html>" };
  const result = renameDeletePaths(products, "youngla", "younglainc", ["younglainc"], files);
  assertEquals(result, ["youngla/youngla-batman-half-sleeve/index.html"]);
});

Deno.test("renameDeletePaths: returns nothing when renameFrom/renameTo are absent (the normal, non-rename publish)", () => {
  assertEquals(renameDeletePaths([], undefined, undefined, [], {}), []);
});
