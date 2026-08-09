// supabase/functions/publish-site/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchCatalog } from "./data.ts";
import { renderAllProductsPage } from "./render.ts";
import { commitFiles } from "./github.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── AUTHORIZATION ────────────────────────────────────────────────────────
  // The platform's `verify_jwt` gate is NOT sufficient here: the anon/publishable
  // key is itself a valid JWT and is embedded in public client-side HTML, so any
  // visitor could read it out of page source and POST to this function, causing
  // real commits to the production repo's main branch. We therefore verify that
  // the *caller* is a signed-in admin before doing any work.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerMatch = authHeader.match(/^bearer\s+(\S+)$/i);
  if (!bearerMatch) {
    return json({ ok: false, error: "Unauthorized: missing bearer token" }, 401);
  }
  const callerJwt = bearerMatch[1];

  // A client scoped to the caller's own JWT — never the service role. The token
  // is passed to getUser() explicitly (rather than relying on a stored session,
  // which does not exist in a stateless function invocation). If the bearer
  // token is the anon/publishable key, or any other non-user token, this fails:
  // there is no `sub` claim resolving to a real auth user.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(callerJwt);
  const caller = userData?.user;
  if (userError || !caller) {
    return json({ ok: false, error: "Unauthorized: not a signed-in user" }, 401);
  }

  // Separate service-role client. Used for the admin lookup (admin_profiles is
  // not readable by non-admins under RLS, so a scoped read would be
  // indistinguishable from "row missing") and, below, for fetchCatalog.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: adminProfile, error: adminError } = await supabase
    .from("admin_profiles")
    .select("id, role")
    .eq("id", caller.id)
    .maybeSingle();

  if (adminError) {
    console.error("admin check failed", adminError);
    return json({ ok: false, error: "Admin check failed" }, 500);
  }
  if (!adminProfile) {
    return json({ ok: false, error: "Forbidden: admin privileges required" }, 403);
  }

  // ── PUBLISH ──────────────────────────────────────────────────────────────
  try {
    const catalog = await fetchCatalog(supabase);
    const allProductsHtml = renderAllProductsPage(catalog);

    const githubToken = Deno.env.get("GITHUB_TOKEN")!;
    const { commitSha } = await commitFiles(
      { "all-products/index.generated.html": allProductsHtml },
      `Publish: regenerate storefront from ${catalog.products.length} products`,
      githubToken
    );

    return json({ ok: true, commitSha, productCount: catalog.products.length });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
