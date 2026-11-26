/* Preview, publish and discard flows for the content editor. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;
  var PREVIEW_URL = '/?preview=1';

  function C() { return VFI.content; }

  function sectionLabels(keys) {
    var secs = (VFI.schema && VFI.schema.sections) || [];
    return keys.map(function (k) { var s = secs.filter(function (x) { return x.key === k; })[0]; return s ? s.label : k; });
  }

  /** Ask to save first. Resolves true when the draft is saved (or was never dirty). */
  function needSave(opts) {
    return new Promise(function (resolve) {
      var answered = false;
      VFI.dialog({
        title: opts.title,
        size: 'sm',
        body: h('p', { text: opts.text }),
        actions: [
          { label: 'Cancel', onClick: function () { answered = true; resolve(false); } },
          { label: opts.confirm, kind: 'primary', onClick: function (ctrl) { answered = true; return opts.run(ctrl, resolve); } }
        ],
        onClose: function () { if (!answered) resolve(false); }
      });
    });
  }

  function preview() {
    if (!C().isDirty()) { window.open(PREVIEW_URL, '_blank'); return; }
    needSave({
      title: 'Save before previewing?',
      text: 'The preview shows your saved draft. You have unsaved changes, so save them first.',
      confirm: 'Save draft and preview',
      run: function (ctrl, resolve) {
        // open the tab synchronously (inside the click) so pop-up blockers allow it
        var w = window.open('about:blank', '_blank');
        return C().save().then(function (ok) {
          if (ok) { if (w) w.location.href = PREVIEW_URL; else window.open(PREVIEW_URL, '_blank'); }
          else if (w) w.close();
          resolve(ok);
        });
      }
    });
  }

  function openPublishDialog() {
    var S = C().state;
    var noteId = VFI.nextId('note');
    var note = h('textarea', { id: noteId, rows: 3, maxlength: 200, 'aria-describedby': noteId + '-h ' + noteId + '-e', placeholder: 'For example: Updated the Kenstar brand description' });
    var err = h('p', { class: 'ferr', id: noteId + '-e', hidden: true });
    var count = h('span', { class: 'counter muted', text: '0 / 200', 'aria-hidden': 'true' });
    note.addEventListener('input', function () { count.textContent = note.value.length + ' / 200'; if (note.value.trim()) { err.hidden = true; note.removeAttribute('aria-invalid'); } });
    var changed = sectionLabels(S.changed);
    var summary = changed.length
      ? h('div', { class: 'pub-summary' }, [
        h('p', { class: 'pub-sum-title', text: changed.length === 1 ? '1 section will change on the live site:' : changed.length + ' sections will change on the live site:' }),
        h('ul', { class: 'chips' }, changed.map(function (l) { return h('li', { text: l }); }))
      ])
      : h('p', { class: 'muted', text: 'This makes your saved draft the live version.' });
    VFI.dialog({
      title: 'Publish to the live site',
      size: 'md',
      body: [
        summary,
        h('div', { class: 'field' }, [
          h('label', { for: noteId, text: 'Short note (optional)' }),
          h('p', { class: 'help muted', id: noteId + '-h', text: 'Say what changed. It appears in History so everyone can see what was published.' }),
          note,
          h('div', { class: 'fmeta' }, [err, count])
        ]),
        h('p', { class: 'muted small', text: 'Visitors see the change within about a minute. You can undo it from History.' })
      ],
      actions: [
        { label: 'Cancel' },
        {
          label: 'Publish', kind: 'primary', onClick: function () {
            var v = note.value.trim();
            return VFI.api('POST', '/api/admin/publish', { note: v }).then(function (j) {
              var rev = (j.revision && j.revision.id) || j.published_revision;
              VFI.toast('Published' + (rev ? ' as revision #' + rev : '') + '. It will be live within about a minute.');
              VFI.announce('Published.');
              return C().reload().then(function () { C().refresh(); }, function () {});
            }, function (e) {
              if (e.handled) return false;
              if (e.status === 422 && e.data && e.data.errors) {
                setTimeout(function () { C().applyErrors(e.data.errors, e.error || 'The draft cannot be published until these are fixed'); }, 0);
                return true; // close the dialog; the editor shows the problems
              }
              err.textContent = VFI.errMsg(e, 'Could not publish.'); err.hidden = false; return false;
            });
          }
        }
      ],
      focus: note
    });
  }

  function publish() {
    var S = C().state;
    if (C().isDirty()) {
      needSave({
        title: 'Save before publishing?',
        text: 'You have unsaved changes. Save the draft first, then publish it.',
        confirm: 'Save draft and continue',
        run: function (ctrl, resolve) {
          return C().save().then(function (ok) { resolve(ok); if (ok) setTimeout(openPublishDialog, 0); });
        }
      });
      return;
    }
    if (!S.hasUnpublished) { VFI.toast('There is nothing new to publish.'); return; }
    openPublishDialog();
  }

  function discard() {
    var S = C().state;
    if (!S.hasUnpublished && !C().isDirty()) { VFI.toast('The draft already matches the live site.'); return; }
    VFI.confirm({
      title: 'Discard the draft?',
      message: ['This resets the draft to what is live on the site. Every unpublished change' + (C().isDirty() ? ', including your unsaved edits,' : '') + ' will be lost.', 'This cannot be undone.'],
      confirmLabel: 'Discard draft', danger: true
    }).then(function (ok) {
      if (!ok) return;
      VFI.api('POST', '/api/admin/discard', {}).then(function () {
        return C().reload();
      }).then(function () {
        C().refresh();
        VFI.toast('Draft discarded. It now matches the live site.');
        VFI.announce('Draft discarded.');
      }, function (e) { if (!e.handled) VFI.toast(VFI.errMsg(e, 'Could not discard the draft.'), true); });
    });
  }

  VFI.publish = { preview: preview, publish: publish, discard: discard, sectionLabels: sectionLabels };
})();
