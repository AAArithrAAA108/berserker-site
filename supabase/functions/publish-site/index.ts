// supabase/functions/publish-site/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchCatalog } from "./data.ts";
import { renderAllProductsPage } from "./render.ts";
import { commitFiles } from "./github.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const catalog = await fetchCatalog(supabase);
    const allProductsHtml = renderAllProductsPage(catalog);

    const githubToken = Deno.env.get("GITHUB_TOKEN")!;
    const { commitSha } = await commitFiles(
      { "all-products/index.generated.html": allProductsHtml },
      `Publish: regenerate storefront from ${catalog.products.length} products`,
      githubToken
    );

    return new Response(JSON.stringify({ ok: true, commitSha, productCount: catalog.products.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
