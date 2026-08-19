import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCartItemName, computeOrderTotals, computePaymentSplit } from "./order-logic.ts";

Deno.test("parseCartItemName: splits a normal composed name into product/color/size", () => {
  assertEquals(parseCartItemName("Onyx 5.0 Compression — Black / M"), {
    productName: "Onyx 5.0 Compression",
    colorLabel: "Black",
    size: "M",
  });
});

Deno.test("parseCartItemName: handles a product name that itself contains an em dash (regression: naive split-on-first-dash would misparse this)", () => {
  assertEquals(parseCartItemName("Cactus Jack — Astroworld Tee — Red / XL"), {
    productName: "Cactus Jack",
    colorLabel: "Astroworld Tee — Red",
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
