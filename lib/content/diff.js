'use strict';
// Helpers to compare content documents.

/** JSON with object keys sorted, so equal documents serialise identically (jsonb reorders keys). */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

const same = (a, b) => canonical(a) === canonical(b);

/** Top-level section keys whose value differs between two content documents (sorted). */
function changedSections(a, b) {
  const x = a && typeof a === 'object' ? a : {};
  const y = b && typeof b === 'object' ? b : {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].filter((k) => !same(x[k], y[k])).sort();
}

/** Field paths (like "brands[2].logo") of every string value in `content` that equals `value`. */
function findUsages(content, value) {
  const out = [];
  const walk = (node, p) => {
    if (typeof node === 'string') { if (node === value) out.push(p); return; }
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (node && typeof node === 'object') for (const k of Object.keys(node)) walk(node[k], p ? `${p}.${k}` : k);
  };
  walk(content, '');
  return out;
}

module.exports = { canonical, same, changedSections, findUsages };
