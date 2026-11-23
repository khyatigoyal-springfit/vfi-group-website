'use strict';
// Per-request authentication (cookie -> users row) and the role/permission table (CMS-ARCHITECTURE section 3).
const session = require('./session');
const { HttpError } = require('../http');

const ROLES = ['admin', 'editor', 'sales'];
const ANY = ['admin', 'editor', 'sales'];
const EDITORS = ['admin', 'editor'];
const ADMINS = ['admin'];

/** action -> method -> allowed roles. Authoritative table used by the admin handler. */
const PERMISSIONS = {
  password: { POST: ANY },
  account: { PATCH: ANY },
  enquiries: { GET: ANY, PATCH: ANY },
  export: { GET: ANY },
  content: { GET: EDITORS, PUT: EDITORS },
  publish: { POST: EDITORS },
  revisions: { GET: EDITORS },
  revision: { GET: EDITORS },
  rollback: { POST: EDITORS },
  discard: { POST: EDITORS },
  media: { GET: EDITORS, POST: EDITORS, PATCH: EDITORS, DELETE: EDITORS },
  users: { GET: ADMINS, POST: ADMINS, PATCH: ADMINS },
  audit: { GET: ADMINS },
};

const can = (role, action, method) => Boolean(PERMISSIONS[action] && PERMISSIONS[action][method] && PERMISSIONS[action][method].includes(role));

const publicUser = (u) => (u ? {
  id: u.id, email: u.email, name: u.name, role: u.role, active: u.active,
  must_change_password: Boolean(u.must_change_password),
  created_at: u.created_at, last_login_at: u.last_login_at || null,
} : null);

/**
 * Resolve the signed-in user for a request. Reloads the users row every time, so deactivation, role changes and
 * session_version bumps take effect on the very next request.
 * @returns {Promise<object|null>} full user row (including password_hash: never send it) or null
 */
async function authenticate(req, store) {
  const cfg = session.authConfig();
  if (!cfg.ok) throw new HttpError(503, 'admin_not_configured', 'Admin is not configured on this server.');
  const claims = session.fromRequest(req, cfg.secret);
  if (!claims) return null;
  const user = await store.getUserById(claims.uid);
  if (!user || !user.active || user.session_version !== claims.v) return null;
  return user;
}

module.exports = { ROLES, PERMISSIONS, can, publicUser, authenticate };
