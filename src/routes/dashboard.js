'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { t } = require('../i18n');

function fmtMoney(cents) {
  return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

router.get('/dashboard', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const totalMembers = db
    .prepare(`SELECT COUNT(DISTINCT id) as n FROM members WHERE org_id IN (${placeholders})`)
    .get(...orgIds).n;

  const activeMemberships = db
    .prepare(
      `SELECT COUNT(*) as n FROM memberships WHERE org_id IN (${placeholders}) AND status = 'active'`
    )
    .get(...orgIds).n;

  const revenueYtd = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) as total FROM transactions
       WHERE org_id IN (${placeholders}) AND status = 'completed'`
    )
    .get(...orgIds).total;

  const pendingCompliance = db
    .prepare(
      `SELECT COUNT(*) as n FROM compliance_records cr
       JOIN members m ON m.id = cr.member_id
       WHERE m.org_id IN (${placeholders}) AND cr.status = 'pending'`
    )
    .get(...orgIds).n;

  const uciIssued = db
    .prepare(
      `SELECT COUNT(*) as n FROM uci_licences ul
       JOIN members m ON m.id = ul.member_id
       WHERE m.org_id IN (${placeholders}) AND ul.status = 'issued'`
    )
    .get(...orgIds).n;

  const childOrgs = db
    .prepare(
      `SELECT * FROM organizations WHERE parent_id = ? ORDER BY name_en`
    )
    .all(req.scope.primaryOrg ? req.scope.primaryOrg.id : 0);

  const recentRegistrations = db
    .prepare(
      `SELECT mem.first_name, mem.last_name, o.name_en as org_name, o.name_fr as org_name_fr,
              ms.season_year, ms.membership_type, ms.created_at
       FROM memberships ms
       JOIN members mem ON mem.id = ms.member_id
       JOIN organizations o ON o.id = ms.org_id
       WHERE ms.org_id IN (${placeholders})
       ORDER BY ms.created_at DESC LIMIT 10`
    )
    .all(...orgIds);

  res.render('dashboard', {
    locale,
    t,
    fmtMoney,
    kpis: { totalMembers, activeMemberships, revenueYtd, pendingCompliance, uciIssued },
    childOrgs,
    recentRegistrations,
  });
});

module.exports = router;
