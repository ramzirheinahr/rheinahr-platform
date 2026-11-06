# CLAUDE.md — RheinAhr Staffing Platform

> Project memory and build instructions for **Claude Code**.
> Read this file fully before generating any code. Keep it updated as the project evolves.

---

## ⚠️ Production Operations — read first (binding)

### Two companies, ONE codebase
The platform serves **two companies owned by the same owner, with the same business
model** — every change must apply to **both**:

| Company | Domain | DB (same Postgres) | pm2 / port | Env file on server |
|---|---|---|---|---|
| **RheinAhr** Dienstleistungen GmbH | platform.rheinahr-gmbh.de | `postgres` | `rheinahr-platform` / 3000 | `~/shared/rheinahr.env` |
| **RheinLand** Personalmanagement und Fahrdienst GmbH | platform.rheinland-gmbh.de | `rheinland_db` | `rheinland-platform` / 3001 | `~/shared/rheinland.env` |

- Company identity (name, logo, stamp, bank data…) comes from env (`NEXT_PUBLIC_COMPANY_*`)
  and DB settings (`company.*`) via `lib/config/company.ts` — **never hardcode one company**.
  Branching on the company, when unavoidable, goes through `companyConfig` (see the
  RheinLand stamp in `lib/pdf/contract.tsx`).
- Never create a separate copy/branch of the code per company.

### Server
- Self-hosted Ubuntu box, reached as `ssh rheinahr` (Tailscale, key-only SSH). Public
  traffic only via a Cloudflare named tunnel. Firewall (ufw) is on.
- `sudo` requires the account password, which only the owner types — **never** try to
  bypass this; ask the owner to run the one command that needs it.
- Releases: `~/releases/<timestamp>-<commit>/<company>`; live links `~/apps/<company>`
  (+ `.previous` for rollback).

### Deploying (the only allowed way)
1. Commit the change (repo-local git email `paypalalmnar@gmail.com`).
2. `scripts/deploy.sh` — deploys git HEAD to **RheinLand first (canary), then RheinAhr**:
   pre-migration backup → `prisma migrate deploy` on each company DB → build → smoke test
   on a private port → pm2 switch with auto-rollback. `scripts/deploy.sh rheinahr` = one only.
3. Rollback: `scripts/rollback.sh <company>`.
- Never edit code directly on the server, never build inside a live release dir, never
  use the retired `scripts/deploy-prod.sh`.
- Migrations must be **additive / backward compatible** (they run while the previous
  release still serves, and rollback keeps the new schema). Never `prisma db push` in prod.
- Server npm is v10: if `npm ci` rejects the lockfile the deploy falls back to `npm install`.

### Backups
- Local nightly 03:00 (`scripts/backup-server.sh` → server `~/scripts/backup-db.sh`), and
  03:30 encrypted offsite copy of **both** companies to Cloudflare R2
  (`scripts/offsite-backup.sh`, EU bucket with 30-day lock). Restore guide:
  `scripts/RESTORE-OFFSITE.md`. Log: `~/backups/logs/offsite-backup.log`.
- Any one-off data change in production: take a fresh backup first, dry-run, then apply,
  and audit-log it (example: `scripts/revoke-used-access-links.mjs`).

### Security decisions already made (do not undo)
- Access links (`/access/<token>`) are **single-use**, no PIN (company decision); sessions
  last 10 years.
- Client IP for audit/signatures: `lib/client-ip.ts` (Cloudflare `CF-Connecting-IP`) —
  never read `X-Forwarded-For` directly.
- Brute-force limits: `lib/rate-limit.ts`. Security headers: `next.config.mjs`.
- Every exported function in a `"use server"` file is a public endpoint: it must check
  auth itself; put internal helpers in `lib/` (server-only) instead.
- Links in emails use `NEXT_PUBLIC_APP_URL`, never request Host headers.

---

## 0. Company Identity

**RheinAhr Dienstleistungen GmbH** — Personaldienstleister / Zeitarbeitsfirma (medical & care staffing) based in Bonn, Germany.

