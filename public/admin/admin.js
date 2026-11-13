(function () {
  'use strict';

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
  var SESSION_MSG = 'Your session expired. Please sign in again.';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var state = {
    tab: 'active', q: '', page: 1,
    rows: [], total: 0, counts: null,
    reqId: 0, loaded: false,
    open: null,        // {row, origin}
    draft: null,       // preserved after 401
    exporting: false
  };

  var loginView = $('loginView'), appView = $('appView'), bootView = $('bootView');
  var loginForm = $('loginForm'), pw = $('pw'), loginBtn = $('loginBtn'), loginMsg = $('loginMsg');
  var logoutBtn = $('logoutBtn'), listBody = $('listBody'), listBox = $('listBox'), listStatus = $('listStatus');
  var tabsEl = $('tabs'), qEl = $('q'), qClear = $('qClear'), pager = $('pager');
  var detail = $('detail'), scrim = $('scrim');

  /* ---------- API ---------- */
  function api(method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'vfi-admin', 'Accept': 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok && j && j.ok !== false) return j;
        var err = { status: r.status, code: (j && j.code) || '', error: (j && j.error) || '', data: j };
        if (r.status === 401 && path.indexOf('/api/admin/login') !== 0) {
          handleExpired();
        }
        throw err;
      });
    }, function () {
      throw { status: 0, code: 'network', error: 'Could not reach the server.' };
    });
  }

  function handleExpired() {
    if (state.open) {
      state.draft = {
        row: state.open.row,
        status: $('dStatus').value,
        notes: $('dNotes').value
      };
      closeDetail(true);
    }
    showLogin(SESSION_MSG);
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, 3500);
  }

  /* ---------- views ---------- */
  function setView(v) {
    bootView.hidden = v !== 'boot';
    loginView.hidden = v !== 'login';
    appView.hidden = v !== 'app';
    logoutBtn.hidden = v !== 'app';
  }
  function showLogin(msg) {
    state.reqId++;
    state.loaded = false;
    setView('login');
    pw.value = '';
    setLoginMsg(msg || '');
    loginBtn.disabled = false;
    pw.focus();
  }
  function setLoginMsg(msg) {
    loginMsg.hidden = !msg;
    loginMsg.textContent = msg || '';
  }
  function showApp() {
    setView('app');
    readUrl();
    syncControls();
    if (!state.loaded) { state.loaded = true; }
    load(function () {
      if (state.draft) {
        var d = state.draft; state.draft = null;
        var row = null;
        for (var i = 0; i < state.rows.length; i++) if (state.rows[i].id === d.row.id) row = state.rows[i];
        openDetail(row || d.row, null, d);
        toast('Signed in again. Your unsaved changes were restored.');
      }
    });
  }

  /* ---------- login ---------- */
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (loginBtn.disabled) return;
    if (!pw.value) { setLoginMsg('Enter the password.'); pw.focus(); return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    setLoginMsg('');
    api('POST', '/api/admin/login', { password: pw.value }).then(function () {
      loginBtn.textContent = 'Sign in';
      pw.value = '';
      showApp();
    }, function (err) {
      loginBtn.textContent = 'Sign in';
      loginBtn.disabled = false;
      var m = 'Something went wrong. Please try again.';
      if (err.status === 401) m = 'Incorrect password';
      else if (err.status === 429) m = 'Too many attempts. Try again in 15 minutes.';
      else if (err.status === 503) m = 'Admin is not configured on this server.';
      else if (err.status === 0) m = 'Could not reach the server.';
      setLoginMsg(m);
      pw.select();
      pw.focus();
    });
  });

  logoutBtn.addEventListener('click', function () {
    logoutBtn.disabled = true;
    api('POST', '/api/admin/logout').then(done, done);
    function done() {
      logoutBtn.disabled = false;
      closeDetail(true);
      state.draft = null; state.rows = []; state.counts = null; state.q = ''; state.page = 1; state.tab = 'active';
      history.replaceState(null, '', location.pathname);
      listBody.textContent = '';
      showLogin('');
    }
  });

  /* ---------- URL state ---------- */
  function readUrl() {
    var p = new URLSearchParams(location.search);
    var s = p.get('status') || '';
    var tab = 'active';
    TABS.forEach(function (t) { if (t.param && t.param === s) tab = t.key; });
    state.tab = tab;
    state.q = (p.get('q') || '').slice(0, 200);
    var pg = parseInt(p.get('page'), 10);
    state.page = pg > 0 ? pg : 1;
  }
  function writeUrl(push) {
    var p = new URLSearchParams();
    var t = TABS.filter(function (x) { return x.key === state.tab; })[0];
    if (t.param) p.set('status', t.param);
    if (state.q) p.set('q', state.q);
    if (state.page > 1) p.set('page', String(state.page));
    var qs = p.toString();
    var url = location.pathname + (qs ? '?' + qs : '');
    if (url === location.pathname + location.search) return;
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }
  window.addEventListener('popstate', function () {
    if (appView.hidden) return;
    readUrl(); syncControls(); load();
  });

  function syncControls() {
    qEl.value = state.q;
    qClear.hidden = !state.q;
    renderTabs();
  }

  /* ---------- tabs ---------- */
  function countFor(key) {
    var c = state.counts;
    if (!c) return null;
    var active = (c.new || 0) + (c.in_progress || 0) + (c.contacted || 0) + (c.closed || 0);
    if (key === 'active') return active;
    if (key === 'all') return active + (c.spam || 0);
    return c[key] || 0;
  }
  function renderTabs() {
    tabsEl.textContent = '';
    TABS.forEach(function (t) {
      var b = el('button', 'tab' + (t.key === 'new' ? ' is-new' : ''));
      b.type = 'button';
      b.id = 'tab-' + t.key;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t.key === state.tab ? 'true' : 'false');
      b.tabIndex = t.key === state.tab ? 0 : -1;
      b.dataset.key = t.key;
      b.appendChild(el('span', null, t.label));
      var n = countFor(t.key);
      if (n !== null) {
        var cs = el('span', 'count' + (n === 0 ? ' zero' : ''), String(n));
        b.appendChild(cs);
      }
      tabsEl.appendChild(b);
    });
  }
  function selectTab(key) {
    if (key === state.tab) return;
    state.tab = key; state.page = 1;
    writeUrl(true);
    renderTabs();
    load();
  }
  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) selectTab(b.dataset.key);
  });
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

  /* ---------- search ---------- */
  var qTimer;
  qEl.addEventListener('input', function () {
    qClear.hidden = !qEl.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(applySearch, 300);
  });
  qEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(qTimer); applySearch(); }
  });
  function applySearch() {
    clearTimeout(qTimer);
    var v = qEl.value.trim();
    if (v === state.q) return;
    state.q = v; state.page = 1;
    writeUrl(false);
    load();
  }
  qClear.addEventListener('click', function () {
    qEl.value = ''; qClear.hidden = true;
    clearTimeout(qTimer);
    if (state.q) { state.q = ''; state.page = 1; writeUrl(false); load(); }
    qEl.focus();
  });

  /* ---------- list ---------- */
  function query(extra) {
    var t = TABS.filter(function (x) { return x.key === state.tab; })[0];
    var p = new URLSearchParams();
    p.set('status', t.param);
    p.set('q', state.q);
    if (extra) for (var k in extra) p.set(k, extra[k]);
    return p.toString();
  }

  function load(cb, silent) {
    var id = ++state.reqId;
    if (!silent) {
      listBox.setAttribute('aria-busy', 'true');
      renderSkeleton();
      listStatus.textContent = 'Loading enquiries…';
    }
    if (!navigator.onLine) { /* still try; fetch will fail and show error */ }
    api('GET', '/api/admin/enquiries?' + query({ page: state.page, pageSize: PAGE_SIZE })).then(function (j) {
      if (id !== state.reqId) return;
      state.rows = j.rows || [];
      state.total = j.total || 0;
      state.counts = j.counts || state.counts;
      var pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
      if (state.page > pages) { state.page = pages; writeUrl(false); return load(cb, silent); }
      listBox.setAttribute('aria-busy', 'false');
      renderTabs();
      renderList();
      if (cb) cb();
    }, function (err) {
      if (id !== state.reqId || err.status === 401) return;
      listBox.setAttribute('aria-busy', 'false');
      renderError(err.status === 0 ? 'Could not reach the server. Check your connection.' : 'Could not load enquiries.');
    });
  }

  function renderSkeleton() {
    listBody.textContent = '';
    var s = el('div', 'skel');
    for (var i = 0; i < 5; i++) s.appendChild(el('div'));
    listBody.appendChild(s);
    pager.hidden = true;
  }
  function renderError(msg) {
    listBody.textContent = '';
    pager.hidden = true;
    var s = el('div', 'state');
    s.setAttribute('role', 'alert');
    s.appendChild(el('h2', null, msg));
    var b = el('button', 'btn btn-primary', 'Retry'); b.type = 'button';
    b.addEventListener('click', function () { load(); });
    s.appendChild(b);
    listBody.appendChild(s);
    listStatus.textContent = msg;
  }

  function snippet(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }
  function fmtAbs(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso || '');
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
  function timeEl(iso) {
    var t = document.createElement('time');
    t.setAttribute('datetime', iso || '');
    t.textContent = fmtAbs(iso);
    return t;
  }
  function badge(status) {
    return el('span', 'badge b-' + (LABELS[status] ? status : 'closed'), LABELS[status] || status);
  }
  function msgOf(r) { return r.message != null ? r.message : (r.msg || ''); }

  function renderList() {
    listBody.textContent = '';
    if (!state.rows.length) {
      pager.hidden = true;
      var s = el('div', 'state');
      s.appendChild(el('h2', null, 'No enquiries match'));
      s.appendChild(el('p', 'muted', state.q ? 'Try a different search or status.' : 'Nothing here yet.'));
      if (state.q || state.tab !== 'active') {
        var b = el('button', 'btn', 'Clear filters'); b.type = 'button';
        b.addEventListener('click', function () {
          state.q = ''; state.tab = 'active'; state.page = 1;
          writeUrl(true); syncControls(); load();
        });
        s.appendChild(b);
      }
      listBody.appendChild(s);
      listStatus.textContent = 'No enquiries match.';
      return;
    }
    var table = el('table');
    var cap = el('caption', 'sr', 'Enquiries'); table.appendChild(cap);
    var thead = el('thead'), hr = el('tr');
    ['Reference', 'Received', 'From', 'Type', 'Country', 'Message', 'Status'].forEach(function (h) {
      var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);
    var tb = el('tbody');
    state.rows.forEach(function (r) {
      var tr = el('tr', r.status === 'new' ? 'unread' : '');
      tr.dataset.id = r.id;

      var c1 = el('td', 'c-ref');
      var rb = el('button', 'ref', r.ref); rb.type = 'button';
      rb.setAttribute('aria-label', 'Open enquiry ' + r.ref);
      c1.appendChild(rb);

      var c2 = el('td', 'c-when when');
      c2.appendChild(timeEl(r.created_at));
      c2.title = fmtRel(r.created_at) ? fmtRel(r.created_at) : '';
      var rel = fmtRel(r.created_at);
      if (rel) c2.appendChild(el('div', 'sub', rel));

      var c3 = el('td', 'c-who');
      c3.appendChild(el('div', 'who', r.name));
      c3.appendChild(el('div', 'sub', r.company));

      var c4 = el('td', 'c-type', r.type);
      var c5 = el('td', 'c-country', r.country || '—');
      c5.classList.add('c-country');
      var c6 = el('td', 'c-snip');
      c6.appendChild(el('div', 'snip', snippet(msgOf(r))));
      var c7 = el('td', 'c-status'); c7.appendChild(badge(r.status));

      [c1, c2, c3, c4, c5, c6, c7].forEach(function (c) { tr.appendChild(c); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    listBody.appendChild(table);

    var from = (state.page - 1) * PAGE_SIZE + 1, to = from + state.rows.length - 1;
    var info = 'Showing ' + from + '–' + to + ' of ' + state.total;
    $('pagerInfo').textContent = info;
    $('prevBtn').disabled = state.page <= 1;
    $('nextBtn').disabled = to >= state.total;
    pager.hidden = false;
    listStatus.textContent = info + ' enquiries.';
  }

  listBody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr || !tr.dataset.id) return;
    var row = state.rows.filter(function (r) { return r.id === tr.dataset.id; })[0];
    if (row) openDetail(row, tr.querySelector('.ref'));
  });
  $('prevBtn').addEventListener('click', function () { if (state.page > 1) { state.page--; writeUrl(true); load(); scrollTo(0, 0); } });
  $('nextBtn').addEventListener('click', function () { state.page++; writeUrl(true); load(); scrollTo(0, 0); });
  $('refreshBtn').addEventListener('click', function () { load(); });

  /* ---------- detail ---------- */
  var dStatus = $('dStatus'), dNotes = $('dNotes'), dSave = $('dSave');
  STATUSES.forEach(function (s) {
    var o = el('option', null, LABELS[s]); o.value = s; dStatus.appendChild(o);
  });
  var saved = { status: '', notes: '' };

  function field(dl, label, valueNode) {
    dl.appendChild(el('dt', null, label));
    var dd = el('dd'); dd.appendChild(valueNode); dl.appendChild(dd);
  }
  function txt(s) { return document.createTextNode(s == null || s === '' ? '—' : String(s)); }

  function fillDetail(row, draft) {
    $('dTitle').textContent = row.ref;
    $('dSub').textContent = 'Received ' + fmtAbs(row.created_at);
    var dl = $('dFields'); dl.textContent = '';
    field(dl, 'Received', timeEl(row.created_at));
    var up = timeEl(row.updated_at); field(dl, 'Updated', up);
    field(dl, 'Type', txt(row.type));
    field(dl, 'Name', txt(row.name));
    field(dl, 'Company', txt(row.company));
    var em;
    if (row.email) { em = el('a', null, row.email); em.href = 'mailto:' + encodeURIComponent(row.email).replace(/%40/g, '@'); }
    else em = txt('');
    field(dl, 'Email', em);
    field(dl, 'Country', txt(row.country));
    field(dl, 'Volume', txt(row.volume));
    field(dl, 'Source page', txt(row.source_page));
    $('dMsg').textContent = msgOf(row);
    saved.status = row.status; saved.notes = row.notes || '';
    dStatus.value = draft ? draft.status : row.status;
    dNotes.value = draft ? draft.notes : saved.notes;
    updateDirty();
    ['dStatusErr', 'dNotesErr', 'dMsgStatus'].forEach(function (i) { $(i).hidden = true; });
  }
  function isDirty() { return dStatus.value !== saved.status || dNotes.value !== saved.notes; }
  function updateDirty() {
    $('dCount').textContent = String(dNotes.value.length);
    $('dDirty').hidden = !isDirty();
  }
  dNotes.addEventListener('input', updateDirty);
  dStatus.addEventListener('change', updateDirty);

  var bgEls = function () { return [document.querySelector('header.top'), $('main')]; };

  function openDetail(row, origin, draft) {
    state.open = { row: row, origin: origin };
    state.lastId = row.id;
    fillDetail(row, draft);
    detail.hidden = false; scrim.hidden = false;
    document.body.classList.add('lock');
    bgEls().forEach(function (n) { if (n) n.setAttribute('inert', ''); });
    $('dClose').focus();
    detail.querySelector('.d-body').scrollTop = 0;
  }
  function closeDetail(force) {
    if (!state.open) return true;
    if (!force && isDirty() && !confirm('You have unsaved changes. Close without saving?')) return false;
    var origin = state.open.origin;
    state.open = null;
    detail.hidden = true; scrim.hidden = true;
    document.body.classList.remove('lock');
    bgEls().forEach(function (n) { if (n) n.removeAttribute('inert'); });
    var rid = state.lastId;
    if (origin && document.body.contains(origin)) origin.focus();
    else if (origin && rid && !appView.hidden) {
      var tr = listBody.querySelector('tr[data-id="' + rid + '"] .ref');
      if (tr) tr.focus(); else $('main').focus();
    }
    return true;
  }
  $('dClose').addEventListener('click', function () { closeDetail(); });
  scrim.addEventListener('click', function () { closeDetail(); });
  document.addEventListener('keydown', function (e) {
    if (!state.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDetail(); return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(
      detail.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!detail.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === detail)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function dMessage(msg, cls) {
    var m = $('dMsgStatus');
    m.hidden = !msg; m.textContent = msg || ''; m.className = 'msg' + (cls ? ' ' + cls : '');
    if (cls !== 'ok' && cls !== 'info') m.setAttribute('role', 'alert'); else m.setAttribute('role', 'status');
  }
  function fieldErr(id, msg) { var n = $(id); n.hidden = !msg; n.textContent = msg || ''; }

  $('dForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.open || dSave.disabled) return;
    var row = state.open.row, body = { id: row.id };
    if (dStatus.value !== saved.status) body.status = dStatus.value;
    if (dNotes.value !== saved.notes) body.notes = dNotes.value;
    if (Object.keys(body).length === 1) { dMessage('Nothing to save.', 'info'); return; }
    dSave.disabled = true; dSave.textContent = 'Saving…';
    dMessage(''); fieldErr('dStatusErr'); fieldErr('dNotesErr');
    api('PATCH', '/api/admin/enquiries', body).then(function (j) {
      dSave.disabled = false; dSave.textContent = 'Save';
      if (!state.open || state.open.row.id !== row.id) return;
      dSave.focus();
      var nr = j.row || {};
      for (var k in nr) row[k] = nr[k];
      if (!j.row) { if (body.status) row.status = body.status; if ('notes' in body) row.notes = body.notes; }
      saved.status = row.status; saved.notes = row.notes || '';
      dStatus.value = saved.status; dNotes.value = saved.notes;
      updateDirty();
      dMessage('Saved', 'ok');
      toast('Saved');
      load(null, true);
    }, function (err) {
      dSave.disabled = false; dSave.textContent = 'Save';
      if (err.status === 401) return;
      if (err.status === 404) {
        dMessage('This enquiry no longer exists.');
        saved.status = dStatus.value; saved.notes = dNotes.value; updateDirty();
        load(null, true);
        return;
      }
      if (err.status === 422) {
        var errs = (err.data && err.data.errors) || {};
        if (errs.status) fieldErr('dStatusErr', errs.status);
        if (errs.notes) fieldErr('dNotesErr', errs.notes);
        dMessage(errs.status || errs.notes ? 'Please correct the highlighted fields.' : 'Could not save: invalid input.');
        return;
      }
      dMessage(err.status === 0 ? 'Could not reach the server. Your changes are still here; try again.' : 'Could not save. Please try again.');
    });
  });

  /* ---------- export ---------- */
  $('exportBtn').addEventListener('click', function () {
    var btn = $('exportBtn');
    if (state.exporting) return;
    state.exporting = true; btn.disabled = true; btn.textContent = 'Exporting…';
    fetch('/api/admin/export?' + query(), {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'vfi-admin' }
    }).then(function (r) {
      if (r.status === 401) { handleExpired(); throw { handled: true }; }
      if (!r.ok) throw new Error('bad');
      var cd = r.headers.get('Content-Disposition') || '';
      var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      var name = m ? decodeURIComponent(m[1]) : 'vfi-enquiries.csv';
      return r.blob().then(function (b) { return { b: b, name: name }; });
    }).then(function (x) {
      var url = URL.createObjectURL(x.b);
      var a = document.createElement('a');
      a.href = url; a.download = x.name; a.hidden = true;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      toast('Export downloaded');
    }).catch(function (e) {
      if (e && e.handled) return;
      toast('Export failed. Please try again.', true);
    }).then(function () {
      state.exporting = false; btn.disabled = false; btn.textContent = 'Export CSV';
    });
  });

  /* ---------- boot ---------- */
  window.addEventListener('offline', function () { toast('You are offline.', true); });
  window.addEventListener('online', function () { toast('Back online.'); if (!appView.hidden) load(null, true); });

  setView('boot');
  api('GET', '/api/admin/session').then(function (j) {
    if (j.authenticated) showApp(); else showLogin('');
  }, function (err) {
    setView('login');
    setLoginMsg(err.status === 503 ? 'Admin is not configured on this server.' : 'Could not reach the server.');
  });
})();
