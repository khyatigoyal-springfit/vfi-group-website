'use strict';
// Schema-driven validation of the site content document (CMS-ARCHITECTURE section 5).
// validate(content, schema) -> { ok, value, errors: { "brands[3].url": "message" } }
// `value` is a normalised copy (strings trimmed, control characters removed); unknown keys are rejected.

const MAX_BYTES = 512 * 1024;
const DEFAULT_MAX = 2000;
const MAX_LIST_ITEMS = 500;
const MAX_STRING_LIST_ITEMS = 200;
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g; // keeps \t and \n
const BLOB_HOST_RE = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;
const ASSET_RE = /^\/assets\/[A-Za-z0-9_./-]+$/;
const SITE_PATH_RE = /^\/(?![/\\])[^\s\\\u0000-\u001F\u007F]*$/;
const MAIL_RE = /^mailto:[^\s<>"]{1,300}$/i;
const TEL_RE = /^tel:\+?[0-9 ()./-]{3,40}$/i;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const join = (base, key) => (base ? `${base}.${key}` : key);

function maxOf(field, d = DEFAULT_MAX) {
  return Number.isInteger(field.max) && field.max > 0 ? field.max : d;
}

function cleanString(v, multiline) {
  let s = v.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  if (!multiline) s = s.replace(/[\n\t]+/g, ' ');
  return s.trim();
}

/** @returns {string|null} error message when `s` is not an allowed link target. */
function urlError(s) {
  if (s.startsWith('/')) return SITE_PATH_RE.test(s) ? null : 'Enter a valid site link such as /contact';
  if (/^mailto:/i.test(s)) return MAIL_RE.test(s) ? null : 'Enter a valid email link (mailto:name@example.com)';
  if (/^tel:/i.test(s)) return TEL_RE.test(s) ? null : 'Enter a valid phone link (tel:+911234567890)';
  if (/^https:\/\//i.test(s)) {
    if (/[\s<>"\\\u0000-\u001F\u007F]/.test(s)) return 'Enter a valid https:// link';
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return 'Enter a valid https:// link';
      return null;
    } catch (e) { return 'Enter a valid https:// link'; }
  }
  return 'Links must start with https://, / , mailto: or tel:';
}

function imageError(s) {
  if (s.startsWith('/')) return ASSET_RE.test(s) && !s.includes('..') && !s.includes('//') ? null : 'Image must be a /assets/ file or an uploaded image';
  if (/^https:\/\//i.test(s)) {
    if (/[\s<>"\\\u0000-\u001F\u007F]/.test(s)) return 'Image must be a /assets/ file or an uploaded image';
    try {
      const u = new URL(s);
      if (u.protocol === 'https:' && BLOB_HOST_RE.test(u.hostname) && !u.username && !u.password && !u.port) return null;
    } catch (e) { /* fall through */ }
  }
  return 'Image must be a /assets/ file or an uploaded image';
}

function optionValues(field) {
  return (Array.isArray(field.options) ? field.options : []).map((o) => (o && typeof o === 'object' ? o.value : o));
}

function validateField(field, value, path, errors) {
  const type = field.type;
  const required = Boolean(field.required);
  const missing = value === undefined || value === null;

  switch (type) {
    case 'text': case 'textarea': case 'url': case 'image': {
      if (missing) { if (required) errors[path] = 'This field is required'; return undefined; }
      if (typeof value !== 'string') { errors[path] = 'Must be text'; return undefined; }
      const s = cleanString(value, type === 'textarea');
      const max = maxOf(field);
      if (s.length > max) { errors[path] = `Must be ${max} characters or fewer`; return undefined; }
      if (s === '') { if (required) errors[path] = 'This field is required'; return s; }
      if (type === 'url') { const m = urlError(s); if (m) { errors[path] = m; return undefined; } }
      if (type === 'image') { const m = imageError(s); if (m) { errors[path] = m; return undefined; } }
      return s;
    }
    case 'number': {
      if (missing) { if (required) errors[path] = 'This field is required'; return undefined; }
      if (typeof value !== 'number' || !Number.isFinite(value)) { errors[path] = 'Must be a number'; return undefined; }
      if (typeof field.min === 'number' && value < field.min) { errors[path] = `Must be ${field.min} or more`; return undefined; }
      if (typeof field.max === 'number' && value > field.max) { errors[path] = `Must be ${field.max} or less`; return undefined; }
      return value;
    }
    case 'select': {
      if (missing) { if (required) errors[path] = 'This field is required'; return undefined; }
      if (typeof value !== 'string') { errors[path] = 'Must be text'; return undefined; }
      const opts = optionValues(field);
      if (!opts.includes(value)) { errors[path] = 'Choose one of the listed options'; return undefined; }
      if (value === '' && required) { errors[path] = 'This field is required'; return undefined; }
      return value;
    }
    case 'stringList': {
      if (missing) { if (required) errors[path] = 'This field is required'; return undefined; }
      if (!Array.isArray(value)) { errors[path] = 'Must be a list of text items'; return undefined; }
      if (value.length > MAX_STRING_LIST_ITEMS) { errors[path] = `At most ${MAX_STRING_LIST_ITEMS} items`; return undefined; }
      if (required && value.length === 0) { errors[path] = 'Add at least one item'; return undefined; }
      const max = maxOf(field);
      const out = [];
      value.forEach((item, i) => {
        const p = `${path}[${i}]`;
        if (typeof item !== 'string') { errors[p] = 'Must be text'; return; }
        const s = cleanString(item, false);
        if (s.length > max) { errors[p] = `Must be ${max} characters or fewer`; return; }
        if (s === '') { errors[p] = 'This item is empty'; return; }
        out.push(s);
      });
      return out;
    }
    case 'object': {
      if (missing) { if (required) errors[path] = 'This section is required'; return undefined; }
      if (!isPlainObject(value)) { errors[path] = 'Must be an object'; return undefined; }
      return validateObject(field.fields || [], value, path, errors);
    }
    case 'list': {
      if (missing) { if (required) errors[path] = 'This list is required'; return undefined; }
      if (!Array.isArray(value)) { errors[path] = 'Must be a list'; return undefined; }
      const cap = Number.isInteger(field.maxItems) && field.maxItems > 0 ? Math.min(field.maxItems, MAX_LIST_ITEMS) : MAX_LIST_ITEMS;
      if (value.length > cap) { errors[path] = `At most ${cap} items`; return undefined; }
      if (required && value.length === 0) { errors[path] = 'Add at least one item'; return undefined; }
      return value.map((item, i) => {
        const p = `${path}[${i}]`;
        if (!isPlainObject(item)) { errors[p] = 'Must be an object'; return undefined; }
        return validateObject(field.fields || [], item, p, errors);
      });
    }
    default:
      errors[path] = `Unsupported field type "${String(type)}" in schema`;
      return undefined;
  }
}

function validateObject(fields, obj, path, errors) {
  const out = {};
  const known = new Set();
  for (const f of fields) {
    known.add(f.key);
    const v = validateField(f, obj[f.key], join(path, f.key), errors);
    if (v !== undefined) out[f.key] = v;
  }
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) errors[join(path, k)] = 'Unknown field';
  }
  return out;
}

/**
 * @param {*} content parsed JSON
 * @param {{sections: Array}} schema content-schema.json
 */
function validate(content, schema) {
  const errors = {};
  if (!isPlainObject(content)) return { ok: false, value: null, errors: { content: 'Content must be an object' } };
  let size;
  try { size = Buffer.byteLength(JSON.stringify(content), 'utf8'); } catch (e) { return { ok: false, value: null, errors: { content: 'Content is not valid JSON' } }; }
  if (size > MAX_BYTES) return { ok: false, value: null, errors: { content: 'Content is too large (maximum 512 KB)' } };

  const sections = (schema && Array.isArray(schema.sections)) ? schema.sections : [];
  const value = {};
  const known = new Set();
  for (const s of sections) {
    known.add(s.key);
    // A section describes content[s.key]: an object with `fields`, or (type "list") a list of objects with `fields`.
    if (content[s.key] === undefined || content[s.key] === null) {
      if (s.required !== false) errors[s.key] = 'This section is required';
      continue;
    }
    const field = { ...s, type: s.type || 'object', required: false };
    const v = validateField(field, content[s.key], s.key, errors);
    if (v !== undefined) value[s.key] = v;
  }
  for (const k of Object.keys(content)) if (!known.has(k)) errors[k] = 'Unknown section';
  const ok = Object.keys(errors).length === 0;
  return { ok, value: ok ? value : null, errors };
}

module.exports = { validate, urlError, imageError, MAX_BYTES, DEFAULT_MAX };
