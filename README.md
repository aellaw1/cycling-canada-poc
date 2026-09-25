# Cycling Canada National Membership Platform — Proof of Concept

Built in response to Cycling Canada's RFP: *National Aligned Membership & Registration Database* (June 2026). This is a **working proof-of-concept**, not the production system — it demonstrates the architectural approach to the RFP's hardest requirements so a proposal can show, not just claim, capability.

## What this proves

| RFP requirement | How the POC demonstrates it |
|---|---|
| Federated CC → PTSO → Club hierarchy with a shared data model and separate admin control (§4.1) | Single `organizations` table, self-referencing `parent_id`. All 12 PTSOs + CC + sample clubs seeded. Verified: an Ontario admin cannot see or write Québec's data, and vice versa (403 on cross-tenant write). |
| Role-based permissions + audit trails (§4.1) | `user_roles` table scopes each user to an org subtree; every mutating action writes to `audit_log`. |
| PTSO-specific fee structures with national consistency (§4.1) | `fee_rules` resolved by walking the org hierarchy upward (club → PTSO → CC) so a PTSO can override the national default without duplicating rules. |
| Multi-discipline / multi-category / family / individual memberships (§4.1) | `memberships` + `membership_disciplines` + `categories` tables. |
| UCI licence management, linked to national/provincial/club/athlete records (Strategic Expectation 4) | `uci_licences` table linked to `members` and `memberships`, independent of the core registration flow so UCI rule changes don't require redesigning membership. |
| Compliance tracking: NCCP, Safe Sport, PTSO-specific (§4.1) | `compliance_records` table + dashboard KPI + completion workflow. |
| Three-tier dashboards (club/PTSO/CC), real-time data, exportable datasets (§4.1) | `/dashboard` renders different KPIs and child-org rollups depending on login; `/finance/export.csv` produces an accounting-ready extract. |
| Financial data exchange & reconciliation (Strategic Expectation 3) | `transactions` table + `/finance` reconciliation workflow + CSV export as a neutral integration point (RFP names no specific target accounting system). |
| Bilingual capability EN/FR (§4.1) | Full EN/FR UI via `locales/en.json` / `locales/fr.json`; per-user locale preference persisted; every seeded org/discipline/category has bilingual names. |
| Mobile-responsive, accessible UI (§4.1) | Responsive CSS grid layout; semantic HTML tables/forms (no conformance audit performed — flagged as an open item, see RFP gap analysis). |
| Modular, API-enabted, configuration-over-customization architecture (Strategic Expectation 1) | Clean route/service separation; fee/permission logic isolated from route handlers so it's swappable; JSON-friendly data layer ready for a REST/GraphQL API layer. |

## What's intentionally stubbed (RFP is silent on these)

- **Payment processor / merchant-of-record** — the RFP names no processor. Transactions are recorded as completed; a real build would integrate Stripe/Moneris/etc.
- **UCI API integration** — RFP gives no API/DataRide spec. `uci_licences` is a clean extension point.
- **Named accounting system** — no QuickBooks/Sage/NetSuite mentioned. CSV export is a generic, documented integration point.
- **WCAG/accessibility conformance level** — not specified in RFP; not audited here.
- **Encryption/SOC2/breach-notification specifics** — not specified in RFP; would be addressed in the written security section of the proposal, not this POC.

## Tech stack

Deliberately minimal so it can run anywhere, including constrained shared hosting:
- **Node.js** (built-in `node:sqlite` — zero external database server to install)
- **Express** for routing/sessions
- **EJS** for server-rendered views (no build step, no bundler)
- Plain CSS (no framework)

This is a demonstration stack for the POC. A production build would very likely move to PostgreSQL (for real concurrency, replication, and row-level security across tenants) and a proper frontend framework — call that out explicitly in the proposal as "POC substrate vs. production architecture."

## Running locally

```bash
npm install
npm start
# -> http://localhost:3000
```

The database seeds itself automatically on first boot (`data/ccnrd.sqlite`). Re-running is safe — seeding is idempotent.

### Demo accounts (password: `demo1234` for all)

| Email | Role | Scope |
|---|---|---|
| admin@cyclingcanada.demo | CC_ADMIN | Everything (national) |
| admin@ontario.demo | PTSO_ADMIN | Ontario + its clubs only |
| admin@quebec.demo | PTSO_ADMIN | Québec + its clubs only (FR locale) |
| admin@torontovelo.demo | CLUB_ADMIN | Toronto Velo Club only |
| member@demo.ca | MEMBER | Self only |

Log in as different roles in different browsers/incognito windows to see the permission scoping live.

## Deploying to IONOS webspace

**Important constraint to check first:** classic IONOS *shared webspace* plans are built for PHP/static sites and generally do **not** run a persistent Node.js process. Confirm your plan type before deploying:

- **IONOS "Deploy Now" / Node.js-capable hosting, or a VPS/Cloud Server plan**: this app deploys as-is. Typical flow:
  1. `git push` to the IONOS deploy target, or `scp`/SFTP the project (excluding `node_modules` and `data/`).
  2. On the server: `npm install --production`, then run via a process manager: `pm2 start src/app.js --name cc-poc` (or IONOS's Node app runner if using Deploy Now).
  3. Set `PORT` and `SESSION_SECRET` environment variables in the IONOS control panel.
  4. Point the domain/subdomain at the app port, or let IONOS's reverse proxy handle it (Deploy Now does this automatically).

- **Classic shared PHP/static hosting**: this Node app **will not run** there. Options: (a) request a VPS/Cloud Server upgrade from IONOS for the demo, (b) deploy this POC to a free/low-cost Node-friendly host instead (Render, Railway, Fly.io) purely for the RFP demo, and mention the intended production target (Canadian-hosted, e.g. a Canadian AWS/Azure region or Canadian-owned data center) separately in the proposal to satisfy the data-residency requirement.

Tell me which IONOS plan you have and I'll give you exact deployment commands.

## Known gaps to close before treating this as proposal-ready

1. No automated tests yet (add before submission-quality polish).
2. No French translation review by a native speaker (machine-quality FR strings).
3. No accessibility audit performed.
4. SQLite is fine for a demo; note clearly in the written proposal that production uses a multi-tenant-safe RDBMS (Postgres) with encryption at rest.
5. Session store is in-memory (fine for a demo; would need Redis/DB-backed sessions for production sizing).
