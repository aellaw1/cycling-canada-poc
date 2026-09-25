'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { audit } = require('../auth');
const { t } = require('../i18n');

router.get('/members', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');
  const members = db
    .prepare(
      `SELECT m.*, o.name_en as org_name_en, o.name_fr as org_name_fr,
              (SELECT status FROM memberships ms WHERE ms.member_id = m.id ORDER BY ms.created_at DESC LIMIT 1) as latest_status
       FROM members m JOIN organizations o ON o.id = m.org_id
       WHERE m.org_id IN (${placeholders})
       ORDER BY m.last_name, m.first_name`
    )
    .all(...orgIds);

  const clubs = db
    .prepare(`SELECT * FROM organizations WHERE id IN (${placeholders}) AND org_type = 'CLUB' ORDER BY name_en`)
    .all(...orgIds);

  res.render('members', { locale, t, members, clubs });
});

router.post('/members', (req, res) => {
  const { first_name, last_name, date_of_birth, member_type, org_id } = req.body;
  const orgIds = [...req.scope.orgIds];
  if (!orgIds.includes(Number(org_id))) {
    return res.status(403).send('Forbidden: organization outside your permission scope.');
  }
  const info = db
    .prepare(
      `INSERT INTO members (org_id, first_name, last_name, date_of_birth, member_type)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(Number(org_id), first_name, last_name, date_of_birth || null, member_type || 'participant');
  audit(req, 'create', 'member', Number(info.lastInsertRowid), { first_name, last_name, org_id });
  res.redirect('/members');
});

module.exports = router;
