// Database layer for Cycling Canada National Membership Platform POC
// Uses Node's built-in node:sqlite (zero external deps, file-based, portable to any host).
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'ccnrd.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
-- ===================================================================
-- ORGANIZATIONS (federated hierarchy: CC -> PTSO -> Club)
-- Single table with a self-referencing parent_id models the whole
-- federation so CC, all 12 PTSOs, and every club share one national
-- data model while each node gets its own administrative scope.
-- ===================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id     INTEGER REFERENCES organizations(id),
  org_type      TEXT NOT NULL CHECK (org_type IN ('CC','PTSO','CLUB')),
  name_en       TEXT NOT NULL,
  name_fr       TEXT,
  code          TEXT UNIQUE NOT NULL,           -- short code e.g. 'CC', 'ON', 'QC-CLUB-042'
  jurisdiction  TEXT,                            -- province/territory code for PTSOs
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================================================================
-- USERS & ROLE-BASED ACCESS
-- A user can hold different roles at different organization scopes
-- (e.g. a person can be CLUB_ADMIN for one club and MEMBER elsewhere).
-- This is what gives "separate administrative control" per PTSO/club
-- while sharing one underlying schema.
-- ===================================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','fr')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  role          TEXT NOT NULL CHECK (role IN ('CC_ADMIN','PTSO_ADMIN','CLUB_ADMIN','MEMBER','VOLUNTEER','COACH','OFFICIAL')),
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, org_id, role)
);

-- ===================================================================
-- AUDIT TRAIL (required: §4.1 "audit trails and role-based permissions")
-- ===================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  org_id        INTEGER REFERENCES organizations(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER,
  details       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================================================================
-- FAMILIES (for family memberships)
-- ===================================================================
CREATE TABLE IF NOT EXISTS families (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_name TEXT NOT NULL,
  primary_user_id INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS family_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id     INTEGER NOT NULL REFERENCES families(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  relationship  TEXT
);

-- ===================================================================
-- MEMBER PROFILES (persons: participant/official/coach/volunteer/athlete)
-- Distinct from users table (login accounts) to allow guardians registering
-- minors who never log in themselves.
-- ===================================================================
CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),         -- nullable: minors may lack a login
  org_id        INTEGER NOT NULL REFERENCES organizations(id), -- home club
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  date_of_birth TEXT,
  gender        TEXT,
  member_type   TEXT NOT NULL DEFAULT 'participant' CHECK (member_type IN ('participant','official','coach','volunteer')),
  uci_id        TEXT UNIQUE,                          -- UCI licence identifier, once issued
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================================================================
-- DISCIPLINES & CATEGORIES (multi-discipline / multi-category regs)
-- ===================================================================
CREATE TABLE IF NOT EXISTS disciplines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name_en       TEXT NOT NULL,
  name_fr       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discipline_id INTEGER NOT NULL REFERENCES disciplines(id),
  code          TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_fr       TEXT NOT NULL,
  min_age       INTEGER,
  max_age       INTEGER,
  UNIQUE(discipline_id, code)
);

-- ===================================================================
-- FEE RULES (PTSO-specific fee structures — the key federation tension)
-- Each org (CC or a PTSO) can define its own fee for a membership
-- product; a club-level registration resolves fees by walking up the
-- hierarchy (club -> PTSO -> CC) so PTSOs can override national
-- defaults without duplicating the whole rule set.
-- ===================================================================
CREATE TABLE IF NOT EXISTS fee_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  membership_type TEXT NOT NULL CHECK (membership_type IN ('individual','family','race','day_pass')),
  discipline_id INTEGER REFERENCES disciplines(id),
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'CAD',
  season_year   INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================================================================
-- MEMBERSHIPS / UCI LICENCES
-- A membership record is the yearly registration; a linked licence
-- record captures UCI-specific data so the UCI workflow can evolve
-- (new categories/rules) without touching the core membership table.
-- ===================================================================
CREATE TABLE IF NOT EXISTS memberships (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id),
  org_id        INTEGER NOT NULL REFERENCES organizations(id), -- club that processed it
  season_year   INTEGER NOT NULL,
  membership_type TEXT NOT NULL CHECK (membership_type IN ('individual','family','race','day_pass')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','expired','cancelled')),
  waiver_signed_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS membership_disciplines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_id   INTEGER NOT NULL REFERENCES memberships(id),
  discipline_id   INTEGER NOT NULL REFERENCES disciplines(id),
  category_id     INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS uci_licences (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id),
  membership_id   INTEGER REFERENCES memberships(id),
  uci_category    TEXT NOT NULL,           -- e.g. 'Elite', 'Junior', 'Masters'
  licence_year    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','suspended','expired')),
  issued_at       TEXT,
  notes           TEXT
);

-- ===================================================================
-- COMPLIANCE TRACKING (NCCP, Safe Sport, PTSO-specific)
-- ===================================================================
CREATE TABLE IF NOT EXISTS compliance_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id),
  compliance_type TEXT NOT NULL CHECK (compliance_type IN ('NCCP','SAFE_SPORT','PTSO_SPECIFIC')),
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','expired')),
  completed_at  TEXT,
  expires_at    TEXT
);

-- ===================================================================
-- EVENTS & SANCTIONING
-- ===================================================================
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id), -- organizing club
  name_en       TEXT NOT NULL,
  name_fr       TEXT,
  discipline_id INTEGER REFERENCES disciplines(id),
  event_date    TEXT NOT NULL,
  sanctioned    INTEGER NOT NULL DEFAULT 0,
  sanctioning_org_id INTEGER REFERENCES organizations(id), -- PTSO/CC that sanctioned it
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id),
  member_id     INTEGER NOT NULL REFERENCES members(id),
  category_id   INTEGER REFERENCES categories(id),
  waiver_signed_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================================================================
-- FINANCIAL TRANSACTIONS & RECONCILIATION
-- Every registration/membership fee produces a transaction; the
-- export endpoint formats these for external accounting systems
-- (target system left pluggable per RFP silence on named platforms).
-- ===================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES organizations(id), -- org that owns the revenue
  member_id       INTEGER REFERENCES members(id),
  membership_id   INTEGER REFERENCES memberships(id),
  event_registration_id INTEGER REFERENCES event_registrations(id),
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'CAD',
  tx_type         TEXT NOT NULL CHECK (tx_type IN ('membership_fee','event_fee','refund','other')),
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','refunded','failed')),
  reconciled      INTEGER NOT NULL DEFAULT 0,
  external_ref    TEXT,                                  -- placeholder for accounting-system doc/txn id
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_parent ON organizations(parent_id);
CREATE INDEX IF NOT EXISTS idx_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_roles_org ON user_roles(org_id);
CREATE INDEX IF NOT EXISTS idx_members_org ON members(org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_tx_org ON transactions(org_id);
`;

db.exec(SCHEMA);

module.exports = db;
