// supabase/functions/create-verified-order/index.ts
//
// Replaces the storefront's old direct `create_order` RPC call. That RPC
// trusted whatever pricing and razorpay_payment_id the browser sent -- an
// attacker could edit localStorage or DevTools-replay the request with any
// price/total/payment id they liked, since nothing server-side ever
// recomputed or verified it. This function is the new trust boundary:
// every price comes from the products table, every payment id is checked
// against Razorpay's own API before an order is ever inserted.
//
// Deployed with default verify_jwt (unlike send-order-emails/pg_net) --
// the storefront calls this via supabase-js's sb.functions.invoke(), which
// attaches the anon key as a real JWT the platform can verify.
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseCartItemName, computeOrderTotals, computePaymentSplit } from "./order-logic.ts";

const MAX_QTY_PER_ITEM = 5; // matches the UI's own per-item cap (shell.ts: existing.qty >= 5)
const RATE_LIMIT_MAX_ATTEMPTS = 8;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface RequestItem {
  brand: string;
  name: string;
  qty: number;
  imgSrc?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const customer = body?.customer ?? {};
  const address = body?.address ?? {};
  const items: RequestItem[] = Array.isArray(body?.items) ? body.items : [];
  const couponCode: string | null = body?.coupon_code || null;
  const paymentMethod = body?.payment_method;
  const razorpayPaymentId: string | null = body?.razorpay_payment_id || null;

  if (!customer.name || !customer.phone) {
    return json({ ok: false, error: "customer.name and customer.phone are required" }, 400);
  }
  if (!address.line1 || !address.city || !address.state || !address.pincode || !address.country) {
    return json({ ok: false, error: "address is incomplete" }, 400);
  }
  if (items.length === 0) {
    return json({ ok: false, error: "cart is empty" }, 400);
  }
  if (paymentMethod !== "full" && paymentMethod !== "cod") {
    return json({ ok: false, error: "payment_method must be 'full' or 'cod'" }, 400);
  }
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY_PER_ITEM) {
      return json({ ok: false, error: `invalid quantity for "${item.name}"` }, 400);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Rate limit by IP: rejects a burst of order-creation attempts (e.g. a
  // script probing for valid product/color/size combinations) before doing
  // any of the more expensive DB lookups or a Razorpay API call below.
  // Real shoppers retrying a failed payment a couple of times never come
  // close to this threshold.
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentAttempts } = await supabase
    .from("order_creation_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_address", clientIp)
    .gte("created_at", windowStart);
  if ((recentAttempts ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
    return json({ ok: false, error: "Too many order attempts. Please wait a few minutes and try again." }, 429);
  }
  await supabase.from("order_creation_attempts").insert({ ip_address: clientIp });
  // Opportunistic cleanup so this table doesn't grow unbounded -- cheap at
  // this traffic volume, no cron needed.
  await supabase.from("order_creation_attempts").delete().lt("created_at", new Date(Date.now() - RATE_LIMIT_CLEANUP_MAX_AGE_MS).toISOString());

  // Resolve every cart item against the real catalog -- this is what makes
  // price/stock trustworthy. Any failure here rejects the whole order
  // rather than silently dropping or repricing the bad item.
  const resolved: { qty: number; price: number; codAdvance: number; brand: string; name: string; imgSrc?: string }[] = [];
  for (const item of items) {
    const parsed = parseCartItemName(item.name);
    if (!parsed) {
      return json({ ok: false, error: `could not parse cart item "${item.name}"` }, 400);
    }

    const { data: brand } = await supabase.from("brands").select("id, name").eq("name", item.brand?.trim()).maybeSingle();
    if (!brand) {
      return json({ ok: false, error: `unknown brand "${item.brand}"` }, 400);
    }

    const { data: product } = await supabase
      .from("products")
      .select("id, price, cod_advance")
      .eq("brand_id", brand.id)
      .eq("name", parsed.productName)
      .maybeSingle();
    if (!product) {
      return json({ ok: false, error: `unknown product "${parsed.productName}" for brand "${item.brand}"` }, 400);
    }

    // variant_label disambiguates a 'both'-mode product where the same
    // color label can carry more than one variant (e.g. "Black" + "V1" vs
    // "Black" + "V2" are two distinct purchasable rows) -- matching on
    // label alone could return more than one row for those.
    let colorQuery = supabase
      .from("product_colors")
      .select("id, label")
      .eq("product_id", product.id)
      .eq("label", parsed.colorLabel);
    colorQuery = parsed.variantLabel
      ? colorQuery.eq("variant_label", parsed.variantLabel)
      : colorQuery.is("variant_label", null);
    const { data: color } = await colorQuery.maybeSingle();
    if (!color) {
      const colorDesc = parsed.variantLabel ? `${parsed.colorLabel} (${parsed.variantLabel})` : parsed.colorLabel;
      return json({ ok: false, error: `unknown color "${colorDesc}" for "${parsed.productName}"` }, 400);
    }

    const { data: variant } = await supabase
      .from("product_variants")
      .select("in_stock")
      .eq("product_id", product.id)
      .eq("color_id", color.id)
      .eq("size", parsed.size)
      .maybeSingle();
    if (!variant || !variant.in_stock) {
      const colorDesc = parsed.variantLabel ? `${parsed.colorLabel} (${parsed.variantLabel})` : parsed.colorLabel;
      return json({ ok: false, error: `"${parsed.productName} — ${colorDesc} / ${parsed.size}" is out of stock` }, 409);
    }

    resolved.push({
      qty: item.qty,
      price: Number(product.price),
      codAdvance: Number(product.cod_advance),
      brand: brand.name,
      name: item.name,
      imgSrc: item.imgSrc,
    });
  }

  // Re-validate the coupon server-side (same rules as the public
  // validate_coupon RPC) rather than trusting a client-supplied discount.
  let discountPercent = 0;
  let appliedCouponCode: string | null = null;
  if (couponCode) {
    const totalQty = resolved.reduce((a, i) => a + i.qty, 0);
    const { data: couponResult } = await supabase.rpc("validate_coupon", { p_code: couponCode, p_qty: totalQty });
    const row = Array.isArray(couponResult) ? couponResult[0] : couponResult;
    if (row?.valid) {
      discountPercent = Number(row.discount_percent);
      appliedCouponCode = couponCode.toUpperCase();
    }
    // An invalid/expired coupon is not a hard error -- it just doesn't
    // apply, same as if the shopper had never entered a working code.
  }

  const { subtotal, discount, orderTotal, codTotal } = computeOrderTotals(resolved, discountPercent);
  const { amountPaid, balanceDue } = computePaymentSplit(paymentMethod, orderTotal, codTotal);

  if (amountPaid > 0) {
    if (!razorpayPaymentId) {
      return json({ ok: false, error: "payment verification failed: no payment id provided" }, 402);
    }
    const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const auth = "Basic " + btoa(`${keyId}:${keySecret}`);
    const rpRes = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}`, {
      headers: { Authorization: auth },
    });
    if (!rpRes.ok) {
      return json({ ok: false, error: "payment verification failed: could not look up payment" }, 402);
    }
    const payment = await rpRes.json();
    const expectedPaise = Math.round(amountPaid * 100);
    if (payment.status !== "captured" || payment.amount !== expectedPaise || payment.currency !== "INR") {
      return json({ ok: false, error: "payment verification failed: amount/status mismatch" }, 402);
    }

    // Reject replay of an already-used payment id (e.g. the same captured
    // payment submitted twice to mint a second order for free).
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("order_number")
      .eq("razorpay_payment_id", razorpayPaymentId)
      .maybeSingle();
    if (existingOrder) {
      return json({ ok: false, error: "this payment has already been used for an order" }, 409);
    }
  }

  const orderItems = resolved.map((i) => ({ brand: i.brand, name: i.name, qty: i.qty, price: i.price, imgSrc: i.imgSrc }));

  const { data: inserted, error: insertError } = await supabase
    .from("orders")
    .insert({
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email || null,
      address_line1: address.line1,
      address_line2: address.line2 || null,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
      items: orderItems,
      subtotal,
      discount,
      coupon_code: appliedCouponCode,
      order_total: orderTotal,
      payment_method: paymentMethod,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      razorpay_payment_id: razorpayPaymentId,
    })
    .select("order_number")
    .single();

  if (insertError || !inserted) {
    return json({ ok: false, error: `order creation failed: ${insertError?.message ?? "unknown error"}` }, 500);
  }

  return json({ ok: true, order_number: inserted.order_number });
});
