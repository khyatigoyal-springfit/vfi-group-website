/* Enquiries: status tabs, search, list/cards, detail drawer with status + notes, CSV export. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h, $ = VFI.$;

  var STATUSES = ['new', 'in_progress', 'contacted', 'closed', 'spam'];
  var LABELS = { new: 'New', in_progress: 'In progress', contacted: 'Contacted', closed: 'Closed', spam: 'Spam' };
  var TABS = [
    { key: 'active', label: 'Active', param: '' },
    { key: 'new', label: 'New', param: 'new' },
    { key: 'in_progress', label: 'In progress', param: 'in_progress' },
    { key: 'contacted', label: 'Contacted', param: 'contacted' },
    { key: 'closed', label: 'Closed', param: 'closed' },
    { key: 'spam', label: 'Spam', param: 'spam' },
    { key: 'all', label: 'All', param: 'all' }
  ];
  var PAGE_SIZE = 25;
  var stash = null; // unsaved drawer edits kept across a session expiry

  VFI.onSessionExpired = function () {
    var d = document.getElementById('enqDrawer');
    if (d && !d.hidden && d._snapshot) stash = d._snapshot();
  };

  function snippet(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }
  function fmtRel(iso) {
    var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(d)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return '';
  }
  function badge(status) { return h('span', { class: 'badge b-' + (LABELS[status] ? status : 'closed'), text: LABELS[status] || status }); }
  function msgOf(r) { return r.message != null ? r.message : (r.msg || ''); }
  function tabOf(key) { return TABS.filter(function (t) { return t.key === key; })[0] || TABS[0]; }

  function mount(ctx) {
    var state = { tab: 'active', q: '', page: 1, rows: [], total: 0, counts: null, reqId: 0, exporting: false, open: null };
    var root = ctx.root;

    var refreshBtn = VFI.btn('Refresh', '', function () { load(); });
    var exportBtn = VFI.btn('Export CSV', 'btn-primary', function () { exportCsv(); });
    var tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Filter by status' });
    var qEl = h('input', { id: 'enqQ', type: 'search', placeholder: 'Search enquiries', autocomplete: 'off', maxlength: 200 });
    var qClear = h('button', { type: 'button', class: 'clear', 'aria-label': 'Clear search', text: '×', hidden: true });
    var listStatus = h('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });
    var listBody = h('div');
    var listBox = h('div', { class: 'card list-box', 'aria-busy': 'false' }, listBody);
    var pagerInfo = h('span', { class: 'muted' });
    var prevBtn = VFI.btn('Previous', '', function () { if (state.page > 1) { state.page--; writeUrl(true); load(); window.scrollTo(0, 0); } });
    var nextBtn = VFI.btn('Next', '', function () { state.page++; writeUrl(true); load(); window.scrollTo(0, 0); });
    var pager = h('nav', { class: 'pager', 'aria-label': 'Pagination', hidden: true }, [pagerInfo, h('span', { class: 'pager-btns' }, [prevBtn, nextBtn])]);

    root.appendChild(h('div', { class: 'wrap' }, [
      VFI.pageHead('Enquiries', null, [refreshBtn, exportBtn]),
      h('div', { class: 'tabs-wrap' }, tabsEl),
      h('div', { class: 'search' }, [h('label', { for: 'enqQ', class: 'sr', text: 'Search enquiries' }), qEl, qClear]),
      listStatus, listBox, pager
    ]));

    /* ----- URL state (lives in the hash query) ----- */
    function readUrl(p) {
      var q = p.query;
      var s = q.get('status') || '';
      state.tab = 'active';
      TABS.forEach(function (t) { if (t.param && t.param === s) state.tab = t.key; });
      state.q = (q.get('q') || '').slice(0, 200);
      var pg = parseInt(q.get('page'), 10);
      state.page = pg > 0 ? pg : 1;
    }
    function writeUrl(push) {
      var p = new URLSearchParams();
      var t = tabOf(state.tab);
      if (t.param) p.set('status', t.param);
      if (state.q) p.set('q', state.q);
      if (state.page > 1) p.set('page', String(state.page));
      var qs = p.toString();
      var hash = '#/enquiries' + (qs ? '?' + qs : '');
      if (hash === location.hash) return;
      VFI.setHash(hash, push);
    }
    function syncControls() {
      qEl.value = state.q;
      qClear.hidden = !state.q;
      renderTabs();
    }

    /* ----- tabs ----- */
    function countFor(key) {
      var c = state.counts;
      if (!c) return null;
      var active = (c.new || 0) + (c.in_progress || 0) + (c.contacted || 0) + (c.closed || 0);
      if (key === 'active') return active;
      if (key === 'all') return active + (c.spam || 0);
      return c[key] || 0;
    }
    function renderTabs() {
      VFI.clear(tabsEl);
      TABS.forEach(function (t) {
        var b = h('button', { type: 'button', class: 'tab' + (t.key === 'new' ? ' is-new' : ''), id: 'tab-' + t.key, role: 'tab', 'aria-selected': t.key === state.tab ? 'true' : 'false', tabIndex: t.key === state.tab ? 0 : -1, dataset: { key: t.key } }, h('span', { text: t.label }));
        var n = countFor(t.key);
        if (n !== null) b.appendChild(h('span', { class: 'count' + (n === 0 ? ' zero' : ''), text: String(n) }));
        tabsEl.appendChild(b);
      });
    }
    function selectTab(key) {
      if (key === state.tab) return;
      state.tab = key; state.page = 1;
      writeUrl(true); renderTabs(); load();
    }
    tabsEl.addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (b) selectTab(b.dataset.key); });
    tabsEl.addEventListener('keydown', function (e) {
      var keys = TABS.map(function (t) { return t.key; });
      var i = keys.indexOf(state.tab), n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % keys.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + keys.length) % keys.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = keys.length - 1;
      if (n < 0) return;
      e.preventDefault();
      selectTab(keys[n]);
      var nb = $('tab-' + keys[n]);
      if (nb) { nb.focus(); nb.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });

    /* ----- search ----- */
    var qTimer;
    qEl.addEventListener('input', function () { qClear.hidden = !qEl.value; clearTimeout(qTimer); qTimer = setTimeout(applySearch, 300); });
    qEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(qTimer); applySearch(); } });
    function applySearch() {
      clearTimeout(qTimer);
      var v = qEl.value.trim();
      if (v === state.q) return;
      state.q = v; state.page = 1;
      writeUrl(false); load();
    }
    qClear.addEventListener('click', function () {
      qEl.value = ''; qClear.hidden = true; clearTimeout(qTimer);
      if (state.q) { state.q = ''; state.page = 1; writeUrl(false); load(); }
      qEl.focus();
    });

    /* ----- list ----- */
    function query(extra) {
      var p = new URLSearchParams();
      p.set('status', tabOf(state.tab).param);
      p.set('q', state.q);
      if (extra) Object.keys(extra).forEach(function (k) { p.set(k, extra[k]); });
      return p.toString();
    }
    function load(cb, silent) {
      var id = ++state.reqId;
      if (!silent) {
        listBox.setAttribute('aria-busy', 'true');
        renderSkeleton();
        listStatus.textContent = 'Loading enquiries…';
      }
      VFI.api('GET', '/api/admin/enquiries?' + query({ page: state.page, pageSize: PAGE_SIZE })).then(function (j) {
        if (id !== state.reqId) return;
        state.rows = j.rows || [];
        state.total = j.total || 0;
        state.counts = j.counts || state.counts;
        var pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
        if (state.page > pages) { state.page = pages; writeUrl(false); return load(cb, silent); }
        listBox.setAttribute('aria-busy', 'false');
        renderTabs(); renderList();
        if (cb) cb();
      }, function (err) {
        if (id !== state.reqId || err.handled) return;
        listBox.setAttribute('aria-busy', 'false');
        renderError(err);
      });
    }
    function renderSkeleton() {
      VFI.clear(listBody).appendChild(VFI.loadingBox());
      pager.hidden = true;
    }
    function renderError(err) {
      VFI.clear(listBody);
      pager.hidden = true;
      var msg = err.status === 403 ? 'You do not have access to enquiries.' : VFI.errMsg(err, 'Could not load enquiries.');
      listBody.appendChild(VFI.stateBox(msg, null, err.status === 403 ? [] : [VFI.btn('Retry', 'btn-primary', function () { load(); })], true));
      listStatus.textContent = msg;
    }
    function renderList() {
      VFI.clear(listBody);
      if (!state.rows.length) {
        pager.hidden = true;
        var acts = [];
        if (state.q || state.tab !== 'active') acts.push(VFI.btn('Clear filters', '', function () { state.q = ''; state.tab = 'active'; state.page = 1; writeUrl(true); syncControls(); load(); }));
        listBody.appendChild(VFI.stateBox('No enquiries match', state.q ? 'Try a different search or status.' : 'Nothing here yet.', acts));
        listStatus.textContent = 'No enquiries match.';
        return;
      }
      var table = h('table', { class: 'tbl enq-tbl' });
      table.appendChild(h('caption', { class: 'sr', text: 'Enquiries' }));
      table.appendChild(h('thead', null, h('tr', null, ['Reference', 'Received', 'From', 'Type', 'Country', 'Message', 'Status'].map(function (t) { return h('th', { scope: 'col', text: t }); }))));
      var tb = h('tbody');
      state.rows.forEach(function (r) {
        var rel = fmtRel(r.created_at);
        var when = h('td', { class: 'c-when when', title: rel }, [VFI.timeEl(r.created_at), rel ? h('div', { class: 'sub', text: rel }) : null]);
        var tr = h('tr', { class: r.status === 'new' ? 'unread' : '', dataset: { id: r.id } }, [
          h('td', { class: 'c-ref' }, h('button', { type: 'button', class: 'ref', text: r.ref, 'aria-label': 'Open enquiry ' + r.ref })),
          when,
          h('td', { class: 'c-who' }, [h('div', { class: 'who', text: r.name }), h('div', { class: 'sub', text: r.company })]),
          h('td', { class: 'c-type', text: r.type }),
          h('td', { class: 'c-country', text: r.country || '—' }),
          h('td', { class: 'c-snip' }, h('div', { class: 'snip', text: snippet(msgOf(r)) })),
          h('td', { class: 'c-status' }, badge(r.status))
        ]);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      listBody.appendChild(table);
      var from = (state.page - 1) * PAGE_SIZE + 1, to = from + state.rows.length - 1;
      var info = 'Showing ' + from + '–' + to + ' of ' + state.total;
      pagerInfo.textContent = info;
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = to >= state.total;
      pager.hidden = false;
      listStatus.textContent = info + ' enquiries.';
    }
    listBody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr || !tr.dataset.id) return;
      var row = state.rows.filter(function (r) { return r.id === tr.dataset.id; })[0];
      if (row) openDetail(row, tr.querySelector('.ref'));
    });

    /* ----- detail drawer ----- */
    var scrim = h('div', { class: 'scrim', hidden: true });
    var dTitle = h('h2', { id: 'dTitle', text: 'Enquiry' });
    var dSub = h('p', { class: 'muted' });
    var dClose = VFI.btn('Close', '', function () { closeDetail(); });
    var dFields = h('dl', { class: 'fields' });
    var dMsg = h('div', { class: 'msgbox' });
    var dStatus = h('select', { id: 'dStatus' });
    STATUSES.forEach(function (s) { dStatus.appendChild(h('option', { value: s, text: LABELS[s] })); });
    var dStatusErr = h('p', { class: 'ferr', hidden: true });
    var dNotes = h('textarea', { id: 'dNotes', rows: 6, maxlength: 5000 });
    var dCount = h('span', { text: '0' });
    var dNotesErr = h('p', { class: 'ferr', hidden: true });
    var dMsgStatus = h('p', { class: 'msg', hidden: true, role: 'status' });
    var dSave = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save' });
    var dDirty = h('span', { class: 'muted', hidden: true, text: 'Unsaved changes' });
    var dForm = h('form', { novalidate: true }, [
      h('div', { class: 'field' }, [h('label', { for: 'dStatus', text: 'Status' }), dStatus, dStatusErr]),
      h('div', { class: 'field' }, [h('label', { for: 'dNotes', text: 'Internal notes' }), dNotes, h('p', { class: 'counter muted' }, [dCount, ' / 5000']), dNotesErr]),
      dMsgStatus,
      h('div', { class: 'd-actions' }, [dSave, dDirty])
    ]);
    var drawer = h('aside', { class: 'detail', id: 'enqDrawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dTitle', hidden: true, tabIndex: -1 }, [
      h('div', { class: 'd-head' }, [h('div', null, [dTitle, dSub]), dClose]),
      h('div', { class: 'd-body' }, [dFields, h('h3', { text: 'Message' }), dMsg, dForm])
    ]);
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
    var saved = { status: '', notes: '' };

    function addField(label, node) { dFields.appendChild(h('dt', { text: label })); dFields.appendChild(h('dd', null, node)); }
    function txt(s) { return document.createTextNode(s == null || s === '' ? '—' : String(s)); }
    function fillDetail(row, draft) {
      dTitle.textContent = row.ref;
      dSub.textContent = 'Received ' + VFI.fmtDate(row.created_at);
      VFI.clear(dFields);
      addField('Received', VFI.timeEl(row.created_at));
      addField('Updated', VFI.timeEl(row.updated_at));
      addField('Type', txt(row.type)); addField('Name', txt(row.name)); addField('Company', txt(row.company));
      var em;
      if (row.email) { em = h('a', { text: row.email }); em.href = 'mailto:' + encodeURIComponent(row.email).replace(/%40/g, '@'); } else em = txt('');
      addField('Email', em);
      addField('Country', txt(row.country)); addField('Volume', txt(row.volume)); addField('Source page', txt(row.source_page));
      dMsg.textContent = msgOf(row);
      saved.status = row.status; saved.notes = row.notes || '';
      dStatus.value = draft ? draft.status : row.status;
      dNotes.value = draft ? draft.notes : saved.notes;
      updateDirty();
      [dStatusErr, dNotesErr, dMsgStatus].forEach(function (n) { n.hidden = true; });
    }
    function isDirty() { return dStatus.value !== saved.status || dNotes.value !== saved.notes; }
    function updateDirty() { dCount.textContent = String(dNotes.value.length); dDirty.hidden = !isDirty(); }
    dNotes.addEventListener('input', updateDirty);
    dStatus.addEventListener('change', updateDirty);
    drawer._snapshot = function () { return state.open ? { row: state.open.row, status: dStatus.value, notes: dNotes.value } : null; };

    function openDetail(row, origin, draft) {
      state.open = { row: row, origin: origin };
      fillDetail(row, draft);
      drawer.hidden = false; scrim.hidden = false;
      VFI.drawerOpen = true;
      VFI.updateInert();
      document.body.classList.add('lock');
      $('app').setAttribute('inert', '');
      dClose.focus();
      drawer.querySelector('.d-body').scrollTop = 0;
    }
    function hideDrawer() {
      var origin = state.open && state.open.origin, rid = state.open && state.open.row.id;
      state.open = null;
      drawer.hidden = true; scrim.hidden = true;
      VFI.drawerOpen = false;
      $('app').removeAttribute('inert');
      VFI.updateInert();
      if (origin && document.body.contains(origin)) origin.focus();
      else if (rid) { var b = listBody.querySelector('tr[data-id="' + rid + '"] .ref'); if (b) b.focus(); }
    }
    function closeDetail(force) {
      if (!state.open) return Promise.resolve(true);
      if (force || !isDirty()) { hideDrawer(); return Promise.resolve(true); }
      return VFI.confirm({ title: 'Discard your changes?', message: 'You have unsaved changes to this enquiry. Close without saving?', confirmLabel: 'Close without saving', danger: true }).then(function (ok) {
        if (ok) hideDrawer();
        return ok;
      });
    }
    scrim.addEventListener('click', function () { closeDetail(); });
    function onKey(e) {
      if (!state.open || document.querySelector('.modal-scrim')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeDetail(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(drawer.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!drawer.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);

    function dMessage(msg, cls) {
      dMsgStatus.hidden = !msg; dMsgStatus.textContent = msg || '';
      dMsgStatus.className = 'msg' + (cls ? ' ' + cls : '');
      dMsgStatus.setAttribute('role', cls === 'ok' || cls === 'info' ? 'status' : 'alert');
    }
    function fieldErr(el, msg) { el.hidden = !msg; el.textContent = msg || ''; }

    dForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!state.open || dSave.disabled) return;
      var row = state.open.row, body = { id: row.id };
      if (dStatus.value !== saved.status) body.status = dStatus.value;
      if (dNotes.value !== saved.notes) body.notes = dNotes.value;
      if (Object.keys(body).length === 1) { dMessage('Nothing to save.', 'info'); return; }
      dSave.disabled = true; dSave.textContent = 'Saving…';
      dMessage(''); fieldErr(dStatusErr); fieldErr(dNotesErr);
      VFI.api('PATCH', '/api/admin/enquiries', body).then(function (j) {
        dSave.disabled = false; dSave.textContent = 'Save';
        if (!state.open || state.open.row.id !== row.id) return;
        dSave.focus();
        var nr = j.row || {};
        Object.keys(nr).forEach(function (k) { row[k] = nr[k]; });
        if (!j.row) { if (body.status) row.status = body.status; if ('notes' in body) row.notes = body.notes; }
        saved.status = row.status; saved.notes = row.notes || '';
        dStatus.value = saved.status; dNotes.value = saved.notes;
        updateDirty();
        dMessage('Saved', 'ok');
        VFI.toast('Saved');
        load(null, true);
      }, function (err) {
        dSave.disabled = false; dSave.textContent = 'Save';
        if (err.handled) return;
        if (err.status === 404) {
          dMessage('This enquiry no longer exists.');
          saved.status = dStatus.value; saved.notes = dNotes.value; updateDirty();
          load(null, true);
          return;
        }
        if (err.status === 422) {
          var errs = (err.data && err.data.errors) || {};
          if (errs.status) fieldErr(dStatusErr, errs.status);
          if (errs.notes) fieldErr(dNotesErr, errs.notes);
          dMessage(errs.status || errs.notes ? 'Please correct the highlighted fields.' : 'Could not save: invalid input.');
          return;
        }
        dMessage(err.status === 0 ? 'Could not reach the server. Your changes are still here; try again.' : VFI.errMsg(err, 'Could not save. Please try again.'));
      });
    });

    /* ----- export ----- */
    function exportCsv() {
      if (state.exporting) return;
      state.exporting = true; exportBtn.disabled = true; exportBtn.textContent = 'Exporting…';
      fetch('/api/admin/export?' + query(), { credentials: 'same-origin', headers: { 'X-Requested-With': 'vfi-admin' } }).then(function (r) {
        if (r.status === 401) { VFI.sessionExpired(); throw { handled: true }; }
        if (!r.ok) throw new Error('bad');
        var cd = r.headers.get('Content-Disposition') || '';
        var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        var name = m ? decodeURIComponent(m[1]) : 'vfi-enquiries.csv';
        return r.blob().then(function (b) { return { b: b, name: name }; });
      }).then(function (x) {
        var url = URL.createObjectURL(x.b);
        var a = h('a', { href: url, download: x.name, hidden: true });
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        VFI.toast('Export downloaded');
      }).catch(function (e) {
        if (e && e.handled) return;
        VFI.toast('Export failed. Please try again.', true);
      }).then(function () { state.exporting = false; exportBtn.disabled = false; exportBtn.textContent = 'Export CSV'; });
    }

    /* ----- start ----- */
    readUrl(ctx.params);
    syncControls();
    load(function () {
      if (stash) {
        var d = stash; stash = null;
        var row = null;
        state.rows.forEach(function (r) { if (r.id === d.row.id) row = r; });
        openDetail(row || d.row, null, d);
        VFI.toast('Signed in again. Your unsaved changes were restored.');
      }
    });

    return {
      update: function (p) { readUrl(p); syncControls(); load(); },
      canLeave: function () { return closeDetail(); },
      unmount: function () {
        clearTimeout(qTimer);
        document.removeEventListener('keydown', onKey);
        state.reqId++;
        if (state.open) { state.open = null; VFI.drawerOpen = false; $('app').removeAttribute('inert'); VFI.updateInert(); }
        scrim.remove(); drawer.remove();
      }
    };
  }

  VFI.register('enquiries', { title: 'Enquiries', roles: ['admin', 'editor', 'sales'], mount: mount });
})();
