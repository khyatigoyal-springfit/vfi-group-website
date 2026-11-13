'use strict';
// Enquiry validation. Rules mirror ARCHITECTURE section 4 and the SQL in supabase/migrations/0001_init.sql.

const TYPES = ['Retail partnership', 'Hospitality', 'OEM manufacturing', 'Private label', 'Foam supply', 'International', 'Careers', 'Other'];
const VOLUMES = ['', 'Exploring options', 'Under 500 units a month', '500 to 2,000 units a month', 'Over 2,000 units a month'];
const STATUSES = ['new', 'in_progress', 'contacted', 'closed', 'spam'];
const LIMITS = { name: 120, company: 160, email: 200, country: 80, message: 5000, source_page: 200, notes: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ASCII control characters except \t (0x09) and \n (0x0A); also DEL.
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Coerce to string, strip control chars, trim. Non-scalar values become ''. */
function clean(v, { multiline = false } = {}) {
  let s = typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : '';
  s = s.replace(CONTROL_RE, '');
  if (!multiline) s = s.replace(/[\n\t]+/g, ' ');
  return s.trim();
}

/**
 * @returns {{ok:boolean, value:object, errors:Object<string,string>}}
 * value: {type,name,company,email,country,volume,message,source_page}
 */
function validateEnquiry(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};

  let type = clean(b.type);
  if (!TYPES.includes(type)) type = 'Other';
  let volume = clean(b.volume);
  if (!VOLUMES.includes(volume)) volume = '';

  const name = clean(b.name);
  const company = clean(b.company);
  const email = clean(b.email);
  const country = clean(b.country);
  const message = clean(b.msg !== undefined ? b.msg : b.message, { multiline: true });
  const source_page = clean(b.page !== undefined ? b.page : b.source_page);

  if (!name) errors.name = 'Enter your full name';
  else if (name.length > LIMITS.name) errors.name = `Name must be ${LIMITS.name} characters or fewer`;

  if (!company) errors.company = 'Enter your company name';
  else if (company.length > LIMITS.company) errors.company = `Company must be ${LIMITS.company} characters or fewer`;

  if (!email) errors.email = 'Enter your work email';
  else if (email.length > LIMITS.email) errors.email = `Email must be ${LIMITS.email} characters or fewer`;
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';

  if (country.length > LIMITS.country) errors.country = `Country must be ${LIMITS.country} characters or fewer`;

  if (!message) errors.message = 'Tell us how we can help';
  else if (message.length > LIMITS.message) errors.message = `Message must be ${LIMITS.message} characters or fewer`;

  if (source_page.length > LIMITS.source_page) errors.page = `Page must be ${LIMITS.source_page} characters or fewer`;

  return {
    ok: Object.keys(errors).length === 0,
    value: { type, name, company, email, country, volume, message, source_page },
    errors,
  };
}

module.exports = { validateEnquiry, clean, TYPES, VOLUMES, STATUSES, LIMITS, EMAIL_RE, UUID_RE };
