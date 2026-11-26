/* Audit log (admin only): read-only paged table. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;
  var PAGE = 50;

  var LABELS = {
    login: 'Signed in', login_failed: 'Failed sign-in', logout: 'Signed out',
    password_change: 'Changed password', password_change_failed: 'Failed password change', account_update: 'Updated own account',
    content_save: 'Saved draft', content_publish: 'Published', content_rollback: 'Rolled back', content_discard: 'Discarded draft',
    media_upload: 'Uploaded image', media_update: 'Edited image', media_delete: 'Deleted image',
    user_create: 'Created user', user_update: 'Updated user', user_reset_password: 'Reset password',
    enquiry_update: 'Updated enquiry', enquiry_export: 'Exported enquiries'
  };
  function actionLabel(a) { return LABELS[a] || String(a || '').replace(/_/g, ' '); }
  function detailText(d) {
    if (!d || typeof d !== 'object') return '';
    var parts = [];
    Object.keys(d).forEach(function (k) {
      var v = d[k];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      parts.push(k.replace(/_/g, ' ') + ': ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    });
    var s = parts.join(', ');
    return s.length > 140 ? s.slice(0, 139) + '…' : s;
  }

  function mount(ctx) {
    var state = { page: 1, total: 0, rows: [] };
    var box = h('div', { class: 'card list-box', 'aria-busy': 'false' });
    var pagerBox = h('div');
    ctx.root.appendChild(h('div', { class: 'wrap' }, [
      VFI.pageHead('Audit log', 'A read-only record of sign-ins, content changes, uploads and user changes. Newest first.', [VFI.btn('Refresh', '', function () { load(); })]),
      box, pagerBox
    ]));

    function load(page) {
      state.page = page || state.page;
      box.setAttribute('aria-busy', 'true');
      VFI.clear(box).appendChild(VFI.loadingBox());
      VFI.clear(pagerBox);
      VFI.api('GET', '/api/admin/audit?page=' + state.page + '&pageSize=' + PAGE).then(function (j) {
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
      if (!state.rows.length) { box.appendChild(VFI.stateBox('No activity recorded yet')); return; }
      var table = h('table', { class: 'tbl audit-tbl' });
      table.appendChild(h('caption', { class: 'sr', text: 'Audit log' }));
      table.appendChild(h('thead', null, h('tr', null, ['Time', 'User', 'Action', 'Target', 'Detail'].map(function (t) { return h('th', { scope: 'col', text: t }); }))));
      var tb = h('tbody');
      state.rows.forEach(function (r) {
        var failed = /failed/.test(r.action);
        tb.appendChild(h('tr', { class: failed ? 'is-bad' : '' }, [
          h('td', { class: 'when' }, VFI.timeEl(r.at)),
          h('td', { text: r.user_name || r.user_email || (r.user_id ? 'Unknown user' : 'System') }),
          h('td', null, h('span', { class: 'act-chip' + (failed ? ' bad' : ''), text: actionLabel(r.action), title: r.action })),
          h('td', { class: 'c-target', text: r.target || '—' }),
          h('td', { class: 'c-detail muted', text: detailText(r.detail) })
        ]));
      });
      table.appendChild(tb);
      box.appendChild(table);
      pagerBox.appendChild(VFI.pager({ page: state.page, pageSize: PAGE, total: state.total }, function () { load(state.page - 1); window.scrollTo(0, 0); }, function () { load(state.page + 1); window.scrollTo(0, 0); }));
    }
    load(1);
    return {};
  }
  VFI.register('audit', { title: 'Audit log', roles: ['admin'], mount: mount });
})();
