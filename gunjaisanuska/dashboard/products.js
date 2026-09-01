// gunjaisanuska/dashboard/products.js
// Depends on globals from index.html's inline script, loaded first: sb, esc, fmtMoney.

var productsCache = [];

async function loadProductsList() {
  var { data, error } = await sb
    .from('products')
    .select('*, brands(name, folder_slug), product_colors(id, label, hex, color_group, variant_label, cover_image_id)')
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
  // Rebuilding the table destroys every `.open`-classed detail div (they're
  // recreated fresh below with no `open` class), so any previously-open
  // product's tracked id must be reset here too -- otherwise the next Edit
  // click on that same product is misread as a close-toggle by
  // wireEditButtons() and silently does nothing. Resetting here (rather than
  // at each of this function's callers -- reorder, delete, add, save) means
  // it can never drift out of sync again as new callers are added.
  openProductId = null;
  var tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '';
  productsCache.forEach(function(p) {
    var colorsHtml = (p.product_colors || []).map(function(c) {
      var title = c.variant_label ? (c.label + ' (' + c.variant_label + ')') : c.label;
      var bg = c.hex || groupHex(c.color_group);
      return '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + esc(bg) + ';border:1px solid #444;margin-right:3px;" title="' + esc(title) + '"></span>';
    }).join('');
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="number" class="reorder-input" data-id="' + p.id + '" value="' + p.position + '" min="1" max="' + productsCache.length + '" style="width:56px;" /></td>' +
      '<td>' + (p.cover_thumb_url ? '<img src="' + esc(p.cover_thumb_url) + '" style="width:36px;height:36px;object-fit:cover;" />' : '<span style="color:var(--muted);">—</span>') + '</td>' +
      '<td>' + esc(p.brands.name) + '</td>' +
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
      var currentPos = productsCache.find(function(p) { return p.id === id; }).position;
      // The RPC itself is the authoritative check (a max attribute is only a
      // UI hint, e.g. bypassable by direct input); this just avoids a round
      // trip for an obviously-out-of-range value.
      if (!newPos || newPos < 1 || newPos > productsCache.length) { input.value = currentPos; return; }
      input.disabled = true;
      var { error } = await sb.rpc('set_product_position', { p_product_id: id, p_new_position: newPos });
      input.disabled = false;
      if (error) { alert('Reorder failed: ' + error.message); }
      loadProductsList();
    });
  });
}

// Shared by the product-delete and brand-delete flows: publish with a set
// of pages to delete (nothing else in the catalog can tell Publish about
// them, since the backing DB rows are already gone by the time this runs).
async function publishExtraDeletes(extraDeletePaths) {
  var status = document.getElementById('publish-status');
  if (!status) return;
  status.style.color = 'var(--muted)';
  status.textContent = 'Publishing...';

  var { data: sessionData } = await sb.auth.getSession();
  if (!sessionData || !sessionData.session) {
    status.style.color = '#ff3c1e';
    status.textContent = 'Deleted, but not signed in -- the live page(s) were not removed. Publish again once signed in.';
    return;
  }

  try {
    var res = await fetch(SUPABASE_URL + '/functions/v1/publish-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionData.session.access_token },
      body: JSON.stringify({ extraDeletePaths: extraDeletePaths }),
    });
    var body = await res.json();
    if (body.ok) {
      status.style.color = '#8fd14f';
      status.textContent = 'Published ' + body.productCount + ' products (commit ' + body.commitSha.slice(0, 7) + ').';
    } else {
      status.style.color = '#ff3c1e';
      status.textContent = 'Deleted, but publish failed: ' + (body.error || 'unknown error') + '. Publish again from the Products tab.';
    }
  } catch (err) {
    status.style.color = '#ff3c1e';
    status.textContent = 'Deleted, but publish failed: ' + err.message + '. Publish again from the Products tab.';
  }
}

