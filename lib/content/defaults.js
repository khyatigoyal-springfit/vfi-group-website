'use strict';
// Bundled default content and its editor schema. Both files are part of the deployed function bundle
// (vercel.json "functions.includeFiles"); paths are relative to this file so they resolve locally and on Vercel.
const fs = require('fs');
const path = require('path');

const paths = {
  content: path.join(__dirname, '..', '..', 'public', 'content', 'default.json'),
  schema: path.join(__dirname, '..', '..', 'public', 'admin', 'content-schema.json'),
};
let cache = { content: null, schema: null };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Fresh deep copy of the bundled default content (callers may mutate it). */
function loadDefaultContent() {
  if (!cache.content) cache.content = readJson(paths.content);
  return JSON.parse(JSON.stringify(cache.content));
}

/** The content schema (treat as read-only). */
function loadSchema() {
  if (!cache.schema) cache.schema = readJson(paths.schema);
  return cache.schema;
}

/** Tests only: point the loaders at fixture files (null restores the real paths). */
function setPaths(p) {
  paths.content = (p && p.content) || path.join(__dirname, '..', '..', 'public', 'content', 'default.json');
  paths.schema = (p && p.schema) || path.join(__dirname, '..', '..', 'public', 'admin', 'content-schema.json');
  cache = { content: null, schema: null };
}

module.exports = { loadDefaultContent, loadSchema, setPaths, paths };
