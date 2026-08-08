# Berserker admin panel & storefront overhaul — design spec

Date: 2026-08-08
Status: approved, ready for implementation planning

## Background

The Berserker site (`berserker-site`, deployed on Vercel from GitHub `AAArithrAAA108/berserker-site`, `main`) is currently 100% hand-authored static HTML — no build step, no `package.json`, no generator. Every product is hardcoded `<div class="product-card">` markup duplicated across up to 4 files (all-products listing, brand page, collection page, individual product page). Images are committed to the repo, some inlined as base64 (the homepage is 9.8MB as a result).

Supabase already exists (`products`, `product_colors`, `coupons`, `customers`, `orders`, `admin_profiles` tables) and backs an admin panel (`admin/`, `admin/dashboard/`) with Supabase-auth login and a `role`-gated dashboard. But the admin panel's product editing is disconnected from the storefront: its own UI warns that editing price there "does not change the live product page." There is no create-product form, no image upload, no per-product category/sleeve-length/size/stock/position data anywhere.

This spec covers a set of 13 requested features that collectively require turning the storefront into something genuinely generated from the database, rather than adding features on top of 40+ duplicated static files.

## Scope decomposition and build order

1. **Foundation** — data model + publish pipeline (this unlocks everything else)
2. **Admin product editor UI** — depends on 1
3. **Storefront filters/sort/stock display/pricing/scrollbar** — depends on 1
4. **Legal pages + checkout consent checkbox** — independent
5. **Order email notifications** — independent (touches `orders` table + a new Edge Function)

Item "shipping-info page not opening" (originally item 5 in the request) was investigated and found already resolved (live site returns 200 with correct content on every path tested; user confirmed on retest) — dropped from scope.

