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
- **Rich worker profiles** (2026‑07): personal/HR fields (birthDate, birthPlace,
  nationality [ISO‑3166 code], socialSecurityNumber — all sensitive, admin‑only),
  professional fields (bio/Kurzprofil, skills[], yearsExperience, employedSince),
  **profile photo** + **certificate/ID/vaccination documents** (new `WorkerDocument`
  model + private `worker-files` Storage bucket, signed‑URL API routes
  `/api/workers/[id]/photo` & `/api/worker-documents/[id]`, admin‑verifiable).
  Spoken **languages = all world languages** (ISO‑639 codes, DE/EN/AR pinned;
  labels via `Intl.DisplayNames`, no hand tables — `lib/languages.ts`,
  `lib/countries.ts`, searchable `components/ui/combobox.tsx`). Worker `languages`
  column migrated `Language[]`→`text[]` (data preserved). Worker self‑service at
  `/worker/documents`. **Client‑facing profile** `/client/workers/[id]` (access‑gated:
  client must have an assignment with the worker; data‑minimized, no SV‑Nr/birthdate);
  admin preview at `/admin/workers/[id]/profile`; linked from client confirmations
  and the worker edit page.
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
  **Leistungsnachweis PDF**, **in‑app notifications** (bell).
- **Worked hours** (2026‑07): worker schedule table shows client‑confirmed hours per
  shift (green "Vom Kunden bestätigt" badge) + monthly net total (breaks deducted) in a
  table footer; **fully editable admin mirror** at `/admin/workers/[id]/schedule`
  (linked "Stunden" from the workers list) — renders the *same* `AvailabilityBuilder`
  with `workerId`, so admins accept/decline assignments and edit availability **on the
  worker's behalf** (phone‑in changes; `saveAvailability`/`respondAssignment` accept
  admin/super_admin, audit logs keep the acting user via `actorRole`). Shared data
  source `lib/worker-schedule.ts` (`getWorkerMonthSchedule`,
  `getWorkerMonthUnavailability`); `service_confirmed` bell notification carries
  facility · date · hours and the confirm action revalidates `/worker`.
- **Client month overview** (2026‑07): `/client/schedule` (nav tab "Monatsübersicht")
  mirrors the same monthly table for the facility — all days, weekend/NRW‑holiday tint,
  per‑shift worker + qualification + Wohnbereich, green confirmed badge, net hours +
  month total. Download as branded **PDF** (`lib/pdf/monatsuebersicht.tsx`, German
  business doc) or **Excel‑friendly CSV** (BOM + semicolon, German decimals) via
  `/api/exports/client-schedule?year&month&format=pdf|csv` (client‑scoped, audited;
  admins add `&clientId=` for any facility). Data source `lib/client-schedule.ts`
  (`getClientMonthSchedule`, `clientScheduleCsv`); table markup shared via
  `components/client/month-schedule-table.tsx`. **Admin mirror** at
  `/admin/clients/[id]/schedule` ("Stunden" button in the clients list) — same table +
  same PDF/Excel downloads.
- **Unified inbox** (2026‑07): conversation‑based messaging for all three portals
  (`/{admin,client,worker}/inbox` + `/inbox/[id]` thread pages, shared
  `components/inbox/*` views). Model: agency staff (admin/super_admin act as one
  team) ↔ exactly one client/worker per thread; staff see **all** threads, others
  only their own; **no client↔worker** direct messaging. Admin compose supports
  **multi‑recipient** (one private thread per recipient, searchable Combobox).
  **Unread badge** on the inbox nav tab (`countUnreadConversations` in
  `PortalShell`), `new_message` bell notifications **deep‑link to the inbox**.
  Threads auto‑refresh (20 s, visibility‑aware) + read cursors
  (`ConversationParticipant.lastReadAt`, upserted on open/send). Old
  **per‑assignment chat** folded in: `/admin/messages/[assignmentId]` now
  lazily creates/finds the assignment's conversation and redirects into the
  inbox; the worker assignment page embeds the same thread. Client
  **change‑request messages** (locked requests) land as a per‑request thread
  (`Conversation.requestGroupId`) instead of notification‑only. Server logic in
  `lib/inbox.ts` (queries/access) + `lib/inbox-actions.ts` (Zod‑validated
  actions, audit‑logged).
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
- **Inbox schema** (2026‑07‑03, already `db push`ed — additive/safe): new
  `conversations` (`subject`, `assignment_id` unique‑nullable, `request_group_id`,
  `last_message_at`) + `conversation_participants` (`@@unique([conversationId,userId])`,
  `lastReadAt` = per‑user read cursor). `messages.assignment_id` relaxed to
  **nullable** (legacy column); new nullable `messages.conversation_id` — new
  messages always set it; legacy per‑assignment rows are attached lazily on
  first access (`getOrCreateAssignmentConversation`, seeds read cursors to
  "now" so old threads don't flood badges).

## 8. ⚠️ PENDING / UNPUSHED WORK
Everything up to HEAD `ed61e83` is committed. Currently **uncommitted** (2026‑07‑03):
the **unified inbox** feature (§6) — new `lib/inbox{,-actions}.ts`,
`components/inbox/*`, 6 inbox pages, edits to the 3 portal layouts,
`portal-{shell,nav}`, `notifications-bell`, worker assignment page, admin
messages page (now a redirect), client orders actions, `prisma/schema.prisma`,
`messages/{de,en,ar}.json`; deleted `lib/messages.ts`, `lib/message-actions.ts`,
`components/messages/message-thread.tsx`.
- **DB already pushed** (additive only — existing data untouched).
- Verified locally: vitest green, clean build; authed smoke test (real Supabase
  sessions): admin/worker inbox render (DE + AR RTL), unread nav badge counts,
  legacy assignment‑chat URL lazily creates the conversation + redirects,
  non‑participant worker gets 404 with **no content leak**, admin compose
  recipient list serialized correctly. Test data cleaned up afterwards.
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
