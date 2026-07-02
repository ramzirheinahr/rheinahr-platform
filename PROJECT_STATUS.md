# RheinAhr Platform — Project Status & Context

> Handoff/context snapshot for continuing in a new session. Read `CLAUDE.md`
> first (domain + conventions), then this file. Date of snapshot: 2026‑07‑01.

## 1. What this is
Trilingual (DE/EN/AR, Arabic RTL) staffing platform for **RheinAhr Dienstleistungen GmbH**,
an **elderly‑care (Altenpflege) Zeitarbeit** company in Bonn. NOT general hospital
staffing. Workers = care staff (Pflegekräfte); clients = care facilities.

## 2. Stack
- Next.js **14** App Router + TypeScript (strict) · Tailwind **v4** (CSS‑first) ·
  shadcn/ui **base‑nova** style built on **Base UI** (use the `render` prop, not `asChild`).
- **next-intl** (locale‑prefixed routes `/de /en /ar`, default `de`, catalogs in `messages/`).
- **Prisma 6** + **Supabase Postgres (EU, eu‑west‑1/Ireland)** · **Supabase Auth (email)**.
- **Supabase Storage** private bucket `confirmations` (Leistungsnachweis uploads).
- PDF: `@react-pdf/renderer`. Signature: `signature_pad`. Top loader: `nextjs-toploader`.
- Hosting: **Vercel** (Hobby). CI: push to GitHub `main` → Vercel auto‑deploy.

## 3. Deployment & Git (IMPORTANT)
- GitHub: `github.com/ramzirheinahr/rheinahr-platform` (private). Push via SSH
  (dedicated key `~/.ssh/github_rheinahr`, configured in `~/.ssh/config`).
- Vercel account/owner email: **paypalalmnar@gmail.com** (Hobby plan).
- **Commit author email MUST be `paypalalmnar@gmail.com`** — repo‑local git config is
  set to it. Vercel Hobby **blocks** deploys whose commit author isn't the owner.
  (The machine's global git email is `ramziabuibaid@gmail.com` — do NOT let commits
  use it here.)
- Custom domain plan: point `rheinahr-gmbh.de` DNS (A `76.76.21.21`, `www` CNAME
  `cname.vercel-dns.com`) at Vercel; **keep MX/email records untouched**; upgrade to
  Vercel Pro for production/commercial use.

## 4. Roles & auth
- Roles: `super_admin`, `admin`, `client`, `worker`. Login is **email** (Supabase Auth);
  Google/Apple OAuth planned later. Username login was explored and rejected.
- **super_admin** is the sole account creator. There is **no separate accounts page**
  (removed 2026‑07): creating a worker (`/admin/workers/new`) or facility
  (`/admin/clients/new`) provisions the Supabase Auth user + Prisma `User` + profile in
  one step, and the worker/client **edit pages** carry an `AccountSection`
  (super_admin‑only: active flag, password reset, access link). Shared actions in
  `app/[locale]/admin/account-actions.ts`. Plain `admin`-role accounts can no longer be
  created via UI (seed/DB only).
- **Passwordless access link + PIN** (client/worker convenience login): from the
  worker/client edit page, super_admin generates a personal link `/{locale}/access/<token>`
  + a 6‑digit PIN (shown once, stored bcrypt‑hashed). User opens the link, enters the
  PIN once per device → server mints a **persistent Supabase session** (`/api/access/verify`
  via `generateLink`+`verifyOtp`, no email sent; cookie Max‑Age ~400d). Returning visits
  skip the PIN. PWA "add to home screen" hint on the page. Brute‑force lockout
  (5 attempts → 15 min), uniform 401 (no enumeration), regenerate/revoke, audit‑logged.
  New `User` fields: `loginToken` (unique), `loginPinHash`, `loginPinAttempts`,
  `loginPinLockUntil`. Helpers in `lib/access.ts`. Email login still works for everyone.
- `lib/auth.ts`: `getCurrentUser`, `requireRole`, `requireSuperAdmin`, `roleSatisfies`
  (super_admin ⊇ admin), `portalPath`. After login `/dashboard` routes by role.

## 5. Demo login accounts (seeded)
| Role | Email | Password |
|---|---|---|
| super_admin | admin@rheinahr-gmbh.de | RheinAhr#2026!Admin |
| client | client.demo@demo.rheinahr-gmbh.de | Demo!Klinik2026 |
| worker | worker.demo@demo.rheinahr-gmbh.de | Demo!Pflege2026 |

Re‑seed demo data anytime: `npm run db:seed:demo` (wipes non‑super_admin data + recreates).

