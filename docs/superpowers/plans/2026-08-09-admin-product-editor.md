# Admin Product Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin dashboard's bare price-editing product list with a full editor — reorder, edit all fields, manage images (upload/delete via Supabase Storage), manage colors/variants with per-size stock toggles, add new products, and publish the live storefront on demand.

**Architecture:** The admin dashboard (`admin/dashboard/index.html`) is a single hand-authored HTML file with inline `<script>`, no build step, no framework — same as the rest of the site. Phase 2 keeps that convention for the Orders/Coupons/Admins tabs (untouched) but extracts the new Products tab's substantially larger logic into a sibling file, `admin/dashboard/products.js`, loaded via a plain `<script src="products.js">` tag placed *after* the existing inline script so it shares the same global scope (`sb`, `esc`, `fmtMoney`, `currentUser`, `currentRole` — all already plain top-level `var`s in a classic, non-module script) without needing a bundler or exports. All writes go through the browser's own authenticated Supabase session — the same `sb` client already used by the rest of the dashboard — relying on the RLS `admin write ... using (is_admin())` policies Foundation put on every catalog table. No service-role key ever touches client code.

**Tech Stack:** Vanilla JS (ES2017+, matching the rest of the codebase), Supabase JS v2 (already loaded via CDN), Supabase Storage client API, `fetch` for invoking the `publish-site` Edge Function directly (not `supabase-js`'s `functions.invoke`, to keep full control over the `Authorization` header — see Task 8).

## Global Constraints

- Sizes are fixed: `S`, `M`, `L`, `XL` (per `product_variants.size` check constraint).
- Category enum: `t-shirt`, `compression`, `pants`, `jacket`, `dress`, `set`. Sleeve length enum (nullable): `half`, `full`, `sleeveless`.
- Every write to `products`/`product_colors`/`product_images`/`product_variants` from the browser must go through the existing authenticated `sb` client (RLS-gated via `is_admin()`) — never introduce a service-role key or a new backend endpoint for these.
- `set_product_position(p_product_id uuid, p_new_position int)` now **requires an existing row** — Foundation's security fix (`20260809045542_harden_set_product_position_security_definer.sql`) replaced its old "null old-position = new product" branch with `raise exception ... no product found`. **A new product must be INSERTed with an explicit `position` value directly (e.g. `coalesce(max(position),0)+1` to append at the end) — do not call `set_product_position` for initial placement, only to *move* a product that already has a row.**
- `classify_color_group(hex)` and `set_product_position(...)` are both plain Postgres functions callable via `sb.rpc('classify_color_group', { hex: '#xxxxxx' })` / `sb.rpc('set_product_position', { p_product_id, p_new_position })` from the authenticated client.
- The Storage bucket `product-images` is `public = true` (so public GET/read works without any RLS policy — public bucket reads bypass the API entirely), but **`storage.objects` currently has RLS enabled with zero policies**, meaning INSERT/UPDATE/DELETE (upload/delete) from any client — including an authenticated admin — will fail until Task 1 adds admin-scoped write policies.
- Standing project workflow: every edit to `admin/dashboard/index.html` (a real site page, even though unindexed) must be mirrored to `C:\Users\anind\Downloads\berserker\`, diffed before overwriting, then committed and pushed automatically without stopping to confirm each push. `admin/dashboard/products.js` is a new file under the same page's directory — mirror it too, same rule. Backend-only files (`supabase/migrations/*`) do not need a Downloads mirror, per Foundation's precedent.
- This is a live, actively-used admin tool (real orders/coupons already in the DB via the Orders/Coupons tabs) — do not break those tabs while adding Products functionality. `products.js` must not redeclare any identifier already declared in `index.html`'s inline script (`sb`, `esc`, `fmtMoney`, `fmtDate`, `currentUser`, `currentRole` are all taken).
- A final whole-branch review is mandatory before merging (Foundation's caught 3 Critical + 5 Important cross-task bugs invisible to any single task's review — do not skip it for this phase).

---

## File Structure

- `admin/dashboard/index.html` — modify only the `<section class="panel" id="panel-products">` block (replace its current bare table with the new UI shell: product list table with position/reorder controls, an expandable per-product edit area following the same expand/collapse pattern the Orders tab already uses for its detail rows, an "Add Product" form, and a "Publish" button + status indicator fixed at the top of the panel) and add one line near the bottom: `<script src="products.js" defer></script>`, placed immediately after the existing inline `<script>` block closes.
- `admin/dashboard/products.js` *(new)* — all Products-tab JS: list rendering + reorder (Task 2), edit-in-place (Task 3), add product (Task 4), images grid + upload/delete (Task 5), colors/variants CRUD + color-group auto-suggest (Task 6), stock toggle grid (Task 7), publish button (Task 8). One `initProducts()` entrypoint, called from `index.html`'s existing `(async function() { ... })()` IIFE in place of the current `loadProducts()` call.
- `supabase/migrations/<timestamp>_enable_rls_storage_objects_product_images.sql` *(new)* — the Storage RLS policies from Task 1, applied live via `mcp__supabase__apply_migration` and committed to the repo (Foundation's established pattern: every applied migration gets a matching repo file).
- `supabase/schema.sql` — append a documentation section for the new storage policies (matching how Foundation documented `product_images`'s table-level RLS there, even though `storage.objects` isn't one of `schema.sql`'s own `create table` statements — add a short comment block noting these policies exist on the Supabase-managed `storage.objects` table for the `product-images` bucket).

---

## Task 1: Storage RLS policies for the `product-images` bucket

**Files:**
- Migration applied via `mcp__supabase__apply_migration`, then committed as `supabase/migrations/<timestamp>_enable_rls_storage_objects_product_images.sql`
- Modify: `supabase/schema.sql` (append documentation)

**Interfaces:**
- Produces: authenticated admin sessions can `INSERT`/`UPDATE`/`DELETE` objects in the `product-images` bucket via the Supabase Storage JS client; all other roles (including `anon`) cannot write, but public `GET` continues to work unaffected (public-bucket reads bypass RLS entirely).

- [ ] **Step 1: Confirm the current state (should be zero policies)**

Run via `mcp__supabase__execute_sql`:
```sql
select count(*) as policy_count from pg_policies where schemaname='storage' and tablename='objects';
```
Expected: `0`. If it's already non-zero, stop and report — something changed since this plan was written, investigate before proceeding rather than blindly adding possibly-duplicate policies.

- [ ] **Step 2: Write and apply the migration**

```sql
create policy "admin write product-images objects"
on storage.objects
for all
using (bucket_id = 'product-images' and is_admin())
with check (bucket_id = 'product-images' and is_admin());
```
Apply via `mcp__supabase__apply_migration` with `name: "enable_rls_storage_objects_product_images"`.

- [ ] **Step 3: Verify with a real authenticated-context test**

Run via `mcp__supabase__execute_sql` (uses the same `request.jwt.claim.sub` impersonation technique Foundation's final review used):
```sql
begin;
  select set_config('request.jwt.claim.sub', (select id::text from admin_profiles limit 1), true);
  select policy_name from (
    select 'would allow' as policy_name
    where exists (
      select 1 from storage.buckets where id = 'product-images'
    ) and is_admin()
  ) t;
rollback;
```
This confirms `is_admin()` resolves `true` under a simulated admin session (the actual object-level RLS enforcement can't be tested via raw SQL the same way client uploads work — it's enforced by PostgREST/Storage's own request pipeline — so this step is a sanity check on the `is_admin()` half of the policy, not a full upload simulation). The real end-to-end proof happens in Task 5 when an actual browser upload is tested.

- [ ] **Step 4: Update `supabase/schema.sql`**

Append near the existing `product_images` table section:
```sql
-- Storage: the `product-images` bucket (public=true, created in Foundation) has RLS
-- enabled on storage.objects by default with zero policies out of the box, meaning
-- writes are denied to everyone until an explicit policy is added. This grants
-- INSERT/UPDATE/DELETE to admins only; public GET is unaffected (public-bucket reads
-- bypass RLS entirely, they don't need a SELECT policy here).
-- create policy "admin write product-images objects" on storage.objects for all
--   using (bucket_id = 'product-images' and is_admin())
--   with check (bucket_id = 'product-images' and is_admin());
```
(Commented-out, matching the fact this isn't a `create table` schema.sql normally documents live-executable DDL for — it's informational, consistent with how `schema.sql`'s header already says it documents the app's own tables, not Supabase-managed ones. If you find `schema.sql` already has a precedent for documenting non-`create table` policies as live executable statements elsewhere, follow that precedent instead of commenting this one out — check before assuming.)

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/ supabase/schema.sql
git commit -m "Add admin-write RLS policy for product-images Storage bucket"
git push origin feature/admin-product-editor
```

## Task 2: Products panel shell — list rendering + reorder

**Files:**
- Modify: `admin/dashboard/index.html` (replace the `#panel-products` section's markup; add the `products.js` script tag)
- Create: `admin/dashboard/products.js`

**Interfaces:**
- Consumes: global `sb`, `esc`, `fmtMoney` (from `index.html`'s existing inline script, loaded first)
- Produces: `function initProducts()` (entrypoint, called once from `index.html`'s init IIFE), `function loadProductsList()` (re-fetches and re-renders the list — later tasks call this after any mutation), module-level `var productsCache` (array of the last-loaded product rows, so later tasks — edit, images, colors — can look up a product's current data without a fresh fetch every time they open its detail area)

- [ ] **Step 1: Replace the Products panel markup in `index.html`**

Replace the entire `<!-- PRODUCTS -->` section (currently a bare table) with:
```html
  <!-- PRODUCTS -->
  <section class="panel" id="panel-products">
    <div class="panel-title">Products</div>
    <div class="btn-row" style="margin-bottom:16px;">
      <button class="btn" id="publish-btn">Publish Storefront</button>
      <span class="msg" id="publish-status"></span>
    </div>
    <button class="btn secondary" id="show-add-product-btn" style="margin-bottom:16px;">+ Add New Product</button>
    <div id="add-product-form-wrap" style="display:none;"></div>
    <div id="products-loading" class="loading-note">Loading products...</div>
    <div class="table-wrap" id="products-table-wrap" style="display:none;">
      <table>
        <thead><tr><th>#</th><th>Image</th><th>Brand</th><th>Name</th><th>Category</th><th>Price (₹)</th><th>Colors</th><th>Actions</th></tr></thead>
        <tbody id="products-tbody"></tbody>
      </table>
    </div>
  </section>
```
Then, right after the existing `<script>...</script>` block's closing `</script>` tag (before `</body>`), add:
```html
<script src="products.js" defer></script>
```
And inside the existing inline script's `// ── INIT ──` IIFE, replace the `loadProducts();` call with `initProducts();` (this is the only line in the existing script that needs to change — do not touch anything else in that IIFE or elsewhere in the file). Also delete the now-dead old `loadProducts` function and its two `document.querySelectorAll('.save-product-btn'...)`/`.delete-product-btn` listener blocks from the existing inline script — `products.js` fully replaces that functionality. Leave every other function (`loadOrders`, `loadCoupons`, `loadAdmins`, auth gate, tabs) untouched.

- [ ] **Step 2: Write `products.js` — data fetch + list rendering + reorder**

```javascript
// admin/dashboard/products.js
// Depends on globals from index.html's inline script, loaded first: sb, esc, fmtMoney.

var productsCache = [];

async function loadProductsList() {
  var { data, error } = await sb
    .from('products')
    .select('*, product_colors(id, label, hex, color_group, cover_image_id)')
    .order('position', { ascending: true });
  document.getElementById('products-loading').style.display = 'none';
  if (error) {
    document.getElementById('products-loading').style.display = 'block';
    document.getElementById('products-loading').textContent = 'Failed to load products: ' + error.message;
    return;
  }
  productsCache = data;
  document.getElementById('products-table-wrap').style.display = 'block';
  renderProductsTable();
}

function renderProductsTable() {
  var tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '';
  productsCache.forEach(function(p) {
    var colorsHtml = (p.product_colors || []).map(function(c) {
      return '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + esc(c.hex || '#333') + ';border:1px solid #444;margin-right:3px;" title="' + esc(c.label) + '"></span>';
    }).join('');
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="number" class="reorder-input" data-id="' + p.id + '" value="' + p.position + '" min="1" style="width:56px;" /></td>' +
      '<td>' + (p.cover_thumb_url ? '<img src="' + esc(p.cover_thumb_url) + '" style="width:36px;height:36px;object-fit:cover;" />' : '<span style="color:var(--muted);">—</span>') + '</td>' +
      '<td>' + esc(p.brand) + '</td>' +
      '<td>' + esc(p.name) + '</td>' +
      '<td>' + esc(p.category) + '</td>' +
      '<td>' + fmtMoney(p.price) + '</td>' +
      '<td>' + (colorsHtml || '<span style="color:var(--muted);">—</span>') + '</td>' +
      '<td class="btn-row">' +
        '<button class="btn secondary edit-product-btn" data-id="' + p.id + '">Edit</button>' +
        '<button class="btn danger delete-product-btn" data-id="' + p.id + '">Delete</button>' +
      '</td>';
    tbody.appendChild(tr);

    var detailTr = document.createElement('tr');
    var detailTd = document.createElement('td');
    detailTd.colSpan = 8;
    detailTd.innerHTML = '<div class="order-detail" id="product-detail-' + p.id + '"></div>';
    detailTr.appendChild(detailTd);
    tbody.appendChild(detailTr);
  });
  wireReorderInputs();
  wireEditButtons();
  wireDeleteButtons();
}

function wireReorderInputs() {
  document.querySelectorAll('.reorder-input').forEach(function(input) {
    input.addEventListener('change', async function() {
      var id = input.dataset.id;
      var newPos = parseInt(input.value, 10);
      if (!newPos || newPos < 1) { input.value = productsCache.find(function(p) { return p.id === id; }).position; return; }
      input.disabled = true;
      var { error } = await sb.rpc('set_product_position', { p_product_id: id, p_new_position: newPos });
      input.disabled = false;
      if (error) { alert('Reorder failed: ' + error.message); }
      loadProductsList();
    });
  });
}

function wireDeleteButtons() {
  document.querySelectorAll('.delete-product-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this product and all its colors/images/variants from the database? (Does not remove the live storefront page until you Publish.)')) return;
      await sb.from('products').delete().eq('id', btn.dataset.id);
      loadProductsList();
    });
  });
}

function initProducts() {
  loadProductsList();
}
```

Note: `p.cover_thumb_url` referenced in `renderProductsTable` doesn't exist on the raw query result yet — it's `undefined` today, so the thumbnail column will show "—" for every row until Task 5 (images) populates a real cover URL onto each cached product. That's expected and correct for this task; don't add a fake placeholder image now.

`wireEditButtons()` is referenced but not yet defined — Task 3 defines it. For this task's own testing, temporarily stub it as `function wireEditButtons() {}` at the bottom of the file (a real, working no-op — not a placeholder comment) so the file is syntactically complete and testable on its own; Task 3 will replace this stub with the real implementation.

- [ ] **Step 3: Manual browser verification**

Since this codebase has no build step and no JS test runner, verification for every UI task in this plan is: serve the worktree locally and drive it with a real browser.

```bash
cd admin/dashboard
python -m http.server 8080
```
(or any static server — `npx serve .` works too if Python isn't available). Then use the claude-in-chrome browser tools to navigate to `http://localhost:8080/` (note: this serves the admin dashboard in isolation, outside the full site's routing — `/admin/` login redirect logic checks `window.location.href = '/admin/'`, which won't resolve correctly from a bare `python -m http.server` in the `admin/dashboard` folder; for a real login-gated test, instead serve the WHOLE repo root: `cd` to the worktree root and run the static server there, then navigate to `http://localhost:8080/admin/dashboard/`). Confirm:
- The Products panel loads without a console error and shows all 41 real products (this hits the live Supabase project) in position order.
- Changing a position number and pressing Tab/Enter (triggering the `change` event) actually reorders the list on reload — pick a product, note its neighbors, change its position to a different value, and confirm the list re-renders with the expected new order (cross-check against a direct `mcp__supabase__execute_sql` query: `select brand, name, position from products order by position limit 5;` before and after).
- Read the browser console (`read_console_messages`) for errors after every interaction in this step.

- [ ] **Step 4: Mirror, commit, push**

Diff `admin/dashboard/index.html` between this worktree and `C:\Users\anind\Downloads\berserker\admin\dashboard\index.html` (reconcile any divergence per the standing workflow), apply the same edit there, and create `products.js` there too. Then:
```bash
git add admin/dashboard/index.html admin/dashboard/products.js
git commit -m "Add Products tab shell with list view and drag-free reorder"
git push origin feature/admin-product-editor
```

## Task 3: Edit product (expand-in-place form)

**Files:**
- Modify: `admin/dashboard/products.js` (replace the Task 2 stub `wireEditButtons`; append new functions)

**Interfaces:**
- Consumes: `productsCache`, `loadProductsList()`, `esc` (Task 2/existing)
- Produces: `function renderEditForm(product)` (renders into `#product-detail-<id>`, called by the edit button and reused by Tasks 5-7 to render the images/colors/stock sections into the same expanded area), `function wireEditButtons()` (replaces the Task 2 stub)

- [ ] **Step 1: Implement the edit form**

```javascript
var openProductId = null;

function wireEditButtons() {
  document.querySelectorAll('.edit-product-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.dataset.id;
      var detail = document.getElementById('product-detail-' + id);
      if (openProductId === id) {
        detail.classList.remove('open');
        openProductId = null;
        return;
      }
      if (openProductId) {
        var prevDetail = document.getElementById('product-detail-' + openProductId);
        if (prevDetail) prevDetail.classList.remove('open');
      }
      openProductId = id;
      var product = productsCache.find(function(p) { return p.id === id; });
      renderEditForm(product);
      detail.classList.add('open');
    });
  });
}

function renderEditForm(product) {
  var detail = document.getElementById('product-detail-' + product.id);
  detail.innerHTML =
    '<form class="add-form" id="edit-form-' + product.id + '">' +
      '<div class="field"><label>Brand</label><input type="text" name="brand" value="' + esc(product.brand) + '" required style="width:160px;" /></div>' +
      '<div class="field"><label>Name</label><input type="text" name="name" value="' + esc(product.name) + '" required style="width:260px;" /></div>' +
      '<div class="field"><label>Price (₹)</label><input type="number" name="price" value="' + product.price + '" required style="width:100px;" /></div>' +
      '<div class="field"><label>COD Advance (₹)</label><input type="number" name="cod_advance" value="' + product.cod_advance + '" required style="width:100px;" /></div>' +
      '<div class="field"><label>Category</label><select name="category">' +
        ['t-shirt','compression','pants','jacket','dress','set'].map(function(c) {
          return '<option value="' + c + '"' + (c === product.category ? ' selected' : '') + '>' + c + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="field"><label>Sleeve Length</label><select name="sleeve_length">' +
        ['', 'half', 'full', 'sleeveless'].map(function(s) {
          return '<option value="' + s + '"' + (s === (product.sleeve_length || '') ? ' selected' : '') + '>' + (s || '(none)') + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="field" style="flex-basis:100%;"><label>Description</label><textarea name="description" style="width:100%;min-height:60px;background:var(--mid);border:1px solid var(--border);color:var(--white);font-family:\'DM Sans\',sans-serif;font-size:13px;padding:8px 10px;">' + esc(product.description || '') + '</textarea></div>' +
      '<button type="submit" class="btn">Save Changes</button>' +
      '<p class="msg" id="edit-msg-' + product.id + '"></p>' +
    '</form>' +
    '<div id="images-section-' + product.id + '"></div>' +
    '<div id="colors-section-' + product.id + '"></div>';

  document.getElementById('edit-form-' + product.id).addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById('edit-msg-' + product.id);
    var sleeveVal = form.sleeve_length.value;
    var { error } = await sb.from('products').update({
      brand: form.brand.value.trim(),
      name: form.name.value.trim(),
      price: parseFloat(form.price.value),
      cod_advance: parseFloat(form.cod_advance.value),
      category: form.category.value,
      sleeve_length: sleeveVal === '' ? null : sleeveVal,
      description: form.description.value.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', product.id);
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Saved.';
      loadProductsList();
    }
  });

  renderImagesSection(product); // Task 5
  renderColorsSection(product); // Task 6
}
```

Since Tasks 5-6 haven't run yet, add temporary real no-op stubs at the bottom of the file so this task is independently testable:
```javascript
function renderImagesSection(product) { /* implemented in Task 5 */ }
function renderColorsSection(product) { /* implemented in Task 6 */ }
```

- [ ] **Step 2: Manual browser verification**

Serve the repo root locally (per Task 2 Step 3's instructions) and, in the Products tab, click "Edit" on a real product. Confirm the form pre-fills with its actual current values (cross-check 2-3 fields against a direct `select * from products where id = '<id>';` query), change the price, submit, and confirm both the success message appears and the list's price column updates on reload. Click "Edit" again on the same row to confirm it collapses (toggle behavior). Check the browser console for errors.

- [ ] **Step 3: Mirror, commit, push** (same procedure as Task 2 Step 4)

## Task 4: Add new product

**Files:**
- Modify: `admin/dashboard/products.js`

**Interfaces:**
- Consumes: `loadProductsList()`, `esc`
- Produces: wiring for `#show-add-product-btn` / `#add-product-form-wrap` (both already in the HTML shell from Task 2)

