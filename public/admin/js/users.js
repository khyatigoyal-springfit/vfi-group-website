/* Users (admin only): list, create, edit name/role, deactivate, reset password. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;
  var ROLES = [
    { v: 'admin', label: 'Admin', help: 'Everything, including users and the audit log' },
    { v: 'editor', label: 'Editor', help: 'Enquiries, content, media and history' },
    { v: 'sales', label: 'Sales', help: 'Enquiries only' }
  ];
  var ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generatePassword() {
    var out = '', buf = new Uint32Array(1), max = Math.floor(4294967296 / ALPHABET.length) * ALPHABET.length;
    while (out.length < 16) {
      crypto.getRandomValues(buf);
      if (buf[0] >= max) continue;
      out += ALPHABET.charAt(buf[0] % ALPHABET.length);
      if (out.length % 5 === 4 && out.length < 15) out += '-';
    }
    return out;
  }
  function roleLabel(v) { var r = ROLES.filter(function (x) { return x.v === v; })[0]; return r ? r.label : v; }

  function mount(ctx) {
    var me = ctx.user;
    var users = [];
    var box = h('div', { class: 'card list-box', 'aria-busy': 'false' });
    var addBtn = VFI.btn('Add user', 'btn-primary', function () { addUser(); });
    ctx.root.appendChild(h('div', { class: 'wrap' }, [
      VFI.pageHead('Users', 'People who can sign in to this admin area.', [addBtn]), box
    ]));

    function load(focusId) {
      box.setAttribute('aria-busy', 'true');
      if (!users.length) VFI.clear(box).appendChild(VFI.loadingBox());
      VFI.api('GET', '/api/admin/users').then(function (j) {
        users = (j.users || []).slice().sort(function (a, b) { return (a.name || a.email).toLowerCase() < (b.name || b.email).toLowerCase() ? -1 : 1; });
        box.setAttribute('aria-busy', 'false');
        render(focusId);
      }, function (err) {
        box.setAttribute('aria-busy', 'false');
        if (err.handled) return;
        VFI.clear(box).appendChild(VFI.errorBox(err, function () { load(); }));
      });
    }
    function activeAdmins() { return users.filter(function (u) { return u.role === 'admin' && u.active; }).length; }

    function render(focusId) {
      VFI.clear(box);
      var table = h('table', { class: 'tbl users-tbl' });
      table.appendChild(h('caption', { class: 'sr', text: 'Users' }));
      table.appendChild(h('thead', null, h('tr', null, ['Name', 'Email', 'Role', 'Status', 'Last sign-in', 'Actions'].map(function (t) { return h('th', { scope: 'col', text: t }); }))));
      var tb = h('tbody');
      var lastAdminId = activeAdmins() === 1 ? users.filter(function (u) { return u.role === 'admin' && u.active; })[0].id : null;
      users.forEach(function (u) {
        var isMe = u.id === me.id, isLast = u.id === lastAdminId;
        var label = u.name || u.email;
        var noteId = VFI.nextId('la');
        var deact = u.active
          ? VFI.btn('Deactivate', 'btn-sm', function () { setActive(u, false); }, { 'aria-label': 'Deactivate ' + label, disabled: isLast, 'aria-describedby': isLast ? noteId : null })
          : VFI.btn('Reactivate', 'btn-sm', function () { setActive(u, true); }, { 'aria-label': 'Reactivate ' + label });
        var actions = h('td', { class: 'c-act' }, [
          h('div', { class: 'act-row' }, [
            VFI.btn('Edit', 'btn-sm', function () { editUser(u); }, { 'aria-label': 'Edit ' + label, dataset: { uid: u.id } }),
            VFI.btn('Reset password', 'btn-sm', function () { resetPw(u); }, { 'aria-label': 'Reset password for ' + label }),
            deact
          ]),
          isLast ? h('p', { class: 'muted small', id: noteId, text: 'Last active admin: cannot be deactivated or demoted.' }) : null
        ]);
        tb.appendChild(h('tr', { class: u.active ? '' : 'inactive' }, [
          h('td', { class: 'c-name' }, [h('span', { class: 'who', text: u.name || '—' }), isMe ? h('span', { class: 'you', text: ' (you)' }) : null]),
          h('td', { class: 'c-email', text: u.email }),
          h('td', null, h('span', { class: 'role-chip r-' + u.role, text: roleLabel(u.role) })),
          h('td', null, [h('span', { class: 'badge ' + (u.active ? 'b-contacted' : 'b-closed'), text: u.active ? 'Active' : 'Deactivated' }), u.must_change_password ? h('span', { class: 'muted small must-change', text: ' Must set new password' }) : null]),
          h('td', { class: 'when' }, u.last_login_at ? VFI.timeEl(u.last_login_at) : h('span', { class: 'muted', text: 'Never' })),
          actions
        ]));
      });
      table.appendChild(tb);
      box.appendChild(table);
      if (focusId) { var b = box.querySelector('[data-uid="' + focusId + '"]'); if (b) b.focus(); }
    }

    function fieldErrs(errs, map) {
      Object.keys(map).forEach(function (k) { var e = map[k]; var m = errs && errs[k]; e.textContent = m || ''; e.hidden = !m; });
    }

    function roleSelect(id, value, disabled) {
      var sel = h('select', { id: id, disabled: disabled });
      ROLES.forEach(function (r) { sel.appendChild(h('option', { value: r.v, text: r.label + ' – ' + r.help })); });
      sel.value = value;
      return sel;
    }

    function addUser() {
      var ids = { e: VFI.nextId('u'), n: VFI.nextId('u'), r: VFI.nextId('u'), p: VFI.nextId('u') };
      var email = h('input', { id: ids.e, type: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      var name = h('input', { id: ids.n, type: 'text', autocomplete: 'off', maxlength: 120 });
      var role = roleSelect(ids.r, 'editor');
      var pw = h('input', { id: ids.p, type: 'text', autocomplete: 'off', spellcheck: 'false', class: 'mono', 'aria-describedby': ids.p + '-h' });
      var errs = { email: h('p', { class: 'ferr', hidden: true }), name: h('p', { class: 'ferr', hidden: true }), role: h('p', { class: 'ferr', hidden: true }), password: h('p', { class: 'ferr', hidden: true }) };
      var gen = VFI.btn('Generate', 'btn-sm', function () { pw.value = generatePassword(); pw.focus(); });
      var msg = h('p', { class: 'msg', role: 'alert', hidden: true });
      var ctrl = VFI.dialog({
        title: 'Add a user',
        size: 'md',
        body: h('form', { novalidate: true, class: 'dlg-form' }, [
          msg,
          h('div', { class: 'field' }, [h('label', { for: ids.e, text: 'Email address' }), email, errs.email]),
          h('div', { class: 'field' }, [h('label', { for: ids.n, text: 'Name' }), name, errs.name]),
          h('div', { class: 'field' }, [h('label', { for: ids.r, text: 'Role' }), role, errs.role]),
          h('div', { class: 'field' }, [h('label', { for: ids.p, text: 'Initial password' }),
            h('div', { class: 'inline-row' }, [pw, gen]),
            h('p', { class: 'help muted', id: ids.p + '-h', text: 'At least 12 characters. Pass it to the person yourself; they must choose a new one when they first sign in.' }), errs.password])
        ]),
        actions: [{ label: 'Cancel' }, {
          label: 'Create user', kind: 'primary', onClick: function () {
            msg.hidden = true; fieldErrs({}, errs);
            var body = { email: email.value.trim(), name: name.value.trim(), role: role.value, password: pw.value };
            var local = {};
            if (!body.email) local.email = 'Enter an email address';
            if (body.password.length < 12) local.password = 'Password must be at least 12 characters';
            if (Object.keys(local).length) { fieldErrs(local, errs); (local.email ? email : pw).focus(); return false; }
            return VFI.api('POST', '/api/admin/users', body).then(function (j) {
              body.password = ''; pw.value = '';
              VFI.toast('User created: ' + (j.user && j.user.email));
              load();
            }, function (err) {
              if (err.handled) return false;
              var e = (err.data && err.data.errors) || {};
              if (Object.keys(e).length) { fieldErrs(e, errs); var first = e.email ? email : e.name ? name : e.role ? role : pw; first.focus(); }
              else { msg.textContent = VFI.errMsg(err, 'Could not create the user.'); msg.hidden = false; }
              return false;
            });
          }
        }]
      });
      ctrl.el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); ctrl.buttons[1].click(); });
    }

    function editUser(u) {
      var isLast = activeAdmins() === 1 && u.role === 'admin' && u.active;
      var ids = { n: VFI.nextId('u'), r: VFI.nextId('u') };
      var name = h('input', { id: ids.n, type: 'text', maxlength: 120, autocomplete: 'off' });
      name.value = u.name || '';
      var role = roleSelect(ids.r, u.role, isLast);
      var errs = { name: h('p', { class: 'ferr', hidden: true }), role: h('p', { class: 'ferr', hidden: true }) };
      var msg = h('p', { class: 'msg', role: 'alert', hidden: true });
      var ctrl = VFI.dialog({
        title: 'Edit ' + (u.name || u.email),
        size: 'md',
        body: h('form', { novalidate: true, class: 'dlg-form' }, [
          msg,
          h('p', { class: 'muted', text: u.email }),
          h('div', { class: 'field' }, [h('label', { for: ids.n, text: 'Name' }), name, errs.name]),
          h('div', { class: 'field' }, [h('label', { for: ids.r, text: 'Role' }), role,
            isLast ? h('p', { class: 'help muted', text: 'This is the only active admin, so the role cannot be changed. Make another user an admin first.' }) : null, errs.role])
        ]),
        actions: [{ label: 'Cancel' }, {
          label: 'Save', kind: 'primary', onClick: function () {
            var patch = { id: u.id };
            if (name.value.trim() !== (u.name || '')) patch.name = name.value.trim();
            if (role.value !== u.role) patch.role = role.value;
            if (Object.keys(patch).length === 1) return true;
            var go = function () {
              msg.hidden = true; fieldErrs({}, errs);
              return VFI.api('PATCH', '/api/admin/users', patch).then(function () {
                VFI.toast('User updated.');
                if (u.id === me.id) {
                  VFI.api('GET', '/api/admin/session').then(function (s) { if (s.user) { VFI.refreshUser(s.user); if (s.user.role !== me.role) location.reload(); } });
                }
                load(u.id);
              }, function (err) {
                if (err.handled) return false;
                if (err.code === 'last_admin') msg.textContent = err.error || 'At least one active administrator must remain.';
                else {
                  var e = (err.data && err.data.errors) || {};
                  if (Object.keys(e).length) { fieldErrs(e, errs); return false; }
                  msg.textContent = VFI.errMsg(err, 'Could not update the user.');
                }
                msg.hidden = false; return false;
              });
            };
            if (patch.role && u.id === me.id && patch.role !== 'admin') {
              return VFI.confirm({ title: 'Change your own role?', message: 'You will lose access to some areas, including Users, straight away.', confirmLabel: 'Change role', danger: true }).then(function (ok) { return ok ? go() : false; });
            }
            return go();
          }
        }]
      });
      ctrl.el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); ctrl.buttons[1].click(); });
    }

    function setActive(u, active) {
      var label = u.name || u.email;
      var self = u.id === me.id && !active;
      VFI.confirm({
        title: active ? 'Reactivate ' + label + '?' : 'Deactivate ' + label + '?',
        message: active ? 'They will be able to sign in again.' : (self ? 'This is your own account. You will be signed out straight away and will not be able to sign in again until another admin reactivates you.' : 'They are signed out straight away and cannot sign in until reactivated.'),
        confirmLabel: active ? 'Reactivate' : 'Deactivate', danger: !active
      }).then(function (ok) {
        if (!ok) return;
        VFI.api('PATCH', '/api/admin/users', { id: u.id, active: active }).then(function () {
          VFI.toast(active ? label + ' reactivated.' : label + ' deactivated.');
          load(u.id);
        }, function (err) {
          if (err.handled) return;
          if (err.code === 'last_admin') VFI.alertDialog('Cannot deactivate the last admin', h('p', { text: err.error || 'At least one active administrator must remain. Make another user an administrator first.' }));
          else VFI.toast(VFI.errMsg(err, 'Could not update the user.'), true);
        });
      });
    }

    function resetPw(u) {
      var label = u.name || u.email;
      VFI.confirm({
        title: 'Reset password for ' + label + '?',
        message: 'A temporary password is created and shown once. ' + label + ' is signed out everywhere and must choose a new password at the next sign-in.',
        confirmLabel: 'Reset password', danger: true
      }).then(function (ok) {
        if (!ok) return;
        VFI.api('PATCH', '/api/admin/users', { id: u.id, resetPassword: true }).then(function (j) {
          showTemp(u, j.temporary_password);
          j.temporary_password = null;
          load(u.id);
        }, function (err) {
          if (err.handled) return;
          if (err.code === 'last_admin') VFI.alertDialog('Cannot reset', h('p', { text: err.error }));
          else VFI.toast(VFI.errMsg(err, 'Could not reset the password.'), true);
        });
      });
    }
    function showTemp(u, temp) {
      var code = h('code', { class: 'temp-pw', id: VFI.nextId('tp'), text: temp });
      var copy = VFI.btn('Copy', 'btn-sm', function () {
        VFI.copyText(code.textContent).then(function () { copy.textContent = 'Copied'; VFI.announce('Temporary password copied.'); setTimeout(function () { copy.textContent = 'Copy'; }, 2000); }, function () { VFI.toast('Could not copy. Select the password and copy it manually.', true); });
      }, { 'aria-label': 'Copy temporary password' });
      temp = null;
      VFI.dialog({
        title: 'Temporary password',
        size: 'sm',
        body: [
          h('p', null, ['The new temporary password for ', h('strong', { text: u.name || u.email }), ' is:']),
          h('div', { class: 'temp-row' }, [code, copy]),
          h('p', { class: 'msg warn', role: 'note', text: 'This is shown only once. Copy it now and give it to the person securely. It cannot be shown again, and they must change it when they sign in.' })
        ],
        actions: [{ label: 'I have copied it', kind: 'primary' }],
        focus: function (c) { return copy; },
        dismissable: false,
        onClose: function () { code.textContent = ''; }
      });
    }

    load();
    return {};
  }
  VFI.register('users', { title: 'Users', roles: ['admin'], mount: mount });
})();
