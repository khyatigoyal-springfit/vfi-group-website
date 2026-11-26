/* Media library: resize + upload, library page, picker dialog. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;

  var MAX_EDGE = 2000, MAX_BYTES = 4 * 1024 * 1024, JPEG_Q = 0.85;
  var NOT_CONFIGURED = 'Image uploads are not set up on this server yet. An administrator needs to connect the image storage (Vercel Blob) before pictures can be added.';

  function userError(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  /* ---------- file checks & resize ---------- */
  function sniff(file) {
    return file.slice(0, 12).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var ascii = function (a, z) { var s = ''; for (var i = a; i < z; i++) s += String.fromCharCode(b[i]); return s; };
      if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
      if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
      if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
      return '';
    });
  }
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).then(function (bm) { return { src: bm, w: bm.width, h: bm.height, close: function () { if (bm.close) bm.close(); } }; });
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () { resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: function () {} }); };
        img.onerror = function () { reject(new Error('decode')); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(new Error('read')); };
      fr.readAsDataURL(file);
    });
  }
  function toBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, type, q); });
  }
  function hasAlpha(ctx, w, hh) {
    try {
      var d = ctx.getImageData(0, 0, w, hh).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) { return false; }
    return false;
  }
  function baseName(name) { return String(name || 'image').replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'image'; }

  /**
   * Validate and (if needed) shrink an image. Resolves {blob, name, type, width, height, size, thumb, resized}.
   * Rejects with Error(userMessage).
   */
  function prepare(file) {
    var nm = file.name || 'image';
    if (file.type === 'image/svg+xml' || /\.svgz?$/i.test(nm)) return Promise.reject(userError('SVG images are not accepted. Please use a PNG, JPEG or WebP image.'));
    if (file.type === 'application/pdf' || /\.pdf$/i.test(nm)) return Promise.reject(userError('PDF files cannot be used here. Please use a PNG, JPEG or WebP image.'));
    return sniff(file).then(function (kind) {
      if (!kind) throw userError('“' + nm + '” is not a PNG, JPEG or WebP image.');
      return decode(file).then(function (img) {
        var w = img.w, hh = img.h;
        if (!w || !hh) { img.close(); throw userError('That image could not be read.'); }
        var scale = Math.min(1, MAX_EDGE / Math.max(w, hh));
        var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(hh * scale));
        var canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        var ctx = canvas.getContext('2d');
        var alpha = false;
        if (kind !== 'image/jpeg') {
          ctx.drawImage(img.src, 0, 0, tw, th);
          alpha = hasAlpha(ctx, tw, th);
        }
        var passThrough = scale === 1 && file.size <= MAX_BYTES;
        var base = baseName(nm);
        var out;
        if (passThrough) {
          out = Promise.resolve({ blob: file, type: kind, w: tw, h: th, resized: false });
        } else {
          out = encode(img, w, hh, tw, th, alpha).then(function (r) { r.resized = true; return r; });
        }
        return out.then(function (r) {
          img.close();
          if (!r.blob || r.blob.size > MAX_BYTES) throw userError('This image is still larger than 4 MB after shrinking. Please choose a smaller picture.');
          var ext = r.type === 'image/png' ? 'png' : r.type === 'image/webp' ? 'webp' : 'jpg';
          var res = { blob: r.blob, name: passThrough ? nm : base + '.' + ext, type: r.type, width: r.w, height: r.h, size: r.blob.size, resized: r.resized, original: file.size, alpha: alpha };
          res.thumb = thumbOf(canvas, tw, th, alpha);
          return res;
        });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw userError('“' + nm + '” could not be read as an image.');
      });
    });
  }
  function encode(img, ow, oh, tw, th, alpha) {
    var w = tw, hh = th;
    var attempt = function (q, w2, h2) {
      var c = document.createElement('canvas');
      c.width = w2; c.height = h2;
      var cx = c.getContext('2d');
      if (!alpha) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w2, h2); }
      cx.drawImage(img.src, 0, 0, w2, h2);
      var type = alpha ? 'image/png' : 'image/jpeg';
      return toBlob(c, type, q).then(function (b) {
        if (b && b.size > MAX_BYTES && alpha && type === 'image/png') return toBlob(c, 'image/webp', JPEG_Q).then(function (wb) { return wb && wb.type === 'image/webp' ? { blob: wb, type: 'image/webp', w: w2, h: h2 } : { blob: b, type: type, w: w2, h: h2 }; });
        return { blob: b, type: type, w: w2, h: h2 };
      });
    };
    var step = function (q, w2, h2, n) {
      return attempt(q, w2, h2).then(function (r) {
        if (r.blob && r.blob.size <= MAX_BYTES) return r;
        if (n > 6) return r;
        if (!alpha && q > 0.6) return step(q - 0.1, w2, h2, n + 1);
        return step(Math.max(0.6, q), Math.round(w2 * 0.8), Math.round(h2 * 0.8), n + 1);
      });
    };
    return step(JPEG_Q, w, hh, 0);
  }
  function thumbOf(canvas, w, hh, alpha) {
    var s = Math.min(1, 160 / Math.max(w, hh));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(hh * s));
    var cx = c.getContext('2d');
    if (!alpha) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); }
    cx.drawImage(canvas, 0, 0, c.width, c.height);
    try { return c.toDataURL(alpha ? 'image/png' : 'image/jpeg', 0.7); } catch (e) { return ''; }
  }

  /* ---------- upload ---------- */
  function uploadBlob(prep, alt, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/media');
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'vfi-admin');
      xhr.setRequestHeader('Content-Type', prep.type);
      xhr.setRequestHeader('X-Filename', encodeURIComponent(prep.name));
      if (alt) xhr.setRequestHeader('X-Alt', encodeURIComponent(alt));
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onerror = function () { reject({ status: 0, code: 'network', error: '', data: {} }); };
      xhr.onload = function () {
        var j = {};
        try { j = JSON.parse(xhr.responseText); } catch (e) { j = {}; }
        if (xhr.status >= 200 && xhr.status < 300 && j.ok !== false && j.media) return resolve(j.media);
        reject(VFI.handleApiError({ status: xhr.status, code: j.code || '', error: j.error || '', data: j }, '/api/admin/media'));
      };
      xhr.send(prep.blob);
    });
  }

  function attachDrop(zone, onFiles, hoverClass) {
    var depth = 0;
    function has(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    zone.addEventListener('dragenter', function (e) { if (!has(e)) return; e.preventDefault(); depth++; zone.classList.add(hoverClass || 'drag'); });
    zone.addEventListener('dragover', function (e) { if (!has(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    zone.addEventListener('dragleave', function (e) { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove(hoverClass || 'drag'); });
    zone.addEventListener('drop', function (e) {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; zone.classList.remove(hoverClass || 'drag');
      onFiles(Array.prototype.slice.call(e.dataTransfer.files));
    });
  }

  /**
   * Upload dialog. opts: {files, single, title, onDone(rows)}
   */
  function openUpload(opts) {
    var single = !!opts.single;
    var rows = [];  // {file, state, prep, error, altInput, el}
    var list = h('ul', { class: 'up-list' });
    var banner = h('p', { class: 'msg', role: 'alert', hidden: true });
    var fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: !single, class: 'sr', tabIndex: -1, 'aria-hidden': 'true' });
    var drop = h('div', { class: 'dropzone' }, [
      h('p', { text: single ? 'Drop an image here, or' : 'Drop images here, or' }),
      VFI.btn(single ? 'Choose an image' : 'Choose images', '', function () { fileInput.click(); }, { 'data-autofocus': '' }),
      h('p', { class: 'muted small', text: 'PNG, JPEG or WebP. Large photos are shrunk to 2000 px on the longest side before upload (maximum 4 MB).' })
    ]);
    var busy = false, finished = false, blocked = false;
    var done = [];
    var ctrl = VFI.dialog({
      title: opts.title || (single ? 'Upload an image' : 'Upload images'),
      size: 'md',
      body: [banner, drop, list, fileInput],
      actions: [
        { label: 'Cancel', onClick: function () { if (busy) return false; } },
        { label: 'Upload', kind: 'primary', id: 'upGo', onClick: function () { return start(); } }
      ],
      onClose: function () { if (done.length && opts.onDone) opts.onDone(done); }
    });
    var goBtn = ctrl.buttons[1];
    goBtn.disabled = true;
    attachDrop(ctrl.el, addFiles);
    fileInput.addEventListener('change', function () { addFiles(Array.prototype.slice.call(fileInput.files)); fileInput.value = ''; });

    function readyRows() { return rows.filter(function (r) { return r.state === 'ready' || r.state === 'failed'; }); }
    function refreshBtn() {
      var n = readyRows().length;
      goBtn.disabled = busy || blocked || !n;
      goBtn.textContent = n > 1 ? 'Upload ' + n + ' images' : 'Upload';
    }
    function addFiles(files) {
      if (!files.length) return;
      if (single) { rows = rows.filter(function (r) { return r.state === 'done'; }); files = files.slice(0, 1); VFI.clear(list); rows.forEach(function (r) { list.appendChild(r.el); }); }
      files.forEach(function (f) { addRow(f); });
    }
    function addRow(file) {
      var r = { file: file, state: 'processing', prep: null, error: '' };
      var thumb = h('div', { class: 'up-thumb' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }));
      var name = h('div', { class: 'up-name', text: file.name || 'image' });
      var meta = h('div', { class: 'up-meta muted small', text: 'Checking…' });
      var altId = VFI.nextId('alt');
      r.altInput = h('input', { type: 'text', id: altId, maxlength: 200, placeholder: 'Describe the picture for screen readers (optional)' });
      var altWrap = h('div', { class: 'up-alt', hidden: true }, [h('label', { for: altId, class: 'small', text: 'Alt text' }), r.altInput]);
      var bar = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': 'Upload progress for ' + (file.name || 'image') });
      var status = h('p', { class: 'up-status small', role: 'status' });
      var rm = VFI.btn('Remove', 'btn-sm btn-text', function () { if (busy) return; rows.splice(rows.indexOf(r), 1); li.remove(); refreshBtn(); }, { 'aria-label': 'Remove ' + (file.name || 'image') + ' from the list' });
      var li = h('li', { class: 'up-row' }, [thumb, h('div', { class: 'up-info' }, [name, meta, altWrap, bar, status]), rm]);
      r.el = li;
      r.ui = { thumb: thumb, meta: meta, altWrap: altWrap, bar: bar, status: status, rm: rm };
      rows.push(r);
      list.appendChild(li);
      prepare(file).then(function (p) {
        r.prep = p; r.state = 'ready';
        VFI.clear(thumb);
        if (p.thumb) thumb.appendChild(h('img', { src: p.thumb, alt: '' }));
        var parts = [p.width + ' × ' + p.height + ' px', VFI.fmtBytes(p.size)];
        if (p.resized) parts.push('shrunk from ' + VFI.fmtBytes(p.original));
        meta.textContent = parts.join(' · ');
        altWrap.hidden = false;
        refreshBtn();
      }, function (e) {
        r.state = 'error'; r.error = (e && e.userMessage) || 'This file cannot be used.';
        VFI.clear(thumb); thumb.classList.add('bad');
        meta.textContent = '';
        status.textContent = r.error; status.className = 'up-status small err';
        status.setAttribute('role', 'alert');
        refreshBtn();
      });
      refreshBtn();
    }

    function start() {
      var todo = readyRows();
      if (!todo.length || busy) return false;
      busy = true; ctrl.setBusy(true);
      banner.hidden = true;
      var okCount = 0;
      var chain = Promise.resolve();
      todo.forEach(function (r) {
        chain = chain.then(function () {
          if (blocked) return;
          r.state = 'uploading';
          r.ui.bar.hidden = false; r.ui.bar.value = 0; r.ui.rm.hidden = true;
          r.ui.status.textContent = 'Uploading…'; r.ui.status.className = 'up-status small';
          r.altInput.disabled = true;
          return uploadBlob(r.prep, r.altInput.value.trim(), function (f) { r.ui.bar.value = Math.round(f * 100); }).then(function (m) {
            r.state = 'done'; okCount++; done.push(m);
            r.ui.bar.value = 100; r.ui.bar.hidden = true;
            r.ui.status.textContent = 'Uploaded'; r.ui.status.className = 'up-status small ok';
          }, function (err) {
            r.state = 'failed'; r.ui.bar.hidden = true; r.ui.rm.hidden = false; r.altInput.disabled = false;
            var msg = err.code === 'media_not_configured' ? NOT_CONFIGURED : VFI.errMsg(err, 'Upload failed.');
            if (err.code === 'media_not_configured') { blocked = true; banner.textContent = NOT_CONFIGURED; banner.hidden = false; }
            r.ui.status.textContent = msg; r.ui.status.className = 'up-status small err';
            r.ui.status.setAttribute('role', 'alert');
          });
        });
      });
      return chain.then(function () {
        busy = false; ctrl.setBusy(false);
        refreshBtn();
        if (okCount && okCount === todo.length) { VFI.toast(okCount === 1 ? 'Image uploaded.' : okCount + ' images uploaded.'); return true; }
        if (okCount) VFI.toast(okCount + ' uploaded; some failed.', true);
        else VFI.announce('Upload failed.');
        return false; // stay open to show errors
      });
    }

    if (opts.files && opts.files.length) addFiles(opts.files);
    return ctrl;
  }

  /* ---------- helpers for library + picker ---------- */
  function displayName(m) {
    var p = String(m.pathname || m.url || '').split('/').pop() || '';
    return p.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || 'image';
  }
  function metaLine(m) {
    var t = (m.content_type || '').replace('image/', '').toUpperCase().replace('JPEG', 'JPG');
    var parts = [];
    if (m.width && m.height) parts.push(m.width + ' × ' + m.height);
    parts.push(VFI.fmtBytes(m.size));
    if (t) parts.push(t);
    return parts.join(' · ');
  }
  function imgEl(m, cls) {
    var img = h('img', { src: m.url, alt: m.alt || '', loading: 'lazy', class: cls || '' });
    img.addEventListener('error', function () { img.classList.add('broken'); img.removeAttribute('alt'); img.alt = ''; });
    return img;
  }

  /* ---------- library page ---------- */
  var PAGE = 24;
  function mountLibrary(ctx) {
    var root = ctx.root;
    var state = { page: 1, rows: [], total: 0, loading: false };
    var gridBox = h('div', { class: 'media-box', 'aria-busy': 'false' });
    var pagerBox = h('div');
    var notice = h('p', { class: 'msg', role: 'alert', hidden: true });
    var upBtn = VFI.btn('Upload images', 'btn-primary', function () { openUpload({ onDone: function () { load(1); } }); });
    var wrap = h('div', { class: 'wrap media-page' }, [
      VFI.pageHead('Media library', 'Pictures you can use in any image field. Drag files onto this page to upload.', [upBtn]),
      notice, gridBox, pagerBox
    ]);
    root.appendChild(wrap);
    attachDrop(wrap, function (files) { if (files.length) openUpload({ files: files, onDone: function () { load(1); } }); }, 'drop-over');

    function load(page) {
      state.page = page || state.page;
      gridBox.setAttribute('aria-busy', 'true');
      VFI.clear(gridBox).appendChild(VFI.loadingBox());
      VFI.clear(pagerBox);
      VFI.api('GET', '/api/admin/media?page=' + state.page + '&pageSize=' + PAGE).then(function (j) {
        state.rows = j.rows || []; state.total = j.total || 0;
        var pages = Math.max(1, Math.ceil(state.total / PAGE));
        if (state.page > pages) return load(pages);
        gridBox.setAttribute('aria-busy', 'false');
        render();
      }, function (err) {
        gridBox.setAttribute('aria-busy', 'false');
        if (err.handled) return;
        VFI.clear(gridBox).appendChild(VFI.errorBox(err, function () { load(); }));
      });
    }
    function render() {
      VFI.clear(gridBox); VFI.clear(pagerBox);
      if (!state.rows.length) {
        gridBox.appendChild(VFI.stateBox('No images yet', 'Upload a PNG, JPEG or WebP picture to get started.', [VFI.btn('Upload images', 'btn-primary', function () { openUpload({ onDone: function () { load(1); } }); })]));
        return;
      }
      var grid = h('ul', { class: 'media-grid' });
      state.rows.forEach(function (m) { grid.appendChild(card(m)); });
      gridBox.appendChild(grid);
      pagerBox.appendChild(VFI.pager({ page: state.page, pageSize: PAGE, total: state.total }, function () { load(state.page - 1); window.scrollTo(0, 0); }, function () { load(state.page + 1); window.scrollTo(0, 0); }));
    }
    function card(m) {
      var altP = h('p', { class: 'm-alt' + (m.alt ? '' : ' none'), text: m.alt ? 'Alt: ' + m.alt : 'No alt text' });
      var name = displayName(m);
      var li = h('li', { class: 'm-card' }, [
        h('div', { class: 'm-thumb' }, imgEl(m)),
        h('div', { class: 'm-info' }, [
          h('p', { class: 'm-name', text: name, title: name }),
          h('p', { class: 'm-meta muted small', text: metaLine(m) }),
          altP
        ]),
        h('div', { class: 'm-actions' }, [
          VFI.btn('Edit alt text', 'btn-sm', function (e) { editAlt(m, altP, e.currentTarget); }, { 'aria-label': 'Edit alt text for ' + name }),
          VFI.btn('Copy URL', 'btn-sm', function () { VFI.copyText(m.url).then(function () { VFI.toast('Image URL copied.'); }, function () { VFI.toast('Could not copy. Select the URL manually.', true); }); }, { 'aria-label': 'Copy URL of ' + name }),
          VFI.btn('Delete', 'btn-sm btn-text btn-del', function (e) { del(m, e.currentTarget); }, { 'aria-label': 'Delete ' + name })
        ])
      ]);
      return li;
    }
    function editAlt(m, altP) {
      var id = VFI.nextId('alt');
      var input = h('input', { type: 'text', id: id, maxlength: 200 });
      input.value = m.alt || '';
      var err = h('p', { class: 'ferr', hidden: true });
      VFI.dialog({
        title: 'Alt text',
        size: 'sm',
        body: [
          h('p', { class: 'muted', text: 'Describe the picture in a short sentence. Screen readers read this aloud.' }),
          h('div', { class: 'field' }, [h('label', { for: id, text: 'Alt text for ' + displayName(m) }), input, err])
        ],
        actions: [{ label: 'Cancel' }, {
          label: 'Save', kind: 'primary', onClick: function () {
            return VFI.api('PATCH', '/api/admin/media', { id: m.id, alt: input.value }).then(function (j) {
              m.alt = (j.media && j.media.alt) != null ? j.media.alt : input.value.trim();
              altP.textContent = m.alt ? 'Alt: ' + m.alt : 'No alt text';
              altP.className = 'm-alt' + (m.alt ? '' : ' none');
              VFI.toast('Alt text saved.');
            }, function (e) {
              if (e.handled) return false;
              err.textContent = (e.data && e.data.errors && e.data.errors.alt) || VFI.errMsg(e); err.hidden = false; return false;
            });
          }
        }]
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.closest('.dlg').querySelector('.btn-primary').click(); } });
    }
    function del(m) {
      VFI.confirm({ title: 'Delete this image?', message: 'Delete “' + displayName(m) + '” from the media library? This cannot be undone.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        VFI.api('DELETE', '/api/admin/media?id=' + encodeURIComponent(m.id)).then(function () {
          VFI.toast('Image deleted.');
          load();
        }, function (err) {
          if (err.handled) return;
          if (err.status === 409 && err.code === 'in_use') return showInUse(m, err);
          VFI.toast(VFI.errMsg(err, 'Could not delete the image.'), true);
        });
      });
    }
    function showInUse(m, err) {
      var used = (err.data && err.data.used_in) || [];
      var ul = h('ul', { class: 'used-list' });
      var fill = function (schema) {
        used.forEach(function (u) {
          var desc = schema ? VFI.form.describePath(schema, u.path) : { labels: [u.path] };
          ul.appendChild(h('li', null, [
            h('strong', { text: u.where === 'published' ? 'Live site' : 'Draft' }),
            h('span', { text: ': ' + desc.labels.join(' › ') }),
            h('span', { class: 'muted small used-path', text: ' (' + u.path + ')' })
          ]));
        });
      };
      fill(VFI.schema);
      VFI.dialog({
        title: 'This image is in use',
        size: 'md',
        body: [
          h('p', { text: 'It was not deleted. Remove or replace it in these places first' + (used.some(function (u) { return u.where === 'published'; }) ? ', then publish the change' : '') + ':' }),
          ul
        ],
        actions: [{ label: 'OK', kind: 'primary' }]
      });
      if (!VFI.schema) VFI.loadSchema().then(function (s) { VFI.clear(ul); fill(s); }, function () {});
    }
    VFI.loadSchema().catch(function () {});
    load(1);
    return { unmount: function () {} };
  }

  /* ---------- picker dialog ---------- */
  function openPicker(opts) {
    var state = { page: 1, rows: [], total: 0 };
    var grid = h('ul', { class: 'pick-grid' });
    var status = h('p', { class: 'muted', role: 'status' });
    var more = VFI.btn('Show more', '', function () { load(state.page + 1); });
    var body = h('div', null, [
      h('div', { class: 'pick-bar' }, [
        VFI.btn('Upload new image', 'btn-primary', function () {
          openUpload({ single: true, onDone: function (rows) { if (rows[0]) { ctrl.close(); opts.onPick(rows[0]); } } });
        }, { 'data-autofocus': '' }),
        status
      ]),
      grid, h('div', { class: 'pick-more' }, more)
    ]);
    var ctrl = VFI.dialog({ title: 'Choose from media library', size: 'lg', body: body, actions: [{ label: 'Cancel' }] });
    more.hidden = true;
    function load(page) {
      status.textContent = 'Loading…';
      VFI.api('GET', '/api/admin/media?page=' + page + '&pageSize=24').then(function (j) {
        state.page = page; state.total = j.total || 0;
        (j.rows || []).forEach(function (m) {
          var b = h('button', { type: 'button', class: 'pick-tile' + (m.url === opts.current ? ' current' : ''), 'aria-label': 'Choose ' + displayName(m) + (m.alt ? ', ' + m.alt : ''), on: { click: function () { ctrl.close(); opts.onPick(m); } } }, [
            h('span', { class: 'pick-img' }, imgEl(m)),
            h('span', { class: 'pick-name', text: displayName(m) })
          ]);
          grid.appendChild(h('li', null, b));
        });
        state.rows = state.rows.concat(j.rows || []);
        more.hidden = state.rows.length >= state.total;
        status.textContent = state.total ? state.total + (state.total === 1 ? ' image' : ' images') + ' in the library' : 'The library is empty. Upload your first image.';
      }, function (err) {
        status.textContent = '';
        if (err.handled) return;
        grid.appendChild(h('li', { class: 'ferr', role: 'alert', text: VFI.errMsg(err, 'Could not load the media library.') }));
      });
    }
    load(1);
    return ctrl;
  }

  VFI.media = { prepare: prepare, uploadBlob: uploadBlob, openUpload: openUpload, openPicker: openPicker, NOT_CONFIGURED: NOT_CONFIGURED, attachDrop: attachDrop };
  VFI.register('media', { title: 'Media library', roles: ['admin', 'editor'], mount: mountLibrary });
})();
