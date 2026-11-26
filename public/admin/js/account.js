/* My account: display name and password. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;

  function mount(ctx) {
    var u = ctx.user;
    var nameId = VFI.nextId('acc');
    var name = h('input', { id: nameId, type: 'text', maxlength: 120, autocomplete: 'name' });
    name.value = u.name || '';
    var nameErr = h('p', { class: 'ferr', hidden: true });
    var msg = h('p', { class: 'msg ok', role: 'status', hidden: true });
    var save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save name' });
    var form = h('form', { novalidate: true, class: 'card pad' }, [
      h('h2', { text: 'Your details' }),
      h('dl', { class: 'kv' }, [
        h('dt', { text: 'Email' }), h('dd', { text: u.email }),
        h('dt', { text: 'Role' }), h('dd', { text: u.role.charAt(0).toUpperCase() + u.role.slice(1) })
      ]),
      msg,
      h('div', { class: 'field' }, [h('label', { for: nameId, text: 'Display name' }), name, nameErr]),
      save
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (save.disabled) return;
      nameErr.hidden = true; msg.hidden = true;
      var v = name.value.trim();
      if (!v) { nameErr.textContent = 'Enter your name.'; nameErr.hidden = false; name.focus(); return; }
      save.disabled = true;
      VFI.api('PATCH', '/api/admin/account', { name: v }).then(function (j) {
        save.disabled = false;
        VFI.refreshUser(j.user);
        msg.textContent = 'Name saved.'; msg.hidden = false;
        VFI.toast('Name saved.');
      }, function (err) {
        save.disabled = false;
        if (err.handled) return;
        var e2 = (err.data && err.data.errors) || {};
        nameErr.textContent = e2.name || VFI.errMsg(err, 'Could not save your name.'); nameErr.hidden = false; name.focus();
      });
    });
    var pwForm = VFI.passwordForm({ submitLabel: 'Change password', onDone: function (nu) { VFI.refreshUser(nu); VFI.toast('Password changed.'); VFI.announce('Password changed.'); } });
    ctx.root.appendChild(h('div', { class: 'wrap narrow' }, [
      VFI.pageHead('My account'),
      form,
      h('section', { class: 'card pad', 'aria-labelledby': 'pwTitle' }, [
        h('h2', { id: 'pwTitle', text: 'Change password' }),
        h('p', { class: 'muted', text: 'Use at least 12 characters. Changing it signs you out of other devices.' }),
        pwForm
      ])
    ]));
    return {};
  }
  VFI.register('account', { title: 'My account', roles: ['admin', 'editor', 'sales'], mount: mount });
})();
