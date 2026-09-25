'use strict';
// Auth + permission-scoping helpers.
// A user's "scope" is the set of organizations they can act within,
// derived from their user_roles rows plus every descendant org
// (a PTSO_ADMIN sees their PTSO and every club beneath it; a CC_ADMIN
// sees everything). This is the concrete mechanism behind the RFP's
// "separate administrative control ... shared data model with defined
// permissions."

const db = require('./db');

function getAllDescendantOrgIds(orgId) {
  const ids = [orgId];
  const children = db.prepare('SELECT id FROM organizations WHERE parent_id = ?').all(orgId);
  for (const child of children) {
    ids.push(...getAllDescendantOrgIds(child.id));
  }
  return ids;
}

function getUserRoles(userId) {
  return db
    .prepare(
      `SELECT ur.role, ur.org_id, o.org_type, o.name_en, o.name_fr, o.code
       FROM user_roles ur JOIN organizations o ON o.id = ur.org_id
       WHERE ur.user_id = ?`
    )
    .all(userId);
}

// Returns { orgIds: Set<number>, highestRole, primaryOrg } describing
// everything this user is allowed to see/act on.
function computeScope(userId) {
  const roles = getUserRoles(userId);
  const orgIds = new Set();
  let highestRole = 'MEMBER';
  const rank = { MEMBER: 0, VOLUNTEER: 0, COACH: 0, OFFICIAL: 0, CLUB_ADMIN: 1, PTSO_ADMIN: 2, CC_ADMIN: 3 };
  let primaryOrg = null;

  for (const r of roles) {
    if (r.role === 'CC_ADMIN' || r.role === 'PTSO_ADMIN' || r.role === 'CLUB_ADMIN') {
      for (const id of getAllDescendantOrgIds(r.org_id)) orgIds.add(id);
    } else {
      orgIds.add(r.org_id);
    }
    if ((rank[r.role] || 0) >= (rank[highestRole] || 0)) {
      highestRole = r.role;
      primaryOrg = { id: r.org_id, org_type: r.org_type, name_en: r.name_en, name_fr: r.name_fr, code: r.code };
    }
  }

  return { orgIds, highestRole, primaryOrg, roles };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function loadScope(req, res, next) {
  if (req.session.userId) {
    req.scope = computeScope(req.session.userId);
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  }
  next();
}

function audit(req, action, entityType, entityId, details = null) {
  db.prepare(
    `INSERT INTO audit_log (actor_user_id, org_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    req.session.userId || null,
    req.scope && req.scope.primaryOrg ? req.scope.primaryOrg.id : null,
    action,
    entityType,
    entityId,
    details ? JSON.stringify(details) : null
  );
}

module.exports = { getAllDescendantOrgIds, getUserRoles, computeScope, requireAuth, loadScope, audit };
