# Onward Scout

**Your scout for every opportunity.** [onwardscout.com](https://onwardscout.com)

Onward Scout turns what a person already has (résumé, deck, portfolio, links) into a sourced profile, finds real opportunities they can win (jobs, internships, investors, accelerators, competitions, grants, fellowships, calls for papers, scholarships, residencies, awards…), prepares each application from their own facts, submits it when they tap, and follows up. CAPTCHAs, third-party logins, payments, signatures and interviews always stay with the person, as a short, explicit handoff.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4
- next-intl (English at `/`, Chinese at `/zh`, no middleware for public pages)
- Clerk (email-code sign-in) · Stripe (credits and subscription)
- Neon Postgres over HTTP + Drizzle ORM; a Postgres job queue for long tasks
- Cloudflare R2 (private files behind a signing worker) and Email Routing (mail worker)
- An `Intelligence` interface with three providers: `anthropic` (Claude), `local` (a deterministic engine that parses and composes from the user's own documents) and `mock` (tests)

## Getting started

Requires Node 24 (`.nvmrc`).

```bash
npm install
cp .env.example .env.local   # fill in what you have; most features degrade gracefully without keys
npm run db:generate          # only when the schema changed
node scripts/migrate.mjs     # applies ./drizzle to DATABASE_URL_UNPOOLED (skips without it)
npm run dev
```

Without a database the public site still renders; without Clerk keys the signed-in area answers 503; without `ANTHROPIC_API_KEY` the `local` intelligence engine is used.

## Checks

```bash
npx next typegen && npx tsc --noEmit
npx eslint .
npx vitest run               # no network, no paid APIs
npx next build
```

Tests never submit anything to a real third party: end-to-end submission targets the built-in sandbox form at `/sandbox/form`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/app/[locale]/(site)` | Public pages (static / ISR, no auth JavaScript) |
| `src/app/[locale]/(app)` | Signed-in app, checkout and admin (dynamic) |
| `src/app/api` | Route handlers (JSON, `Cache-Control: no-store`) |
| `src/lib/core` | Taxonomies (identities, industries, occupations, goals, opportunity types), playbooks, the application state machine |
| `src/lib/db/schema` | Drizzle schema (platform + product tables) |
| `src/lib/llm` | The intelligence layer and its providers |
| `src/lib/jobs` | Postgres queue, runner and handler registry |
| `src/lib/ingest` | File and URL ingestion (PDF, DOCX, PPTX, HTML, GitHub, ORCID) |
| `src/components` | Design system and app shell |
| `messages/<locale>` | Translations, one JSON file per namespace |
| `infra/workers` | Cloudflare workers (mail ingest, signed file access) |
| `drizzle` | SQL migrations |
