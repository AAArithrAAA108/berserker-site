// scripts/migrate-brand-thumbnails.ts
//
// One-off migration: uploads the 7 existing hand-authored brand thumbnails
// (brands/images/<folder_slug>.jpg) into the product-images Storage bucket
// under a _brands/ prefix, and records each path on the matching primary
// brands row. Run once, after Task 3's row backfill.
//
// Run with:
//   deno run --allow-net --allow-env --allow-read --env-file=.env.local scripts/migrate-brand-thumbnails.ts
//
// Required env vars (see .env.local):
//   SUPABASE_URL               e.g. https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role secret

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FOLDER_SLUGS = ["gymshark", "youngla", "breathedivinity", "chromehearts", "cactusjack", "skims", "lululemon"];

for (const slug of FOLDER_SLUGS) {
  const localPath = `./brands/images/${slug}.jpg`;
  const bytes = await Deno.readFile(localPath);
  const storagePath = `_brands/${slug}-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(storagePath, bytes, { contentType: "image/jpeg" });
  if (uploadError) throw new Error(`upload failed for ${slug}: ${uploadError.message}`);

  const { error: updateError } = await supabase
    .from("brands")
    .update({ thumbnail_storage_path: storagePath })
    .eq("folder_slug", slug)
    .eq("is_primary", true);
  if (updateError) throw new Error(`update failed for ${slug}: ${updateError.message}`);

  console.log(`${slug} -> ${storagePath}`);
}

console.log(`Migrated ${FOLDER_SLUGS.length} brand thumbnails.`);
