// supabase/functions/create-verified-order/order-logic.ts
//
// Pure, testable helpers for recomputing an order's real price/eligibility
// server-side instead of trusting whatever the browser sent. Kept separate
// from index.ts (DB lookups, Razorpay API call, the insert itself) so the
// actual math/parsing is covered by Deno.test without mocking a DB client,
// matching send-order-emails/email-templates.ts's split.

// Cart items are keyed by a composed display string, e.g.
// "Onyx 5.0 Compression — Black / M" (see shell.ts's confirmSize()), since
// price/cod_advance are per-product (not per-color/size) -- this string is
// enough to identify what was actually bought without needing stable
// product/color IDs threaded through every page.
//
// A product with a variant label (option_mode 'both') extends the color
// segment to "Black (V1)" -- colorLabel stays "Black", variantLabel becomes
// "V1". A pure-variant product (option_mode 'variant') has no parens at
// all: its product_colors.label IS the variant text directly (e.g. "V1"),
// so it round-trips through the plain colorLabel path unchanged, same as
// every existing color-only product's format.
export interface ParsedCartItemName {
  productName: string;
  colorLabel: string;
  variantLabel: string | null;
  size: string;
}

const VALID_SIZES = new Set(["S", "M", "L", "XL"]);
const VARIANT_SUFFIX = / \(([^()]+)\)$/;

export function parseCartItemName(name: string): ParsedCartItemName | null {
  const dashIdx = name.indexOf(" — ");
  if (dashIdx === -1) return null;
  const productName = name.slice(0, dashIdx).trim();
  const rest = name.slice(dashIdx + 3);
  const slashIdx = rest.lastIndexOf(" / ");
  if (slashIdx === -1) return null;
  let colorLabel = rest.slice(0, slashIdx).trim();
  const size = rest.slice(slashIdx + 3).trim();

  let variantLabel: string | null = null;
  const variantMatch = colorLabel.match(VARIANT_SUFFIX);
  if (variantMatch) {
    variantLabel = variantMatch[1].trim();
    colorLabel = colorLabel.slice(0, variantMatch.index).trim();
    if (!variantLabel) return null;
  }

  if (!productName || !colorLabel || !VALID_SIZES.has(size)) return null;
  return { productName, colorLabel, variantLabel, size };
}

export interface ResolvedItem {
  qty: number;
  price: number; // canonical products.price, never the client's number
  codAdvance: number; // canonical products.cod_advance
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  orderTotal: number;
  codTotal: number;
}

// Mirrors checkout/review/index.html's client-side totals math exactly
// (subtotal/codTotal accumulate pre-discount, discount is a flat percentage
// of subtotal) so the server's number matches what the shopper was shown --
// just computed from prices the server trusts instead of the client's.
export function computeOrderTotals(items: ResolvedItem[], discountPercent: number): OrderTotals {
  let subtotal = 0;
  let codTotal = 0;
  for (const item of items) {
    subtotal += item.price * item.qty;
    codTotal += item.codAdvance * item.qty;
  }
  const discount = Math.round(subtotal * (discountPercent / 100));
  const orderTotal = subtotal - discount;
  return { subtotal, discount, orderTotal, codTotal };
}

export interface PaymentSplit {
  amountPaid: number;
  balanceDue: number;
}

// Mirrors checkout/review/index.html's pay-btn handler: COD charges the
// lesser of the accumulated cod_advance total or the (already-discounted)
// order total, never more than what's actually owed.
export function computePaymentSplit(paymentMethod: "full" | "cod", orderTotal: number, codTotal: number): PaymentSplit {
  if (paymentMethod === "full") {
    return { amountPaid: orderTotal, balanceDue: 0 };
  }
  const amountPaid = Math.min(codTotal, orderTotal);
  const balanceDue = Math.max(orderTotal - amountPaid, 0);
  return { amountPaid, balanceDue };
}
