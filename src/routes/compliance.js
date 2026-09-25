'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { audit } = require('../auth');
const { t } = require('../i18n');

router.get('/compliance', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const records = db
    .prepare(
      `SELECT cr.*, m.first_name, m.last_name, o.name_en as org_name_en, o.name_fr as org_name_fr
       FROM compliance_records cr
       JOIN members m ON m.id = cr.member_id
       JOIN organizations o ON o.id = m.org_id
       WHERE m.org_id IN (${placeholders})
       ORDER BY cr.status, cr.expires_at`
    )
    .all(...orgIds);

  res.render('compliance', { locale, t, records });
});

router.post('/compliance/:id/complete', (req, res) => {
  const rec = db
    .prepare(
      `SELECT cr.*, m.org_id FROM compliance_records cr JOIN members m ON m.id = cr.member_id WHERE cr.id = ?`
    )
    .get(req.params.id);
  if (!rec || !req.scope.orgIds.has(rec.org_id)) {
    return res.status(403).send('Forbidden.');
  }
  db.prepare(`UPDATE compliance_records SET status = 'complete', completed_at = datetime('now') WHERE id = ?`).run(
    rec.id
  );
  audit(req, 'complete', 'compliance_record', rec.id);
  res.redirect('/compliance');
});

module.exports = router;
