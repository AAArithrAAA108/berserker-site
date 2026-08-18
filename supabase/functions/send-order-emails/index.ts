// supabase/functions/send-order-emails/index.ts
//
// Invoked by a Postgres AFTER INSERT trigger on `orders` (see migration
// 20260818200000_order_email_webhook.sql), via pg_net's async net.http_post
// -- not by the browser and not gated by Supabase's platform verify_jwt
// (deployed with --no-verify-jwt, matching pg_net's own auth model: it
// can't attach a user JWT, only whatever headers the trigger sets). The
// bearer secret below is this function's own authorization gate instead.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  renderOwnerEmailHtml,
  renderCustomerEmailHtml,
  ownerEmailSubject,
  customerEmailSubject,
  type OrderRecord,
} from "./email-templates.ts";

const OWNER_EMAIL = "support@berserker.in";
const FROM_ADDRESS = "BERSERKER <support@berserker.in>";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Shared-secret check -- this function only ever receives calls from the
  // orders-insert trigger, which reads the same secret out of Supabase
  // Vault. Not a Supabase user JWT (there is no user here), so this is the
  // function's real authorization gate, not platform verify_jwt.
  const webhookSecret = Deno.env.get("ORDER_EMAIL_WEBHOOK_SECRET");
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!webhookSecret || authHeader !== `Bearer ${webhookSecret}`) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let orderNumber: number;
  try {
    const body = await req.json();
    orderNumber = Number(body?.order_number);
    if (!orderNumber || Number.isNaN(orderNumber)) throw new Error("missing or invalid order_number");
  } catch (err) {
    return json({ ok: false, error: `Invalid request body: ${err}` }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (orderError || !order) {
    return json({ ok: false, error: `Order not found: ${orderError?.message ?? orderNumber}` }, 404);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

  async function sendEmail(to: string, subject: string, html: string) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Resend API error (${to}): ${res.status} ${body?.message ?? "no message"}`);
    }
    return body;
  }

  const orderRecord = order as OrderRecord;
  const results: { owner: string; customer: string } = { owner: "skipped", customer: "skipped" };
  const errors: string[] = [];

  try {
    await sendEmail(OWNER_EMAIL, ownerEmailSubject(orderRecord), renderOwnerEmailHtml(orderRecord));
    results.owner = "sent";
  } catch (err) {
    console.error("owner email failed", err);
    errors.push(String(err));
  }

  if (orderRecord.customer_email) {
    try {
      await sendEmail(orderRecord.customer_email, customerEmailSubject(orderRecord), renderCustomerEmailHtml(orderRecord));
      results.customer = "sent";
    } catch (err) {
      console.error("customer email failed", err);
      errors.push(String(err));
    }
  }

  return json({ ok: errors.length === 0, orderNumber, results, errors: errors.length ? errors : undefined });
});