function wireDeleteButtons() {
  document.querySelectorAll('.delete-product-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var product = productsCache.find(function(p) { return p.id === btn.dataset.id; });
      if (!confirm('Delete this product and all its colors/images/variants from the database, and remove its live storefront page?')) return;
      btn.disabled = true;

      // The product_images ROWS cascade-delete via the FK when the product row
      // goes, but the underlying Storage files do not -- remove those first so
      // they don't become permanently orphaned (no row left anywhere to point
      // at them, so nothing in the admin UI could ever find or delete them again).
      var { data: images, error: imagesError } = await sb.from('product_images').select('storage_path').eq('product_id', btn.dataset.id);
      if (imagesError) {
        alert('Delete failed: could not look up this product\'s images (' + imagesError.message + ').');
        btn.disabled = false;
        return;
      }
      if (images && images.length) {
        var paths = images.map(function(img) { return img.storage_path; });
        var allPaths = paths.concat(paths.map(thumbStoragePath));
        var { error: removeError } = await sb.storage.from('product-images').remove(allPaths);
        if (removeError) {
          alert('Delete failed: could not remove this product\'s images from storage (' + removeError.message + '). Product was NOT deleted.');
          btn.disabled = false;
          return;
        }
      }

      // delete_product_and_renumber (not a plain .delete()) also shifts every
      // product above this one's position down by one, so deleting product
      // #39 makes #40 become #39, #41 become #40, and so on -- no gap left
      // in the sequence for Publish's page ordering to inherit.
      var { error: deleteError } = await sb.rpc('delete_product_and_renumber', { p_product_id: btn.dataset.id });
      if (deleteError) {
        alert('Delete failed: ' + deleteError.message + (images && images.length ? ' (note: this product\'s images were already removed from storage before this failure.)' : ''));
        btn.disabled = false;
        return;
      }
      loadProductsList();

      // Remove the now-orphaned PDP page from the live site in the same
      // commit -- otherwise it stays published forever, reachable directly
      // by URL even though nothing links to it anymore.
      if (product && product.brands && product.brands.folder_slug) {
        await publishExtraDeletes([product.brands.folder_slug + '/' + product.slug + '/index.html']);
      }
    });
  });
}

var openProductId = null;

function wireEditButtons() {
  document.querySelectorAll('.edit-product-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
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
      await renderEditForm(product);
      detail.classList.add('open');
    });
  });
}

function brandOptions(selectedId) {
  var primaries = brandsCache.filter(function(b) { return b.is_primary; });
  return primaries.map(function(primary) {
    var opts = '<option value="' + primary.id + '"' + (primary.id === selectedId ? ' selected' : '') + '>' + esc(primary.name) + '</option>';
    opts += brandsCache.filter(function(b) { return !b.is_primary && b.folder_slug === primary.folder_slug; })
      .map(function(collab) { return '<option value="' + collab.id + '"' + (collab.id === selectedId ? ' selected' : '') + '>&nbsp;&nbsp;↳ ' + esc(collab.name) + '</option>'; })
      .join('');
    return opts;
  }).join('');
}

async function renderEditForm(product) {
  if (!brandsCache.length) { await loadBrandsList(); }
  var detail = document.getElementById('product-detail-' + product.id);
  detail.innerHTML =
    '<form class="add-form" id="edit-form-' + product.id + '">' +
      '<div class="field"><label>Brand</label><select name="brand_id" required>' + brandOptions(product.brand_id) + '</select></div>' +
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
      '<div class="field"><label>Options</label>' + optionModeSelectHtml(product.option_mode || 'color') + '</div>' +
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
    var newOptionMode = form.option_mode.value;
    var { error } = await sb.from('products').update({
      brand_id: form.brand_id.value,
      name: form.name.value.trim(),
      price: parseFloat(form.price.value),
      cod_advance: parseFloat(form.cod_advance.value),
      category: form.category.value,
      sleeve_length: sleeveVal === '' ? null : sleeveVal,
      option_mode: newOptionMode,
      description: form.description.value.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', product.id);
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Saved.';
      // Only rebuild Colors & Stock when option_mode actually changed (its
      // Add-Option fields depend on it) -- rebuilding on every unrelated
      // product-field save (name/price/category/etc) tore down and
      // re-fetched every stock checkbox for no reason, and could show a
      // just-toggled checkbox as reverted if this fresh fetch raced ahead
      // of that toggle's own still-in-flight save (regression: this is
      // what "toggle stock, hit Save, see it revert" was -- the checkbox's
      // own write always persisted correctly, only the *display* was stale).
      var optionModeChanged = product.option_mode !== newOptionMode;
      product.option_mode = newOptionMode;
      if (optionModeChanged) renderColorsSection(product);
      loadProductsList();
    }
  });

  renderImagesSection(product); // Task 5
  renderColorsSection(product); // Task 6
}