- [ ] **Step 1: Implement**

```javascript
document.getElementById('show-add-product-btn').addEventListener('click', function() {
  var wrap = document.getElementById('add-product-form-wrap');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    renderAddProductForm();
  } else {
    wrap.style.display = 'none';
  }
});

function renderAddProductForm() {
  var wrap = document.getElementById('add-product-form-wrap');
  wrap.innerHTML =
    '<form class="add-form" id="add-product-form">' +
      '<div class="field"><label>Brand</label><input type="text" name="brand" required style="width:160px;" /></div>' +
      '<div class="field"><label>Name</label><input type="text" name="name" required style="width:260px;" /></div>' +
      '<div class="field"><label>Slug</label><input type="text" name="slug" required placeholder="unique-url-slug" style="width:220px;" /></div>' +
      '<div class="field"><label>Price (₹)</label><input type="number" name="price" required style="width:100px;" /></div>' +
      '<div class="field"><label>COD Advance (₹)</label><input type="number" name="cod_advance" required value="0" style="width:100px;" /></div>' +
      '<div class="field"><label>Category</label><select name="category" required>' +
        ['t-shirt','compression','pants','jacket','dress','set'].map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
      '</select></div>' +
      '<button type="submit" class="btn">Create Product</button>' +
      '<p class="msg" id="add-product-msg"></p>' +
    '</form>';

  document.getElementById('add-product-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById('add-product-msg');

    var { data: maxRow } = await sb.from('products').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
    var nextPosition = (maxRow ? maxRow.position : 0) + 1;

    var { error } = await sb.from('products').insert({
      brand: form.brand.value.trim(),
      name: form.name.value.trim(),
      slug: form.slug.value.trim(),
      price: parseFloat(form.price.value),
      cod_advance: parseFloat(form.cod_advance.value),
      category: form.category.value,
      position: nextPosition,
    });
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Product created at position ' + nextPosition + '. Add colors/images by clicking Edit on it below.';
      form.reset();
      loadProductsList();
    }
  });
}
```
This is the "insert with an explicit computed position" approach required by the Global Constraints note — it deliberately does NOT call `set_product_position` for the initial insert, since that RPC now requires an existing row. If the admin later wants this new product at a different position than "end of list", they use the existing reorder input from Task 2 (which correctly calls `set_product_position` on an already-existing row).

