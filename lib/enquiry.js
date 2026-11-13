'use strict';
// Shared enquiry handling for the Express server (server.js) and Vercel (api/enquiry.js).
const crypto = require('crypto');

const TYPES = ['Retail partnership', 'Hospitality', 'OEM manufacturing', 'Private label', 'Foam supply', 'International', 'Careers', 'Other', ''];
const VOLUMES = ['', 'Exploring options', 'Under 500 units a month', '500 to 2,000 units a month', 'Over 2,000 units a month'];
const LIMITS = { name: 120, company: 160, email: 200, country: 80, msg: 5000, page: 200 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** Returns { ok:true, enquiry } or { ok:false, status, error }. */
function validate(body) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Invalid request.' };
  // Honeypot: bots fill the hidden "website" field. Pretend success so they don't retry.
  if (body.website) return { ok: true, spam: true };
  const e = {
    type: TYPES.includes(body.type) ? body.type : 'Other',
    name: clean(body.name, LIMITS.name),
    company: clean(body.company, LIMITS.company),
    email: clean(body.email, LIMITS.email),
    country: clean(body.country, LIMITS.country),
    volume: VOLUMES.includes(body.volume) ? body.volume : '',
    msg: clean(body.msg, LIMITS.msg),
    page: clean(body.page, LIMITS.page),
  };
  if (!e.name || !e.company || !e.msg) return { ok: false, status: 422, error: 'Please complete all required fields.' };
  if (!EMAIL_RE.test(e.email)) return { ok: false, status: 422, error: 'Please enter a valid work email.' };
  e.ref = 'VFI-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  e.receivedAt = new Date().toISOString();
  return { ok: true, enquiry: e };
}

/** Sends the enquiry by email when SMTP_* env vars are set. Returns true if sent. */
async function notify(e) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ENQUIRY_TO, ENQUIRY_FROM } = process.env;
  if (!SMTP_HOST || !ENQUIRY_TO) return false;
  const nodemailer = require('nodemailer');
  const port = Number(SMTP_PORT || 587);
  const t = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined });
  const text = [
    `Reference: ${e.ref}`, `Type: ${e.type}`, `Name: ${e.name}`, `Company: ${e.company}`, `Email: ${e.email}`,
    `Country: ${e.country || '-'}`, `Volume: ${e.volume || '-'}`, `Sent from: ${e.page || '-'}`, `Received: ${e.receivedAt}`, '', e.msg,
  ].join('\n');
  await t.sendMail({
    from: ENQUIRY_FROM || SMTP_USER || ENQUIRY_TO,
    to: ENQUIRY_TO,
    replyTo: `"${e.name.replace(/"/g, '')}" <${e.email}>`,
    subject: `[${e.ref}] ${e.type} enquiry from ${e.company}`,
    text,
  });
  return true;
}

module.exports = { validate, notify };
