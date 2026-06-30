# RheinAhr Staffing Platform — Setup & Decisions

Project foundation (Phase 1, Weeks 1–4) scaffolded per [CLAUDE.md](CLAUDE.md).

## Quick start

```bash
cp .env.example .env        # fill Supabase (EU/Frankfurt), Resend keys
npm install                 # runs prisma generate via postinstall
npm run db:push             # create tables on your Supabase Postgres (or db:migrate)
npm run dev                 # http://localhost:3000 → redirects to /de
```

## What's implemented

- **Next.js 14 App Router + TypeScript (strict)** in the repo root.
- **Trilingual i18n (de/en/ar)** via `next-intl` — locale-prefixed routes
  (`/de`, `/en`, `/ar`), German default. Arabic renders `dir="rtl"`
  automatically. Catalogs in [messages/](messages/). Use the locale-aware
  `Link`/`useRouter` from [i18n/navigation.ts](i18n/navigation.ts) everywhere.
- **Prisma schema** ([prisma/schema.prisma](prisma/schema.prisma)) — all core
  entities from CLAUDE.md §5, plus an `AuditLog` model for GDPR Art. 30.
- **Supabase Auth** wiring — server/browser clients in [lib/supabase/](lib/supabase/).
- **RBAC** — server-side role guard [`requireRole`](lib/auth.ts) used in each
  portal layout. Roles resolved from our own DB (never trust the client).
- **Three role-scoped portals** — `/[locale]/admin`, `/client`, `/worker`,
  each with a guarded layout + dashboard shell + nav.
- **Login** page + form ([app/[locale]/login](app/[locale]/login)).
- **Zod validators** ([lib/validations.ts](lib/validations.ts)) mirroring the
  Prisma enums, for API-boundary validation.
- **UI**: shadcn/ui (`base-nova` style on Base UI) + Tailwind CSS.

Production build is green; `/`, `/de`, `/de/login` prerender statically, while
the auth-gated portal routes render dynamically per request (verified via
`prerender-manifest.json` — they are intentionally **not** prerendered).

## Stack decisions that diverged from / refined CLAUDE.md §5

| Area | Decision | Why |
|---|---|---|
| **Tailwind** | **v4** (CSS-first, no `tailwind.config.ts`) | `shadcn@latest` scaffolds the `base-nova` style for Tailwind v4 + Base UI. Tokens live in `@theme` inside [app/globals.css](app/globals.css). |
| **shadcn components** | Built on **Base UI**, not Radix | This is what current shadcn `base-nova` uses. API note: use the **`render`** prop for polymorphism (e.g. `<Button render={<Link/>}>`), **not** `asChild`. |
| **Prisma** | Pinned to **v6** (classic) | v7 drops `url`/`directUrl` from the schema and forces `prisma.config.ts` + a driver adapter. v6 keeps the simpler `env()`-in-schema model CLAUDE.md assumes. |
| **Env files** | Secrets in `.env` (gitignored), template in `.env.example` | Both Prisma and Next read `.env`. `.gitignore` now ignores `.env*` except the example. |

## Next steps (Phase 1 backlog, by milestone)

- **Week 3–4** — 2FA (mandatory for Admin), password reset, Supabase RLS
  policies as the second auth layer; seed an initial admin user.
- **Week 5–8** — Worker & Client CRUD + document upload (Supabase Storage,
  signed URLs) + availability calendar.
- **Week 9–12** — Order creation (client) + admin review + availability
  matching engine + assignment workflow (+ unit tests for the matcher).
- **Week 13–14** — Service confirmation (signature pad + upload) writing to
  `ServiceConfirmation` with IP/timestamp through the [`audit`](lib/audit.ts) path.
- Email notifications via Resend (React Email templates) per the §8 matrix.
- Legal pages **in German**: `/impressum`, `/datenschutz` (linked from the footer).

## Conventions (see CLAUDE.md §9)

- No hardcoded user-facing strings — always go through `next-intl` catalogs.
- RTL-safe styling — use logical utilities (`ps-`, `pe-`, `ms-`, `me-`,
  `start-`, `end-`); never hardcode `left`/`right`.
- Validate all input with Zod at API boundaries; DB access only via Prisma.
- Every PII-touching action goes through `audit()`. No PII in logs.
