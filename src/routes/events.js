'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { audit } = require('../auth');
const { t } = require('../i18n');

router.get('/events', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const events = db
    .prepare(
      `SELECT e.*, o.name_en as org_name_en, o.name_fr as org_name_fr, d.name_en as disc_en, d.name_fr as disc_fr
       FROM events e
       JOIN organizations o ON o.id = e.org_id
       LEFT JOIN disciplines d ON d.id = e.discipline_id
       WHERE e.org_id IN (${placeholders})
       ORDER BY e.event_date DESC`
    )
    .all(...orgIds);

  const disciplines = db.prepare('SELECT * FROM disciplines ORDER BY name_en').all();
  const clubs = db
    .prepare(`SELECT * FROM organizations WHERE id IN (${placeholders}) ORDER BY name_en`)
    .all(...orgIds);

  res.render('events', { locale, t, events, disciplines, clubs });
});

router.post('/events', (req, res) => {
  const { name_en, name_fr, discipline_id, event_date, org_id, sanctioned } = req.body;
  const orgIds = [...req.scope.orgIds];
  if (!orgIds.includes(Number(org_id))) {
    return res.status(403).send('Forbidden: organization outside your permission scope.');
  }
  const info = db
    .prepare(
      `INSERT INTO events (org_id, name_en, name_fr, discipline_id, event_date, sanctioned, sanctioning_org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(org_id),
      name_en,
      name_fr || null,
      discipline_id ? Number(discipline_id) : null,
      event_date,
      sanctioned ? 1 : 0,
      sanctioned ? req.scope.primaryOrg.id : null
    );
  audit(req, 'create', 'event', Number(info.lastInsertRowid), { name_en, org_id });
  res.redirect('/events');
});

module.exports = router;
