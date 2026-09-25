'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { audit } = require('../auth');
const { t } = require('../i18n');

router.get('/finance', (req, res) => {
  const locale = req.session.locale || 'en';
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');

  const transactions = db
    .prepare(
      `SELECT tx.*, m.first_name, m.last_name, o.name_en as org_name_en, o.name_fr as org_name_fr
       FROM transactions tx
       JOIN organizations o ON o.id = tx.org_id
       LEFT JOIN members m ON m.id = tx.member_id
       WHERE tx.org_id IN (${placeholders})
       ORDER BY tx.created_at DESC LIMIT 200`
    )
    .all(...orgIds);

  const totals = db
    .prepare(
      `SELECT tx_type, COUNT(*) as n, COALESCE(SUM(amount_cents),0) as total
       FROM transactions WHERE org_id IN (${placeholders}) GROUP BY tx_type`
    )
    .all(...orgIds);

  res.render('finance', { locale, t, transactions, totals });
});

router.post('/finance/:id/reconcile', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx || !req.scope.orgIds.has(tx.org_id)) {
    return res.status(403).send('Forbidden.');
  }
  db.prepare(`UPDATE transactions SET reconciled = 1, external_ref = ? WHERE id = ?`).run(
    `MANUAL-${Date.now()}`,
    tx.id
  );
  audit(req, 'reconcile', 'transaction', tx.id);
  res.redirect('/finance');
});

// Export placeholder: emits a generic CSV shaped for downstream import
// into an accounting system. The RFP names no specific target platform
// (no QuickBooks/Sage/NetSuite named), so this is a neutral, documented
// extension point rather than a hardcoded integration.
router.get('/finance/export.csv', (req, res) => {
  const orgIds = [...req.scope.orgIds];
  const placeholders = orgIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT tx.id, tx.org_id, o.name_en as org_name, tx.member_id, tx.amount_cents, tx.currency,
              tx.tx_type, tx.status, tx.reconciled, tx.external_ref, tx.created_at
       FROM transactions tx JOIN organizations o ON o.id = tx.org_id
       WHERE tx.org_id IN (${placeholders})
       ORDER BY tx.created_at`
    )
    .all(...orgIds);

  const header = 'id,org_id,org_name,member_id,amount_cents,currency,tx_type,status,reconciled,external_ref,created_at';
  const csv = [header]
    .concat(
      rows.map((r) =>
        [
          r.id,
          r.org_id,
          `"${(r.org_name || '').replace(/"/g, '""')}"`,
          r.member_id ?? '',
          r.amount_cents,
          r.currency,
          r.tx_type,
          r.status,
          r.reconciled,
          r.external_ref ?? '',
          r.created_at,
        ].join(',')
      )
    )
    .join('\n');

  audit(req, 'export', 'transactions_csv', null, { count: rows.length });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="financial_export.csv"');
  res.send(csv);
});

module.exports = router;
