'use strict';
// Cycling Canada National Membership Platform — Proof of Concept
// Entry point: wires session auth, permission scoping, i18n, and routes.

const express = require('express');
const session = require('express-session');
const path = require('node:path');

require('./seed')(); // idempotent seed on every boot so a fresh deploy has demo data

const { requireAuth, loadScope } = require('./auth');
const { t, locales } = require('./i18n');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'cycling-canada-poc-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
  })
);

app.use(loadScope);

// Expose a human-readable "scope label" (e.g. "Ontario Cycling Association
// (PTSO_ADMIN)") to every authenticated view without repeating logic.
app.use((req, res, next) => {
  if (req.scope && req.scope.primaryOrg) {
    const locale = req.session.locale || 'en';
    const name = locale === 'fr' && req.scope.primaryOrg.name_fr ? req.scope.primaryOrg.name_fr : req.scope.primaryOrg.name_en;
    res.locals.scopeLabel = `${name} (${req.scope.highestRole})`;
  }
  next();
});

app.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));

app.use('/', require('./routes/auth'));

// Everything below requires authentication + a computed permission scope.
app.use(requireAuth);
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/members'));
app.use('/', require('./routes/memberships'));
app.use('/', require('./routes/events'));
app.use('/', require('./routes/finance'));
app.use('/', require('./routes/compliance'));
app.use('/', require('./routes/orgs'));

app.use((req, res) => {
  res.status(404).send('Not found.');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Internal server error: ' + err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cycling Canada POC listening on http://localhost:${PORT}`);
  console.log(`Available locales: ${locales.join(', ')}`);
});
