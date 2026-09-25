'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { audit, computeScope } = require('../auth');
const { t } = require('../i18n');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null, locale: req.session.locale || 'en', t });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const locale = req.session.locale || 'en';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('login', { error: t(locale, 'login_error'), locale, t });
  }
  req.session.userId = user.id;
  req.session.locale = user.locale || locale;
  req.scope = computeScope(user.id);
  req.user = user;
  audit(req, 'login', 'user', user.id);
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  if (req.session.userId) {
    req.scope = computeScope(req.session.userId);
    audit(req, 'logout', 'user', req.session.userId);
  }
  req.session.destroy(() => res.redirect('/login'));
});

router.post('/locale/:locale', (req, res) => {
  const { locale } = req.params;
  if (locale === 'en' || locale === 'fr') {
    req.session.locale = locale;
    if (req.session.userId) {
      db.prepare('UPDATE users SET locale = ? WHERE id = ?').run(locale, req.session.userId);
    }
  }
  res.redirect(req.get('Referer') || '/dashboard');
});

module.exports = router;
