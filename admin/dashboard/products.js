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
        var { error: removeError } = await sb.storage.from('product-images').remove(paths);
        if (removeError) {
          alert('Delete failed: could not remove this product\'s images from storage (' + removeError.message + '). Product was NOT deleted.');
          btn.disabled = false;
          return;
        }
      }

      var { error: deleteError } = await sb.from('products').delete().eq('id', btn.dataset.id);
      if (deleteError) {
        alert('Delete failed: ' + deleteError.message + (images && images.length ? ' (note: this product\'s images were already removed from storage before this failure.)' : ''));
        btn.disabled = false;
        return;
      }
      loadProductsList();
    });
  });
}

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

async function renderImagesSection(product) {
  var container = document.getElementById('images-section-' + product.id);
  container.innerHTML = '<p style="font-family:\'Space Mono\',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;">Images</p><div id="images-grid-' + product.id + '" style="display:flex;flex-wrap:wrap;gap:8px;"></div><input type="file" id="image-upload-' + product.id + '" accept="image/jpeg,image/png,image/webp" multiple style="margin-top:8px;" /><p class="msg" id="image-upload-msg-' + product.id + '"></p>';

  await refreshImagesGrid(product.id);

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
      var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
      if (uploadError) { failureMessages.push(file.name + ': ' + uploadError.message); continue; }
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
      var msg = document.getElementById('image-upload-msg-' + productId);
      var { error: removeError } = await sb.storage.from('product-images').remove([btn.dataset.storagePath]);
      if (removeError) {
        if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: ' + removeError.message; }
        return;
      }
      var { error: deleteError } = await sb.from('product_images').delete().eq('id', btn.dataset.imageId);
      if (deleteError) {
        if (msg) { msg.style.color = '#ff3c1e'; msg.textContent = 'Delete failed: storage object removed but database row could not be deleted (' + deleteError.message + '). Please refresh and retry.'; }
        await refreshImagesGrid(productId);
        return;
      }
      if (msg) { msg.style.color = '#8fd14f'; msg.textContent = 'Image deleted.'; }
      await refreshImagesGrid(productId);
    });
  });
}

var COLOR_GROUP_PALETTE = ['Black','White','Grey','Red','Blue','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Denim','Uncategorized'];
var HEX_PATTERN = /^#[0-9a-f]{6}$/i;

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
      var groupSelectOptions = COLOR_GROUP_PALETTE.map(function(g) {
        return '<option value="' + g + '"' + (g === c.color_group ? ' selected' : '') + '>' + g + '</option>';
      }).join('');
      return '<div class="color-row" data-color-id="' + c.id + '" style="border:1px solid var(--border);padding:10px;margin-bottom:8px;">' +
        '<div class="btn-row" style="align-items:center;">' +
          '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:' + esc(c.hex || '#333') + ';border:1px solid #444;"></span>' +
          '<input type="text" class="color-label" value="' + esc(c.label) + '" style="width:120px;" />' +
          '<input type="text" class="color-hex" value="' + esc(c.hex || '') + '" placeholder="#rrggbb" style="width:90px;" />' +
          '<select class="color-group-select" title="Color group (auto-suggested from label/hex on blur, editable)">' + groupSelectOptions + '</select>' +
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
      var msg = document.getElementById('colors-msg-' + product.id);
      if (hex && !HEX_PATTERN.test(hex)) { msg.style.color = '#ff3c1e'; msg.textContent = 'Hex must look like #rrggbb.'; return; }
      var colorGroup = row.querySelector('.color-group-select').value;
      var coverImageId = row.querySelector('.color-cover-select').value || null;
      var { error } = await sb.from('product_colors').update({ label: label, hex: hex, color_group: colorGroup, cover_image_id: coverImageId }).eq('id', colorId);
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

  document.getElementById('add-color-btn-' + product.id).addEventListener('click', async function() {
    var labelInput = document.getElementById('new-color-label-' + product.id);
    var hexInput = document.getElementById('new-color-hex-' + product.id);
    var label = labelInput.value.trim();
    var hex = hexInput.value.trim() || null;
    var msg = document.getElementById('colors-msg-' + product.id);
    if (!label) { alert('Color label is required.'); return; }
    if (hex && !HEX_PATTERN.test(hex)) { msg.style.color = '#ff3c1e'; msg.textContent = 'Hex must look like #rrggbb.'; return; }
    var colorGroup = 'Uncategorized';
    var { data: suggested } = await sb.rpc('classify_color_group', { hex: hex, label: label });
    if (suggested) colorGroup = suggested;

    // Inherit the product's first uploaded image as this color's cover, if one
    // exists, rather than leaving it null -- a color with no cover image and
    // (until an admin visits the stock grid below) no variant rows would make
    // Publish's storefront card show a broken image and zero size buttons for
    // the WHOLE product if this color happens to sort first. If the product
    // has no images uploaded yet, leave cover_image_id null -- that's a more
    // visible gap an admin using this tab would notice immediately.
    var coverImageId = coverOptions.length ? coverOptions[0].id : null;

    var { data: newColor, error } = await sb.from('product_colors')
      .insert({ product_id: product.id, label: label, hex: hex, color_group: colorGroup, cover_image_id: coverImageId })
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
      hexInput.value = '';
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
