/* Schema-driven form generator + client-side validation that mirrors lib/content/validate.js. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;

  var DEFAULT_MAX = 2000;
  var CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
  var BLOB_HOST_RE = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;
  var ASSET_RE = /^\/assets\/[A-Za-z0-9_./-]+$/;
  var SITE_PATH_RE = /^\/(?![/\\])[^\s\\\u0000-\u001F\u007F]*$/;
  var MAIL_RE = /^mailto:[^\s<>"]{1,300}$/i;
  var TEL_RE = /^tel:\+?[0-9 ()./-]{3,40}$/i;
  var REQ = 'This field is required';

  /* ---------- validation (same rules and messages as the server) ---------- */
  function cleanStr(v, multiline) {
    var s = v.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
    if (!multiline) s = s.replace(/[\n\t]+/g, ' ');
    return s.trim();
  }
  function urlError(s) {
    if (s.charAt(0) === '/') return SITE_PATH_RE.test(s) ? '' : 'Enter a valid site link such as /contact';
    if (/^mailto:/i.test(s)) return MAIL_RE.test(s) ? '' : 'Enter a valid email link (mailto:name@example.com)';
    if (/^tel:/i.test(s)) return TEL_RE.test(s) ? '' : 'Enter a valid phone link (tel:+911234567890)';
    if (/^https:\/\//i.test(s)) {
      if (/[\s<>"\\\u0000-\u001F\u007F]/.test(s)) return 'Enter a valid https:// link';
      try {
        var u = new URL(s);
        if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return 'Enter a valid https:// link';
        return '';
      } catch (e) { return 'Enter a valid https:// link'; }
    }
    return 'Links must start with https://, / , mailto: or tel:';
  }
  function imageError(s) {
    var bad = 'Image must be a /assets/ file or an uploaded image';
    if (s.charAt(0) === '/') return ASSET_RE.test(s) && s.indexOf('..') < 0 && s.indexOf('//') < 0 ? '' : bad;
    if (/^https:\/\//i.test(s)) {
      if (/[\s<>"\\\u0000-\u001F\u007F]/.test(s)) return bad;
      try {
        var u = new URL(s);
        if (u.protocol === 'https:' && BLOB_HOST_RE.test(u.hostname) && !u.username && !u.password && !u.port) return '';
      } catch (e) { /* fall through */ }
    }
    return bad;
  }
  function optVal(o) { return o && typeof o === 'object' ? o.value : o; }
  function optLabel(o) { return o && typeof o === 'object' ? (o.label != null ? o.label : o.value) : o; }
  function maxOf(f) { return typeof f.max === 'number' && f.max > 0 && f.type !== 'number' ? f.max : DEFAULT_MAX; }

  /** Message for one scalar value ('' when valid). Containers are handled by validateAll. */
  function scalarMsg(f, v) {
    var req = !!f.required, missing = v === undefined || v === null;
    switch (f.type) {
      case 'text': case 'textarea': case 'url': case 'image': {
        if (missing) return req ? REQ : '';
        if (typeof v !== 'string') return 'Must be text';
        var s = cleanStr(v, f.type === 'textarea'), max = maxOf(f);
        if (s.length > max) return 'Must be ' + max + ' characters or fewer';
        if (s === '') return req ? REQ : '';
        if (f.type === 'url') return urlError(s);
        if (f.type === 'image') return imageError(s);
        return '';
      }
      case 'number':
        if (missing) return req ? REQ : '';
        if (typeof v !== 'number' || !isFinite(v)) return 'Must be a number';
        if (typeof f.min === 'number' && v < f.min) return 'Must be ' + f.min + ' or more';
        if (typeof f.max === 'number' && v > f.max) return 'Must be ' + f.max + ' or less';
        return '';
      case 'select': {
        if (missing) return req ? REQ : '';
        if (typeof v !== 'string') return 'Must be text';
        var opts = (f.options || []).map(optVal);
        if (opts.indexOf(v) < 0) return 'Choose one of the listed options';
        if (v === '' && req) return REQ;
        return '';
      }
    }
    return '';
  }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function join(base, key) { return base ? base + '.' + key : key; }

  function validateFieldDeep(f, v, path, errors) {
    var req = !!f.required, missing = v === undefined || v === null;
    switch (f.type) {
      case 'stringList': {
        if (missing) { if (req) errors[path] = REQ; return; }
        if (!Array.isArray(v)) { errors[path] = 'Must be a list of text items'; return; }
        if (v.length > 200) { errors[path] = 'At most 200 items'; return; }
        if (req && v.length === 0) { errors[path] = 'Add at least one item'; return; }
        var max = maxOf(f);
        v.forEach(function (item, i) {
          var p = path + '[' + i + ']';
          if (typeof item !== 'string') { errors[p] = 'Must be text'; return; }
          var s = cleanStr(item, false);
          if (s.length > max) errors[p] = 'Must be ' + max + ' characters or fewer';
          else if (s === '') errors[p] = 'This item is empty';
        });
        return;
      }
      case 'object':
        if (missing) { if (req) errors[path] = 'This section is required'; return; }
        if (!isObj(v)) { errors[path] = 'Must be an object'; return; }
        validateObject(f.fields || [], v, path, errors);
        return;
      case 'list': {
        if (missing) { if (req) errors[path] = 'This list is required'; return; }
        if (!Array.isArray(v)) { errors[path] = 'Must be a list'; return; }
        var cap = f.maxItems > 0 ? Math.min(f.maxItems, 500) : 500;
        if (v.length > cap) { errors[path] = 'At most ' + cap + ' items'; return; }
        if (req && v.length === 0) { errors[path] = 'Add at least one item'; return; }
        v.forEach(function (item, i) {
          var p = path + '[' + i + ']';
          if (!isObj(item)) { errors[p] = 'Must be an object'; return; }
          validateObject(f.fields || [], item, p, errors);
        });
        return;
      }
      default: {
        var m = scalarMsg(f, v);
        if (m) errors[path] = m;
      }
    }
  }
  function validateObject(fields, obj, path, errors) {
    fields.forEach(function (f) { validateFieldDeep(f, obj[f.key], join(path, f.key), errors); });
  }
  /** Validate the whole document. Returns {path: message}. Keys use the same format as the server's 422 errors. */
  function validateAll(draft, schema) {
    var errors = {};
    (schema.sections || []).forEach(function (s) {
      var v = draft[s.key];
      if (v === undefined || v === null) { errors[s.key] = 'This section is required'; return; }
      validateFieldDeep({ key: s.key, type: s.type || 'object', fields: s.fields, required: false }, v, s.key, errors);
    });
    return errors;
  }
  function sectionOfPath(path) { return String(path).split(/[.\[]/)[0]; }

  /** Turn an error path into readable labels using the schema: ['Brands', 'Items', '#4', 'Website address'] */
  function describePath(schema, path) {
    var m = /^([^.\[]+)(.*)$/.exec(path);
    var sec = m && (schema.sections || []).filter(function (s) { return s.key === m[1]; })[0];
    if (!sec) return { section: sectionOfPath(path), labels: [path] };
    var labels = [sec.label], rest = m[2], fields = sec.fields || [], itemNo = null;
    while (rest) {
      if (rest.charAt(0) === '.') rest = rest.slice(1);
      var im = /^\[(\d+)\](.*)$/.exec(rest);
      if (im) { itemNo = +im[1] + 1; labels.push('#' + itemNo); rest = im[2]; continue; }
      var best = null;
      for (var i = 0; i < fields.length; i++) {
        var k = fields[i].key;
        if ((rest === k || rest.indexOf(k + '.') === 0 || rest.indexOf(k + '[') === 0) && (!best || k.length > best.key.length)) best = fields[i];
      }
      if (!best) { labels.push(rest); break; }
      if (labels[labels.length - 1] !== (best.label || best.key)) labels.push(best.label || best.key);
      rest = rest.slice(best.key.length);
      fields = best.fields || [];
    }
    return { section: sec.key, labels: labels };
  }

  /* ---------- value helpers ---------- */
  function newValue(f) {
    switch (f.type) {
      case 'text': case 'textarea': case 'url': case 'image': return '';
      case 'stringList': case 'list': return [];
      case 'object': return newObject(f.fields || []);
      case 'select': return f.required && f.options && f.options.length ? optVal(f.options[0]) : undefined;
      default: return undefined;
    }
  }
  function newObject(fields) {
    var o = {};
    fields.forEach(function (f) { var v = newValue(f); if (v !== undefined) o[f.key] = v; });
    return o;
  }
  function hasContent(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return true;
    if (Array.isArray(v)) return v.some(hasContent);
    if (typeof v === 'object') return Object.keys(v).some(function (k) { return hasContent(v[k]); });
    return !!v;
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function singular(label) {
    var s = String(label || 'item').toLowerCase().trim();
    if (/ies$/.test(s)) return s.replace(/ies$/, 'y');
    if (/(ss|us)$/.test(s)) return s;
    if (/s$/.test(s)) return s.replace(/s$/, '');
    return s;
  }
  function trunc(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function itemTitle(fields, item) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if ((f.type === 'text' || f.type === 'textarea') && typeof item[f.key] === 'string' && item[f.key].trim()) return trunc(item[f.key], 70);
    }
    return '';
  }

  /* ---------- rendering ---------- */
  var openState = typeof WeakMap === 'function' ? new WeakMap() : null;

  function reveal(node) {
    var c;
    while (node && (c = node.closest && node.closest('.item-card[data-open="false"],details.tgroup:not([open])'))) {
      if (c.tagName === 'DETAILS') c.open = true; else if (c._setOpen) c._setOpen(true);
      node = c.parentNode;
      if (!node) break;
    }
  }

  /**
   * ctx: {
   *   errors: {path: msg},            shared error map (mutated)
   *   reg: {path: {focusEl, setError(msg)}}  filled while rendering
   *   changed(path, field),           a value changed
   *   errorsChanged(),                the error map changed
   *   section
   * }
   */
  function setError(ctx, path, msg) {
    if (msg) ctx.errors[path] = msg; else delete ctx.errors[path];
    var r = ctx.reg[path];
    if (r && r.setError) r.setError(msg);
    if (ctx.errorsChanged) ctx.errorsChanged();
  }

  function fieldShell(f, path, ctx, opts) {
    var id = VFI.nextId('f');
    var helpId = f.help ? id + '-h' : null;
    var errEl = h('p', { class: 'ferr', id: id + '-e', hidden: true });
    var counter = opts && opts.counter ? h('span', { class: 'counter muted', 'aria-hidden': 'true' }) : null;
    var label = h('label', { for: id, class: 'flabel' }, [f.label || f.key, f.required ? h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null, f.required ? h('span', { class: 'sr', text: ' (required)' }) : null]);
    var shell = h('div', { class: 'field fld fld-' + f.type, dataset: { path: path } }, [
      label,
      f.help ? h('p', { class: 'help muted', id: helpId, text: f.help }) : null
    ]);
    var api = {
      id: id, node: shell, errEl: errEl, counter: counter,
      describedBy: function (input) { input.setAttribute('aria-describedby', [helpId, id + '-e'].filter(Boolean).join(' ')); },
      finish: function (control) {
        shell.appendChild(control);
        shell.appendChild(h('div', { class: 'fmeta' }, [errEl, counter]));
      },
      show: function (input, msg) {
        errEl.textContent = msg || '';
        errEl.hidden = !msg;
        if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
        shell.classList.toggle('has-error', !!msg);
      }
    };
    return api;
  }

  function renderScalar(f, obj, path, ctx) {
    var t = f.type, max = maxOf(f);
    var shell = fieldShell(f, path, ctx, { counter: (t === 'text' || t === 'textarea' || t === 'url') && typeof f.max === 'number' });
    var input;
    var cur = obj[f.key];

    function commit(v) {
      if (v === undefined) delete obj[f.key]; else obj[f.key] = v;
      ctx.changed(path, f);
    }
    function validateNow() {
      var m = scalarMsg(f, obj[f.key]);
      setError(ctx, path, m);
    }

    if (t === 'textarea') {
      input = h('textarea', { id: shell.id, rows: max > 400 ? 5 : 3 });
      input.value = typeof cur === 'string' ? cur : '';
    } else if (t === 'select') {
      input = h('select', { id: shell.id });
      if (!f.required) input.appendChild(h('option', { value: '', text: '— Not set —' }));
      (f.options || []).forEach(function (o) { input.appendChild(h('option', { value: optVal(o), text: optLabel(o) })); });
      input.value = typeof cur === 'string' ? cur : '';
      if (cur !== undefined && input.value !== cur) { /* value not in options: leave first option, validation flags it */ }
    } else if (t === 'number') {
      input = h('input', { id: shell.id, type: 'number', step: 'any', inputmode: 'decimal' });
      input.value = typeof cur === 'number' ? String(cur) : '';
    } else if (t === 'image') {
      return renderImage(f, obj, path, ctx, shell, validateNow, commit);
    } else {
      input = h('input', { id: shell.id, type: 'text', autocomplete: 'off' });
      if (t === 'url') input.setAttribute('inputmode', 'url');
      input.value = typeof cur === 'string' ? cur : '';
    }
    shell.describedBy(input);
    function upd() { if (shell.counter) { var n = input.value.length; shell.counter.textContent = n + ' / ' + f.max; shell.counter.classList.toggle('over', n > f.max); } }
    upd();

    input.addEventListener('input', function () {
      var v;
      if (t === 'number') v = input.value === '' ? undefined : parseFloat(input.value);
      else if (t === 'select') v = input.value === '' ? undefined : input.value;
      else v = input.value;
      if (t === 'number' && v !== undefined && isNaN(v)) v = undefined;
      commit(v);
      upd();
      if (ctx.errors[path] || t === 'select') validateNow();
    });
    input.addEventListener('blur', validateNow);
    if (t === 'select') input.addEventListener('change', function () { /* input handler covers it */ });

    shell.finish(input);
    ctx.reg[path] = { focusEl: input, node: shell.node, setError: function (m) { shell.show(input, m); } };
    if (ctx.errors[path]) shell.show(input, ctx.errors[path]);
    return shell.node;
  }

  function renderImage(f, obj, path, ctx, shell, validateNow, commit) {
    var ctl = VFI.imageControl({
      id: shell.id,
      field: f,
      get: function () { var v = obj[f.key]; return typeof v === 'string' ? v : ''; },
      set: function (v) { commit(v); validateNow(); },
      describedBy: [f.help ? shell.id + '-h' : '', shell.id + '-e'].filter(Boolean).join(' ')
    });
    shell.finish(ctl.node);
    ctx.reg[path] = { focusEl: ctl.focusEl, node: shell.node, setError: function (m) { shell.show(ctl.focusEl, m); } };
    if (ctx.errors[path]) shell.show(ctl.focusEl, ctx.errors[path]);
    return shell.node;
  }

  function groupHeading(f, ctx, path) {
    return h('div', { class: 'ghead' }, [
      h('span', { class: 'glabel', id: VFI.nextId('g'), text: f.label || f.key }),
      f.required ? h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null
    ]);
  }

  function renderObject(f, obj, path, ctx) {
    var sub = obj[f.key];
    if (!isObj(sub)) { sub = obj[f.key] = newObject(f.fields || []); }
    var legend = h('legend', { class: 'glegend', text: f.label || f.key });
    var fs = h('fieldset', { class: 'fobj', dataset: { path: path } }, [legend, f.help ? h('p', { class: 'help muted', text: f.help }) : null]);
    var errEl = h('p', { class: 'ferr', hidden: true });
    fs.appendChild(errEl);
    renderFields(f.fields || [], sub, path, ctx, fs);
    ctx.reg[path] = { focusEl: legend, node: fs, setError: function (m) { errEl.textContent = m || ''; errEl.hidden = !m; } };
    legend.tabIndex = -1;
    if (ctx.errors[path]) { errEl.textContent = ctx.errors[path]; errEl.hidden = false; }
    return fs;
  }

  function renderFields(fields, obj, path, ctx, container, groupTexts) {
    if (groupTexts) {
      var groups = [], byName = {};
      fields.forEach(function (f) {
        var parts = String(f.label || f.key).split(' · ');
        var g = parts.length > 1 ? parts[0] : 'Other';
        if (!byName[g]) { byName[g] = { name: g, fields: [] }; groups.push(byName[g]); }
        byName[g].fields.push({ f: f, label: parts.length > 1 ? parts.slice(1).join(' · ') : (f.label || f.key) });
      });
      groups.forEach(function (g, gi) {
        var det = h('details', { class: 'tgroup' }, h('summary', null, [h('span', { text: g.name }), h('span', { class: 'count', text: String(g.fields.length) })]));
        if (gi === 0) det.open = true;
        var body = h('div', { class: 'tgroup-body' });
        g.fields.forEach(function (x) {
          var copy = {};
          Object.keys(x.f).forEach(function (k) { copy[k] = x.f[k]; });
          copy.label = x.label;
          body.appendChild(renderAny(copy, obj, path, ctx, x.f));
        });
        det.appendChild(body);
        container.appendChild(det);
      });
      return;
    }
    fields.forEach(function (f) { container.appendChild(renderAny(f, obj, path, ctx)); });
  }

  function renderAny(f, obj, parentPath, ctx, origField) {
    var path = join(parentPath, f.key);
    var fl = origField || f;
    switch (f.type) {
      case 'object': return renderObject(f, obj, path, ctx);
      case 'list': return renderList(f, obj, path, ctx);
      case 'stringList': return renderStringList(f, obj, path, ctx);
      default: return renderScalar(f, obj, path, ctx);
    }
  }

  /* ----- string list ----- */
  function renderStringList(f, obj, path, ctx) {
    var fallback = [];
    var arr = function () { return Array.isArray(obj[f.key]) ? obj[f.key] : fallback; };
    var attach = function () { if (!Array.isArray(obj[f.key])) obj[f.key] = fallback; };
    var labelId = VFI.nextId('g');
    var errEl = h('p', { class: 'ferr', hidden: true });
    var ol = h('ol', { class: 'slist' });
    var addBtn = VFI.btn('Add ' + singular(f.label), 'btn-sm', function () { attach(); arr().push(''); ctx.changed(path, f); render(); var ins = ol.querySelectorAll('input'); if (ins.length) ins[ins.length - 1].focus(); });
    var wrap = h('div', { class: 'fld fld-list slist-wrap', role: 'group', 'aria-labelledby': labelId, dataset: { path: path } }, [
      h('div', { class: 'ghead' }, [h('span', { class: 'glabel', id: labelId, text: f.label || f.key }), f.required ? h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null]),
      f.help ? h('p', { class: 'help muted', text: f.help }) : null,
      errEl, ol,
      h('div', { class: 'list-foot' }, addBtn)
    ]);
    function clearReg() { Object.keys(ctx.reg).forEach(function (k) { if (k === path || k.indexOf(path + '[') === 0) delete ctx.reg[k]; }); }
    function render(focus) {
      clearReg();
      ctx.reg[path] = { focusEl: addBtn, node: wrap, setError: function (m) { errEl.textContent = m || ''; errEl.hidden = !m; } };
      VFI.clear(ol);
      arr().forEach(function (val, i) {
        var p = path + '[' + i + ']';
        var id = VFI.nextId('s');
        var e = h('p', { class: 'ferr', hidden: true, id: id + '-e' });
        var input = h('input', { type: 'text', id: id, autocomplete: 'off', 'aria-label': (f.label || f.key) + ' ' + (i + 1), 'aria-describedby': id + '-e' });
        input.value = typeof val === 'string' ? val : '';
        input.addEventListener('input', function () {
          arr()[i] = input.value; ctx.changed(p, f);
          if (ctx.errors[p]) check();
        });
        function check() {
          var s = cleanStr(input.value, false), max = maxOf(f), m = '';
          if (s.length > max) m = 'Must be ' + max + ' characters or fewer'; else if (s === '') m = 'This item is empty';
          setError(ctx, p, m);
        }
        input.addEventListener('blur', check);
        var last = i === arr().length - 1;
        var up = VFI.btn('↑', 'btn-icon', function () { move(i, -1, 'up'); }, { 'aria-label': 'Move ' + (f.label || 'item') + ' ' + (i + 1) + ' up', 'aria-disabled': i === 0 ? 'true' : null, dataset: { act: 'up' } });
        var down = VFI.btn('↓', 'btn-icon', function () { move(i, 1, 'down'); }, { 'aria-label': 'Move ' + (f.label || 'item') + ' ' + (i + 1) + ' down', 'aria-disabled': last ? 'true' : null, dataset: { act: 'down' } });
        var rm = VFI.btn('Remove', 'btn-icon btn-text', function () { arr().splice(i, 1); ctx.changed(path, f); render(); VFI.announce('Removed. ' + arr().length + ' items remain.'); var ins = ol.querySelectorAll('input'); (ins[Math.min(i, ins.length - 1)] || addBtn).focus(); }, { 'aria-label': 'Remove ' + (f.label || 'item') + ' ' + (i + 1) });
        ctx.reg[p] = { focusEl: input, node: input, setError: function (m) { e.textContent = m || ''; e.hidden = !m; if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); } };
        if (ctx.errors[p]) { e.textContent = ctx.errors[p]; e.hidden = false; input.setAttribute('aria-invalid', 'true'); }
        ol.appendChild(h('li', { class: 'srow' }, [h('div', { class: 'srow-in' }, [input, up, down, rm]), e]));
      });
      if (ctx.errors[path]) { errEl.textContent = ctx.errors[path]; errEl.hidden = false; }
      if (focus) { var b = ol.querySelectorAll('li')[focus.i]; if (b) { var x = b.querySelector('[data-act="' + focus.act + '"]'); if (x) x.focus(); } }
    }
    function move(i, d, act) {
      var a = arr(), j = i + d;
      if (j < 0 || j >= a.length) return;
      var t = a[i]; a[i] = a[j]; a[j] = t;
      ctx.changed(path, f);
      revalidateIfShown();
      render({ i: j, act: act });
      VFI.announce((f.label || 'Item') + ' moved ' + act + ' to position ' + (j + 1) + ' of ' + a.length);
    }
    function revalidateIfShown() { if (Object.keys(ctx.errors).some(function (k) { return k === path || k.indexOf(path + '[') === 0; })) revalidateSubtree(ctx, f, path, arr()); }
    render();
    return wrap;
  }

  /** Recompute errors under `path` after a structural change (indexes shifted). */
  function revalidateSubtree(ctx, f, path, data) {
    Object.keys(ctx.errors).forEach(function (k) { if (k === path || k.indexOf(path + '[') === 0 || k.indexOf(path + '.') === 0) delete ctx.errors[k]; });
    var fresh = {};
    validateFieldDeep(f, data, path, fresh);
    Object.keys(fresh).forEach(function (k) { ctx.errors[k] = fresh[k]; });
    // repaint everything registered below this path
    Object.keys(ctx.reg).forEach(function (k) {
      if (k === path || k.indexOf(path + '[') === 0 || k.indexOf(path + '.') === 0) { var r = ctx.reg[k]; if (r && r.setError) r.setError(ctx.errors[k] || ''); }
    });
    if (ctx.errorsChanged) ctx.errorsChanged();
  }

  /* ----- list of objects ----- */
  function renderList(f, obj, path, ctx) {
    var fallback = [];
    var arr = function () { return Array.isArray(obj[f.key]) ? obj[f.key] : fallback; };
    var attach = function () { if (!Array.isArray(obj[f.key])) obj[f.key] = fallback; };
    var fields = f.fields || [];
    var labelId = VFI.nextId('g');
    var errEl = h('p', { class: 'ferr', hidden: true });
    var ol = h('ol', { class: 'items' });
    var noun = singular(f.label || 'item');
    var addBtn = VFI.btn('Add ' + noun, 'btn-sm btn-primary', function () { add(); });
    var addBtn2 = VFI.btn('Add ' + noun, 'btn-sm', function () { add(); });
    var count = h('span', { class: 'muted gcount' });
    var expandAll = VFI.btn('Expand all', 'btn-sm btn-text', function () { setAll(true); });
    var collapseAll = VFI.btn('Collapse all', 'btn-sm btn-text', function () { setAll(false); });
    var foot = h('div', { class: 'list-foot' }, addBtn2);
    var wrap = h('section', { class: 'fld fld-list', 'aria-labelledby': labelId, dataset: { path: path } }, [
      h('div', { class: 'list-head' }, [
        h('div', null, [
          h('h3', { class: 'glabel', id: labelId, text: f.label || f.key }),
          f.help ? h('p', { class: 'help muted', text: f.help }) : null
        ]),
        h('div', { class: 'list-tools' }, [count, expandAll, collapseAll, addBtn])
      ]),
      errEl, ol, foot
    ]);

    function clearReg() { Object.keys(ctx.reg).forEach(function (k) { if (k.indexOf(path + '[') === 0) delete ctx.reg[k]; }); }
    function isOpen(item, n) {
      if (openState && openState.has(item)) return openState.get(item);
      return n <= 3;
    }
    function setAll(open) { arr().forEach(function (it) { if (openState) openState.set(it, open); }); Array.prototype.forEach.call(ol.children, function (li) { if (li._setOpen) li._setOpen(open, true); }); }

    function render(focus) {
      clearReg();
      ctx.reg[path] = { focusEl: addBtn, node: wrap, setError: function (m) { errEl.textContent = m || ''; errEl.hidden = !m; } };
      VFI.clear(ol);
      var a = arr();
      count.textContent = a.length + (a.length === 1 ? ' item' : ' items');
      expandAll.hidden = collapseAll.hidden = a.length < 2;
      foot.hidden = a.length < 4;
      a.forEach(function (item, i) { ol.appendChild(renderCard(item, i, a.length)); });
      if (!a.length) ol.appendChild(h('li', { class: 'empty-list muted', text: 'Nothing here yet. Use "Add ' + noun + '" to create the first one.' }));
      if (ctx.errors[path]) { errEl.textContent = ctx.errors[path]; errEl.hidden = false; } else errEl.hidden = true;
      if (focus) {
        var li = ol.children[focus.i];
        if (li) { var x = li.querySelector(focus.sel || '.card-toggle'); if (x) x.focus(); }
      }
    }

    function renderCard(item, i, n) {
      var p = path + '[' + i + ']';
      var bodyId = VFI.nextId('ib');
      var open = isOpen(item, n);
      var titleEl = h('span', { class: 'card-title' });
      var noEl = h('span', { class: 'card-no', 'aria-hidden': 'true', text: String(i + 1) });
      var chev = h('span', { class: 'chev', 'aria-hidden': 'true' });
      function refreshTitle() {
        var t = itemTitle(fields, item);
        titleEl.textContent = t || ('Untitled ' + noun);
        titleEl.classList.toggle('untitled', !t);
        return t || ('Untitled ' + noun);
      }
      refreshTitle();
      var toggle = h('button', { type: 'button', class: 'card-toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': bodyId }, [chev, noEl, titleEl]);
      var labelFor = function () { return noun + ' ' + (i + 1) + (itemTitle(fields, item) ? ', ' + itemTitle(fields, item) : ''); };
      var up = VFI.btn('↑', 'btn-icon', function () { move(i, -1); }, { 'aria-label': 'Move ' + labelFor() + ' up', title: 'Move up', 'aria-disabled': i === 0 ? 'true' : null, dataset: { act: 'up' } });
      var down = VFI.btn('↓', 'btn-icon', function () { move(i, 1); }, { 'aria-label': 'Move ' + labelFor() + ' down', title: 'Move down', 'aria-disabled': i === n - 1 ? 'true' : null, dataset: { act: 'down' } });
      var dup = VFI.btn('Duplicate', 'btn-icon btn-text', function () { duplicate(i); }, { 'aria-label': 'Duplicate ' + labelFor() });
      var rm = VFI.btn('Remove', 'btn-icon btn-text btn-del', function () { remove(i, item); }, { 'aria-label': 'Remove ' + labelFor() });
      var errBadge = h('span', { class: 'card-err', hidden: true, text: 'Needs attention' });
      var head = h('div', { class: 'card-head' }, [toggle, errBadge, h('div', { class: 'card-actions' }, [up, down, dup, rm])]);
      var body = h('div', { class: 'card-body', id: bodyId, hidden: !open });
      var li = h('li', { class: 'item-card', dataset: { open: open ? 'true' : 'false' } }, [head, body]);
      li._setOpen = function (o, silent) {
        li.dataset.open = o ? 'true' : 'false';
        toggle.setAttribute('aria-expanded', o ? 'true' : 'false');
        body.hidden = !o;
        if (openState) openState.set(item, o);
      };
      toggle.addEventListener('click', function () { li._setOpen(li.dataset.open !== 'true'); });
      toggle.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1); }
      });
      var itemCtx = ctx;
      renderFields(fields, item, p, itemCtx, body);
      // keep the title fresh and flag cards that contain errors
      body.addEventListener('input', function () { refreshTitle(); });
      li._refreshErr = function () {
        var has = Object.keys(ctx.errors).some(function (k) { return k === p || k.indexOf(p + '.') === 0 || k.indexOf(p + '[') === 0; });
        errBadge.hidden = !has;
        li.classList.toggle('has-error', has);
      };
      li._refreshErr();
      ctx.cards = ctx.cards || [];
      return li;
    }

    function revalidateIfShown() { if (Object.keys(ctx.errors).some(function (k) { return k === path || k.indexOf(path + '[') === 0; })) revalidateSubtree(ctx, f, path, arr()); }
    function add() {
      var it = newObject(fields);
      attach();
      arr().push(it);
      if (openState) openState.set(it, true);
      ctx.changed(path, f);
      render();
      var li = ol.children[arr().length - 1];
      var first = li && li.querySelector('input,textarea,select,button.img-choose');
      if (first) first.focus();
      VFI.announce('Added ' + noun + ' ' + arr().length + '. ' + arr().length + ' items in total.');
    }
    function move(i, d) {
      var a = arr(), j = i + d;
      if (j < 0 || j >= a.length) return;
      var t = a[i]; a[i] = a[j]; a[j] = t;
      ctx.changed(path, f);
      revalidateIfShown();
      render({ i: j, sel: '[data-act="' + (d < 0 ? 'up' : 'down') + '"]' });
      VFI.announce(trunc(itemTitle(fields, a[j]) || noun, 40) + ' moved ' + (d < 0 ? 'up' : 'down') + ' to position ' + (j + 1) + ' of ' + a.length);
    }
    function duplicate(i) {
      var a = arr(), c = clone(a[i]);
      a.splice(i + 1, 0, c);
      if (openState) openState.set(c, true);
      ctx.changed(path, f);
      revalidateIfShown();
      render({ i: i + 1 });
      VFI.announce('Duplicated. ' + noun + ' ' + (i + 2) + ' is the copy.');
    }
    function remove(i, item) {
      var go = function () {
        arr().splice(i, 1);
        ctx.changed(path, f);
        revalidateIfShown();
        render();
        var li = ol.children[Math.min(i, arr().length - 1)];
        var t = li && li.querySelector ? li.querySelector('.card-toggle') : null;
        (t || addBtn).focus();
        VFI.announce('Removed ' + noun + ' ' + (i + 1) + '. ' + arr().length + ' remain.');
      };
      if (!hasContent(item)) return go();
      var title = itemTitle(fields, item);
      VFI.confirm({
        title: 'Remove this ' + noun + '?',
        message: 'Remove ' + noun + ' ' + (i + 1) + (title ? ' (“' + title + '”)' : '') + '? This takes effect when you save the draft.',
        confirmLabel: 'Remove', danger: true
      }).then(function (ok) { if (ok) go(); else { var li = ol.children[i]; var b = li && li.querySelector('.btn-del'); if (b) b.focus(); } });
    }

    wrap._refreshCards = function () { Array.prototype.forEach.call(ol.children, function (li) { if (li._refreshErr) li._refreshErr(); }); };
    render();
    return wrap;
  }

  /**
   * Build the form for one schema section.
   * @returns {node, reg}
   */
  function buildSection(section, draft, ctx) {
    ctx.reg = {};
    ctx.section = section;
    if (!isObj(draft[section.key])) draft[section.key] = {};
    var data = draft[section.key];
    var root = h('div', { class: 'section-form' });
    var errEl = h('p', { class: 'ferr', hidden: true });
    root.appendChild(errEl);
    ctx.reg[section.key] = { focusEl: null, node: root, setError: function (m) { errEl.textContent = m || ''; errEl.hidden = !m; } };
    if (ctx.errors[section.key]) { errEl.textContent = ctx.errors[section.key]; errEl.hidden = false; }
    renderFields(section.fields || [], data, section.key, ctx, root, section.key === 'texts');
    return root;
  }

  function focusPath(ctx, path) {
    var r = ctx.reg[path];
    if (!r || !r.node || !document.body.contains(r.node)) return false;
    reveal(r.node);
    var el = r.focusEl || r.node;
    if (el && el.focus) el.focus({ preventScroll: true });
    (r.node.scrollIntoView ? r.node : el).scrollIntoView({ block: 'center', behavior: 'auto' });
    return true;
  }

  VFI.form = {
    validateAll: validateAll,
    scalarMsg: scalarMsg,
    sectionOfPath: sectionOfPath,
    describePath: describePath,
    buildSection: buildSection,
    focusPath: focusPath,
    setError: setError,
    refreshCards: function (root) { Array.prototype.forEach.call(root.querySelectorAll('.fld-list'), function (n) { if (n._refreshCards) n._refreshCards(); }); }
  };
})();
