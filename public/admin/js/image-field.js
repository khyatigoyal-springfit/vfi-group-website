/* Image field control: thumbnail, path input, Choose from media library, Upload new, Clear. */
(function () {
  'use strict';
  var VFI = window.VFI, h = VFI.h;

  var BLOB_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;
  function previewable(v) { return /^\/assets\//.test(v) || BLOB_RE.test(v); }

  /** opts: {id, field, get() -> string, set(string), describedBy} -> {node, focusEl} */
  VFI.imageControl = function (opts) {
    var f = opts.field;
    var thumb = h('div', { class: 'img-thumb' });
    var input = h('input', { type: 'text', id: opts.id, class: 'img-path', autocomplete: 'off', spellcheck: 'false', placeholder: '/assets/… or choose an uploaded image', 'aria-describedby': opts.describedBy });
    input.value = opts.get();
    var clearBtn = f.required ? null : VFI.btn('Clear', 'btn-sm btn-text', function () { setValue(''); input.focus(); }, { 'aria-label': 'Clear image for ' + (f.label || 'this field') });
    var chooseBtn = VFI.btn('Choose from media library', 'btn-sm img-choose', function () {
      VFI.media.openPicker({ current: opts.get(), onPick: function (m) { setValue(m.url); input.focus(); VFI.announce('Image selected: ' + (m.alt || 'uploaded image')); } });
    });
    var upBtn = VFI.btn('Upload new', 'btn-sm', function () {
      VFI.media.openUpload({ single: true, onDone: function (rows) { if (rows[0]) { setValue(rows[0].url); VFI.announce('Image uploaded and selected.'); } } });
    });
    var actions = h('div', { class: 'img-actions' }, [chooseBtn, upBtn, clearBtn]);
    var node = h('div', { class: 'imgctl' }, [thumb, h('div', { class: 'img-side' }, [input, actions])]);

    function paint() {
      var v = opts.get();
      VFI.clear(thumb);
      thumb.classList.remove('broken');
      if (v && previewable(v)) {
        var img = h('img', { src: v, alt: '' });
        img.addEventListener('error', function () { thumb.classList.add('broken'); VFI.clear(thumb); thumb.appendChild(h('span', { class: 'img-empty', text: 'Not found' })); });
        thumb.appendChild(img);
      } else {
        thumb.appendChild(h('span', { class: 'img-empty', text: v ? 'No preview' : 'No image' }));
      }
      if (clearBtn) clearBtn.hidden = !v;
    }
    function setValue(v) {
      input.value = v;
      opts.set(v);
      paint();
    }
    input.addEventListener('input', function () { opts.set(input.value); });
    input.addEventListener('change', paint);
    paint();
    return { node: node, focusEl: input };
  };
})();
