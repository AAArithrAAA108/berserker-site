// admin/dashboard/brands.js
// Depends on globals from index.html's inline script, loaded first: sb, esc.

var brandsCache = [];

async function loadBrandsList() {
  var { data, error } = await sb.from('brands').select('*').order('name', { ascending: true });
  document.getElementById('brands-loading').style.display = 'none';
  if (error) {
    document.getElementById('brands-loading').style.display = 'block';
    document.getElementById('brands-loading').textContent = 'Failed to load brands: ' + error.message;
    return;
  }
  brandsCache = data;
  document.getElementById('brands-table-wrap').style.display = 'block';
  renderBrandsTable();
}

function renderBrandsTable() {
  var tbody = document.getElementById('brands-tbody');
  tbody.innerHTML = '';
  var primaries = brandsCache.filter(function(b) { return b.is_primary; });
  primaries.forEach(function(primary) {
    tbody.appendChild(brandRow(primary, false));
    brandsCache.filter(function(b) { return !b.is_primary && b.folder_slug === primary.folder_slug; })
      .forEach(function(collab) { tbody.appendChild(brandRow(collab, true)); });
  });
  wireBrandRowButtons();
}

function brandRow(b, isCollab) {
  var thumbUrl = b.thumbnail_storage_path ? sb.storage.from('product-images').getPublicUrl(b.thumbnail_storage_path).data.publicUrl : '';
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td>' + (thumbUrl ? '<img src="' + esc(thumbUrl) + '" style="width:36px;height:36px;object-fit:cover;" />' : '<span style="color:var(--muted);">—</span>') + '</td>' +
    '<td>' + (isCollab ? '&nbsp;&nbsp;↳ ' : '') + esc(b.name) + '</td>' +
    '<td>' + esc(b.folder_slug) + '</td>' +
    '<td class="btn-row">' +
      '<button class="btn secondary rename-brand-btn" data-id="' + b.id + '" data-primary="' + b.is_primary + '">Rename</button>' +
      (b.is_primary ? '<button class="btn secondary replace-thumb-btn" data-id="' + b.id + '" data-folder="' + esc(b.folder_slug) + '" data-path="' + esc(b.thumbnail_storage_path || '') + '">Replace Thumbnail</button>' : '') +
    '</td>';
  return tr;
}

document.getElementById('show-add-brand-btn').addEventListener('click', function() {
  var wrap = document.getElementById('add-brand-form-wrap');
  if (wrap.style.display === 'none') { wrap.style.display = 'block'; renderAddBrandForm(); }
  else { wrap.style.display = 'none'; }
});

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function renderAddBrandForm() {
  var wrap = document.getElementById('add-brand-form-wrap');
  wrap.innerHTML =
    '<form class="add-form" id="add-brand-form">' +
      '<div class="field"><label>Name</label><input type="text" name="name" required style="width:200px;" /></div>' +
      '<div class="field"><label>Folder Slug</label><input type="text" name="folder_slug" required style="width:160px;" /></div>' +
      '<div class="field"><label>Thumbnail</label><input type="file" name="thumbnail" accept="image/*" required /></div>' +
      '<button type="submit" class="btn">Create Brand</button>' +
      '<p class="msg" id="add-brand-msg"></p>' +
    '</form>';

  var nameInput = wrap.querySelector('input[name="name"]');
  var slugInput = wrap.querySelector('input[name="folder_slug"]');
  var slugTouched = false;
  slugInput.addEventListener('input', function() { slugTouched = true; });
  nameInput.addEventListener('input', function() {
    if (!slugTouched) slugInput.value = slugify(nameInput.value);
  });

  document.getElementById('add-brand-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById('add-brand-msg');
    var file = form.thumbnail.files[0];
    var folderSlug = form.folder_slug.value.trim();
    var storagePath = '_brands/' + folderSlug + '-' + Date.now() + '.' + file.name.split('.').pop();

    var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
    if (uploadError) { msg.style.color = '#ff3c1e'; msg.textContent = 'Thumbnail upload failed: ' + uploadError.message; return; }

    var { error } = await sb.rpc('create_primary_brand', {
      p_name: form.name.value.trim(),
      p_folder_slug: folderSlug,
      p_thumbnail_storage_path: storagePath,
    });
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Brand created.';
      form.reset();
      loadBrandsList();
    }
  });
}

