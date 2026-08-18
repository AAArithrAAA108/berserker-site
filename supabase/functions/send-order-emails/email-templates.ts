// supabase/functions/send-order-emails/email-templates.ts
//
// Pure, testable HTML-building functions for the two order emails. Kept
// separate from index.ts (the network-IO orchestration layer -- DB read,
// Resend API call, auth check) so the actual formatted content can be
// covered by Deno.test the same way render.ts's rendering functions are,
// without needing to mock an HTTP client. index.ts stays untested,
// matching this project's existing publish-site/index.ts precedent for
// orchestration-heavy Edge Function entrypoints.

export interface OrderItem {
  brand: string;
  name: string;
  qty: number;
  price: number;
}

export interface OrderRecord {
  order_number: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  coupon_code: string | null;
  order_total: number;
  payment_method: "full" | "cod";
  amount_paid: number;
  balance_due: number;
  razorpay_payment_id: string | null;
}

// Escapes text that ultimately comes from an admin/customer-editable source
// (name, address, coupon code) before it's interpolated into email HTML --
// same threat model and escaping rules as render.ts's esc() for the
// storefront, applied here so a name/address containing `<`, `>`, `&`, `"`
// or `'` can't break the email's HTML structure.
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatInr(amount: number): string {
  return "₹" + Number(amount).toLocaleString("en-IN");
}

function renderItemsList(items: OrderItem[]): string {
  if (!items.length) return "<li>(no items)</li>";
  return items
    .map((i) => `<li>${esc(i.brand)} — ${esc(i.name)} × ${i.qty} (${formatInr(i.price)})</li>`)
    .join("");
}

function renderAddress(order: OrderRecord): string {
  const line2 = order.address_line2 ? `, ${esc(order.address_line2)}` : "";
  return `${esc(order.address_line1)}${line2}, ${esc(order.city)}, ${esc(order.state)} ${esc(order.pincode)}, ${esc(order.country)}`;
}

function renderPaymentSummary(order: OrderRecord): string {
  const method = order.payment_method === "cod" ? "Cash on Delivery" : "Full payment online";
  const balance = order.balance_due > 0 ? `, balance due on delivery: ${formatInr(order.balance_due)}` : "";
  return `${method} — paid now: ${formatInr(order.amount_paid)}${balance}`;
}

function renderDiscountLine(order: OrderRecord): string {
  if (!(order.discount > 0)) return "";
  const code = order.coupon_code ? `, code ${esc(order.coupon_code)}` : "";
  return ` (discount: -${formatInr(order.discount)}${code})`;
}

export function renderOwnerEmailHtml(order: OrderRecord): string {
  return `
<h2>New Order #${order.order_number}</h2>
<p><strong>Customer:</strong> ${esc(order.customer_name)} — ${esc(order.customer_phone)}${order.customer_email ? " — " + esc(order.customer_email) : ""}</p>
<p><strong>Address:</strong> ${renderAddress(order)}</p>
<p><strong>Items:</strong></p>
<ul>${renderItemsList(order.items)}</ul>
<p><strong>Subtotal:</strong> ${formatInr(order.subtotal)}${renderDiscountLine(order)}</p>
<p><strong>Order Total:</strong> ${formatInr(order.order_total)}</p>
<p><strong>Payment:</strong> ${renderPaymentSummary(order)}</p>
${order.razorpay_payment_id ? `<p><strong>Razorpay Payment ID:</strong> ${esc(order.razorpay_payment_id)}</p>` : ""}
`.trim();
}

export function ownerEmailSubject(order: OrderRecord): string {
  return `New Order #${order.order_number} — ${formatInr(order.order_total)}`;
}

// Per docs/superpowers/specs/2026-08-08-admin-storefront-overhaul-design.md
// Phase 5 and the live Shipping Info page's own "STANDARD DELIVERY WINDOW"
// section (shipping-info/index.html) -- kept as one named constant so a
// future policy change only needs updating in one place per file.
export const ESTIMATED_SHIPPING_WINDOW = "35–45 days";

export function renderCustomerEmailHtml(order: OrderRecord): string {
  const balanceLine =
    order.balance_due > 0 ? `<p><strong>Balance due on delivery:</strong> ${formatInr(order.balance_due)}</p>` : "";
  return `
<h2>Thanks for your order, ${esc(order.customer_name)}!</h2>
<p>Your BERSERKER order <strong>#${order.order_number}</strong> has been placed.</p>
<p><strong>Items:</strong></p>
<ul>${renderItemsList(order.items)}</ul>
<p><strong>Order Total:</strong> ${formatInr(order.order_total)}</p>
${balanceLine}
<p>Estimated delivery: <strong>${ESTIMATED_SHIPPING_WINDOW}</strong> from today, unless a different timeline was shown on the product page.</p>
<p>Questions? Reach us at <a href="mailto:support@berserker.in">support@berserker.in</a> or WhatsApp <a href="https://wa.me/918777841979">+91 87778 41979</a>.</p>
`.trim();
}

export function customerEmailSubject(order: OrderRecord): string {
  return `Your BERSERKER order #${order.order_number} is confirmed`;
}
