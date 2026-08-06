# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two roughly equal primary audiences, both in India:
- Fitness-focused buyers seeking affordable, authentic-feeling international activewear (Gymshark, Lululemon, YoungLA, Skims) they can't easily or affordably import themselves.
- Streetwear/hype buyers seeking sought-after international drops (Chrome Hearts, Cactus Jack × Travis Scott) for style and brand cachet, not workout use.

## Product Purpose

BERSERKER is an independent retailer that sources premium global streetwear and activewear through international manufacturing/warehouse networks and resells it to customers across India, with each item quality-inspected before dispatch. Success is a customer receiving a piece that feels authentic and premium, delivered reliably.

## Positioning

Affordability and access: bringing elite international drops and fitness-wear styles to Indian consumers who otherwise can't easily obtain them, backed by a stated (self-reported, unverified by any accreditation) quality-check process before dispatch.

## Operating Context

- Static HTML/CSS/JS site (no backend/CMS observed); cart is client-side only via `localStorage`, shared across pages by key `berserkerCart`.
- Checkout button redirects to `/checkout/`, which does not exist in the current codebase — no working payment integration is present yet, despite policy pages referencing Razorpay refunds and COD.
- Individual product-detail pages (e.g. `/gymshark/gymshark-onyx-5-half-sleeve`) are linked from the homepage but do not exist in the repo — only category listing pages (`all-products/`, and one page per brand) currently exist.
- Support channels: WhatsApp (+91 87778 41979) and email (support@berserker.in); Instagram @berserker.in.
- Site established/dated 2026 per on-page copy (About page: "Established in 2026"; footer copyright "© 2026").

## Capabilities and Constraints

- Catalog: 28 products across 7 brands — Gymshark, YoungLA, BreatheDivinity, Chrome Hearts, Cactus Jack × Travis Scott, Skims, Lululemon. Prices range ₹4,299–₹8,999.
- Legal: About page explicitly states BERSERKER is "not affiliated with, authorized by, or officially partnered with any of the brands featured" — an independent resale operation, not an authorized retailer.
- Policy: strict no-return policy; damage/defect claims require an unedited unboxing video reported within 24 hours of delivery or are automatically denied; COD orders require a non-refundable advance amount (per-product, not yet wired into product data shown in the current catalog markup); order cancellation window is 12 hours; standard delivery window is stated as 35–45 days; shipping is free.
- Undecided/not yet built: real checkout/payment flow, individual product detail pages, an actual backend for the cart/orders.

## Brand Commitments

- Name: BERSERKER. Domain: berserker.in.
- Visual identity: dark theme (near-black background), electric yellow-green accent (`#e8f000`), hot red secondary accent (`#ff3c1e`). Typography: Bebas Neue (display), DM Sans (body), Space Mono (mono/labels).
- Tone: intense/aggressive branding ("Go BERSERK", "Berserker Army", empty cart copy "Cart's Empty. Go BERSERK.").

## Evidence on Hand

- Community/product stats shown on-site ("1K+ Berserker Army", "50+ Products") and the three named customer reviews are placeholder/aspirational, not confirmed real — do not cite them as verified facts or expand on them as if real in future design or copy work.
- No other real testimonials, press, case studies, or third-party evidence currently on hand.

## Product Principles

- Affordability and access to international drops are the core value proposition — pricing and availability framing should lead over aggregate brand prestige.
- The dark/aggressive "Berserker Army" identity is a deliberate, established brand voice — preserve it rather than softening toward a generic e-commerce tone.
- The site currently overstates operational maturity in places (checkout, per-product COD amounts, product detail pages) — new work should not compound that gap by adding further claims not backed by real functionality.
- Serves two distinct audiences (fitness and streetwear) under one storefront — navigation and merchandising should keep both legible rather than collapsing toward one.