| Field | Value |
|---|---|
| Legal name | RheinAhr Dienstleistungen GmbH |
| Rechtsform | GmbH |
| Address | Theaterplatz 1, 53177 Bonn, Deutschland |
| Phone | 0228 / 28 68 3821 |
| Fax | 0228 / 360 391 05 |
| Email | info@rheinahr-gmbh.de |
| Website | https://www.rheinahr-gmbh.de |
| Geschäftsführung | Basem Aldanaf |
| Registergericht | Amtsgericht Bonn |
| Registernummer | HRB 23459 |
| USt-IdNr. | DE316507908 |
| Aufsichtsbehörde | Arbeitnehmerüberlassung — Agentur für Arbeit Düsseldorf, 40180 Düsseldorf |

**Business**: Arbeitnehmerüberlassung von qualifizierten **Pflege- und Betreuungskräften ausschließlich im Bereich der Altenpflege / Seniorenpflege** (Versorgung pflegebedürftiger und älterer Menschen) auf temporärer Basis an Pflegeheime, Seniorenheime, Tagespflege, Kurzzeitpflege und ambulante Pflegedienste in Bonn, NRW und ganz Deutschland.

> **Domain focus (binding)**: RheinAhr is an **elderly-care (Altenpflege) staffing** company — NOT general hospital/medical staffing. The platform must always model this domain: workers are **care staff (Pflege-/Betreuungskräfte)**, clients are **care facilities** (Pflegeheim, Seniorenheim, ambulanter Dienst, Tages-/Kurzzeitpflege). Do NOT introduce hospital-only roles (Arzt, OP-/Anästhesie, Intensiv on acute wards) or acute-hospital facility types.
>
> **Terminology**: refer to workers as **care staff / Pflegekräfte / كوادر الرعاية (مقدّمو الرعاية)** — never "technicians / Techniker / فنيون".

> **Branding rule**: All user-facing text, legal pages, emails, PDFs (Leistungsnachweis), and the Impressum must use the RheinAhr identity above. Replace any leftover "MedStaff Pro" references from the original plan.

---

## 1. What We Are Building

A web application to digitize and automate RheinAhr's Zeitarbeit operations in **elderly care (Altenpflege)** — replacing manual Excel/WhatsApp/phone coordination with an integrated trilingual (DE/EN/AR) platform.

**Scope**: 200+ care staff (Pflege-/Betreuungskräfte) · 50+ care facilities (Pflegeheime, Seniorenheime, ambulante Dienste) · 3 languages · full lifecycle management.

**Goals**: zero manual coordination errors · digital service confirmation (Leistungsnachweis) · real-time availability · automated reminders.

**Key problems solved**
- Manual Excel scheduling → automated availability matching
- Phone/WhatsApp coordination → in-app notifications + digital confirmation
- No audit trail → full digital Leistungsnachweis
- No client portal → self-service booking + real-time order tracking
- Manual reminders → automated SMS/email 24h & 1h before shift

---

## 2. Roles & Portals

### Admin Portal (Agency Management)
Agency manager's command center. Manage all workers (profiles, qualifications, contracts, certifications), all client facilities, full order lifecycle (pending → assigned → in-progress → completed → confirmed), manual override/reassignment, financial overview & invoicing export, system config (notification templates, reminder timing, roles), reports & analytics.

### Client Portal (Kundenportal / بوابة الزبائن) — DE/EN/AR
For hospital/facility managers & HR coordinators. Submit service requests (date, time, shift duration, required qualification, headcount), real-time status, worker assignment notification, digital Leistungsnachweis (confirm arrival & hours), upload signed confirmation docs, full history, downloadable invoicing-ready reports.

### Worker Portal (Mitarbeiterportal / بوابة العمال) — mobile-first
For doctors/nurses/care workers. View assigned shifts (location, contact, duration, tasks), accept/request change, automated reminders (24h + 1h), availability calendar, work history & confirmed hours, upload personal docs (certs, ID, vaccination proof), in-app messaging per assignment.

---

