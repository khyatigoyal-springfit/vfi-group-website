'use strict';
// Optional email notification. Never throws; logs only the enquiry ref (no PII, no secrets).

const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/"/g, '').trim();

/** Returns true if an email was sent, false if SMTP is not configured or sending failed. */
async function notify(e) {
  try {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ENQUIRY_TO, ENQUIRY_FROM } = process.env;
    if (!SMTP_HOST || !ENQUIRY_TO) return false;
    const nodemailer = require('nodemailer');
    const port = Number(SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: SMTP_HOST, port, secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 3000,
    });
    const text = [
      `Reference: ${e.ref}`, `Type: ${e.type}`, `Name: ${e.name}`, `Company: ${e.company}`, `Email: ${e.email}`,
      `Country: ${e.country || '-'}`, `Volume: ${e.volume || '-'}`, `Sent from: ${e.source_page || '-'}`, '', e.message,
    ].join('\n');
    await transport.sendMail({
      from: ENQUIRY_FROM || SMTP_USER || ENQUIRY_TO,
      to: ENQUIRY_TO,
      replyTo: `"${oneLine(e.name)}" <${oneLine(e.email)}>`,
      subject: `[${e.ref}] ${oneLine(e.type)} enquiry from ${oneLine(e.company)}`,
      text,
    });
    return true;
  } catch (err) {
    console.error('Enquiry email failed', e && e.ref);
    return false;
  }
}

module.exports = { notify };
