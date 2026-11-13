'use strict';
// Vercel serverless function. Vercel has no persistent disk, so set SMTP_* and ENQUIRY_TO
// environment variables in the project settings to receive enquiries by email.
const { validate, notify } = require('../lib/enquiry');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const v = validate(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body);
  if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });
  if (v.spam) return res.json({ ok: true, ref: 'VFI-OK' });
  const e = v.enquiry;
  console.log('ENQUIRY', JSON.stringify(e));
  try {
    const sent = await notify(e);
    if (!sent) console.warn('SMTP not configured: enquiry only logged', e.ref);
  } catch (err) {
    console.error('Email failed', e.ref, err.message);
    return res.status(502).json({ ok: false, error: 'We could not deliver your enquiry.' });
  }
  res.json({ ok: true, ref: e.ref });
};
