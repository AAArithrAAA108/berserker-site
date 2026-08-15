// scripts/verify-storefront-generation.ts
//
// One-off local verification harness for Task 8 of the live-storefront-generation
// plan. Generates all 55 storefront pages from the live database into a local
// scratch directory and does NOT touch any real site page or commit anything.
//
// Run with:
//   deno run --allow-net --allow-env --allow-read --allow-write --env-file=.env.local scripts/verify-storefront-generation.ts
//
// Required env vars (see .env.local):
//   SUPABASE_URL               e.g. https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role secret

import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchCatalog, fetchPrimaryBrands } from "../supabase/functions/publish-site/data.ts";
import {
  renderListingPage,
  renderCollectionPage,
  renderBrandPage,
  renderBrandsIndexPage,
  renderPdpPage,
} from "../supabase/functions/publish-site/render.ts";
import { COLLECTION_SLUGS, brandFolderFor } from "../supabase/functions/publish-site/membership.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const catalog = await fetchCatalog(supabase);
console.log(`Fetched ${catalog.products.length} products.`);

const outDir = "./scratch-generated-pages";
await Deno.mkdir(outDir, { recursive: true });

await Deno.writeTextFile(`${outDir}/all-products.html`, renderListingPage(catalog));
for (const slug of COLLECTION_SLUGS) {
  await Deno.writeTextFile(`${outDir}/collection-${slug}.html`, renderCollectionPage(catalog, slug));
}

const primaryBrands = await fetchPrimaryBrands(supabase);
console.log(`Fetched ${primaryBrands.length} primary brands.`);
for (const brand of primaryBrands) {
  await Deno.writeTextFile(`${outDir}/brand-${brand.folderSlug}.html`, renderBrandPage(catalog, brand.folderSlug, brand.name));
}
await Deno.writeTextFile(`${outDir}/brands.html`, renderBrandsIndexPage(primaryBrands));

for (const product of catalog.products) {
  const folder = brandFolderFor(product) ?? "unknown";
  await Deno.writeTextFile(`${outDir}/pdp-${folder}-${product.slug}.html`, renderPdpPage(product));
}

console.log(
  `Wrote ${1 + COLLECTION_SLUGS.length + primaryBrands.length + 1 + catalog.products.length} files to ${outDir}/`
);
