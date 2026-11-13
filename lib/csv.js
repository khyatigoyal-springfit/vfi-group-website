'use strict';

const COLUMNS = ['ref', 'created_at', 'status', 'type', 'name', 'company', 'email', 'country', 'volume', 'source_page', 'message', 'notes', 'updated_at'];

function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV/formula injection guard
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** UTF-8 BOM + CRLF + RFC 4180 quoting. */
function toCsv(rows, columns = COLUMNS) {
  const lines = [columns.map(cell).join(',')];
  for (const r of rows || []) lines.push(columns.map((c) => cell(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, cell, COLUMNS };
