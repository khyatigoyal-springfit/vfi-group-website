/* History: published revisions, per-revision changed sections vs live, rollback. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;
  var PAGE = 20;

  function mount(ctx) {
    var state = { page: 1, total: 0, rows: [] };
    var box = h('div', { class: 'card list-box', 'aria-busy': 'false' });
    var pagerBox = h('div');
    var wrap = h('div', { class: 'wrap' }, [
      VFI.pageHead('History', 'Every time the site is published a new version is saved here. You can see what changed and go back to any earlier version.'),
      box, pagerBox
    ]);
    ctx.root.appendChild(wrap);
    VFI.loadSchema().catch(function () {});

    function load(page) {
      state.page = page || state.page;
      box.setAttribute('aria-busy', 'true');
      VFI.clear(box).appendChild(VFI.loadingBox());
      VFI.clear(pagerBox);
      VFI.api('GET', '/api/admin/revisions?page=' + state.page + '&pageSize=' + PAGE).then(function (j) {
        state.rows = j.rows || []; state.total = j.total || 0;
        var pages = Math.max(1, Math.ceil(state.total / PAGE));
        if (state.page > pages) return load(pages);
        box.setAttribute('aria-busy', 'false');
        render();
      }, function (err) {
        box.setAttribute('aria-busy', 'false');
        if (err.handled) return;
        VFI.clear(box).appendChild(VFI.errorBox(err, function () { load(); }));
      });
    }

    function render() {
      VFI.clear(box); VFI.clear(pagerBox);
      if (!state.rows.length) { box.appendChild(VFI.stateBox('Nothing published yet', 'Published versions will appear here.')); return; }
      var table = h('table', { class: 'tbl' });
      table.appendChild(h('caption', { class: 'sr', text: 'Published versions' }));
      table.appendChild(h('thead', null, h('tr', null, ['Version', 'Note', 'Published by', 'Date', 'Actions'].map(function (t) { return h('th', { scope: 'col', text: t }); }))));
      var tb = h('tbody');
      state.rows.forEach(function (r) {
        var ver = h('td', { class: 'c-ver' }, [h('span', { class: 'ver', text: '#' + r.id }), r.is_current ? h('span', { class: 'badge b-live', text: 'Live' }) : null]);
        var actions = h('td', { class: 'c-act' }, [
          VFI.btn('View changes', 'btn-sm', function () { viewChanges(r); }, { 'aria-label': 'View changes in version ' + r.id }),
          r.is_current ? h('span', { class: 'muted small', text: 'Current version' }) : VFI.btn('Roll back', 'btn-sm', function () { rollback(r); }, { 'aria-label': 'Roll back to version ' + r.id })
        ]);
        tb.appendChild(h('tr', { class: r.is_current ? 'is-live' : '' }, [
          ver,
          h('td', { class: 'c-note', text: r.note || '—' }),
          h('td', { text: r.published_by || 'System' }),
          h('td', { class: 'when' }, VFI.timeEl(r.published_at)),
          actions
        ]));
      });
      table.appendChild(tb);
      box.appendChild(table);
      pagerBox.appendChild(VFI.pager({ page: state.page, pageSize: PAGE, total: state.total }, function () { load(state.page - 1); }, function () { load(state.page + 1); }));
    }

    function viewChanges(r) {
      var body = h('div', null, h('p', { class: 'muted', text: 'Loading…' }));
      VFI.dialog({ title: 'Version #' + r.id, size: 'md', body: body, actions: [{ label: 'Close', kind: 'primary' }] });
      Promise.all([VFI.api('GET', '/api/admin/revision?id=' + r.id), VFI.loadSchema().catch(function () { return null; })]).then(function (res) {
        var j = res[0];
        var labels = VFI.publish.sectionLabels(j.changed_sections || []);
        VFI.clear(body);
        var rev = j.revision || r;
        body.appendChild(h('p', { class: 'muted', text: 'Published ' + VFI.fmtDate(rev.published_at) + ' by ' + (rev.published_by || 'System') + (rev.note ? '. Note: “' + rev.note + '”' : '.') }));
        if (rev.is_current) body.appendChild(h('p', { text: 'This is the version that is live on the site now.' }));
        else if (!labels.length) body.appendChild(h('p', { text: 'This version is identical to the live site.' }));
        else {
          body.appendChild(h('p', { text: 'Compared with the live site, these sections are different in this version:' }));
          body.appendChild(h('ul', { class: 'chips' }, labels.map(function (l) { return h('li', { text: l }); })));
        }
      }, function (err) {
        VFI.clear(body).appendChild(h('p', { class: 'ferr', role: 'alert', text: VFI.errMsg(err, 'Could not load this version.') }));
      });
    }

    function rollback(r) {
      VFI.confirm({
        title: 'Roll back to version #' + r.id + '?',
        message: [
          'The site will go back to version #' + r.id + (r.note ? ' (“' + r.note + '”)' : '') + ' straight away, as a new version called “Rollback to #' + r.id + '”.',
          'Your current draft is replaced by that version. Nothing is deleted from History, so you can roll forward again.'
        ],
        confirmLabel: 'Roll back and publish', danger: true
      }).then(function (ok) {
        if (!ok) return;
        VFI.api('POST', '/api/admin/rollback', { id: r.id }).then(function (j) {
          VFI.toast('Rolled back to #' + r.id + '. The live site updates within about a minute.');
          VFI.announce('Rolled back to version ' + r.id + '.');
          load(1);
        }, function (err) { if (!err.handled) VFI.toast(VFI.errMsg(err, 'Could not roll back.'), true); });
      });
    }

    load(1);
    return {};
  }
  VFI.register('history', { title: 'History', roles: ['admin', 'editor'], mount: mount });
})();
