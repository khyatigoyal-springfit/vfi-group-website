/* VFI admin: shell, router, api helper, dialogs, login. Other views register themselves via VFI.register(). */
(function () {
  'use strict';

  var VFI = window.VFI = { views: {}, user: null, schema: null };

  /* ---------- DOM helpers (never innerHTML) ---------- */
  function append(n, kids) {
    if (kids == null || kids === false) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return append(n, c);
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
  }
  var PROPS = { value: 1, checked: 1, disabled: 1, hidden: 1, selected: 1, indeterminate: 1, tabIndex: 1 };
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
        else if (PROPS[k]) n[k] = v;
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    append(n, kids);
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function btn(label, cls, onClick, attrs) {
    var a = { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: label };
    if (attrs) Object.keys(attrs).forEach(function (k) { a[k] = attrs[k]; });
    if (onClick) a.on = { click: onClick };
    return h('button', a);
  }
  var uid = 0;
  function nextId(p) { return (p || 'id') + '-' + (++uid); }

  VFI.h = h; VFI.$ = $; VFI.clear = clear; VFI.btn = btn; VFI.nextId = nextId;

  /* ---------- formatting ---------- */
  VFI.fmtDate = function (iso, opts) {
    var d = new Date(iso);
    if (isNaN(d)) return iso ? String(iso) : '';
    return d.toLocaleString(undefined, opts || { dateStyle: 'medium', timeStyle: 'short' });
  };
  VFI.fmtTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  VFI.fmtBytes = function (n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };
  VFI.timeEl = function (iso) {
    var t = document.createElement('time');
    t.setAttribute('datetime', iso || '');
    t.textContent = VFI.fmtDate(iso);
    return t;
  };

  /* ---------- toast + live region ---------- */
  var toastTimer;
  VFI.toast = function (msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 6000 : 3500);
  };
  VFI.announce = function (msg) {
    var l = $('live');
    l.textContent = '';
    setTimeout(function () { l.textContent = msg; }, 30);
  };

  /* ---------- clipboard + download ---------- */
  VFI.copyText = function (text) {
    function fallback() {
      return new Promise(function (resolve, reject) {
        var ta = h('textarea', { 'aria-hidden': 'true', tabIndex: -1, class: 'offscreen' });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        ok ? resolve() : reject(new Error('copy failed'));
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
  };
  VFI.download = function (filename, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime || 'application/octet-stream' }));
    var a = h('a', { href: url, download: filename, hidden: true });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };

  /* ---------- API ---------- */
  var expiredHandling = false;
  VFI.api = function (method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'X-Requested-With': 'vfi-admin', 'Accept': 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var retries = 0;
    function attempt() {
      return fetch(path, opts).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok && j && j.ok !== false) return j;
          var err = { status: r.status, code: (j && j.code) || '', error: (j && j.error) || '', data: j || {} };
          if (err.status === 503 && err.code === 'unavailable') {
            // Transient (database waking up): retry quietly, never the full-page "not set up" screen.
            if (retries < 2) {
              retries++;
              VFI.toast('Connecting to the database\u2026 retrying');
              return new Promise(function (res) { setTimeout(res, 2000); }).then(attempt);
            }
            err.error = 'The server is busy, please try again in a moment.';
            err.busy = true;
            throw err;
          }
          throw handleApiError(err, path);
        });
      }, function () {
        throw { status: 0, code: 'network', error: '', data: {} };
      });
    }
    return attempt();
  };
  var NOT_READY = { not_configured: 1, admin_not_configured: 1 };
  function handleApiError(err, path) {
    if (err.status === 503 && NOT_READY[err.code]) {
      err.handled = true;
      showSetup();
    } else if (err.status === 401 && path.indexOf('/api/admin/login') !== 0 && path.indexOf('/api/admin/session') !== 0) {
      err.handled = true;
      VFI.sessionExpired();
    } else if (err.status === 403 && err.code === 'password_change_required') {
      err.handled = true;
      if (VFI.user) VFI.user.must_change_password = true;
      showForced();
    }
    return err;
  }
  VFI.handleApiError = handleApiError;
  /** Plain-language message for a failed request. */
  VFI.errMsg = function (err, fallback) {
    if (!err) return fallback || 'Something went wrong. Please try again.';
    if (err.status === 0) return 'Could not reach the server. Check your connection and try again.';
    if (err.status === 401) return 'You were signed out. Please sign in again.';
    if (err.status === 403) return err.code === 'password_change_required' ? 'You need to set a new password first.' : 'You do not have permission to do this.';
    if (err.status === 429) return 'Too many attempts. Try again in 15 minutes.';
    if (err.status === 503) return err.code === 'media_not_configured' ? 'Image uploads are not set up on this server yet.' : (err.code === 'unavailable' ? 'The server is busy, please try again in a moment.' : 'The service is unavailable right now. Please try again shortly.');
    return err.error || fallback || 'Something went wrong. Please try again.';
  };

  /* ---------- dialogs ---------- */
  var dialogs = [];
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function visible(n) { return n.offsetParent !== null || n === document.activeElement; }

  /**
   * opts: {title, body: Node|Node[], actions: [{label, kind: 'primary'|'danger'|'', onClick(ctrl) -> false to stay open}],
   *        size: 'sm'|'md'|'lg', onClose, focus: Node|function, dismissable (default true), role}
   */
  VFI.dialog = function (opts) {
    var titleId = nextId('dlg-t');
    var prevFocus = document.activeElement;
    var closed = false;
    var bodyEl = h('div', { class: 'dlg-body' }, opts.body);
    var footer = h('div', { class: 'dlg-foot' });
    var ctrl = { el: null, body: bodyEl, footer: footer };
    var buttons = [];
    var busy = false;

    function setBusy(b) {
      busy = b;
      buttons.forEach(function (x) { x.disabled = b; });
    }
    function close(result) {
      if (closed) return;
      closed = true;
      var i = dialogs.indexOf(ctrl);
      if (i >= 0) dialogs.splice(i, 1);
      scrim.remove();
      updateInert();
      if (opts.onClose) opts.onClose(result);
      if (prevFocus && document.body.contains(prevFocus) && typeof prevFocus.focus === 'function') prevFocus.focus();
      else { var m = $('main'); if (m) m.focus(); }
    }
    (opts.actions || []).forEach(function (a) {
      var b = btn(a.label, a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : '', function () {
        if (busy) return;
        var r = a.onClick ? a.onClick(ctrl) : undefined;
        if (r && typeof r.then === 'function') {
          setBusy(true);
          r.then(function (v) { if (!closed) { setBusy(false); } if (v !== false) close(a.value); }, function () { if (!closed) setBusy(false); });
        } else if (r !== false) close(a.value);
      });
      if (a.id) b.id = a.id;
      buttons.push(b);
      footer.appendChild(b);
      a._btn = b;
    });
    var dlg = h('div', { class: 'dlg dlg-' + (opts.size || 'md'), role: opts.role || 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1 }, [
      h('div', { class: 'dlg-head' }, [
        h('h2', { id: titleId, text: opts.title }),
        opts.dismissable === false ? null : h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Close', text: '×', on: { click: function () { if (!busy) close(); } } })
      ]),
      bodyEl,
      (opts.actions && opts.actions.length) ? footer : null
    ]);
    var scrim = h('div', { class: 'modal-scrim' }, dlg);
    ctrl.el = dlg;
    ctrl.close = close;
    ctrl.setBusy = setBusy;
    ctrl.buttons = buttons;

    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim && opts.dismissable !== false && !busy) close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (opts.dismissable === false || busy) return;
        e.preventDefault(); e.stopPropagation(); close(); return;
      }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(dlg.querySelectorAll(FOCUSABLE), visible);
      if (!f.length) { e.preventDefault(); dlg.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (!dlg.contains(document.activeElement) || document.activeElement === dlg) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.appendChild(scrim);
    dialogs.push(ctrl);
    updateInert();
    var target = typeof opts.focus === 'function' ? opts.focus(ctrl) : opts.focus;
    if (!target) target = dlg.querySelector('[data-autofocus]') || dlg.querySelector('input:not([type=hidden]),select,textarea') || footer.querySelector('.btn-primary,.btn-danger') || dlg.querySelector('.dlg-x');
    (target || dlg).focus();
    return ctrl;
  };
  function updateInert() {
    var app = $('app');
    if (dialogs.length || VFI.drawerOpen) app.setAttribute('inert', ''); else app.removeAttribute('inert');
    document.body.classList.toggle('lock', dialogs.length > 0 || !!VFI.drawerOpen);
    dialogs.forEach(function (d, i) {
      var scr = d.el.parentNode;
      if (i < dialogs.length - 1) scr.setAttribute('inert', ''); else scr.removeAttribute('inert');
    });
  }
  VFI.updateInert = updateInert;
  VFI.closeAllDialogs = function () { dialogs.slice().forEach(function (d) { d.close(); }); };

  /** confirm({title, message, confirmLabel, cancelLabel, danger}) -> Promise<boolean> */
  VFI.confirm = function (o) {
    return new Promise(function (resolve) {
      var answered = false;
      var d = VFI.dialog({
        title: o.title || 'Are you sure?',
        size: 'sm',
        role: 'alertdialog',
        body: (Array.isArray(o.message) ? o.message : [o.message || '']).map(function (m) { return typeof m === 'string' ? h('p', { text: m }) : m; }),
        actions: [
          { label: o.cancelLabel || 'Cancel', onClick: function () { answered = true; resolve(false); } },
          { label: o.confirmLabel || 'OK', kind: o.danger ? 'danger' : 'primary', onClick: function () { answered = true; resolve(true); } }
        ],
        focus: function (c) { return o.danger ? c.buttons[0] : c.buttons[1]; },
        onClose: function () { if (!answered) resolve(false); }
      });
      return d;
    });
  };
  /** A one-button information dialog. */
  VFI.alertDialog = function (title, body, label) {
    return new Promise(function (resolve) {
      VFI.dialog({ title: title, size: 'sm', body: body, actions: [{ label: label || 'OK', kind: 'primary' }], onClose: resolve });
    });
  };

  /* ---------- states ---------- */
  VFI.stateBox = function (title, text, actions, isAlert) {
    var s = h('div', { class: 'state' }, [h('h2', { text: title }), text ? h('p', { class: 'muted', text: text }) : null]);
    if (isAlert) s.setAttribute('role', 'alert');
    (actions || []).forEach(function (a) { s.appendChild(a); });
    return s;
  };
  VFI.loadingBox = function () { return h('div', { class: 'skel' }, [h('div'), h('div'), h('div')]); };
  VFI.errorBox = function (err, retry) {
    if (err && err.status === 403 && err.code === 'forbidden') {
      return VFI.stateBox('You do not have access to this page', 'Ask an administrator if you need it.', [], true);
    }
    return VFI.stateBox('Could not load this page', VFI.errMsg(err), retry ? [btn('Try again', 'btn-primary', retry)] : [], true);
  };
  VFI.pageHead = function (title, sub, actions) {
    return h('div', { class: 'head-row' }, [
      h('div', null, [h('h1', { text: title, tabIndex: -1, 'data-view-title': '' }), sub ? h('p', { class: 'muted head-sub', text: sub }) : null]),
      actions ? h('div', { class: 'head-actions' }, actions) : null
    ]);
  };
  /** Previous / Next pager. */
  VFI.pager = function (info, onPrev, onNext) {
    var prev = btn('Previous', '', onPrev, { disabled: info.page <= 1 });
    var next = btn('Next', '', onNext, { disabled: info.page * info.pageSize >= info.total });
    var from = info.total ? (info.page - 1) * info.pageSize + 1 : 0;
    var to = Math.min(info.total, info.page * info.pageSize);
    return h('nav', { class: 'pager', 'aria-label': 'Pagination' }, [
      h('span', { class: 'muted', text: info.total ? 'Showing ' + from + '–' + to + ' of ' + info.total : 'Nothing to show' }),
      h('span', { class: 'pager-btns' }, [prev, next])
    ]);
  };

  /* ---------- router ---------- */
  var NAV = [
    { route: 'enquiries', label: 'Enquiries', roles: ['admin', 'editor', 'sales'] },
    { route: 'content', label: 'Content', roles: ['admin', 'editor'] },
    { route: 'media', label: 'Media', roles: ['admin', 'editor'] },
    { route: 'history', label: 'History', roles: ['admin', 'editor'] },
    { route: 'users', label: 'Users', roles: ['admin'] },
    { route: 'audit', label: 'Audit log', roles: ['admin'] },
    { route: 'account', label: 'My account', roles: ['admin', 'editor', 'sales'] }
  ];
  var current = null; // { route, ctrl }
  var lastHash = '';
  var ignoreHash = false;
  var routing = false;

  VFI.register = function (route, view) { VFI.views[route] = view; };
  VFI.parseHash = function (hash) {
    var raw = String(hash == null ? location.hash : hash).replace(/^#\/?/, '');
    var q = '', i = raw.indexOf('?');
    if (i >= 0) { q = raw.slice(i + 1); raw = raw.slice(0, i); }
    var parts = raw.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return { route: parts[0] || '', param: parts[1] || '', query: new URLSearchParams(q) };
  };
  VFI.navigate = function (hash) { if (location.hash === hash) route(true); else location.hash = hash; };
  VFI.defaultRoute = function () { return VFI.user && VFI.user.role === 'sales' ? 'enquiries' : 'content'; };
  VFI.canView = function (r) {
    var v = VFI.views[r];
    return !!(v && VFI.user && v.roles.indexOf(VFI.user.role) >= 0);
  };
  /** Ask the current view whether it may be left. */
  VFI.canLeave = function () {
    if (current && current.ctrl && current.ctrl.canLeave) return Promise.resolve(current.ctrl.canLeave());
    return Promise.resolve(true);
  };

  function setActiveNav(r) {
    Array.prototype.forEach.call($('navList').querySelectorAll('a'), function (a) {
      if (a.dataset.route === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function route(forceRemount) {
    if (!VFI.user || VFI.user.must_change_password) return;
    var p = VFI.parseHash();
    var r = p.route;
    if (!r || !VFI.views[r]) { replaceHash('#/' + VFI.defaultRoute()); return route(); }
    if (!VFI.canView(r)) { renderForbidden(r); return; }
    var same = current && current.route === r && !forceRemount;
    if (same) {
      lastHash = location.hash;
      if (current.ctrl && current.ctrl.update) current.ctrl.update(p);
      return;
    }
    if (routing) return;
    routing = true;
    VFI.canLeave().then(function (ok) {
      routing = false;
      if (!ok) { ignoreHash = true; replaceHash(lastHash || '#/' + VFI.defaultRoute()); setTimeout(function () { ignoreHash = false; }, 0); return; }
      mount(r, p);
    });
  }
  function replaceHash(h2) { history.replaceState(null, '', location.pathname + location.search + h2); }
  function unmountCurrent() {
    if (current && current.ctrl && current.ctrl.unmount) { try { current.ctrl.unmount(); } catch (e) { /* ignore */ } }
    current = null;
  }
  function mount(r, p) {
    unmountCurrent();
    var root = clear($('view'));
    var view = VFI.views[r];
    lastHash = location.hash;
    document.title = view.title + ' | VFI Group admin';
    setActiveNav(r);
    closeMenu();
    current = { route: r, ctrl: null };
    var ctrl = view.mount({ root: root, params: p, user: VFI.user });
    current.ctrl = ctrl || {};
    window.scrollTo(0, 0);
    var first = !VFI.firstMountDone;
    VFI.firstMountDone = true;
    if (!first) { var t = root.querySelector('[data-view-title]'); if (t) t.focus({ preventScroll: true }); }
  }
  function renderForbidden(r) {
    unmountCurrent();
    var root = clear($('view'));
    root.appendChild(h('div', { class: 'wrap' }, VFI.stateBox('You do not have access to this page', 'Your role does not include it. Ask an administrator if you need it.', [btn('Go to ' + VFI.views[VFI.defaultRoute()].title, 'btn-primary', function () { VFI.navigate('#/' + VFI.defaultRoute()); })], true)));
    setActiveNav('');
  }
  window.addEventListener('hashchange', function () {
    if (ignoreHash) { ignoreHash = false; return; }
    route();
  });
  /** Used by views that change their own query string without remounting. */
  VFI.setHash = function (hash, push) {
    history[push ? 'pushState' : 'replaceState'](null, '', location.pathname + location.search + hash);
    lastHash = location.hash;
  };

  /* ---------- shell ---------- */
  function buildNav() {
    var list = clear($('navList'));
    NAV.forEach(function (n) {
      if (!VFI.views[n.route] || n.roles.indexOf(VFI.user.role) < 0) return;
      list.appendChild(h('li', null, h('a', { href: '#/' + n.route, text: n.label, dataset: { route: n.route } })));
    });
  }
  function closeMenu() {
    $('sidenav').classList.remove('open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
  }
  $('menuBtn').addEventListener('click', function () {
    var open = !$('sidenav').classList.contains('open');
    $('sidenav').classList.toggle('open', open);
    $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  function setScreen(name) {
    $('bootView').hidden = name !== 'boot';
    $('loginView').hidden = name !== 'login';
    $('forceView').hidden = name !== 'force';
    $('setupView').hidden = name !== 'setup';
    $('view').hidden = name !== 'app';
    var authed = name === 'app' || name === 'force';
    if (name === 'setup') { $('topUser').hidden = true; $('sidenav').hidden = true; $('menuBtn').hidden = true; $('shell').classList.remove('has-nav'); closeMenu(); return; }
    $('topUser').hidden = !authed;
    var showNav = name === 'app';
    $('sidenav').hidden = !showNav;
    $('menuBtn').hidden = !showNav;
    $('shell').classList.toggle('has-nav', showNav);
    if (!showNav) closeMenu();
    if (authed && VFI.user) {
      $('userName').textContent = VFI.user.name || VFI.user.email;
      $('userRole').textContent = VFI.user.role;
    }
  }
  VFI.refreshUser = function (u) {
    VFI.user = u;
    $('userName').textContent = u.name || u.email;
    $('userRole').textContent = u.role;
  };

  function startApp() {
    setScreen('app');
    buildNav();
    var p = VFI.pendingHash;
    VFI.pendingHash = null;
    if (p && p !== '#' && p !== '#/') replaceHash(p);
    else if (!location.hash || location.hash === '#' || location.hash === '#/') replaceHash('#/' + VFI.defaultRoute());
    current = null;
    route(true);
  }

  var loginForm = $('loginForm'), loginEmail = $('loginEmail'), loginPw = $('loginPw'), loginBtn = $('loginBtn'), loginMsg = $('loginMsg');
  function setLoginMsg(m) { loginMsg.hidden = !m; loginMsg.textContent = m || ''; }
  function showLogin(msg) {
    setScreen('login');
    document.title = 'Sign in | VFI Group admin';
    loginPw.value = '';
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
    setLoginMsg(msg || '');
    (loginEmail.value ? loginPw : loginEmail).focus();
  }
  VFI.sessionExpired = function () {
    if (expiredHandling) return;
    expiredHandling = true;
    VFI.closeAllDialogs();
    if (VFI.onSessionExpired) VFI.onSessionExpired();
    VFI.pendingHash = location.hash;
    unmountCurrent();
    VFI.user = null;
    showLogin('You were signed out. Please sign in again.');
  };

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (loginBtn.disabled) return;
    var email = loginEmail.value.trim(), pw = loginPw.value;
    if (!email || !pw) { setLoginMsg(!email ? 'Enter your email address.' : 'Enter your password.'); (!email ? loginEmail : loginPw).focus(); return; }
    loginBtn.disabled = true; loginBtn.textContent = 'Signing in…'; setLoginMsg('');
    VFI.api('POST', '/api/admin/login', { email: email, password: pw }).then(function (j) {
      loginPw.value = ''; pw = '';
      expiredHandling = false;
      VFI.user = j.user;
      if (j.user.must_change_password) showForced(); else startApp();
    }, function (err) {
      loginBtn.disabled = false; loginBtn.textContent = 'Sign in';
      if (err.handled) return;
      var m = err.status === 401 ? 'Incorrect email or password.' : err.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : VFI.errMsg(err);
      setLoginMsg(m);
      loginPw.value = '';
      loginPw.focus();
    });
  });

  VFI.logout = function () {
    return VFI.canLeave().then(function (ok) {
      if (!ok) return;
      var b = $('logoutBtn'); b.disabled = true;
      var done = function () {
        b.disabled = false;
        VFI.closeAllDialogs();
        if (VFI.onLogout) VFI.onLogout();
        unmountCurrent();
        VFI.user = null; VFI.pendingHash = null;
        history.replaceState(null, '', location.pathname);
        clear($('view'));
        expiredHandling = false;
        showLogin('');
      };
      VFI.api('POST', '/api/admin/logout').then(done, done);
    });
  };
  $('logoutBtn').addEventListener('click', function () { VFI.logout(); });

  /* ---------- password form (forced change + My account) ---------- */
  function strength(pw) {
    if (!pw) return { text: 'Use at least 12 characters.', cls: '' };
    if (pw.length < 12) return { text: (12 - pw.length) + ' more character' + (12 - pw.length === 1 ? '' : 's') + ' needed (' + pw.length + ' of 12 minimum).', cls: 'weak' };
    var kinds = (/[a-z]/.test(pw) ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) + (/[0-9]/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
    if (pw.length >= 16 && kinds >= 3) return { text: 'Strong password.', cls: 'strong' };
    if (kinds >= 2 || pw.length >= 16) return { text: 'Good password.', cls: 'good' };
    return { text: 'Long enough. Mixing letters, numbers and symbols makes it stronger.', cls: 'ok' };
  }
  /** opts: {submitLabel, onDone(user)} -> form element */
  VFI.passwordForm = function (opts) {
    var ids = { cur: nextId('pw'), nw: nextId('pw'), cf: nextId('pw'), hint: nextId('pwh') };
    var msg = h('p', { class: 'msg', role: 'alert', hidden: true });
    var cur = h('input', { id: ids.cur, type: 'password', autocomplete: 'current-password', required: true });
    var nw = h('input', { id: ids.nw, type: 'password', autocomplete: 'new-password', required: true, 'aria-describedby': ids.hint });
    var cf = h('input', { id: ids.cf, type: 'password', autocomplete: 'new-password', required: true });
    var curErr = h('p', { class: 'ferr', hidden: true }), nwErr = h('p', { class: 'ferr', hidden: true }), cfErr = h('p', { class: 'ferr', hidden: true });
    var hint = h('p', { id: ids.hint, class: 'pw-hint muted', text: strength('').text });
    var submit = h('button', { type: 'submit', class: 'btn btn-primary', text: opts.submitLabel || 'Change password' });
    var form = h('form', { novalidate: true, class: 'pw-form' }, [
      msg,
      h('div', { class: 'field' }, [h('label', { for: ids.cur, text: 'Current password' }), cur, curErr]),
      h('div', { class: 'field' }, [h('label', { for: ids.nw, text: 'New password' }), nw, hint, nwErr]),
      h('div', { class: 'field' }, [h('label', { for: ids.cf, text: 'Confirm new password' }), cf, cfErr]),
      submit
    ]);
    function setErr(el, input, m) { el.hidden = !m; el.textContent = m || ''; if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    nw.addEventListener('input', function () { var s = strength(nw.value); hint.textContent = s.text; hint.className = 'pw-hint ' + (s.cls ? 'pw-' + s.cls : 'muted'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submit.disabled) return;
      msg.hidden = true; setErr(curErr, cur, ''); setErr(nwErr, nw, ''); setErr(cfErr, cf, '');
      var bad = null;
      if (!cur.value) { setErr(curErr, cur, 'Enter your current password.'); bad = bad || cur; }
      if (nw.value.length < 12) { setErr(nwErr, nw, 'The new password must be at least 12 characters.'); bad = bad || nw; }
      else if (nw.value === cur.value) { setErr(nwErr, nw, 'Choose a password different from the current one.'); bad = bad || nw; }
      if (cf.value !== nw.value) { setErr(cfErr, cf, 'The two passwords do not match.'); bad = bad || cf; }
      if (bad) { bad.focus(); return; }
      submit.disabled = true;
      var old = submit.textContent; submit.textContent = 'Saving…';
      var body = { current: cur.value, next: nw.value };
      VFI.api('POST', '/api/admin/password', body).then(function (j) {
        cur.value = nw.value = cf.value = ''; body = null;
        submit.disabled = false; submit.textContent = old;
        hint.textContent = strength('').text; hint.className = 'pw-hint muted';
        if (opts.onDone) opts.onDone(j.user);
      }, function (err) {
        submit.disabled = false; submit.textContent = old;
        cur.value = ''; body = null;
        if (err.handled) return;
        var errs = (err.data && err.data.errors) || {};
        if (err.status === 422 && (errs.current || errs.next)) {
          if (errs.current) { setErr(curErr, cur, errs.current); cur.focus(); }
          if (errs.next) { setErr(nwErr, nw, errs.next); if (!errs.current) nw.focus(); }
        } else { msg.textContent = VFI.errMsg(err); msg.hidden = false; }
      });
    });
    return form;
  };

  function showForced() {
    VFI.closeAllDialogs();
    unmountCurrent();
    setScreen('force');
    document.title = 'Set a new password | VFI Group admin';
    var box = clear($('forceView'));
    var form = VFI.passwordForm({
      submitLabel: 'Set new password',
      onDone: function (u) {
        VFI.user = u; VFI.toast('Password updated.');
        startApp();
      }
    });
    box.appendChild(h('div', { class: 'card login force' }, [
      h('h1', { text: 'Set a new password', tabIndex: -1, id: 'forceTitle' }),
      h('p', { class: 'muted', text: 'For your security, choose a new password before you continue. It must be at least 12 characters.' }),
      form
    ]));
    $('forceTitle').focus();
  }
  VFI.showForced = showForced;

  /* ---------- "not set up yet" full-page message ---------- */
  function showSetup() {
    VFI.closeAllDialogs();
    if (current) unmountCurrent();
    var wasAuthed = !!VFI.user;
    setScreen('setup');
    document.title = 'Admin not ready | VFI Group admin';
    var retry = btn('Retry', 'btn-primary', function () {
      retry.disabled = true; retry.textContent = 'Checking…';
      expiredHandling = false;
      VFI.firstMountDone = false;
      boot();
    });
    var box = clear($('setupView'));
    box.appendChild(h('div', { class: 'card login force', role: 'alert' }, [
      h('h1', { text: 'Admin panel not ready', tabIndex: -1, id: 'setupTitle' }),
      h('p', { class: 'muted', text: 'The admin panel isn\u2019t fully set up yet. Please contact your website administrator.' }),
      retry
    ]));
    if (wasAuthed) VFI.user = null; // boot() asks the server again
    $('setupTitle').focus();
  }
  VFI.showSetup = showSetup;

  /* ---------- schema ---------- */
  var schemaPromise = null;
  VFI.loadSchema = function () {
    if (VFI.schema) return Promise.resolve(VFI.schema);
    if (!schemaPromise) {
      schemaPromise = fetch('/admin/content-schema.json', { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw { status: r.status, code: 'schema', error: 'Could not load the content schema.', data: {} };
        return r.json();
      }).then(function (s) { VFI.schema = s; return s; }, function (e) { schemaPromise = null; throw (e && e.status !== undefined ? e : { status: 0, code: 'network', error: '', data: {} }); });
    }
    return schemaPromise;
  };

  /* ---------- global events ---------- */
  window.addEventListener('offline', function () { VFI.toast('You are offline.', true); });
  window.addEventListener('online', function () { VFI.toast('Back online.'); });

  /* ---------- boot ---------- */
  function boot() {
    setScreen('boot');
    VFI.api('GET', '/api/admin/session').then(function (j) {
      if (!j.authenticated) { showLogin(''); return; }
      VFI.user = j.user;
      if (j.user.must_change_password) showForced(); else startApp();
    }, function (err) {
      if (err.handled) return;
      setScreen('login');
      setLoginMsg('Could not reach the server. Check your connection and reload.');
    });
  }
  // Deferred scripts have all run by DOMContentLoaded, so every view is registered before boot.
  document.addEventListener('DOMContentLoaded', boot);
})();