## 3. Core Workflow — Order Lifecycle (8 stages)

1. **Request Submitted** (Client) — date, shift, qualification, quantity
2. **Request Review** (Admin) — feasibility check / clarification
3. **Availability Check** (System + Admin) — auto-match qualified available workers
4. **Worker Assignment** (Admin) — assign 1+ workers; they get a portal notification
5. **Worker Acceptance** (Worker) — confirm or request change; client notified on confirmation
6. **Automated Reminder** (System) — 24h before + 1h before shift
7. **Shift Execution** (Worker) — service performed at facility
8. **Service Confirmation** (Client) — digitally confirm presence, hours, completion

### Digital Confirmation (Leistungsnachweis) — legal/financial cornerstone
- **Method A — Electronic Signature**: in-portal signature pad / click-to-confirm with timestamp + IP logging
- **Method B — Document Upload**: print, sign, upload scanned PDF/photo
- Both produce a tamper-proof record, exportable as PDF for invoicing/archiving
- GDPR-compliant audit log: who confirmed, when, device/IP

---

## 4. Modules & Build Order

| Module | Features | Phase |
|---|---|---|
| Authentication & RBAC | Login, 2FA, role-based access (Admin/Client/Worker), password reset, sessions | **P1** |
| Worker Management | Profiles, qualifications, certifications, contract type, availability calendar, document vault | **P1** |
| Client Management | Facility profiles, contacts, service history, preferred workers | **P1** |
| Order Management | Create/edit orders, status pipeline, assignment workflow, conflict detection | **P1** |
| Availability Engine | Calendar availability, smart filter by qualification + location + schedule | **P1** |
| Notification System | Email + SMS reminders (24h, 1h), assignment & status alerts | **P1** |
| Service Confirmation | E-signature, document upload, confirmation PDF, audit log | **P1** |
| Client Portal | Order submission, status tracking, worker card, confirmation UI | **P1** |
| Worker Portal | Shift calendar, assignment details, reminders, availability setter | **P1** |
| Multilingual (i18n) | DE/EN/AR, RTL for Arabic, per-user language switcher | **P1** |
| Reporting & Dashboard | Fulfillment rate, active orders, utilization, client activity | **P2** |
| Invoicing Export | Leistungsnachweis PDF, DATEV/CSV export | **P2** |
| Internal Messaging | Per-assignment chat coordinator ↔ worker | **P2** |
| Mobile App (PWA) | Installable PWA for workers | **P2** |
| API Integration | REST API for ERP/payroll (DATEV, SAP) | **P3** |
| E-Signature (QES) | Qualified electronic signature — BundID / DocuSign | **P3** |

---

## 5. Technical Architecture

### Stack (locked unless a decision below overrides it)
> **Current reality (2026-11) overrides the original plan below:** Supabase and Vercel are
> no longer used. Production is self-hosted — local PostgreSQL 16 (Docker), local file
> storage (`lib/local-storage.ts`), custom session auth (`lib/auth.ts`, `app_session`
> cookie), SMTP email, Next.js 16. See **Production Operations** at the top of this file.

- **Frontend**: Next.js 14 (App Router, React, TypeScript) — SSR/SSG, built-in i18n routing
- **UI**: Tailwind CSS + shadcn/ui — RTL via logical properties / tailwindcss-rtl
- **i18n / RTL**: next-intl — Arabic RTL layout, per-user locale
- **Backend**: Next.js API Routes (Node.js) — same-language full stack
- **Database**: PostgreSQL via **Supabase (EU region — Frankfurt)** — relational, GDPR, realtime
- **ORM**: Prisma — type-safe, auto-migrations
- **Auth**: Supabase Auth (or Auth.js) — JWT + session, RBAC, 2FA
- **File Storage**: Supabase Storage (EU) — signed expiring URLs
- **Email**: Resend + React Email
- **SMS/WhatsApp**: Twilio (German numbers, WhatsApp Business API)
- **PDF**: React-PDF / Puppeteer — server-side Leistungsnachweis rendering
- **E-Signature**: signature_pad.js (MVP) → DocuSign/BundID (later)
- **Hosting**: Vercel (frontend) + Supabase (backend) — both EU; Hetzner VPS as self-host alternative
- **CI/CD**: GitHub Actions → Vercel auto-deploy
- **Monitoring**: Sentry + Vercel Analytics (EU data residency)