document.getElementById('show-add-collab-btn').addEventListener('click', function() {
  var wrap = document.getElementById('add-collab-form-wrap');
  if (wrap.style.display === 'none') { wrap.style.display = 'block'; renderAddCollabForm(); }
  else { wrap.style.display = 'none'; }
});

function renderAddCollabForm() {
  var wrap = document.getElementById('add-collab-form-wrap');
  var primaries = brandsCache.filter(function(b) { return b.is_primary; });
  wrap.innerHTML =
    '<form class="add-form" id="add-collab-form">' +
      '<div class="field"><label>Name</label><input type="text" name="name" required placeholder="e.g. YoungLA × Batman" style="width:240px;" /></div>' +
      '<div class="field"><label>Shares Folder Of</label><select name="parent_folder" required>' +
        primaries.map(function(p) { return '<option value="' + esc(p.folder_slug) + '">' + esc(p.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<button type="submit" class="btn">Create Collab</button>' +
      '<p class="msg" id="add-collab-msg"></p>' +
    '</form>';

  document.getElementById('add-collab-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.target;
    var msg = document.getElementById('add-collab-msg');
    var { error } = await sb.rpc('create_collab_brand', {
      p_name: form.name.value.trim(),
      p_parent_folder_slug: form.parent_folder.value,
    });
    if (error) {
      msg.style.color = '#ff3c1e';
      msg.textContent = error.message;
    } else {
      msg.style.color = '#8fd14f';
      msg.textContent = 'Collab brand created.';
      form.reset();
      loadBrandsList();
    }
  });
}

function wireBrandRowButtons() {
  document.querySelectorAll('.rename-brand-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var b = brandsCache.find(function(x) { return x.id === btn.dataset.id; });
      var newName = prompt('New name:', b.name);
      if (newName === null || newName.trim() === '') return;
      if (b.is_primary) {
        var newSlug = prompt('New folder slug:', b.folder_slug);
        if (newSlug === null || newSlug.trim() === '') return;
        if (newSlug.trim() !== b.folder_slug) {
          var { error: renameError } = await sb.rpc('rename_brand_folder', { p_old_slug: b.folder_slug, p_new_slug: newSlug.trim() });
          if (renameError) { alert('Rename failed: ' + renameError.message); return; }
          // Trigger a scoped publish to move the folder's live pages -- same
          // publish-site function, with renameFrom/renameTo so it deletes
          // the old folder's files in the same commit it writes the new one.
          var { data: sessionData } = await sb.auth.getSession();
          await fetch(SUPABASE_URL + '/functions/v1/publish-site', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionData.session.access_token },
            body: JSON.stringify({ renameFrom: b.folder_slug, renameTo: newSlug.trim() }),
          });
        }
      }
      var { error } = await sb.from('brands').update({ name: newName.trim() }).eq('id', b.id);
      if (error) { alert('Rename failed: ' + error.message); return; }
      loadBrandsList();
    });
  });

  document.querySelectorAll('.replace-thumb-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async function() {
        var file = input.files[0];
        if (!file) return;
        var storagePath = '_brands/' + btn.dataset.folder + '-' + Date.now() + '.' + file.name.split('.').pop();
        var { error: uploadError } = await sb.storage.from('product-images').upload(storagePath, file, { contentType: file.type });
        if (uploadError) { alert('Upload failed: ' + uploadError.message); return; }
        var { error } = await sb.from('brands').update({ thumbnail_storage_path: storagePath }).eq('id', btn.dataset.id);
        if (error) { alert('Update failed: ' + error.message); return; }
        if (btn.dataset.path) {
          await sb.storage.from('product-images').remove([btn.dataset.path]);
        }
        loadBrandsList();
      });
      input.click();
    });
  });
}
