'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { audit } = require('../auth');
const { t } = require('../i18n');

// Resolve the effective fee for a membership type + discipline by walking
// the org hierarchy upward until a fee_rule is found (club -> PTSO -> CC).
// This is the concrete mechanism for "PTSO-specific fee structures" that
// still fall back to a national default.
function resolveFee(orgId, membershipType, disciplineId, seasonYear) {
  let currentId = orgId;
  while (currentId) {
    const row = db
      .prepare(
        `SELECT * FROM fee_rules WHERE org_id = ? AND membership_type = ?
         AND (discipline_id IS ? OR discipline_id = ?) AND season_year = ?
         ORDER BY discipline_id DESC LIMIT 1`
      )
      .get(currentId, membershipType, disciplineId, disciplineId, seasonYear);
    if (row) return row;
    const org = db.prepare('SELECT parent_id FROM organizations WHERE id = ?').get(currentId);
    currentId = org ? org.parent_id : null;
  }
  return null;
}

router.get('/memberships', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const memberships = db
    .prepare(
      `SELECT ms.*, m.first_name, m.last_name, m.uci_id, o.name_en as org_name_en, o.name_fr as org_name_fr,
              GROUP_CONCAT(d.code) as discipline_codes
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id
       JOIN organizations o ON o.id = ms.org_id
       LEFT JOIN membership_disciplines md ON md.membership_id = ms.id
       LEFT JOIN disciplines d ON d.id = md.discipline_id
       WHERE ms.org_id IN (${placeholders})
       GROUP BY ms.id
       ORDER BY ms.created_at DESC`
    )
    .all(...orgIds);

  const members = db
    .prepare(`SELECT id, first_name, last_name FROM members WHERE org_id IN (${placeholders}) ORDER BY last_name`)
    .all(...orgIds);

  const disciplines = db.prepare('SELECT * FROM disciplines ORDER BY name_en').all();
  const clubs = db
    .prepare(`SELECT * FROM organizations WHERE id IN (${placeholders}) AND org_type = 'CLUB' ORDER BY name_en`)
    .all(...orgIds);

  res.render('memberships', { locale, t, memberships, members, disciplines, clubs });
});

router.post('/memberships', (req, res) => {
  const { member_id, membership_type, discipline_id, org_id, waiver_signed } = req.body;
  const orgIds = [...req.scope.orgIds];
  if (!orgIds.includes(Number(org_id))) {
    return res.status(403).send('Forbidden: organization outside your permission scope.');
  }
  const seasonYear = new Date().getFullYear();

  const info = db
    .prepare(
      `INSERT INTO memberships (member_id, org_id, season_year, membership_type, status, waiver_signed_at)
       VALUES (?, ?, ?, ?, 'active', ?)`
    )
    .run(
      Number(member_id),
      Number(org_id),
      seasonYear,
      membership_type,
      waiver_signed ? new Date().toISOString() : null
    );
  const membershipId = Number(info.lastInsertRowid);

  if (discipline_id) {
    db.prepare(
      `INSERT INTO membership_disciplines (membership_id, discipline_id) VALUES (?, ?)`
    ).run(membershipId, Number(discipline_id));
  }

  const fee = resolveFee(Number(org_id), membership_type, discipline_id ? Number(discipline_id) : null, seasonYear);
  const amount = fee ? fee.amount_cents : 0;
  db.prepare(
    `INSERT INTO transactions (org_id, member_id, membership_id, amount_cents, tx_type, status)
     VALUES (?, ?, ?, ?, 'membership_fee', 'completed')`
  ).run(Number(org_id), Number(member_id), membershipId, amount);

  audit(req, 'create', 'membership', membershipId, { member_id, membership_type, fee_applied: amount });
  res.redirect('/memberships');
});

module.exports = router;
module.exports.resolveFee = resolveFee;