- [ ] **Step 2: Manual browser verification**

Serve locally, click "+ Add New Product", fill in a real-looking test product (use an obviously-fake slug like `test-plan-verification-product` so it's easy to find and delete afterward), submit, confirm it appears at the end of the list with the correct next position number. Then use the Delete button from Task 2 to remove it again (cleanup — do not leave test data in the live product catalog). Verify via `mcp__supabase__execute_sql` that the row was actually inserted with the right values before deleting it, and that after deletion `select count(*) from products;` returns to 41.

- [ ] **Step 3: Mirror, commit, push**

## Task 5: Images — list, upload, delete

**Files:**
- Modify: `admin/dashboard/products.js` (replace the Task 3 stub `renderImagesSection`)

**Interfaces:**
- Consumes: `productsCache`, `esc`, Task 1's storage RLS policy
- Produces: `function renderImagesSection(product)` (replaces the Task 3 stub), also sets `p.cover_thumb_url` on the matching entry in `productsCache` after images load, so Task 2's list-view thumbnail column (currently always "—") starts showing real thumbnails once a product's edit panel has been opened at least once in the session (a full eager fetch of every product's cover on initial list load is a reasonable future optimization but out of scope here — lazy population on first Edit click is sufficient and keeps the initial list load fast)

- [ ] **Step 1: Implement**

```javascript
async function renderImagesSection(product) {
  var container = document.getElementById('images-section-' + product.id);
  container.innerHTML = '<p style="font-family:\'Space Mono\',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;">Images</p><div id="images-grid-' + product.id + '" style="display:flex;flex-wrap:wrap;gap:8px;"></div><input type="file" id="image-upload-' + product.id + '" accept="image/jpeg,image/png,image/webp" multiple style="margin-top:8px;" /><p class="msg" id="image-upload-msg-' + product.id + '"></p>';

  await refreshImagesGrid(product.id);

  document.getElementById('image-upload-' + product.id).addEventListener('change', async function(e) {
    var files = Array.from(e.target.files || []);
    var msg = document.getElementById('image-upload-msg-' + product.id);
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var { data: existing } = await sb.from('product_images').select('sort_order').eq('product_id', product.id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
      var nextSort = (existing ? existing.sort_order : -1) + 1;
      var storagePath = product.slug + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
      if (uploadError) { msg.style.color = '#ff3c1e'; msg.textContent = 'Upload failed: ' + uploadError.message; continue; }
      var { error: rowError } = await sb.from('product_images').insert({ product_id: product.id, storage_path: storagePath, sort_order: nextSort });
      if (rowError) { msg.style.color = '#ff3c1e'; msg.textContent = 'Row insert failed: ' + rowError.message; continue; }
    }
    msg.style.color = '#8fd14f';
    msg.textContent = 'Uploaded ' + files.length + ' image(s).';
    e.target.value = '';
    await refreshImagesGrid(product.id);
  });
}

async function refreshImagesGrid(productId) {
  var { data: images, error } = await sb.from('product_images').select('id, storage_path, sort_order').eq('product_id', productId).order('sort_order', { ascending: true });
  var grid = document.getElementById('images-grid-' + productId);
  if (error) { grid.innerHTML = 'Failed to load images: ' + esc(error.message); return; }
  grid.innerHTML = images.map(function(img) {
    var url = sb.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl;
    return '<div style="position:relative;"><img src="' + esc(url) + '" style="width:80px;height:80px;object-fit:cover;border:1px solid var(--border);" />' +
      '<button class="btn danger delete-image-btn" data-image-id="' + img.id + '" data-storage-path="' + esc(img.storage_path) + '" style="position:absolute;top:2px;right:2px;padding:2px 6px;font-size:9px;">×</button></div>';
  }).join('') || '<span style="color:var(--muted);font-size:12px;">No images yet.</span>';

  var product = productsCache.find(function(p) { return p.id === productId; });
  if (product && images.length) {
    product.cover_thumb_url = sb.storage.from('product-images').getPublicUrl(images[0].storage_path).data.publicUrl;
  }

  grid.querySelectorAll('.delete-image-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this image? If any color uses it as a cover, that color will need a new cover assigned.')) return;
      await sb.storage.from('product-images').remove([btn.dataset.storagePath]);
      await sb.from('product_images').delete().eq('id', btn.dataset.imageId);
      await refreshImagesGrid(productId);
    });
  });
}
```
Note: deleting a `product_images` row that a `product_colors.cover_image_id` points to will null out that FK automatically only if the FK was declared `on delete set null` — check `supabase/schema.sql`'s actual `product_colors` FK definition for `cover_image_id` before relying on this; if it's a plain `references product_images(id)` with no `on delete` clause (the default is `no action`, which would make the delete above fail with a foreign-key-violation error whenever a color currently uses that image as its cover), report this as a real finding rather than silently working around it — the fix (adding `on delete set null` to that constraint) may need its own small migration as part of this task if the FK doesn't already have safe delete behavior. Check first with:
```sql
select confdeltype from pg_constraint where conname = 'product_colors_cover_image_id_fkey';
```
`confdeltype = 'a'` means `no action` (delete will fail while referenced) — if so, add a migration: `alter table product_colors drop constraint product_colors_cover_image_id_fkey, add constraint product_colors_cover_image_id_fkey foreign key (cover_image_id) references product_images(id) on delete set null;` before finishing this task, and note it in your report as an unplanned-but-necessary fix.

- [ ] **Step 2: Manual browser verification**

Serve locally, open Edit on a real product, confirm its existing images (migrated in Foundation) display correctly as thumbnails. Upload one small test image file, confirm it appears in the grid and a new `product_images` row exists (`select * from product_images where product_id = '<id>' order by sort_order desc limit 1;`). Delete that same test image via the × button, confirm it disappears from the grid, the storage object is gone (`select * from storage.objects where name = '<the storage_path>';` returns no rows), and the `product_images` row is gone. This is the real end-to-end proof of Task 1's RLS policy working — if upload fails with a permission error here, Task 1 needs revisiting, don't work around it with a different mechanism.

- [ ] **Step 3: Mirror, commit, push**

## Task 6: Colors/variants — add/edit/delete, color-group auto-suggest, cover image assignment

**Files:**
- Modify: `admin/dashboard/products.js` (replace the Task 3 stub `renderColorsSection`)

**Interfaces:**
- Consumes: `productsCache`, `esc`, `classify_color_group` RPC
- Produces: `function renderColorsSection(product)` (replaces the Task 3 stub); each rendered color also gets a stock grid placeholder container `#stock-grid-<colorId>` for Task 7 to fill in

- [ ] **Step 1: Implement**

```javascript
async function renderColorsSection(product) {
  var container = document.getElementById('colors-section-' + product.id);
  var { data: colors, error } = await sb.from('product_colors').select('id, label, hex, color_group, cover_image_id').eq('product_id', product.id).order('label', { ascending: true });
  if (error) { container.innerHTML = 'Failed to load colors: ' + esc(error.message); return; }

  var { data: images } = await sb.from('product_images').select('id, storage_path').eq('product_id', product.id).order('sort_order', { ascending: true });
  var coverOptions = (images || []).map(function(img) {
    return { id: img.id, url: sb.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl };
  });

  container.innerHTML = '<p style="font-family:\'Space Mono\',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;">Colors & Stock</p>' +
    colors.map(function(c) {
      var coverSelectOptions = coverOptions.map(function(img) {
        return '<option value="' + img.id + '"' + (img.id === c.cover_image_id ? ' selected' : '') + '>' + img.id.slice(0, 8) + '</option>';
      }).join('');
      return '<div class="color-row" data-color-id="' + c.id + '" style="border:1px solid var(--border);padding:10px;margin-bottom:8px;">' +
        '<div class="btn-row" style="align-items:center;">' +
          '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:' + esc(c.hex || '#333') + ';border:1px solid #444;"></span>' +
          '<input type="text" class="color-label" value="' + esc(c.label) + '" style="width:120px;" />' +
          '<input type="text" class="color-hex" value="' + esc(c.hex || '') + '" placeholder="#rrggbb" style="width:90px;" />' +
          '<span class="color-group-display" style="font-size:11px;color:var(--muted);">' + esc(c.color_group) + '</span>' +
          '<select class="color-cover-select">' + '<option value="">(no cover)</option>' + coverSelectOptions + '</select>' +
          '<button class="btn secondary save-color-btn">Save</button>' +
          '<button class="btn danger delete-color-btn">Delete</button>' +
        '</div>' +
        '<div class="stock-grid" id="stock-grid-' + c.id + '" style="margin-top:8px;"></div>' +
      '</div>';
    }).join('') +
    '<div class="btn-row" style="margin-top:8px;">' +
      '<input type="text" id="new-color-label-' + product.id + '" placeholder="Color label" style="width:140px;" />' +
      '<input type="text" id="new-color-hex-' + product.id + '" placeholder="#rrggbb" style="width:100px;" />' +
      '<button class="btn" id="add-color-btn-' + product.id + '">+ Add Color</button>' +
    '</div>' +
    '<p class="msg" id="colors-msg-' + product.id + '"></p>';

  colors.forEach(function(c) { renderStockGrid(c.id, product.id); }); // Task 7

  container.querySelectorAll('.save-color-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var row = btn.closest('.color-row');
      var colorId = row.dataset.colorId;
      var label = row.querySelector('.color-label').value.trim();
      var hex = row.querySelector('.color-hex').value.trim() || null;
      var coverImageId = row.querySelector('.color-cover-select').value || null;
      var { error } = await sb.from('product_colors').update({ label: label, hex: hex, cover_image_id: coverImageId }).eq('id', colorId);
      var msg = document.getElementById('colors-msg-' + product.id);
      if (error) { msg.style.color = '#ff3c1e'; msg.textContent = error.message; }
      else { msg.style.color = '#8fd14f'; msg.textContent = 'Color saved.'; renderColorsSection(product); }
    });
  });

  container.querySelectorAll('.color-hex').forEach(function(input) {
    input.addEventListener('blur', async function() {
      var hex = input.value.trim();
      var row = input.closest('.color-row');
      var display = row.querySelector('.color-group-display');
      if (!hex) return;
      var { data: suggested, error } = await sb.rpc('classify_color_group', { hex: hex });
      if (!error && suggested) { display.textContent = suggested + ' (suggested)'; }
    });
  });

  document.getElementById('add-color-btn-' + product.id).addEventListener('click', async function() {
    var labelInput = document.getElementById('new-color-label-' + product.id);
    var hexInput = document.getElementById('new-color-hex-' + product.id);
    var label = labelInput.value.trim();
    var hex = hexInput.value.trim() || null;
    if (!label) { alert('Color label is required.'); return; }
    var colorGroup = 'Uncategorized';
    if (hex) {
      var { data: suggested } = await sb.rpc('classify_color_group', { hex: hex });
      if (suggested) colorGroup = suggested;
    }
    var { error } = await sb.from('product_colors').insert({ product_id: product.id, label: label, hex: hex, color_group: colorGroup });
    var msg = document.getElementById('colors-msg-' + product.id);
    if (error) { msg.style.color = '#ff3c1e'; msg.textContent = error.message; }
    else { labelInput.value = ''; hexInput.value = ''; renderColorsSection(product); }
  });

  container.querySelectorAll('.delete-color-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this color and all its size/stock data?')) return;
      var colorId = btn.closest('.color-row').dataset.colorId;
      await sb.from('product_colors').delete().eq('id', colorId);
      renderColorsSection(product);
    });
  });
}
```
The `color_group` shown next to each existing color is read-only display (`color-group-display`) that updates to a live *suggestion* on blur of the hex field, but does not auto-save — the actual `color_group` column is only written on new-color creation (auto-assigned) or, for edits to an existing color's hex, is intentionally left as a manual follow-up (this task's "Save" button for existing colors does not touch `color_group`, matching the spec's "auto-suggested ... with manual override" language — if you judge this should also let the admin explicitly re-run/accept the suggestion into the saved value for an *existing* color via a small "Apply suggestion" action, that's a reasonable small addition within this task's scope; note in your report which approach you took).

New `product_colors` rows created here have **zero** `product_variants` rows until Task 7's stock grid creates them — a color with no sizes yet is valid interim state, not a bug.

- [ ] **Step 2: Manual browser verification**

Serve locally, open Edit on a product with existing colors (e.g. the Gymshark Onyx 5.0 Half Sleeve, which has 4 real colors from Foundation), confirm they render with correct labels/hex/group. Add a new test color with a hex you know the expected group for (e.g. `#1a4a1a` should suggest "Green" per Foundation's corrected classifier), confirm the auto-suggested group is right before saving. Delete that test color afterward (cleanup). Assign a cover image to a real color via the dropdown, save, and confirm via SQL that `cover_image_id` actually updated.

- [ ] **Step 3: Mirror, commit, push**

## Task 7: Stock grid — per size+color in-stock toggles

**Files:**
- Modify: `admin/dashboard/products.js`

**Interfaces:**
- Consumes: `esc`, called by Task 6's `renderColorsSection` for each color
- Produces: `function renderStockGrid(colorId, productId)`

- [ ] **Step 1: Implement**

```javascript
var ALL_SIZES = ['S', 'M', 'L', 'XL'];

async function renderStockGrid(colorId, productId) {
  var grid = document.getElementById('stock-grid-' + colorId);
  if (!grid) return;
  var { data: variants, error } = await sb.from('product_variants').select('id, size, in_stock').eq('color_id', colorId);
  if (error) { grid.innerHTML = 'Failed to load stock: ' + esc(error.message); return; }

  var bySize = {};
  (variants || []).forEach(function(v) { bySize[v.size] = v; });

  grid.innerHTML = ALL_SIZES.map(function(size) {
    var v = bySize[size];
    var inStock = v ? v.in_stock : true;
    return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:14px;font-size:12px;">' +
      '<input type="checkbox" class="stock-toggle" data-size="' + size + '" data-color-id="' + colorId + '" data-variant-id="' + (v ? v.id : '') + '"' + (inStock ? ' checked' : '') + ' /> ' + size +
    '</label>';
  }).join('');

  grid.querySelectorAll('.stock-toggle').forEach(function(cb) {
    cb.addEventListener('change', async function() {
      var size = cb.dataset.size;
      var colorIdAttr = cb.dataset.colorId;
      var variantId = cb.dataset.variantId;
      cb.disabled = true;
      if (variantId) {
        await sb.from('product_variants').update({ in_stock: cb.checked }).eq('id', variantId);
      } else {
        var { data: newRow, error } = await sb.from('product_variants').insert({ product_id: productId, color_id: colorIdAttr, size: size, in_stock: cb.checked }).select('id').single();
        if (!error && newRow) cb.dataset.variantId = newRow.id;
      }
      cb.disabled = false;
    });
  });
}
```
This handles the "color has zero variant rows yet" case from Task 6 gracefully — every checkbox defaults to checked (in-stock) with no `variant-id`, and the first time an admin toggles any box for that color/size, the row is created on the fly rather than requiring a separate "initialize stock" step.

- [ ] **Step 2: Manual browser verification**

Serve locally, open a product with existing stock data (all 41 products have full S/M/L/XL rows per color from Foundation's seed), confirm all 4 checkboxes per color show checked (all `in_stock = true` from Foundation). Uncheck one (e.g. the Batman compression's Stealth/S, matching the user's original example from the initial feature request), confirm via SQL that `in_stock` flipped to `false` for exactly that one `(color_id, size)` row and no others. Re-check it to restore state (cleanup — don't leave real product stock altered from this test). Add a brand-new color (via Task 6) and confirm its stock grid shows all-checked-with-no-variant-id, toggle one off, confirm a `product_variants` row actually gets created (not just the UI checkbox state).

- [ ] **Step 3: Mirror, commit, push**

## Task 8: Publish button

**Files:**
- Modify: `admin/dashboard/products.js`

**Interfaces:**
- Consumes: `sb` (for `sb.auth.getSession()`), the deployed `publish-site` Edge Function
- Produces: wiring for `#publish-btn` / `#publish-status` (already in the HTML shell from Task 2)

- [ ] **Step 1: Implement**

```javascript
document.getElementById('publish-btn').addEventListener('click', async function() {
  var btn = this;
  var status = document.getElementById('publish-status');
  btn.disabled = true;
  status.style.color = 'var(--muted)';
  status.textContent = 'Publishing...';

  var { data: sessionData } = await sb.auth.getSession();
  if (!sessionData || !sessionData.session) {
    status.style.color = '#ff3c1e';
    status.textContent = 'Not signed in.';
    btn.disabled = false;
    return;
  }

  try {
    var res = await fetch('https://gvddahtgbhbqusyczxuo.supabase.co/functions/v1/publish-site', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + sessionData.session.access_token },
    });
    var body = await res.json();
    if (body.ok) {
      status.style.color = '#8fd14f';
      status.textContent = 'Published ' + body.productCount + ' products (commit ' + body.commitSha.slice(0, 7) + ').';
    } else {
      status.style.color = '#ff3c1e';
      status.textContent = 'Publish failed: ' + (body.error || 'unknown error');
    }
  } catch (err) {
    status.style.color = '#ff3c1e';
    status.textContent = 'Publish failed: ' + err.message;
  }
  btn.disabled = false;
});
```
Note this uses the CURRENT admin's real session access token — since `publish-site`'s auth check (from Foundation's security fix) requires resolving the caller's own JWT to a real `admin_profiles` row, this is exactly the scenario it was built for, and should succeed for any signed-in admin viewing this dashboard.

- [ ] **Step 2: Real end-to-end verification**

Serve locally, sign in as the real admin (this requires an actual login through `/admin/`, not a bypass), navigate to the Products tab, click "Publish Storefront". Confirm the status shows a real success message with a commit SHA. Verify independently via `gh api repos/AAArithrAAA108/berserker-site/commits/main --jq '.sha,.commit.message'` that a new commit landed, matching the SHA shown in the UI. This is the first genuinely successful *browser-driven* (not curl-driven) end-to-end publish since Foundation's security fix — treat it as the real proof that fix works end-to-end from an actual signed-in session, not just via manually-constructed test tokens.

- [ ] **Step 3: Mirror, commit, push**

---

## Plan Self-Review Notes

- **Spec coverage:** every bullet in the spec's Section 2 has a task: list+reorder (Task 2), edit form (Task 3), images upload/delete (Task 5), colors/variants+auto-suggest+cover (Task 6), stock toggles (Task 7), add product (Task 4), publish button (Task 8). Task 1 (Storage RLS) isn't in the spec text explicitly but is a hard prerequisite the spec's author didn't know about at design time (discovered during this plan's own research) — without it, Task 5's upload would fail outright.
- **Known open question flagged inline, not silently assumed:** Task 5 Step 1 calls out that `product_colors.cover_image_id`'s foreign key delete behavior needs checking before relying on straightforward image deletion — resolve this for real during implementation, don't skip the check.
- **Verification discipline:** every UI task has a manual real-browser verification step (this codebase has no JS test runner to write automated tests against) cross-checked against direct SQL queries, consistent with how Foundation's non-Edge-Function tasks were verified. The one exception (`render.ts`'s Deno tests in Foundation) doesn't apply here since this phase produces browser-only vanilla JS with no `deno test`-compatible module structure.