### Database Schema — core entities
```
users(id, email, role[admin|client|worker], preferred_language, 2fa_enabled, created_at)
workers(id, user_id, full_name, qualification[enum], certifications[], contract_type, phone, address, languages[])
worker_availability(id, worker_id, date, status[available|unavailable|assigned], notes)
clients(id, user_id, facility_name, facility_type, address, contact_person, billing_info)
orders(id, client_id, required_qualification, shift_date, start_time, end_time, status, notes, quantity)
assignments(id, order_id, worker_id, status[pending|confirmed|declined], assigned_at, confirmed_at)
service_confirmations(id, assignment_id, confirmed_by[user_id], method[electronic|upload], signature_data, document_url, confirmed_at, ip_address)
notifications(id, user_id, type, channel[email|sms|in-app], content, sent_at, read_at)
documents(id, owner_id, owner_type[worker|client], category, file_url, uploaded_at, verified)
```

---

## 6. Implementation Phases

| Phase | Timeline | Deliverables |
|---|---|---|
| **P1 — MVP** | Months 1–4 | Auth+RBAC, Worker & Client CRUD, Order mgmt, Availability engine, Assignment workflow, Email notifications, Service confirmation (electronic+upload), Client portal, Worker portal, Trilingual UI |
| **P2 — Enhanced** | Months 5–7 | SMS/WhatsApp reminders, PDF Leistungsnachweis, Reporting dashboard, Invoicing export, Internal messaging, PWA, advanced availability calendar |
| **P3 — Enterprise** | Months 8–12 | QES (DocuSign/BundID), DATEV/payroll API, multi-agency, advanced analytics, React Native app, SLA monitoring, audit log export |

### Phase 1 — Detailed Milestones
- **Week 1–2**: Project setup, repo, CI/CD, design system, DB schema finalized
- **Week 3–4**: Auth module, user roles, protected routes, language switcher (DE/EN/AR)
- **Week 5–6**: Worker CRUD + document upload + availability calendar
- **Week 7–8**: Client CRUD + facility profiles
- **Week 9–10**: Order creation (client) + admin review interface
- **Week 11–12**: Availability matching engine + assignment workflow + worker notification
- **Week 13–14**: Service confirmation module (e-signature + document upload)
- **Week 15–16**: E2E testing, UAT, bug fixes, deployment

---

## 7. GDPR & Legal Compliance (Germany — critical)

### GDPR / DSGVO
- All personal data on **EU-region servers** (Frankfurt / Ireland)
- Data Processing Agreement (DPA / AVV) with all providers (Supabase, Vercel, Twilio, Resend)
- Cookie consent banner on public pages
- Right to erasure (Recht auf Löschung) — admin can delete worker/client data
- Data export (DSGVO Art. 20) — users download all their data
- Access log — all data-access events with timestamp + user ID
- Privacy policy & ToS pages **in German** (mandatory)
- No data transfer outside EU without consent

### Employment Law (AÜG — Arbeitnehmerüberlassungsgesetz)
- Store AÜG-compliant contract info per worker
- Track max assignment duration (18 months per worker per client — AÜG §1)
- Qualification verification stored & auditable (Fachkunde, Approbation, etc.)
- Support generation of Überlassungsvertrag reference data

### Security
- HTTPS everywhere (TLS 1.3)
- Passwords: bcrypt, min 12 chars
- 2FA available for all roles, **mandatory for Admin**
- Session expiry: 8h workers, 24h clients/admin
- Document URLs: signed expiring links (never public permanent)
- Rate limiting: 100 req/min per IP
- Daily automated backups, 30-day retention

---

## 8. Notification Matrix

