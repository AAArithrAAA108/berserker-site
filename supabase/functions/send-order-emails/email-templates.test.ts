import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  esc,
  formatInr,
  renderOwnerEmailHtml,
  renderCustomerEmailHtml,
  ownerEmailSubject,
  customerEmailSubject,
  ESTIMATED_SHIPPING_WINDOW,
  type OrderRecord,
} from "./email-templates.ts";

const sampleOrder: OrderRecord = {
  order_number: 12092006,
  customer_name: "Priya Sharma",
  customer_phone: "9876543210",
  customer_email: "priya@example.com",
  address_line1: "12 MG Road",
  address_line2: "Flat 4B",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  country: "India",
  items: [
    { brand: "Gymshark", name: "Onyx 5.0 Compression", qty: 1, price: 4799 },
    { brand: "YoungLA", name: "Revenge Hoodie", qty: 2, price: 5099 },
  ],
  subtotal: 14997,
  discount: 0,
  coupon_code: null,
  order_total: 14997,
  payment_method: "full",
  amount_paid: 14997,
  balance_due: 0,
  razorpay_payment_id: "pay_test123",
};

Deno.test("esc: escapes HTML special characters (regression: unescaped customer name/address is a stored-XSS route into the owner's own inbox)", () => {
  assertEquals(esc(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;");
});

Deno.test("esc: handles null/undefined without throwing", () => {
  assertEquals(esc(null), "");
  assertEquals(esc(undefined), "");
});

Deno.test("formatInr: formats with the rupee symbol and Indian digit grouping", () => {
  assertEquals(formatInr(14997), "₹14,997");
  assertEquals(formatInr(500), "₹500");
});

Deno.test("renderOwnerEmailHtml: includes customer contact, address, items, and totals", () => {
  const html = renderOwnerEmailHtml(sampleOrder);
  assertStringIncludes(html, "Priya Sharma");
  assertStringIncludes(html, "9876543210");
  assertStringIncludes(html, "priya@example.com");
  assertStringIncludes(html, "12 MG Road");
  assertStringIncludes(html, "Flat 4B");
  assertStringIncludes(html, "Gymshark");
  assertStringIncludes(html, "Onyx 5.0 Compression");
  assertStringIncludes(html, "× 2");
  assertStringIncludes(html, "₹14,997");
  assertStringIncludes(html, "pay_test123");
});

Deno.test("renderOwnerEmailHtml: omits the Razorpay line when no payment id is present yet (regression: COD orders may not have one at insert time)", () => {
  const html = renderOwnerEmailHtml({ ...sampleOrder, razorpay_payment_id: null });
  if (html.includes("Razorpay Payment ID")) {
    throw new Error("should not render a Razorpay Payment ID line when null");
  }
});

Deno.test("renderOwnerEmailHtml: shows the discount and coupon code when a discount was applied", () => {
  const html = renderOwnerEmailHtml({ ...sampleOrder, subtotal: 16000, discount: 1003, coupon_code: "BRSKR25", order_total: 14997 });
  assertStringIncludes(html, "-₹1,003");
  assertStringIncludes(html, "BRSKR25");
});

Deno.test("renderOwnerEmailHtml: shows COD payment method and balance due", () => {
  const html = renderOwnerEmailHtml({ ...sampleOrder, payment_method: "cod", amount_paid: 4000, balance_due: 10997 });
  assertStringIncludes(html, "Cash on Delivery");
  assertStringIncludes(html, "₹4,000");
  assertStringIncludes(html, "balance due on delivery: ₹10,997");
});

Deno.test("renderOwnerEmailHtml: escapes admin/customer-editable text (regression: name/address/coupon are all customer-supplied)", () => {
  const hostile = {
    ...sampleOrder,
    customer_name: `<script>alert(1)</script>`,
    address_line1: `123 Main" onmouseover="alert(1)`,
    coupon_code: "<b>CODE</b>",
    discount: 100,
  };
  const html = renderOwnerEmailHtml(hostile);
  if (html.includes("<script>alert(1)</script>") || html.includes('onmouseover="alert(1)') || html.includes("<b>CODE</b>")) {
    throw new Error("customer-supplied text must be HTML-escaped in the owner email");
  }
});

Deno.test("renderCustomerEmailHtml: includes order number, items, total, and the shipping window", () => {
  const html = renderCustomerEmailHtml(sampleOrder);
  assertStringIncludes(html, "Priya Sharma");
  assertStringIncludes(html, "#12092006");
  assertStringIncludes(html, "Revenge Hoodie");
  assertStringIncludes(html, "₹14,997");
  assertStringIncludes(html, ESTIMATED_SHIPPING_WINDOW);
});

Deno.test("renderCustomerEmailHtml: includes everything the customer gave us at checkout -- contact info, delivery address, subtotal, and payment details (regression: an earlier version omitted all of this, showing only items and the grand total)", () => {
  const html = renderCustomerEmailHtml(sampleOrder);
  assertStringIncludes(html, "9876543210");
  assertStringIncludes(html, "priya@example.com");
  assertStringIncludes(html, "12 MG Road");
  assertStringIncludes(html, "Flat 4B");
  assertStringIncludes(html, "Bengaluru");
  assertStringIncludes(html, "Karnataka");
  assertStringIncludes(html, "560001");
  assertStringIncludes(html, "Subtotal");
  assertStringIncludes(html, "Payment Reference");
  assertStringIncludes(html, "pay_test123");
});

Deno.test("renderCustomerEmailHtml: shows the discount/coupon code when applied, same as the owner email", () => {
  const html = renderCustomerEmailHtml({ ...sampleOrder, subtotal: 16000, discount: 1003, coupon_code: "BRSKR25", order_total: 14997 });
  assertStringIncludes(html, "-₹1,003");
  assertStringIncludes(html, "BRSKR25");
});

Deno.test("renderCustomerEmailHtml: payment line shows full-payment vs. COD-with-balance correctly", () => {
  const fullyPaid = renderCustomerEmailHtml(sampleOrder);
  assertStringIncludes(fullyPaid, "Full payment online");
  if (fullyPaid.includes("balance due on delivery")) {
    throw new Error("should not mention a balance when balance_due is 0");
  }
  const cod = renderCustomerEmailHtml({ ...sampleOrder, payment_method: "cod", amount_paid: 4000, balance_due: 10997 });
  assertStringIncludes(cod, "Cash on Delivery");
  assertStringIncludes(cod, "₹4,000");
  assertStringIncludes(cod, "balance due on delivery: ₹10,997");
});

Deno.test("renderCustomerEmailHtml: omits the Payment Reference line when no payment id is present yet", () => {
  const html = renderCustomerEmailHtml({ ...sampleOrder, razorpay_payment_id: null });
  if (html.includes("Payment Reference")) {
    throw new Error("should not render a Payment Reference line when razorpay_payment_id is null");
  }
});

Deno.test("renderCustomerEmailHtml: escapes customer-editable text (regression: same threat model as the owner email)", () => {
  const hostile = { ...sampleOrder, customer_name: `<img src=x onerror="alert(1)">` };
  const html = renderCustomerEmailHtml(hostile);
  if (html.includes('<img src=x onerror="alert(1)">')) {
    throw new Error("customer name must be HTML-escaped in the customer email");
  }
});

Deno.test("ownerEmailSubject / customerEmailSubject: include the order number", () => {
  assertStringIncludes(ownerEmailSubject(sampleOrder), "12092006");
  assertStringIncludes(customerEmailSubject(sampleOrder), "12092006");
});