## 6. Feature inventory (built)
- Auth/RBAC · **worker** & **client** modules with account management folded in (§4).
- **Qualifications** (2026‑07): merged to 4 — `pflegefachkraft` (absorbed
  `altenpfleger` + `gesundheitspfleger`; AR label „مؤهل رعاية", EN "Qualified care
  professional"), `pflegehelfer`, `betreuungskraft`, `pflegedienstleitung`. DB rows
  remapped + enum values dropped (prod already pushed).
- **Order lifecycle** + availability **matching engine** (`lib/matching.ts`, unit‑tested).
- **Order entry = full‑month spreadsheet** (`components/client/order-request-builder.tsx`):
  one row/day, 1 shift default + `+` to add up to 3; per shift = type
  (Früh 06:30‑14:00 / Spät 13:30‑21:00 / Nacht 20:30‑07:00 presets, editable), **Pause**
  (default 30), computed **net hours**, headcount, **Wohnbereich/Station/Etage**; weekend/
  **NRW holidays** (`lib/holidays.ts`) rows red; request total hours; one grouped request
  (`Order.requestGroupId`) → many orders.
- **Requests shown as a sheet**, grouped/expandable in client & admin lists.
  Client can **edit a request** while all shifts pending & unassigned (`isRequestEditable`);
  locks on first admin action.
- **Admin request detail** (`/admin/orders/[id]` where `[id]` = requestGroupId): per‑shift
  assignment via `candidatesForShift` (`lib/orders.ts`) showing **available / busy (same‑day)
  / unavailable (time‑overlap)** with override allowed.
- **Worker** portal: **monthly sheet** of shifts (accept/decline, chat); **availability =
  monthly table** with per‑shift or whole‑day unavailability, instant local edit + one Save.
- Digital **service confirmation** (signature pad OR upload → Storage, IP+timestamp),
  **Leistungsnachweis PDF**, **in‑app notifications** (bell), **per‑assignment messaging**.
- **Reports** dashboard · **Invoicing** CSV/DATEV export + PDF · legal **Impressum/Datenschutz**
  (German) · cookie banner · **GDPR data export** (`/api/me/export`) · **PWA** (installable,
  offline shell) · professional **landing** + **/roadmap** page (German, for stakeholder).
- **Top progress bar** (YouTube‑style) on every navigation.

## 7. Data‑model notes (recent)
- `Order.requestGroupId` groups shifts from one submission (backfilled = own id for legacy).
- `WorkerAvailability` now stores **unavailability blocks**: `startTime/endTime` nullable
  (null = whole day), unique `[workerId,date]` **dropped** (multiple blocks/day). Matcher
  uses **time overlap**.
- `ServiceConfirmation.confirmedById` nullable + `onDelete: SetNull` (GDPR‑safe erasure).
- Per‑shift **Pause/net hours are UI‑only** (not persisted); `Wohnbereich` stored in `Order.notes`.

## 8. ⚠️ PENDING / UNPUSHED WORK
Access link + PIN is committed (HEAD `8086fc2`). Currently **uncommitted** (2026‑07‑02):
**accounts‑page removal + qualification merge** — deleted `app/[locale]/admin/accounts/`
and `components/admin/account-{create,edit}-form.tsx`; new `/admin/{workers,clients}/new`
pages + `worker-create-form`/`client-create-form`/`account-section` components +
`app/[locale]/admin/account-actions.ts`; edited workers/clients actions & pages, admin
nav, `lib/{validations,pricing,invoicing}.ts`, `messages/*`, `prisma/schema.prisma`,
`scripts/seed-demo.mjs`.
- **Production DB already migrated**: rows remapped (`altenpfleger`/`gesundheitspfleger`
  → `pflegefachkraft`) then `prisma db push --accept-data-loss` dropped the two enum
  values. ⚠️ The **deployed** code still offers the old values until this is pushed —
  selecting them there will fail; push soon.
- Verified locally: tests + clean build pass; authed smoke test — `/admin/accounts` 404,
  new/edit pages render (incl. AR), AccountSection on worker & client edit pages.
- **Next action:** after review, `git add -A && git commit && git push origin main`
  (author must be paypalalmnar@gmail.com) to deploy.

## 9. Commands
```
npm run dev            # binds 0.0.0.0 (LAN access: http://<lan-ip>:3000)
npm run build:clean    # rm -rf .next && next build   (use this, not plain build)
npm run test           # vitest (matching engine)
npm run db:push        # prisma db push
npm run db:seed        # super_admin seed
npm run db:seed:demo   # realistic demo dataset
npm run db:storage     # create Storage bucket
```

## 10. Deferred (by owner) & roadmap
- Deferred: **Resend email** (owner has working domain email; migrate later), **Twilio SMS/
  WhatsApp**, **2FA for admin** (mandatory before production).
- Later (P2/P3): certificate‑expiry tracking, AÜG 18‑month cap & Equal‑Pay monitoring,
  invoice PDF generation, DATEV/payroll integration, QES (BundID), multi‑branch, ratings,
  check‑in/out.

## 11. Known environment gotchas
- **Transient `.next` build corruption** (errors like “Cannot find module ./XXXX.js” or
  “React Client Manifest”): fix with `rm -rf .next node_modules/.cache && npm run build`.
- **Never pipe `npm run build` through `head`** — SIGPIPE can kill the build mid‑emit.
- `.env` is gitignored (Prisma + Next read it). `.env.example` documents vars.
