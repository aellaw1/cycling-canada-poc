'use strict';
// Seed data: national hierarchy (CC + 12 PTSOs + sample clubs), disciplines,
// categories, fee rules, and demo login accounts for every role tier.
// Safe to re-run: it's idempotent (checks before inserting).

const db = require('./db');
const bcrypt = require('bcryptjs');

function upsertOrg({ parent_id = null, org_type, name_en, name_fr = null, code, jurisdiction = null }) {
  const existing = db.prepare('SELECT id FROM organizations WHERE code = ?').get(code);
  if (existing) return existing.id;
  const stmt = db.prepare(
    `INSERT INTO organizations (parent_id, org_type, name_en, name_fr, code, jurisdiction)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(parent_id, org_type, name_en, name_fr, code, jurisdiction);
  return Number(info.lastInsertRowid);
}

function upsertUser({ email, password, first_name, last_name, locale = 'en' }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, first_name, last_name, locale)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, hash, first_name, last_name, locale);
  return Number(info.lastInsertRowid);
}

function grantRole(user_id, org_id, role) {
  const existing = db
    .prepare('SELECT id FROM user_roles WHERE user_id = ? AND org_id = ? AND role = ?')
    .get(user_id, org_id, role);
  if (existing) return;
  db.prepare('INSERT INTO user_roles (user_id, org_id, role) VALUES (?, ?, ?)').run(user_id, org_id, role);
}

function seed() {
  // --- National body -------------------------------------------------
  const ccId = upsertOrg({ org_type: 'CC', name_en: 'Cycling Canada', name_fr: 'Cyclisme Canada', code: 'CC' });

  // --- 12 PTSOs (per RFP: "12 Provincial/Territorial Sport Organizations") ---
  const ptsos = [
    ['BC', 'Cycling BC', 'Cyclisme BC'],
    ['AB', 'Alberta Bicycle Association', 'Association de vélo de l\u2019Alberta'],
    ['SK', 'Saskatchewan Cycling Association', 'Association de cyclisme de la Saskatchewan'],
    ['MB', 'Cycling Manitoba', 'Cyclisme Manitoba'],
    ['ON', 'Ontario Cycling Association', 'Association de cyclisme de l\u2019Ontario'],
    ['QC', 'Fédération québécoise des sports cyclistes', 'Fédération québécoise des sports cyclistes'],
    ['NB', 'Cycling New Brunswick', 'Cyclisme Nouveau-Brunswick'],
    ['NS', 'Bicycle Nova Scotia', 'Vélo Nouvelle-Écosse'],
    ['PE', 'Cycling PEI', 'Cyclisme Î.-P.-É.'],
    ['NL', 'Cycling Newfoundland and Labrador', 'Cyclisme Terre-Neuve-et-Labrador'],
    ['NT', 'Cycling NWT', 'Cyclisme T.N.-O.'],
    ['YT', 'Cycling Yukon', 'Cyclisme Yukon'],
  ];
  const ptsoIds = {};
  for (const [code, nameEn, nameFr] of ptsos) {
    ptsoIds[code] = upsertOrg({
      parent_id: ccId,
      org_type: 'PTSO',
      name_en: nameEn,
      name_fr: nameFr,
      code: `PTSO-${code}`,
      jurisdiction: code,
    });
  }

  // --- Sample clubs under a couple of PTSOs --------------------------
  const clubOnId = upsertOrg({
    parent_id: ptsoIds.ON,
    org_type: 'CLUB',
    name_en: 'Toronto Velo Club',
    name_fr: 'Club Vélo de Toronto',
    code: 'CLUB-ON-TVC',
    jurisdiction: 'ON',
  });
  const clubQcId = upsertOrg({
    parent_id: ptsoIds.QC,
    org_type: 'CLUB',
    name_en: 'Club Cycliste de Montréal',
    name_fr: 'Club Cycliste de Montréal',
    code: 'CLUB-QC-CCM',
    jurisdiction: 'QC',
  });
  const clubBcId = upsertOrg({
    parent_id: ptsoIds.BC,
    org_type: 'CLUB',
    name_en: 'Vancouver Riders Club',
    name_fr: 'Club des cyclistes de Vancouver',
    code: 'CLUB-BC-VRC',
    jurisdiction: 'BC',
  });

  // --- Disciplines & categories ---------------------------------------
  const disciplines = [
    ['ROAD', 'Road', 'Route'],
    ['TRACK', 'Track', 'Piste'],
    ['MTB', 'Mountain Bike', 'Vélo de montagne'],
    ['CX', 'Cyclocross', 'Cyclocross'],
    ['BMX', 'BMX', 'BMX'],
  ];
  const disciplineIds = {};
  for (const [code, nameEn, nameFr] of disciplines) {
    let row = db.prepare('SELECT id FROM disciplines WHERE code = ?').get(code);
    if (!row) {
      const info = db
        .prepare('INSERT INTO disciplines (code, name_en, name_fr) VALUES (?, ?, ?)')
        .run(code, nameEn, nameFr);
      row = { id: Number(info.lastInsertRowid) };
    }
    disciplineIds[code] = row.id;
  }

  const categories = [
    ['ROAD', 'ELITE', 'Elite', 'Élite', 19, 99],
    ['ROAD', 'JUNIOR', 'Junior', 'Junior', 15, 18],
    ['ROAD', 'MASTERS', 'Masters', 'Maîtres', 30, 99],
    ['MTB', 'ELITE', 'Elite', 'Élite', 19, 99],
    ['MTB', 'JUNIOR', 'Junior', 'Junior', 15, 18],
  ];
  const categoryIds = {};
  for (const [discCode, code, nameEn, nameFr, minAge, maxAge] of categories) {
    const key = `${discCode}:${code}`;
    let row = db
      .prepare('SELECT id FROM categories WHERE discipline_id = ? AND code = ?')
      .get(disciplineIds[discCode], code);
    if (!row) {
      const info = db
        .prepare(
          `INSERT INTO categories (discipline_id, code, name_en, name_fr, min_age, max_age)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(disciplineIds[discCode], code, nameEn, nameFr, minAge, maxAge);
      row = { id: Number(info.lastInsertRowid) };
    }
    categoryIds[key] = row.id;
  }

  // --- Fee rules: national defaults + PTSO overrides ------------------
  const seasonYear = new Date().getFullYear();
  function upsertFee(org_id, membership_type, discipline_id, amount_cents) {
    const existing = db
      .prepare(
        `SELECT id FROM fee_rules WHERE org_id = ? AND membership_type = ?
         AND (discipline_id IS ? OR discipline_id = ?) AND season_year = ?`
      )
      .get(org_id, membership_type, discipline_id, discipline_id, seasonYear);
    if (existing) return;
    db.prepare(
      `INSERT INTO fee_rules (org_id, membership_type, discipline_id, amount_cents, season_year)
       VALUES (?, ?, ?, ?, ?)`
    ).run(org_id, membership_type, discipline_id, amount_cents, seasonYear);
  }
  upsertFee(ccId, 'individual', null, 6500); // national default $65
  upsertFee(ccId, 'family', null, 15000);
  upsertFee(ptsoIds.ON, 'individual', null, 7200); // ON override $72
  upsertFee(ptsoIds.QC, 'individual', null, 6000); // QC override $60

  // --- Demo login accounts for every tier ----------------------------
  const ccAdmin = upsertUser({
    email: 'admin@cyclingcanada.demo',
    password: 'demo1234',
    first_name: 'Robyn',
    last_name: 'Skinner',
  });
  grantRole(ccAdmin, ccId, 'CC_ADMIN');

  const onAdmin = upsertUser({
    email: 'admin@ontario.demo',
    password: 'demo1234',
    first_name: 'Alex',
    last_name: 'Chen',
  });
  grantRole(onAdmin, ptsoIds.ON, 'PTSO_ADMIN');

  const qcAdmin = upsertUser({
    email: 'admin@quebec.demo',
    password: 'demo1234',
    first_name: 'Marie',
    last_name: 'Tremblay',
    locale: 'fr',
  });
  grantRole(qcAdmin, ptsoIds.QC, 'PTSO_ADMIN');

  const clubAdmin = upsertUser({
    email: 'admin@torontovelo.demo',
    password: 'demo1234',
    first_name: 'Jordan',
    last_name: 'Lee',
  });
  grantRole(clubAdmin, clubOnId, 'CLUB_ADMIN');

  const memberUser = upsertUser({
    email: 'member@demo.ca',
    password: 'demo1234',
    first_name: 'Sam',
    last_name: 'Rider',
  });
  grantRole(memberUser, clubOnId, 'MEMBER');

  // A member profile + a sample membership + UCI licence + transaction,
  // so dashboards have something real to show.
  let memberRow = db.prepare('SELECT id FROM members WHERE user_id = ?').get(memberUser);
  let memberId;
  if (!memberRow) {
    const info = db
      .prepare(
        `INSERT INTO members (user_id, org_id, first_name, last_name, date_of_birth, member_type)
         VALUES (?, ?, ?, ?, ?, 'participant')`
      )
      .run(memberUser, clubOnId, 'Sam', 'Rider', '2001-04-12');
    memberId = Number(info.lastInsertRowid);
  } else {
    memberId = memberRow.id;
  }

  let membershipRow = db
    .prepare('SELECT id FROM memberships WHERE member_id = ? AND season_year = ?')
    .get(memberId, seasonYear);
  let membershipId;
  if (!membershipRow) {
    const info = db
      .prepare(
        `INSERT INTO memberships (member_id, org_id, season_year, membership_type, status, waiver_signed_at)
         VALUES (?, ?, ?, 'individual', 'active', datetime('now'))`
      )
      .run(memberId, clubOnId, seasonYear);
    membershipId = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO membership_disciplines (membership_id, discipline_id, category_id)
       VALUES (?, ?, ?)`
    ).run(membershipId, disciplineIds.ROAD, categoryIds['ROAD:ELITE']);
    db.prepare(
      `INSERT INTO transactions (org_id, member_id, membership_id, amount_cents, tx_type, status)
       VALUES (?, ?, ?, 7200, 'membership_fee', 'completed')`
    ).run(clubOnId, memberId, membershipId);
    db.prepare(
      `INSERT INTO uci_licences (member_id, membership_id, uci_category, licence_year, status, issued_at)
       VALUES (?, ?, 'Elite', ?, 'issued', datetime('now'))`
    ).run(memberId, membershipId, seasonYear);
    db.prepare(
      `INSERT INTO compliance_records (member_id, compliance_type, description, status, completed_at)
       VALUES (?, 'SAFE_SPORT', 'Safe Sport training module', 'complete', datetime('now'))`
    ).run(memberId);
  }

  console.log('Seed complete.');
  console.log('Demo logins (all passwords: demo1234):');
  console.log('  admin@cyclingcanada.demo   -> CC_ADMIN (national)');
  console.log('  admin@ontario.demo         -> PTSO_ADMIN (Ontario)');
  console.log('  admin@quebec.demo          -> PTSO_ADMIN (Québec, FR locale)');
  console.log('  admin@torontovelo.demo     -> CLUB_ADMIN (Toronto Velo Club)');
  console.log('  member@demo.ca             -> MEMBER (Sam Rider)');
}

if (require.main === module) {
  seed();
}

module.exports = seed;