Standing project workflow (from prior sessions) continues unchanged throughout: every edit is mirrored to `C:\Users\anind\Downloads\berserker\` and the `berserker-site` repo clone is committed and pushed to GitHub automatically, without stopping to confirm the push itself each time.

## 1. Data model & publish architecture

### Schema additions (Supabase Postgres, via migrations)

- `products`: add `position int unique not null`, `category text not null` (`t-shirt` | `compression` | `pants` | `jacket` | `dress` | `set`), `sleeve_length text` nullable (`half` | `full` | `sleeveless` — only meaningful for tops), `description text`.
- `product_images` (new table): `id uuid pk, product_id uuid fk, storage_path text, sort_order int`. Backs the move to Supabase Storage; replaces the current hardcoded per-file image list.
- `product_colors`: add `color_group text not null` (auto-assigned from hex via nearest-match against a fixed base palette — Black/White/Grey/Red/Blue/Green/Purple/Pink/Orange/Navy/Maroon/Gold/Brown/Cream/Denim — with manual override in admin), `cover_image_id uuid fk -> product_images` (replaces raw `image_index`).
- `product_variants` (new table): `product_id uuid fk, color_id uuid fk -> product_colors, size text` (`S`|`M`|`L`|`XL`), `in_stock boolean not null default true`, unique on `(product_id, color_id, size)`. This is the data item 11's stock toggle edits — out-of-stock is tracked per size+color combination, not per size globally.
- Postgres function `set_product_position(p_product_id uuid, p_new_position int)`: atomically shifts every other product's `position` by ±1 to make room, then sets the target product's position. Used both for reordering an existing product (item 4's auto-increment collision behavior) and for placing a newly created product.

### Data migration

Backfill for the 41 existing products:
- `position` ← current on-page order in `all-products/index.html`.
- `category` ← which collection page(s) (`collections/{compressions,dresses,jackets,pants,sets,t-shirts}/`) the product currently appears under.
- `sleeve_length` ← parsed from product name where present (e.g. "Half Sleeve"), else left null.
- `color_group` ← computed via the hex-proximity algorithm for all 219 existing `product_colors` rows.
- `product_variants` ← seeded for every existing (product × color × {S,M,L,XL}) combination with `in_stock = true`.
- All existing images ← uploaded to a new Supabase Storage bucket, `product_images` rows created pointing at the public URLs; repo-committed image files retired from the generated output once the publish pipeline is live.

Known data-quality note (not fixed by this project, just documented): Cactus Jack and Chrome Hearts products currently have placeholder colors (`Variant 1`, `Variant 2`, ...) that all share the same hex — they'll bucket into one color_group until someone gives them real per-variant color data via the new admin editor.

### Publish pipeline

A Supabase Edge Function, `publish-site`:
1. Queries `products`/`product_colors`/`product_images`/`product_variants` in full, ordered by `position`.
2. Renders every storefront page — `all-products/index.html`, each `collections/<category>/index.html`, each brand page, each individual product page — from one shared HTML template (nav, header, footer, cart drawer, size picker, filter/sort bar, scrollbar CSS defined once, not duplicated per file as today).
3. Commits and pushes the generated files to `github.com/AAArithrAAA108/berserker-site` `main` via the GitHub Contents/Git Data API, using a GitHub PAT stored as an Edge Function secret. Vercel auto-deploys on push to `main` (confirmed: no `vercel.json` needed, homepage already resolves via the connected-repo default).

The admin panel's "Publish" button (see section 2) invokes this function. Nothing an admin edits in Supabase reaches the live site until Publish is clicked — edits are safely staged in the meantime.

This is the highest-effort, highest-risk piece of the whole project: it replaces today's 40+ independently-maintained static files with a single generator, which is a precondition for every other feature in this spec working cleanly.

## 2. Admin product editor

New "Products" tab in `admin/dashboard/index.html`, replacing the current bare price-editing list:

- **Product list**: position, thumbnail, name, category, price. Reorder via a direct "set position" field (or drag-and-drop) calling `set_product_position` — moving a product to an occupied position shifts the occupant (and everything between) by one, per item 4.
- **Edit product**: form for name, brand, price, `cod_advance`, category, sleeve_length, description.
- **Images**: grid of current images with delete; upload (file picker or drag-drop) goes straight to Supabase Storage with a `product_images` row created.
- **Colors/variants**: add/edit/delete a color (label, hex, auto-suggested `color_group` with manual override), assign a cover image. Under each color, a size grid (S/M/L/XL) with an in-stock toggle per cell.
- **Add new product**: same form, blank; creates at the end of the position sequence by default, or at an explicit position via the same `set_product_position` path.
- **Publish button**: fixed at the top of the tab, calls `publish-site`, shows queued/building/pushed status (it's a real network call, not instant).

## 3. Storefront UX

**Filter/sort bar**, added to all-products, every collection page, and every brand page:
- Sleeve length: Half / Full / Sleeveless (shown only where applicable to the products in view).
- Color: one checkbox per `color_group` bucket present in the current listing.
- Category: T-Shirts / Compressions / Pants / Jackets / Dresses / Sets.
- Price range: dual-handle slider, ₹0 to the max-priced item currently in view.
- Sort: price ascending / price descending (item 10), plus the default position order.
- Client-side only, against the page's own rendered product data; composes with the existing `?q=` search-highlight behavior rather than replacing it.

**Stock-aware size picker**: a variant with `in_stock = false` renders its size button disabled/struck-through rather than being removed from the option list.

**Strikethrough pricing** (item 15): every price display gets a second, struck-through price computed as `ceil(price × 2.7 / 1000) × 1000 − 1` (verified against the user's example: ₹4,799 → ₹12,999). No discount percentage shown anywhere. Applied once in the shared template from section 1, so it's consistent across cards, PDPs, cart, and checkout automatically.

**Custom scrollbar** (item 12): `::-webkit-scrollbar` + Firefox `scrollbar-color`, track off `--card-bg`/`--black`, thumb `--border` with `--accent` on hover, matching the existing design tokens. Applied globally plus specifically to the nav sidebar and cart drawer's internal scroll regions.

## 4. Legal pages & checkout consent

**New pages** `/terms-of-service/` and `/privacy-policy/` (currently dead links in the footer — this fixes that), matching the existing legal-page visual pattern (Bebas Neue headers, `#e8f000` numbered sections, bordered callouts), drafted from the existing About Us / Returns & Refunds / Shipping Info content:
- Terms of Service: site usage, order acceptance, pricing/payment terms, the existing brand-affiliation disclaimer (reused from About Us), limitation of liability, governing law.
- Privacy Policy: data collected at checkout (name/phone/optional email/address, cart in browser localStorage), how it's used, third parties involved (Razorpay for payment, courier for delivery), retention, contact info.

**Checkout consent checkbox** (item 7): added to `checkout/review/index.html` directly above the Pay button, unchecked by default: "I have read and agree to the Shipping Policy, Returns & Refund Policy, Terms of Service, and Privacy Policy" with each term linked. Pay button (both UPI/Cards and COD flows) stays disabled until checked.

## 5. Order email notifications

Checkout's shipping form already has an optional `email` field (`checkout/index.html`, `#cf-email` — "For order updates (optional)") feeding into the `create_order` RPC's `customer_email` column; no form changes needed, only a label tweak clarifying that skipping it means no confirmation email.

Rather than firing from the client (unreliable — a closed tab means no email), a Postgres trigger on `orders` insert invokes a new Edge Function `send-order-emails` via Supabase's webhook mechanism, firing reliably regardless of client behavior. The function sends two emails via Resend:
- **Owner notification** → `support@berserker.in`: full order details (customer info, address, items, payment method, amounts, coupon used).
- **Customer confirmation** → `orders.customer_email` when present: order id, items ordered, estimated shipping window (35–45 days, per the existing Shipping Info policy).

Setup requirement: a Resend account (free tier, 3,000 emails/month) with the `berserker.in` domain verified via DNS records at the registrar, so mail can send from an address on that domain.

## Non-goals / out of scope

- Fixing the placeholder "Variant N" color data on Cactus Jack / Chrome Hearts products (documented, not remediated).
- Any change to the Razorpay integration itself beyond adding the consent-checkbox gate.
- Global size range beyond S/M/L/XL (matches current site behavior).