document.getElementById('show-add-product-btn').addEventListener('click', function() {
  var wrap = document.getElementById('add-product-form-wrap');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    renderAddProductForm();
  } else {
    wrap.style.display = 'none';
  }
});

// Shared by the add- and edit-product forms. option_mode governs which
// fields the Colors & Stock section shows for this product's rows: 'color'
// (a real color, unchanged default), 'variant' (a free-text label only, no
// color picker -- e.g. "V1"), or 'both' (a real color plus an extra
// variant-text field on each row).
function optionModeSelectHtml(current) {
  var modes = [
    ['color', 'Color'],
    ['variant', 'Variant number'],
    ['both', 'Both (color + variant)'],
  ];
  return '<select name="option_mode" title="Whether this product\'s swatches show a color, a variant number, or both">' +
    modes.map(function(m) {
      return '<option value="' + m[0] + '"' + (m[0] === current ? ' selected' : '') + '>' + m[1] + '</option>';
    }).join('') +
  '</select>';
}

async function renderAddProductForm() {
  if (!brandsCache.length) { await loadBrandsList(); }
  var wrap = document.getElementById('add-product-form-wrap');
  wrap.innerHTML =
    '<form class="add-form" id="add-product-form">' +
      '<div class="field"><label>Brand</label><select name="brand_id" required>' + brandOptions(null) + '</select></div>' +
      '<div class="field"><label>Name</label><input type="text" name="name" required style="width:260px;" /></div>' +
      '<div class="field"><label>Slug</label><input type="text" name="slug" required placeholder="unique-url-slug" style="width:220px;" /></div>' +
      '<div class="field"><label>Price (₹)</label><input type="number" name="price" required style="width:100px;" /></div>' +
      '<div class="field"><label>COD Advance (₹)</label><input type="number" name="cod_advance" required value="0" style="width:100px;" /></div>' +
      '<div class="field"><label>Category</label><select name="category" required>' +
        ['t-shirt','compression','pants','jacket','dress','set'].map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Options</label>' + optionModeSelectHtml('color') + '</div>' +
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
      brand_id: form.brand_id.value,
      name: form.name.value.trim(),
      slug: form.slug.value.trim(),
      price: parseFloat(form.price.value),
      cod_advance: parseFloat(form.cod_advance.value),
      category: form.category.value,
      option_mode: form.option_mode.value,
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

function initProducts() {
  loadProductsList();
}

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

// Mirrors data.ts's thumbPath() -- "<dir>/<file>" -> "<dir>/thumbs/<file>".
// Kept as pure string logic (no DB column) so both sides stay in sync.
function thumbStoragePath(storagePath) {
  var slashIdx = storagePath.lastIndexOf('/');
  return storagePath.slice(0, slashIdx) + '/thumbs/' + storagePath.slice(slashIdx + 1);
}

// Resizes `file` down to at most maxDim on its longest side and re-encodes as
// WebP (real measured savings over JPEG: ~20% at full size, ~35% at thumb
// size, same visual quality) via canvas. Used for both derivatives this
// upload flow produces:
//   - the thumb (maxDim 380, quality 0.8) -- publish-site's render.ts points
//     the product-card slider and the PDP thumbnail strip at this instead of
//     the full-resolution original, since those contexts only ever display
//     an image at 64-380px and serving the original there wastes cached
//     egress for no visible benefit.
//   - the main/hero image itself (maxDim 1200, quality 0.82) -- capped so a
//     raw multi-thousand-pixel camera/phone photo can't quietly reintroduce
//     the same oversized-original problem a batch fix just cleaned up
//     (existing live photos already sit at 600-800px and look fine at the
//     PDP hero's 80vh display, so 1200px leaves real headroom).
// Resolves null (not a rejection) on any decode failure so a single bad file
// can't abort the whole upload loop.
function resizeToWebp(file, maxDim, quality) {
  return new Promise(function (resolve) {
    var img = new Image();
    var objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      // White background first -- canvas defaults to transparent, and WebP
      // export would otherwise composite onto black, putting a black matte
      // behind any image with real transparency.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/webp', quality);
    };
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

async function renderImagesSection(product) {
  var container = document.getElementById('images-section-' + product.id);
  container.innerHTML = '<p style="font-family:\'Space Mono\',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;">Images</p><div id="images-grid-' + product.id + '" style="display:flex;flex-wrap:wrap;gap:8px;"></div><input type="file" id="image-upload-' + product.id + '" accept="image/jpeg,image/png,image/webp" multiple style="margin-top:8px;" /><p class="msg" id="image-upload-msg-' + product.id + '"></p>';

  await refreshImagesGrid(product);

  document.getElementById('image-upload-' + product.id).addEventListener('change', async function(e) {
    var files = Array.from(e.target.files || []);
    var msg = document.getElementById('image-upload-msg-' + product.id);
    var successCount = 0;
    var failureMessages = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var { data: existing } = await sb.from('product_images').select('sort_order').eq('product_id', product.id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
      var nextSort = (existing ? existing.sort_order : -1) + 1;
      var storagePath = product.slug + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      // Main image is capped/re-encoded too (see resizeToWebp's doc comment)
      // -- falls back to uploading the original file untouched if canvas
      // decoding fails for some reason, so an unusual format still uploads
      // successfully instead of being silently dropped.
      var mainBlob = await resizeToWebp(file, 1200, 0.82);
      var { error: uploadError } = mainBlob
        ? await sb.storage.from('product-images').upload(storagePath, mainBlob, { contentType: 'image/webp', cacheControl: '31536000' })
        : await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type, cacheControl: '31536000' });
      if (uploadError) { failureMessages.push(file.name + ': ' + uploadError.message); continue; }
      // Thumbnail derivative lives one path segment down (see
      // thumbStoragePath) -- data.ts derives this exact path from
      // storage_path alone, so it must be "<same dir>/thumbs/<same
      // filename>" with no DB column to keep the two in sync. A
      // thumb-generation/upload failure is logged but never blocks the real
      // image from being saved -- a missing thumb just means that one image
      // temporarily falls back to whatever the browser does with a 404 src,
      // not a lost upload.
      var thumbPath = thumbStoragePath(storagePath);
      var thumbBlob = await resizeToWebp(file, 380, 0.8);
      if (thumbBlob) {
        var { error: thumbError } = await sb.storage.from('product-images').upload(thumbPath, thumbBlob, { contentType: 'image/webp', cacheControl: '31536000' });
        if (thumbError) console.warn('thumbnail upload failed for ' + file.name + ':', thumbError.message);
      } else {
        console.warn('thumbnail generation failed for ' + file.name);
      }
      var { error: rowError } = await sb.from('product_images').insert({ product_id: product.id, storage_path: storagePath, sort_order: nextSort });
      if (rowError) { failureMessages.push(file.name + ': ' + rowError.message); continue; }
      successCount++;
    }
    if (failureMessages.length) {
      msg.style.color = '#ff3c1e';
      msg.textContent = 'Uploaded ' + successCount + ' of ' + files.length + ' image(s). Failures: ' + failureMessages.join('; ');
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Uploaded ' + successCount + ' image(s).';
    }
    e.target.value = '';
    await refreshImagesGrid(product);
  });
}

async function refreshImagesGrid(product) {
  var productId = product.id;
  var { data: images, error } = await sb.from('product_images').select('id, storage_path, sort_order, color_id').eq('product_id', productId).order('sort_order', { ascending: true });
  var grid = document.getElementById('images-grid-' + productId);
  if (error) { grid.innerHTML = 'Failed to load images: ' + esc(error.message); return; }

  var { data: colors } = await sb.from('product_colors').select('id, label').eq('product_id', productId).order('label', { ascending: true });
  var colorLabelById = {};
  (colors || []).forEach(function(c) { colorLabelById[c.id] = c.label; });

  grid.innerHTML = images.map(function(img, i) {
    var url = sb.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl;
    var serial = '[Image #' + (i + 1) + ']';
    var assignedLabel = img.color_id ? (colorLabelById[img.color_id] || '(unknown color)') : '(unassigned)';
    var colorOptions = '<option value=""' + (!img.color_id ? ' selected' : '') + '>(unassigned)</option>' +
      (colors || []).map(function(c) {
        return '<option value="' + c.id + '"' + (c.id === img.color_id ? ' selected' : '') + '>' + esc(c.label) + '</option>';
      }).join('');
    return '<div style="position:relative;width:80px;">' +
      '<img src="' + esc(url) + '" style="width:80px;height:80px;object-fit:cover;border:1px solid var(--border);" />' +
      '<button class="btn danger delete-image-btn" data-image-id="' + img.id + '" data-storage-path="' + esc(img.storage_path) + '" style="position:absolute;top:2px;right:2px;padding:2px 6px;font-size:9px;">×</button>' +
      '<div style="font-size:10px;color:var(--muted);text-align:center;margin-top:2px;">' + serial + '</div>' +
      '<select class="image-color-select" data-image-id="' + img.id + '" style="width:80px;font-size:10px;margin-top:2px;">' + colorOptions + '</select>' +
      '<div class="image-color-caption" style="font-size:10px;color:var(--white);text-align:center;margin-top:2px;">' + esc(assignedLabel) + '</div>' +
    '</div>';
  }).join('') || '<span style="color:var(--muted);font-size:12px;">No images yet.</span>';

  var productInCache = productsCache.find(function(p) { return p.id === productId; });
  if (productInCache && images.length) {
    productInCache.cover_thumb_url = sb.storage.from('product-images').getPublicUrl(images[0].storage_path).data.publicUrl;
  }

  grid.querySelectorAll('.image-color-select').forEach(function(select) {
    select.addEventListener('change', async function() {
      var imageId = select.dataset.imageId;
      var newColorId = select.value || null;
      select.disabled = true;
      // If some color's cover currently points at this image, clear it --
      // once this image is (re)assigned or unassigned, that color no longer
      // owns it, so its cover pointer would otherwise go stale (data.ts's
      // renderer fallback silently substitutes a different image on the
      // live site, but this admin panel's own Thumbnail dropdown would show
      // "(no cover)" -- a real admin/live-site mismatch, not just cosmetic).
      var { error: clearError } = await sb.from('product_colors').update({ cover_image_id: null }).eq('cover_image_id', imageId);
      if (clearError) { select.disabled = false; alert('Assignment failed: ' + clearError.message); return; }
      var { error: updateError } = await sb.from('product_images').update({ color_id: newColorId }).eq('id', imageId);
      select.disabled = false;
      if (updateError) { alert('Assignment failed: ' + updateError.message); return; }
      await refreshImagesGrid(product);
      renderColorsSection(product);
    });
  });

  grid.querySelectorAll('.delete-image-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this image? If it was assigned to a color, that color loses this photo (and its thumbnail, if this was the one selected).')) return;
      var msg = document.getElementById('image-upload-msg-' + productId);
      var { error: removeError } = await sb.storage.from('product-images').remove([btn.dataset.storagePath, thumbStoragePath(btn.dataset.storagePath)]);
      if (removeError) {
        if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: ' + removeError.message; }
        return;
      }
      var { error: deleteError } = await sb.from('product_images').delete().eq('id', btn.dataset.imageId);
      if (deleteError) {
        if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: storage object removed but database row could not be deleted (' + deleteError.message + '). Please refresh and retry.'; }
        await refreshImagesGrid(product);
        return;
      }
      if (msg) { msg.style.color = '#8fd14f'; msg.textContent = 'Image deleted.'; }
      await refreshImagesGrid(product);
      renderColorsSection(product);
    });
  });
}

