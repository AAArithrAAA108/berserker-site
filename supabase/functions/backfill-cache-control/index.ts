// supabase/functions/backfill-cache-control/index.ts
//
// One-off: re-uploads every object already in the product-images bucket
// with a long-lived Cache-Control header, since Storage only applies
// cacheControl at upload time -- objects uploaded before the products.js/
// brands.js fix are stuck serving the old no-cache default until their
// bytes are re-written. Deploy, invoke once, then delete this function.
//
// Invoke in batches (one invocation processing all ~782 objects hit the
// Edge Function compute/time limit -- WORKER_RESOURCE_LIMIT), advancing
// ?offset by the returned batchSize until offset >= total:
//   curl -X POST "https://<project-ref>.supabase.co/functions/v1/backfill-cache-control?offset=0&limit=40" \
//     -H "Authorization: Bearer <anon-or-service-key>" --max-time 120

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "product-images";
const CACHE_CONTROL = "31536000";

// Storage's list() is not recursive -- walks top-level product/brand
// folders first, then each folder's own files plus its thumbs/ subfolder,
// mirroring the two path shapes this bucket actually contains:
// "<slug>/<file>", "<slug>/thumbs/<file>", "_brands/<file>".
async function listAllPaths(): Promise<string[]> {
  const paths: string[] = [];
  const { data: topEntries, error: topError } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (topError) throw new Error(`list root failed: ${topError.message}`);

  for (const entry of topEntries ?? []) {
    if (entry.id === null) {
      // Folder (no id) -- list its direct files, then its thumbs/ subfolder.
      const { data: files, error: filesError } = await supabase.storage.from(BUCKET).list(entry.name, { limit: 1000 });
      if (filesError) throw new Error(`list ${entry.name} failed: ${filesError.message}`);
      for (const f of files ?? []) {
        if (f.id !== null) paths.push(`${entry.name}/${f.name}`);
      }
      const { data: thumbFiles } = await supabase.storage.from(BUCKET).list(`${entry.name}/thumbs`, { limit: 1000 });
      for (const f of thumbFiles ?? []) {
        if (f.id !== null) paths.push(`${entry.name}/thumbs/${f.name}`);
      }
    } else {
      paths.push(entry.name);
    }
  }
  return paths;
}

async function reuploadOne(path: string): Promise<void> {
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError) throw new Error(`download ${path}: ${downloadError.message}`);
  const contentType = blob.type || "application/octet-stream";
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType, cacheControl: CACHE_CONTROL, upsert: true });
  if (uploadError) throw new Error(`upload ${path}: ${uploadError.message}`);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "40");

  const allPaths = await listAllPaths();
  const batch = allPaths.slice(offset, offset + limit);

  let processed = 0;
  const failed: string[] = [];
  for (const path of batch) {
    try {
      await reuploadOne(path);
      processed++;
    } catch (err) {
      failed.push(`${path}: ${(err as Error).message}`);
    }
  }
  const nextOffset = offset + batch.length;
  return new Response(
    JSON.stringify({ total: allPaths.length, offset, batchSize: batch.length, processed, failed, nextOffset, done: nextOffset >= allPaths.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
