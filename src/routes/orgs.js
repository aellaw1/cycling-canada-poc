'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { t } = require('../i18n');

router.get('/orgs', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const orgs = db
    .prepare(
      `SELECT o.*, p.name_en as parent_name_en, p.name_fr as parent_name_fr
       FROM organizations o LEFT JOIN organizations p ON p.id = o.parent_id
       WHERE o.id IN (${placeholders})
       ORDER BY o.org_type, o.name_en`
    )
    .all(...orgIds);

  res.render('orgs', { locale, t, orgs });
});

router.get('/audit', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const logs = db
    .prepare(
      `SELECT al.*, u.first_name, u.last_name, u.email
       FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id
       WHERE al.org_id IN (${placeholders}) OR al.org_id IS NULL
       ORDER BY al.created_at DESC LIMIT 200`
    )
    .all(...orgIds);

  res.render('audit', { locale, t, logs });
});

module.exports = router;