| Trigger | Channel | Recipient | Content |
|---|---|---|---|
| New order submitted | Email | Admin | Order details, client, qualification, date/shift |
| Worker assigned | Email + In-app | Worker | Assignment details, facility address, contact, time |
| Worker confirms | Email + In-app | Client + Admin | Worker name, qualification confirmed |
| 24h before shift | Email + SMS | Worker | Reminder: tomorrow [time], [facility], [address] |
| 1h before shift | SMS | Worker | Reminder: in 1h — [facility], [address] |
| Service confirmed | Email | Admin + Worker | Confirmation for [date], hours: [X] |
| Order status changed | In-app | Client | Order [#ID] status: [new status] |
| Document uploaded | Email | Admin | New doc by [worker]: [type] |

---

## 9. Coding Conventions & Guardrails for Claude Code

- **Language**: TypeScript everywhere. Strict mode on. No `any` unless justified with a comment.
- **i18n first**: never hardcode user-facing strings — always go through next-intl message catalogs (`messages/de.json`, `en.json`, `ar.json`). Default locale: `de`.
- **RTL**: use CSS logical properties (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`) — never hardcode `left`/`right`. Test every screen in Arabic.
- **DB access**: only through Prisma. Define schema in `prisma/schema.prisma`; never write raw SQL migrations by hand.
- **Auth/RBAC**: enforce role checks server-side (middleware + per-route). Never trust the client. Use Supabase Row Level Security (RLS) as a second layer.
- **Secrets**: never commit. Use `.env.local` (gitignored) and document required vars in `.env.example`.
- **PII/GDPR**: any field touching personal data must be in the audit-log path. No PII in logs, error messages, or Sentry payloads.
- **Validation**: validate all input with Zod at API boundaries.
- **Commits**: conventional commits (`feat:`, `fix:`, `chore:`...). Small, focused PRs aligned to milestones above.
- **Tests**: at minimum, unit tests for the availability-matching engine and the service-confirmation/audit logic.
- **Folder structure** (App Router):
  ```
  app/[locale]/(admin|client|worker)/...   # role-scoped route groups
  app/api/...                              # API routes
  components/ui/                           # shadcn components
  lib/                                     # auth, db, validators, utils
  messages/{de,en,ar}.json                 # i18n catalogs
  prisma/schema.prisma
  ```

### When in doubt
- Prefer EU-hosted, GDPR-safe services. Flag any dependency that processes PII outside the EU.
- Keep the RheinAhr identity (Section 0) consistent across Impressum, emails, and PDFs.
- Build strictly in phase order; do not start P2 features before P1 is functional.

---

## 10. Success Metrics

| Metric | Current (manual) | Target (system) |
|---|---|---|
| Order processing time | 30–60 min | < 5 min (automated matching) |
| Confirmation method | Paper / WhatsApp photo | 100% digital with audit trail |
| Missed-shift reminder rate | Manual, error-prone | 0% — fully automated |
| Worker availability visibility | Offline Excel | Real-time dashboard |
| Client self-service rate | 0% (all via phone) | > 80% orders via portal |
| Service confirmation time | Days (paper) | < 24 hours (electronic) |

---

## 11. First Commands (Week 1–2 kickoff)

```bash
# 1. Scaffold
npx create-next-app@latest rheinahr-platform --typescript --tailwind --app --src-dir=false
cd rheinahr-platform

# 2. Core deps
npm i @prisma/client next-intl zod @supabase/supabase-js @supabase/ssr
npm i -D prisma
npx prisma init

# 3. shadcn/ui
npx shadcn@latest init

# 4. i18n catalogs
mkdir -p messages && printf '{}' | tee messages/de.json messages/en.json messages/ar.json

# 5. env template
cp .env.example .env.local   # fill Supabase, Resend, Twilio, Sentry keys
```

**Next step after scaffolding**: define `prisma/schema.prisma` from Section 5 entities, run `npx prisma migrate dev --name init`, then wire Supabase Auth + the locale middleware before building any portal.

---

_RheinAhr Dienstleistungen GmbH — Staffing Platform · Implementation v1.0 · Ready to build._
