/* Content editor: draft store, section navigation, status bar, save/conflict handling. Publish/preview/discard live in publish.js. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;

  /* ---------- store ---------- */
  var S = {
    loaded: false, draft: null, saved: '', base: null, by: '', byId: null, revision: null,
    hasUnpublished: false, changed: [], errors: {}, dirty: false, saving: false, showSummary: false
  };
  var view = null; // the mounted view's API, or null

  function snapshot() { return JSON.stringify(S.draft); }
  function recomputeDirty() { S.dirty = S.draft ? snapshot() !== S.saved : false; if (view) view.refreshStatus(); }
  var dirtyTimer;
  function markChanged() {
    S.dirty = true;
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(recomputeDirty, 200);
    if (view) view.refreshStatus();
  }
  function replaceErrors(map) {
    Object.keys(S.errors).forEach(function (k) { delete S.errors[k]; });
    Object.keys(map || {}).forEach(function (k) { S.errors[k] = map[k]; });
  }
  function adopt(j, replaceDraft) {
    S.base = j.draft_updated_at; S.by = j.draft_updated_by || ''; S.byId = j.draft_updated_by_id || null;
    S.revision = j.published_revision; S.hasUnpublished = !!j.hasUnpublished; S.changed = j.changed_sections || [];
    if (replaceDraft) {
      S.draft = j.draft; S.saved = JSON.stringify(j.draft); S.dirty = false; S.loaded = true;
    }
  }
  function reset() {
    S.loaded = false; S.draft = null; S.saved = ''; S.base = null; S.dirty = false; S.showSummary = false;
    replaceErrors({});
  }
  /** GET the draft and replace local state with it. */
  function reload() {
    return VFI.api('GET', '/api/admin/content').then(function (j) {
      adopt(j, true);
      replaceErrors({});
      S.showSummary = false;
      return j;
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; return ''; }
    return undefined;
  });
  VFI.onLogout = function () { reset(); };

  function downloadDraft() {
    var d = new Date(), pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var name = 'vfi-draft-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    VFI.download(name, JSON.stringify(S.draft, null, 2), 'application/json');
  }

  /* ---------- save ---------- */
  function conflictDialog(info) {
    return new Promise(function (resolve) {
      var who = info.updated_by || 'Another user';
      var at = info.updated_at ? VFI.fmtDate(info.updated_at, { dateStyle: 'medium', timeStyle: 'short' }) : 'a moment ago';
      var answered = false;
      VFI.dialog({
        title: 'Someone else saved changes',
        size: 'lg',
        role: 'alertdialog',
        body: [
          h('p', null, [h('strong', { text: who }), ' saved changes to the draft at ', h('strong', { text: at }), '. Your changes have not been saved yet.']),
          h('ul', { class: 'opt-list' }, [
            h('li', null, [h('strong', { text: 'Reload their version' }), ' – shows their draft. Your unsaved edits are lost.']),
            h('li', null, [h('strong', { text: 'Keep my edits' }), ' – saves your version over theirs. Their changes to this draft are replaced.']),
            h('li', null, [h('strong', { text: 'Download my draft' }), ' – saves a copy of your version as a JSON file so nothing is lost. This dialog stays open.'])
          ])
        ],
        actions: [
          { label: 'Cancel', onClick: function () { answered = true; resolve('cancel'); } },
          { label: 'Download my draft as JSON', onClick: function () { downloadDraft(); VFI.toast('Your draft was downloaded.'); return false; } },
          { label: 'Reload their version', kind: 'danger', onClick: function () { answered = true; resolve('reload'); } },
          { label: 'Keep my edits', kind: 'primary', onClick: function () { answered = true; resolve('overwrite'); } }
        ],
        focus: function (c) { return c.buttons[0]; },
        onClose: function () { if (!answered) resolve('cancel'); }
      });
    });
  }

  function save() {
    if (S.saving) return Promise.resolve(false);
    return VFI.loadSchema().then(function (schema) {
      var errs = VFI.form.validateAll(S.draft, schema);
      if (Object.keys(errs).length) {
        showErrors(errs, 'Some fields need attention');
        return false;
      }
      return send(false);
    }, function (e) { VFI.toast(VFI.errMsg(e), true); return false; });
  }
  function send(overwriting) {
    S.saving = true;
    if (view) view.refreshStatus();
    var sent = snapshot();
    return VFI.api('PUT', '/api/admin/content', { draft: JSON.parse(sent), base_updated_at: S.base }).then(function (j) {
      S.saving = false;
      var unchanged = snapshot() === sent;
      adopt(j, false);
      S.saved = JSON.stringify(j.draft);
      if (unchanged) {
        S.draft = j.draft; S.dirty = false;
        if (S.saved !== sent && view) view.rerender();
      } else recomputeDirty();
      replaceErrors({}); S.showSummary = false;
      if (view) { view.refreshStatus(); view.refreshErrors(); }
      VFI.toast(overwriting ? 'Saved. Your version replaced the other draft.' : 'Draft saved.');
      VFI.announce('Draft saved.');
      return true;
    }, function (err) {
      S.saving = false;
      if (view) view.refreshStatus();
      if (err.handled) return false;
      if (err.status === 422) {
        var errs = (err.data && err.data.errors) || {};
        if (Object.keys(errs).length) { showErrors(errs, err.error || 'Some fields need attention'); return false; }
      }
      if (err.status === 409 && err.code === 'conflict') {
        return conflictDialog(err.data || {}).then(function (choice) {
          if (choice === 'reload') {
            return reload().then(function (j) {
              if (view) view.rerender();
              VFI.toast('Loaded ' + (j.draft_updated_by || 'the other') + '’s version. Your edits were discarded.');
              return false;
            }, function (e) { VFI.toast(VFI.errMsg(e), true); return false; });
          }
          if (choice === 'overwrite') {
            var go = function (base) { S.base = base; return send(true); };
            if (err.data && err.data.updated_at) return go(err.data.updated_at);
            return VFI.api('GET', '/api/admin/content').then(function (j) { return go(j.draft_updated_at); }, function (e) { VFI.toast(VFI.errMsg(e), true); return false; });
          }
          return false;
        });
      }
      VFI.toast(VFI.errMsg(err, 'Could not save the draft.'), true);
      return false;
    });
  }
  function showErrors(errs, headline) {
    replaceErrors(errs);
    S.showSummary = true;
    var n = Object.keys(errs).length;
    if (view) view.showErrors(headline, n);
    VFI.announce(n + (n === 1 ? ' problem' : ' problems') + ' found. Fix them and save again.');
  }

  /* ---------- view ---------- */
  function mount(ctx) {
    var root = ctx.root;
    var schema = null, current = null, sectionKey = null;
    var formCtx = null, formNode = null;
    var navRefs = {};
    var wrap = h('div', { class: 'editor-wrap' });
    root.appendChild(wrap);
    wrap.appendChild(VFI.loadingBox());

    function sectionByKey(k) { return (schema.sections || []).filter(function (s) { return s.key === k; })[0]; }
    function counts() {
      var c = {};
      Object.keys(S.errors).forEach(function (p) { var k = VFI.form.sectionOfPath(p); c[k] = (c[k] || 0) + 1; });
      return c;
    }

    // ----- status bar
    var pill = h('span', { class: 'st-pill' });
    var meta = h('span', { class: 'st-meta muted' });
    var statusLive = h('div', { class: 'st-text', role: 'status', 'aria-live': 'polite' }, [pill]);
    var saveBtn = VFI.btn('Save draft', 'btn-primary', function () { save(); });
    var previewBtn = VFI.btn('Preview', '', function () { VFI.publish.preview(); });
    var publishBtn = VFI.btn('Publish…', '', function () { VFI.publish.publish(); });
    var discardBtn = VFI.btn('Discard draft', 'btn-text', function () { VFI.publish.discard(); });
    var bar = h('div', { class: 'statusbar' }, [
      h('div', { class: 'st-left' }, [statusLive, meta]),
      h('div', { class: 'st-actions' }, [discardBtn, previewBtn, saveBtn, publishBtn])
    ]);
    var summaryBox = h('div', { class: 'err-summary', hidden: true, tabIndex: -1 });

    function refreshStatus() {
      var text, cls;
      if (S.dirty) { text = 'Unsaved changes'; cls = 'st-dirty'; }
      else if (S.hasUnpublished) {
        var n = S.changed.length;
        text = 'Draft saved — not published' + (n ? ' (' + n + (n === 1 ? ' section' : ' sections') + ' changed)' : '');
        cls = 'st-draft';
      } else { text = 'All changes published'; cls = 'st-live'; }
      if (S.saving) { text = 'Saving…'; cls = 'st-dirty'; }
      pill.textContent = text;
      pill.className = 'st-pill ' + cls;
      var m = [];
      if (S.by) m.push('Draft last saved by ' + S.by);
      if (S.base) m.push(VFI.fmtDate(S.base));
      if (S.revision) m.push('Live: revision #' + S.revision);
      meta.textContent = m.join(' · ');
      saveBtn.disabled = S.saving || !S.dirty;
      publishBtn.disabled = S.saving || (!S.hasUnpublished && !S.dirty);
      discardBtn.disabled = S.saving || (!S.hasUnpublished && !S.dirty);
      saveBtn.textContent = S.saving ? 'Saving…' : 'Save draft';
      refreshNav();
    }

    // ----- nav + summary
    function localChanged() {
      var set = {};
      if (!S.dirty) return set;
      try {
        var saved = JSON.parse(S.saved);
        (schema.sections || []).forEach(function (s) { if (JSON.stringify(S.draft[s.key]) !== JSON.stringify(saved[s.key])) set[s.key] = true; });
      } catch (e) { /* ignore */ }
      return set;
    }
    function refreshNav() {
      if (!schema) return;
      var c = counts(), loc = localChanged();
      (schema.sections || []).forEach(function (s) {
        var r = navRefs[s.key]; if (!r) return;
        var n = c[s.key] || 0;
        r.err.hidden = !n; r.err.textContent = n ? String(n) : '';
        r.err.setAttribute('aria-label', n + (n === 1 ? ' problem' : ' problems'));
        var dirty = !!loc[s.key], diff = dirty || S.changed.indexOf(s.key) >= 0;
        r.dot.hidden = !diff;
        r.dot.className = 'sec-dot' + (dirty ? ' unsaved' : '');
        r.dotText.textContent = diff ? (dirty ? ' (unsaved changes)' : ' (changed, not yet published)') : '';
      });
    }
    function refreshErrors() {
      refreshNav();
      if (formNode) VFI.form.refreshCards(formNode);
      renderSummary();
    }
    function renderSummary() {
      var keys = Object.keys(S.errors);
      if (!S.showSummary || !keys.length) { summaryBox.hidden = true; VFI.clear(summaryBox); return; }
      VFI.clear(summaryBox);
      summaryBox.hidden = false;
      summaryBox.appendChild(h('p', { class: 'es-title', id: 'esTitle', text: summaryBox.dataset.headline || 'Some fields need attention' }));
      var ul = h('ul');
      keys.slice(0, 40).forEach(function (p) {
        var d = VFI.form.describePath(schema, p);
        var a = h('a', { href: '#', class: 'es-link', text: d.labels.join(' › ') });
        a.addEventListener('click', function (e) { e.preventDefault(); goTo(p); });
        ul.appendChild(h('li', null, [a, h('span', { text: ': ' + S.errors[p] })]));
      });
      if (keys.length > 40) ul.appendChild(h('li', { class: 'muted', text: 'and ' + (keys.length - 40) + ' more' }));
      summaryBox.appendChild(ul);
    }
    function goTo(path) {
      var sk = VFI.form.sectionOfPath(path);
      var finish = function () { if (!VFI.form.focusPath(formCtx, path)) { var t = wrap.querySelector('.section-title'); if (t) t.focus(); } };
      if (sk !== sectionKey && sectionByKey(sk)) { showSection(sk, true); VFI.setHash('#/content/' + encodeURIComponent(sk), true); setTimeout(finish, 0); }
      else finish();
    }

    // ----- sections
    var formHolder = h('div', { class: 'form-holder' });
    var titleEl = h('h1', { class: 'section-title', tabIndex: -1, 'data-view-title': '' });
    var descEl = h('p', { class: 'muted section-desc' });
    function showSection(key, focusTitle) {
      var s = sectionByKey(key) || schema.sections[0];
      sectionKey = s.key;
      Object.keys(navRefs).forEach(function (k) { if (k === s.key) navRefs[k].a.setAttribute('aria-current', 'page'); else navRefs[k].a.removeAttribute('aria-current'); });
      titleEl.textContent = s.label;
      descEl.textContent = s.description || '';
      document.title = s.label + ' | Content | VFI Group admin';
      formCtx = {
        errors: S.errors, reg: {},
        changed: function () { markChanged(); },
        errorsChanged: refreshErrors
      };
      VFI.clear(formHolder);
      formNode = VFI.form.buildSection(s, S.draft, formCtx);
      formHolder.appendChild(formNode);
      refreshNav();
      if (focusTitle) { titleEl.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    }

    function build() {
      VFI.clear(wrap);
      var nav = h('nav', { class: 'secnav', 'aria-label': 'Content sections' });
      var ul = h('ul');
      (schema.sections || []).forEach(function (s) {
        var err = h('span', { class: 'sec-err', hidden: true });
        var dotText = h('span', { class: 'sr' });
        var dot = h('span', { class: 'sec-dot', hidden: true, 'aria-hidden': 'true' });
        var a = h('a', { href: '#/content/' + encodeURIComponent(s.key) }, [h('span', { class: 'sec-label', text: s.label }), dot, err, dotText]);
        navRefs[s.key] = { a: a, err: err, dot: dot, dotText: dotText };
        ul.appendChild(h('li', null, a));
      });
      nav.appendChild(ul);
      nav.appendChild(h('p', { class: 'sec-legend muted small' }, [h('span', { class: 'sec-dot', 'aria-hidden': 'true' }), ' changed since last publish']));
      wrap.appendChild(h('div', { class: 'editor' }, [
        bar,
        h('div', { class: 'editor-cols' }, [
          nav,
          h('div', { class: 'editor-main' }, [titleEl, descEl, summaryBox, formHolder])
        ])
      ]));
      var key = ctx.params.param;
      if (!key || !sectionByKey(key)) {
        key = schema.sections[0].key;
        VFI.setHash('#/content/' + encodeURIComponent(key), false);
      }
      showSection(key);
      refreshStatus();
      refreshErrors();
    }

    view = {
      refreshStatus: refreshStatus, refreshErrors: refreshErrors,
      rerender: function () { if (schema) { showSection(sectionKey); refreshStatus(); refreshErrors(); } },
      showErrors: function (headline) {
        summaryBox.dataset.headline = headline;
        if (formCtx) Object.keys(formCtx.reg).forEach(function (p) { var r = formCtx.reg[p]; if (r && r.setError) r.setError(S.errors[p] || ''); });
        // errors may belong to a section other than the open one
        refreshErrors();
        var first = Object.keys(S.errors)[0];
        if (first) {
          var sk = VFI.form.sectionOfPath(first);
          if (sk !== sectionKey && sectionByKey(sk)) { showSection(sk); VFI.setHash('#/content/' + encodeURIComponent(sk), true); refreshErrors(); }
          summaryBox.scrollIntoView({ block: 'nearest' });
          // focus the first invalid field (summary stays visible above)
          setTimeout(function () { if (!VFI.form.focusPath(formCtx, first)) summaryBox.focus(); }, 0);
        }
      }
    };

    function init() {
      VFI.clear(wrap).appendChild(VFI.loadingBox());
      var p = [VFI.loadSchema()];
      if (!(S.loaded && S.dirty)) p.push(reload());
      Promise.all(p).then(function (r) {
        schema = r[0];
        // validate once so the section list can show errors for an already-invalid draft
        build();
      }, function (err) {
        if (err.handled) return;
        VFI.clear(wrap).appendChild(VFI.errorBox(err, init));
      });
    }

    // Ctrl/Cmd+S
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!schema || document.querySelector('.modal-scrim')) return;
        if (S.dirty) save(); else VFI.toast('No changes to save.');
      }
    }
    document.addEventListener('keydown', onKey);
    init();

    return {
      update: function (p) {
        if (!schema) return;
        var k = p.param;
        if (k && k !== sectionKey && sectionByKey(k)) showSection(k, true);
      },
      canLeave: function () {
        if (!S.dirty) return true;
        return new Promise(function (resolve) {
          var answered = false;
          VFI.dialog({
            title: 'Leave without saving?',
            size: 'sm',
            role: 'alertdialog',
            body: h('p', { text: 'You have unsaved changes to the draft. If you leave now they will be lost.' }),
            actions: [
              { label: 'Stay and keep editing', onClick: function () { answered = true; resolve(false); } },
              { label: 'Leave without saving', kind: 'danger', onClick: function () { answered = true; reset(); resolve(true); } },
              { label: 'Save draft and leave', kind: 'primary', onClick: function () { return save().then(function (ok) { answered = true; resolve(ok); if (!ok) return false; }); } }
            ],
            focus: function (c) { return c.buttons[0]; },
            onClose: function () { if (!answered) resolve(false); }
          });
        });
      },
      unmount: function () { document.removeEventListener('keydown', onKey); view = null; }
    };
  }

  VFI.content = {
    state: S, save: save, reload: reload, isDirty: function () { return S.dirty; },
    refresh: function () { if (view) view.rerender(); },
    applyErrors: function (errs, headline) { showErrors(errs, headline || 'The draft has content that is not valid'); },
    inEditor: function () { return !!view; }
  };
  VFI.register('content', { title: 'Content', roles: ['admin', 'editor'], mount: mount });
})();