var COLOR_GROUP_PALETTE = ['Black','White','Grey','Red','Blue','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Denim','Uncategorized'];
var HEX_PATTERN = /^#[0-9a-f]{6}$/i;

// Mirrors classify_color_group's own palette/palette_hex arrays (schema.sql)
// and render.ts's GROUP_HEX -- a representative hex per named color group,
// so a 'variant'-mode row (no real hex of its own) can still show a color
// preview dot here driven by its Primary/Secondary Color selection.
// "Uncategorized" has no representative color; groupHex falls back to the
// same neutral "#333" the swatch already used before this feature.
var GROUP_HEX = {
  Black: '#141414', White: '#f0ede8', Grey: '#8a8a8a', Red: '#c41e1e',
  Blue: '#1c4aa0', Green: '#1c8a3a', Purple: '#5a1ca0', Pink: '#c41e8a',
  Orange: '#c46a1e', Navy: '#1c2c4a', Maroon: '#5a1a1a', Gold: '#c4a01c',
  Brown: '#5a3f2a', Cream: '#ede9e3', Denim: '#6b9fd4',
};
function groupHex(group) {
  return GROUP_HEX[group] || '#333';
}

async function renderColorsSection(product) {
  var container = document.getElementById('colors-section-' + product.id);
  var { data: colors, error } = await sb.from('product_colors').select('id, label, hex, color_group, secondary_color_group, variant_label, cover_image_id').eq('product_id', product.id).order('label', { ascending: true });
  if (error) { container.innerHTML = 'Failed to load colors: ' + esc(error.message); return; }

  // Governs which fields this product's rows show -- see optionModeSelectHtml's
  // doc comment for the three modes. 'variant' has no real color at all, so
  // the "label" input doubles as the variant text directly; 'both' shows the
  // color fields (unchanged) plus an extra variant-text input. Primary/
  // secondary color group are shown in EVERY mode, independent of whether
  // there's a real hex color -- they're a manual visual-categorization
  // choice for the storefront's color filter (e.g. a "Variant 1" row with
  // no hex at all can still be tagged Primary=Black so it shows up under
  // the Black filter), not a description of the swatch's own rendering.
  var mode = product.option_mode || 'color';
  var showColorFields = mode === 'color' || mode === 'both';
  var showVariantField = mode === 'both';
  var labelPlaceholder = mode === 'variant' ? 'Variant label (e.g. V1)' : 'Color label';

  // Same global sort_order numbering as the Images grid above, so an admin
  // can visually match a color's "Thumbnail: [Image #10]" against the photo
  // actually captioned "[Image #10]" there.
  var { data: allImages } = await sb.from('product_images').select('id, color_id').eq('product_id', product.id).order('sort_order', { ascending: true });
  var serialById = {};
  (allImages || []).forEach(function(img, i) { serialById[img.id] = i + 1; });

  function groupOptionsHtml(selected, includeNone) {
    var opts = includeNone ? ['<option value="">(none)</option>'] : [];
    COLOR_GROUP_PALETTE.forEach(function(g) {
      opts.push('<option value="' + g + '"' + (g === selected ? ' selected' : '') + '>' + g + '</option>');
    });
    return opts.join('');
  }

  container.innerHTML = '<p style="font-family:\'Space Mono\',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;">Colors & Stock</p>' +
    colors.map(function(c) {
      var ownImages = (allImages || []).filter(function(img) { return img.color_id === c.id; });
      var coverSelectOptions = ownImages.map(function(img) {
        return '<option value="' + img.id + '"' + (img.id === c.cover_image_id ? ' selected' : '') + '>[Image #' + serialById[img.id] + ']</option>';
      }).join('');
      return '<div class="color-row" data-color-id="' + c.id + '" style="border:1px solid var(--border);padding:10px;margin-bottom:8px;">' +
        '<div class="btn-row" style="align-items:center;">' +
          // Real hex for color/both mode (unchanged); a variant-mode row has
          // no hex of its own, so derive a preview from its Primary color
          // selection instead of a flat placeholder, plus a small corner
          // dot for Secondary when set -- same treatment as the storefront.
          '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:' + esc(showColorFields ? (c.hex || '#333') : groupHex(c.color_group)) + ';border:1px solid #444;position:relative;">' +
            (!showColorFields && c.secondary_color_group ? '<span style="position:absolute;bottom:-2px;right:-2px;width:9px;height:9px;border-radius:50%;background:' + esc(groupHex(c.secondary_color_group)) + ';border:1px solid #1c1c1c;"></span>' : '') +
          '</span>' +
          '<input type="text" class="color-label" value="' + esc(c.label) + '" placeholder="' + esc(labelPlaceholder) + '" style="width:120px;" />' +
          (showColorFields ? '<input type="text" class="color-hex" value="' + esc(c.hex || '') + '" placeholder="#rrggbb" style="width:90px;" />' : '') +
          (showVariantField ? '<input type="text" class="variant-label-input" value="' + esc(c.variant_label || '') + '" placeholder="Variant (e.g. V1)" style="width:100px;" />' : '') +
          '<select class="color-group-select" title="Primary color (auto-suggested from label/hex on blur, editable) -- used by the storefront\'s color filter">' + groupOptionsHtml(c.color_group, false) + '</select>' +
          '<select class="secondary-group-select" title="Secondary color, optional -- the storefront\'s color filter also matches on this">' + groupOptionsHtml(c.secondary_color_group || '', true) + '</select>' +
          '<select class="color-cover-select">' + '<option value="">(no cover)</option>' + coverSelectOptions + '</select>' +
          '<button class="btn secondary save-color-btn">Save</button>' +
          '<button class="btn danger delete-color-btn">Delete</button>' +
        '</div>' +
        '<div class="stock-grid" id="stock-grid-' + c.id + '" style="margin-top:8px;"></div>' +
      '</div>';
    }).join('') +
    '<div class="btn-row" style="margin-top:8px;">' +
      '<input type="text" id="new-color-label-' + product.id + '" placeholder="' + esc(labelPlaceholder) + '" style="width:140px;" />' +
      (showColorFields ? '<input type="text" id="new-color-hex-' + product.id + '" placeholder="#rrggbb" style="width:100px;" />' : '') +
      (showVariantField ? '<input type="text" id="new-variant-label-' + product.id + '" placeholder="Variant (e.g. V1)" style="width:100px;" />' : '') +
      '<select id="new-color-group-' + product.id + '" title="Primary color">' + groupOptionsHtml('Uncategorized', false) + '</select>' +
      '<select id="new-secondary-group-' + product.id + '" title="Secondary color, optional">' + groupOptionsHtml('', true) + '</select>' +
      '<button class="btn" id="add-color-btn-' + product.id + '">+ Add ' + (mode === 'variant' ? 'Variant' : 'Color') + '</button>' +
    '</div>' +
    '<p class="msg" id="colors-msg-' + product.id + '"></p>';

  colors.forEach(function(c) { renderStockGrid(c.id, product.id); }); // Task 7

  container.querySelectorAll('.save-color-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var row = btn.closest('.color-row');
      var colorId = row.dataset.colorId;
      var label = row.querySelector('.color-label').value.trim();
      var hexInput = row.querySelector('.color-hex');
      var hex = showColorFields && hexInput ? (hexInput.value.trim() || null) : null;
      var msg = document.getElementById('colors-msg-' + product.id);
      if (hex && !HEX_PATTERN.test(hex)) { msg.style.color = '#ff3c1e'; msg.textContent = 'Hex must look like #rrggbb.'; return; }
      var colorGroup = row.querySelector('.color-group-select').value;
      var secondaryColorGroup = row.querySelector('.secondary-group-select').value || null;
      var variantInput = row.querySelector('.variant-label-input');
      var variantLabel = showVariantField && variantInput ? (variantInput.value.trim() || null) : null;
      var coverImageId = row.querySelector('.color-cover-select').value || null;
      var { error } = await sb.from('product_colors').update({ label: label, hex: hex, color_group: colorGroup, secondary_color_group: secondaryColorGroup, variant_label: variantLabel, cover_image_id: coverImageId }).eq('id', colorId);
      if (error) { msg.style.color = '#ff3c1e'; msg.textContent = error.message; }
      else { msg.style.color = '#8fd14f'; msg.textContent = 'Color saved.'; renderColorsSection(product); }
    });
  });

  container.querySelectorAll('.color-hex').forEach(function(input) {
    input.addEventListener('blur', async function() {
      var hex = input.value.trim();
      var row = input.closest('.color-row');
      var label = row.querySelector('.color-label').value.trim();
      var groupSelect = row.querySelector('.color-group-select');
      if (!hex && !label) return;
      var { data: suggested, error } = await sb.rpc('classify_color_group', { hex: hex || null, label: label || null });
      if (!error && suggested && COLOR_GROUP_PALETTE.indexOf(suggested) !== -1) { groupSelect.value = suggested; }
    });
  });

  var newColorGroupSelect = document.getElementById('new-color-group-' + product.id);
  var newColorHexInput = document.getElementById('new-color-hex-' + product.id);
  if (newColorHexInput) {
    newColorHexInput.addEventListener('blur', async function() {
      var hex = newColorHexInput.value.trim();
      var label = document.getElementById('new-color-label-' + product.id).value.trim();
      if (!hex && !label) return;
      var { data: suggested, error } = await sb.rpc('classify_color_group', { hex: hex || null, label: label || null });
      if (!error && suggested && COLOR_GROUP_PALETTE.indexOf(suggested) !== -1) { newColorGroupSelect.value = suggested; }
    });
  }

  document.getElementById('add-color-btn-' + product.id).addEventListener('click', async function() {
    var labelInput = document.getElementById('new-color-label-' + product.id);
    var hexInput = document.getElementById('new-color-hex-' + product.id);
    var variantInput = document.getElementById('new-variant-label-' + product.id);
    var label = labelInput.value.trim();
    var hex = showColorFields && hexInput ? (hexInput.value.trim() || null) : null;
    var variantLabel = showVariantField && variantInput ? (variantInput.value.trim() || null) : null;
    var msg = document.getElementById('colors-msg-' + product.id);
    if (!label) { alert((mode === 'variant' ? 'Variant' : 'Color') + ' label is required.'); return; }
    if (hex && !HEX_PATTERN.test(hex)) { msg.style.color = '#ff3c1e'; msg.textContent = 'Hex must look like #rrggbb.'; return; }
    var colorGroup = newColorGroupSelect.value;
    var secondaryColorGroup = document.getElementById('new-secondary-group-' + product.id).value || null;

    // A brand-new color has no images assigned to it yet -- cover_image_id
    // starts null (there is nothing yet that could correctly be its cover;
    // seeding it from some other image, assigned or not, would misattribute
    // a photo to a color it doesn't show). The admin assigns photos to this
    // color from the Images grid above, then picks a Thumbnail here, same
    // immediate next step as visiting the stock grid below already is.
    var { data: newColor, error } = await sb.from('product_colors')
      .insert({ product_id: product.id, label: label, hex: hex, color_group: colorGroup, secondary_color_group: secondaryColorGroup, variant_label: variantLabel, cover_image_id: null })
      .select('id').single();
    if (error) { msg.style.color = '#ff3c1e'; msg.textContent = error.message; return; }

    // Seed all 4 sizes as in-stock so this color is never in the zero-variant
    // state that would otherwise persist until an admin manually visits its
    // stock grid -- see the comment above about what publishing a zero-variant
    // color does to the storefront card.
    var { error: variantsError } = await sb.from('product_variants').insert(
      ALL_SIZES.map(function(size) { return { product_id: product.id, color_id: newColor.id, size: size, in_stock: true }; })
    );
    if (variantsError) {
      msg.style.color = '#ff3c1e';
      msg.textContent = 'Color created, but stock rows failed to seed (' + variantsError.message + '). Check the stock grid below.';
    } else {
      labelInput.value = '';
      if (hexInput) hexInput.value = '';
      if (variantInput) variantInput.value = '';
    }
    renderColorsSection(product);
  });

  container.querySelectorAll('.delete-color-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this color and all its size/stock data?')) return;
      var colorId = btn.closest('.color-row').dataset.colorId;
      var { error } = await sb.from('product_colors').delete().eq('id', colorId);
      var msg = document.getElementById('colors-msg-' + product.id);
      if (error) { if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: ' + error.message; } return; }
      renderColorsSection(product);
    });
  });
}

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
        var { error: updateError } = await sb.from('product_variants').update({ in_stock: cb.checked }).eq('id', variantId);
        if (updateError) { alert('Stock update failed: ' + updateError.message); cb.checked = !cb.checked; }
      } else {
        var { data: newRow, error } = await sb.from('product_variants').insert({ product_id: productId, color_id: colorIdAttr, size: size, in_stock: cb.checked }).select('id').single();
        if (error) { alert('Stock update failed: ' + error.message); cb.checked = !cb.checked; }
        else if (newRow) { cb.dataset.variantId = newRow.id; }
      }
      cb.disabled = false;
    });
  });
}
