'use strict';
// Image upload helpers: magic-byte checks, safe names, and a Vercel Blob wrapper with an injectable uploader.
const crypto = require('crypto');

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/** Detect the real format from the first bytes. Returns 'png' | 'jpeg' | 'webp' | null. SVG and everything else is null. */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Width/height when cheap to read; null when it cannot be determined. */
function dimensions(buf, kind) {
  try {
    if (kind === 'png') {
      if (buf.length >= 24 && buf.toString('latin1', 12, 16) === 'IHDR') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    } else if (kind === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    } else if (kind === 'webp') {
      const fmt = buf.toString('latin1', 12, 16);
      if (fmt === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L' && buf.length >= 25) { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (fmt === 'VP8X' && buf.length >= 30) return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
  } catch (e) { /* fall through */ }
  return { width: null, height: null };
}

/** Lower-case slug from a user supplied file name: no directories, no extension, [a-z0-9-] only, max 60 chars. */
function safeSlug(name) {
  let s = String(name || '');
  try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'image';
}

/**
 * Validate an uploaded body. @returns {{ok:true, kind, contentType, ext, width, height, slug}|{ok:false, status, code, error}}
 */
function inspectUpload(buf, declaredType, filename) {
  const fail = (status, code, error) => ({ ok: false, status, code, error });
  if (!Buffer.isBuffer(buf) || buf.length === 0) return fail(400, 'empty_body', 'No image was received.');
  if (buf.length > MAX_BYTES) return fail(413, 'too_large', 'Image is too large (maximum 4 MB).');
  const declared = String(declaredType || '').split(';')[0].trim().toLowerCase();
  if (!Object.values(TYPES).includes(declared)) {
    return fail(415, 'unsupported_type', declared === 'image/svg+xml' ? 'SVG images are not accepted. Use PNG, JPEG or WebP.' : 'Only PNG, JPEG and WebP images are accepted.');
  }
  const kind = sniff(buf);
  if (!kind) return fail(415, 'unsupported_type', 'The file is not a valid PNG, JPEG or WebP image.');
  if (TYPES[kind] !== declared) return fail(415, 'type_mismatch', 'The file content does not match its declared type.');
  const { width, height } = dimensions(buf, kind);
  return { ok: true, kind, contentType: TYPES[kind], ext: EXT[kind], width, height, slug: safeSlug(filename) };
}

const newPathname = (info) => `media/${crypto.randomUUID()}-${info.slug}.${info.ext}`;

// ---- Blob wrapper (the uploader is injectable so tests never touch the network) ----
function blobUploader() {
  return {
    async put(pathname, body, contentType) {
      const { put } = require('@vercel/blob');
      const r = await put(pathname, body, { access: 'public', contentType, addRandomSuffix: false, token: process.env.BLOB_READ_WRITE_TOKEN });
      return { url: r.url, pathname: r.pathname };
    },
    async del(url) {
      const { del } = require('@vercel/blob');
      await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    },
  };
}

let uploader = null;
const isConfigured = () => Boolean(uploader) || Boolean(process.env.BLOB_READ_WRITE_TOKEN);
/** Tests: inject a fake { put(pathname, body, contentType) -> {url, pathname}, del(url) }. Pass null to restore. */
function setUploader(u) { uploader = u || null; }
const getUploader = () => uploader || blobUploader();

module.exports = { MAX_BYTES, sniff, dimensions, safeSlug, inspectUpload, newPathname, isConfigured, setUploader, getUploader };
