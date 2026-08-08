// scripts/migrate-images-to-storage.ts
//
// One-off migration: uploads existing per-product images (currently
// committed as files under `<brand>/<product-slug>/images/*`) into the
// Supabase Storage bucket `product-images`.
//
// Scope: only per-product image folders are migrated. This repo also has
// several *shared* image pools that are referenced by index from listing
// pages rather than owned by a single product — `all-products/images/`,
// each brand's own `<brand>/images/`, and `collections/<category>/images/`
// (plus small one-off dirs like `brands/images/` for brand logos). Those are
// intentionally left alone: they don't map 1:1 to a product slug, and this
// task only needs to populate `product_images` / `product_colors.cover_image_id`
// with structured per-product data. A later task decides how to source
// images for the all-products/listing pages themselves.
//
// A folder is considered "per-product" if the directory name immediately
// containing the `images/` folder matches an actual `products.slug` value
// (fetched from the DB at run time), e.g. `gymshark/gymshark-onyx-5-half-sleeve/images/`.
// This naturally excludes brand-level and collection-level pools (their
// parent dir names — "gymshark", "pants", "all-products", etc. — are never
// product slugs).
//
// Run with:
//   deno run --allow-net --allow-env --allow-read scripts/migrate-images-to-storage.ts
//
// Required env vars:
//   SUPABASE_URL               e.g. https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role secret (Storage writes require it;
//                               the anon/publishable key cannot write to Storage)

import { createClient } from "npm:@supabase/supabase-js@2";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// The worktree checkout this migration script lives in. Deliberately NOT
// the top-level `berserker-site` checkout: that directory contains a
// `.worktrees/` subfolder with a nested copy of this same repo, and walking
// from there would upload every image twice.
const REPO_ROOT = "C:\\Users\\anind\\berserker-site\\.worktrees\\admin-storefront-overhaul";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface ImageFile {
  productSlug: string;
  localPath: string;
  fileName: string;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function fetchProductSlugs(): Promise<Set<string>> {
  const { data, error } = await supabase.from("products").select("slug");
  if (error) throw new Error(`Failed to fetch product slugs: ${error.message}`);
  return new Set((data ?? []).map((row: { slug: string }) => row.slug));
}

async function findProductImages(slugs: Set<string>): Promise<ImageFile[]> {
  const results: ImageFile[] = [];
  const skipped = new Set<string>();
  for await (
    const entry of walk(REPO_ROOT, {
      match: [/images[\\/][^\\/]+\.(jpg|jpeg|png|webp)$/i],
      skip: [/[\\/]\.git[\\/]/, /[\\/]node_modules[\\/]/],
    })
  ) {
    if (!entry.isFile) continue;
    const parts = entry.path.split(/[\\/]/);
    const imagesIdx = parts.lastIndexOf("images");
    const productSlug = parts[imagesIdx - 1] ?? "unknown";
    if (!slugs.has(productSlug)) {
      skipped.add(productSlug);
      continue;
    }
    results.push({ productSlug, localPath: entry.path, fileName: parts[parts.length - 1] });
  }
  if (skipped.size > 0) {
    console.log(
      `Skipped ${skipped.size} non-product image folder(s) (shared pools, out of scope): ${
        [...skipped].sort().join(", ")
      }`,
    );
  }
  return results;
}

async function uploadOne(img: ImageFile): Promise<string> {
  const bytes = await Deno.readFile(img.localPath);
  const storagePath = `${img.productSlug}/${img.fileName}`;
  const ext = img.fileName.split(".").pop()!.toLowerCase();
  const { error } = await supabase.storage
    .from("product-images")
    .upload(storagePath, bytes, { upsert: true, contentType: CONTENT_TYPES[ext] ?? "application/octet-stream" });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  return storagePath;
}

async function main() {
  const slugs = await fetchProductSlugs();
  console.log(`Loaded ${slugs.size} product slugs from the database.`);

  const images = await findProductImages(slugs);
  console.log(`Found ${images.length} per-product images to migrate.`);

  let uploaded = 0;
  const failures: string[] = [];
  for (const img of images) {
    try {
      await uploadOne(img);
      uploaded++;
      if (uploaded % 20 === 0) console.log(`${uploaded}/${images.length} uploaded...`);
    } catch (err) {
      failures.push(`${img.productSlug}/${img.fileName}: ${(err as Error).message}`);
    }
  }

  console.log(`Done. Uploaded ${uploaded}/${images.length} images.`);
  if (failures.length > 0) {
    console.log(`Failures (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("Now run the product_images population SQL from Task 9 Step 5.");
}

await main();
