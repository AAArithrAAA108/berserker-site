import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCartItemName, computeOrderTotals, computePaymentSplit } from "./order-logic.ts";

Deno.test("parseCartItemName: splits a normal composed name into product/color/size", () => {
  assertEquals(parseCartItemName("Onyx 5.0 Compression — Black / M"), {
    productName: "Onyx 5.0 Compression",
    colorLabel: "Black",
    variantLabel: null,
    size: "M",
  });
});

Deno.test("parseCartItemName: handles a product name that itself contains an em dash (regression: naive split-on-first-dash would misparse this)", () => {
  assertEquals(parseCartItemName("Cactus Jack — Astroworld Tee — Red / XL"), {
    productName: "Cactus Jack",
    colorLabel: "Astroworld Tee — Red",
    variantLabel: null,
    size: "XL",
  });
});

Deno.test("parseCartItemName: rejects a name with no em-dash separator (malformed/tampered cart item)", () => {
  assertEquals(parseCartItemName("Just A Product Name"), null);
});

Deno.test("parseCartItemName: rejects a name with no size separator", () => {
  assertEquals(parseCartItemName("Product — Black"), null);
});

Deno.test("parseCartItemName: rejects a size outside the product_variants enum (regression: an attacker-crafted cart item could claim any size string)", () => {
  assertEquals(parseCartItemName("Product — Black / XXXL"), null);
});

Deno.test("parseCartItemName: rejects an empty product name or color label", () => {
  assertEquals(parseCartItemName(" — Black / M"), null);
  assertEquals(parseCartItemName("Product —  / M"), null);
});

Deno.test("parseCartItemName: extracts a variant suffix from a 'both'-mode item, e.g. \"Black (V1)\"", () => {
  assertEquals(parseCartItemName("Onyx 5.0 Compression — Black (V1) / M"), {
    productName: "Onyx 5.0 Compression",
    colorLabel: "Black",
    variantLabel: "V1",
    size: "M",
  });
});

Deno.test("parseCartItemName: a pure-variant item (no parens -- label itself IS the variant text) parses identically to a plain color, unchanged (regression: extending the format for 'both' mode must not disturb the existing color-only/variant-only cart-item shape)", () => {
  assertEquals(parseCartItemName("Onyx 5.0 Compression — V1 / M"), {
    productName: "Onyx 5.0 Compression",
    colorLabel: "V1",
    variantLabel: null,
    size: "M",
  });
});

Deno.test("parseCartItemName: an empty parenthesized suffix, e.g. \"Black ()\", never matches the variant pattern -- treated as literal color-label text (the admin form always trims a blank variant input to null before storage, so this case can't occur from real data)", () => {
  assertEquals(parseCartItemName("Product — Black () / M"), {
    productName: "Product",
    colorLabel: "Black ()",
    variantLabel: null,
    size: "M",
  });
});

Deno.test("parseCartItemName: a color label that legitimately contains parentheses elsewhere in the string is not mistaken for a variant suffix unless it's the trailing group", () => {
  assertEquals(parseCartItemName("Product — Black (Matte) Finish / M"), {
    productName: "Product",
    colorLabel: "Black (Matte) Finish",
    variantLabel: null,
    size: "M",
  });
});

Deno.test("computeOrderTotals: sums price*qty and cod_advance*qty across items, applies a flat discount percent to subtotal", () => {
  const totals = computeOrderTotals(
    [
      { qty: 2, price: 4799, codAdvance: 1500 },
      { qty: 1, price: 5099, codAdvance: 2000 },
    ],
    10,
  );
  assertEquals(totals.subtotal, 14697);
  assertEquals(totals.codTotal, 5000);
  assertEquals(totals.discount, 1470);
  assertEquals(totals.orderTotal, 13227);
});

Deno.test("computeOrderTotals: zero discount when no coupon applied", () => {
  const totals = computeOrderTotals([{ qty: 1, price: 1000, codAdvance: 300 }], 0);
  assertEquals(totals.discount, 0);
  assertEquals(totals.orderTotal, 1000);
});

Deno.test("computePaymentSplit: full payment charges the entire order total with no balance due", () => {
  assertEquals(computePaymentSplit("full", 13227, 5000), { amountPaid: 13227, balanceDue: 0 });
});

Deno.test("computePaymentSplit: cod charges the lesser of codTotal and orderTotal", () => {
  assertEquals(computePaymentSplit("cod", 13227, 5000), { amountPaid: 5000, balanceDue: 8227 });
});

Deno.test("computePaymentSplit: cod never charges more than the (possibly discounted) order total (regression: a heavy discount could bring orderTotal below the raw codTotal)", () => {
  assertEquals(computePaymentSplit("cod", 3000, 5000), { amountPaid: 3000, balanceDue: 0 });
});
