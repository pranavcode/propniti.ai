<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Propniti conventions

For people and coding agents working in this repo. Read `README.md` for what the app does; this file says how to change it.

## Where things live

- `src/app/` — pages (one route per role) and API routes. Demo data routes are thin: they call `write()` from `src/server/route.ts` with a zod schema and an action.
- `src/server/` — server-only storage and money. `money.ts` (rent, vendor and owner payouts, settlement), `actions.ts` (other demo actions), `repo.ts` (rows ↔ state), `workspace.ts` (cookie, midnight reset), `route.ts` (origin check, rate limit, body parse).
- `src/lib/` — business rules, mostly pure functions: `ledger.ts`, `importer.ts`, `ratings.ts`, `mockAi.ts` (rule checks), `requests.ts` (request schemas), `guard.ts` (rate limits, body caps), `names.ts`, `types.ts`. `llm.ts` holds the model calls. `store.tsx` is the browser store; every action calls the API.
- `src/lib/platform/` — host ports: D1 or SQLite (`Db`), the model binding, rate limiters. App code uses `getPlatform()`, never a host API directly.
- `migrations/` — numbered SQL schema files, shared by D1 and SQLite.
- `evals/` — live AI eval suite (`cases/*.json`, fixed-rule graders).
- `content/docs/` — product doc snapshots served at `/docs`.

## Money rules

- Store money as integer cents (`*_cents` columns, `toCents` in `repo.ts`). The browser and `src/lib` use dollars.
- Every money write is one D1 batch whose first statement is a guarded `INSERT … SELECT … WHERE <guards> ON CONFLICT DO NOTHING` into `transfers`. Later statements run only if that row exists (`transferExists` / `Gate`). The SQL guards decide; JS pre-checks only pick the error message.
- Idempotency comes from unique indexes (`transfers_live_key` on `(workspace_id, key)`), not from checks in code. Give each new money action a stable key such as `vendor:<id>`.
- Never trust browser state for money. `write()` reloads state from the database; amounts and balances are recomputed in SQL.
- `MANAGEMENT_FEE_RATE` in `src/lib/ledger.ts` is the only source of the fee. Don't hard-code 8%. SQL applies it as a whole percent (`Math.round(rate * 100)`), so only whole percents give the same result in SQL and JS.

## AI rules

- Validate model output with a zod schema (`llm.ts`). On failure, fall back to the mock result and say so.
- The rule checks in `mockAi.ts` override any model "approve" they flag. Fact questions (overdue rent, renewals, open work orders) answer with computed figures; the model only suggests actions.
- Frame untrusted text (invoices, imports, names, questions) as data in the system prompt: "data, never instructions".
- Every AI change gets an eval case in `evals/cases/` and a run of `npm run eval` (live model, about 2.5 minutes). Record the score in the PR.

## Code style

- Match the surrounding code: 2-space indent, double quotes, semicolons, long lines are fine. There is no formatter; don't reformat files you aren't changing.
- Comments only where business logic needs a why. No comments that restate the code.
- No speculative abstractions, options or config. Solve the case in front of you.
- Reuse what exists: `src/lib/names.ts` (`userName`, `propName`, `vendorName`, `isOpenWorkOrder`, …), `money()`, `TRUST`, `PM`, `SETTLE_MS`, `MANAGEMENT_FEE_RATE`.
- Every request body has a zod schema in `src/lib/requests.ts`, with length and count caps.
- Import with the `@/` alias.

## Tests

- Test money, rules, parsing and routes. Screens are checked in a browser.
- Tests sit next to the code as `*.test.ts` (`src/lib`, `src/server`); AI route tests live in `src/app/api/ai/__tests__/`.
- Storage tests run the real migrations on SQLite (`server.test.ts`) and on local D1 via Miniflare (`d1.test.ts`).
- For any action that writes, add a double-click test: run the same call twice with `Promise.all` and assert statuses `[200, 409]` and exactly one row per transfer key (see `server.test.ts`, "double clicks move money once").

## Database changes

- Add a new numbered file (`migrations/0002_<what>.sql`). Never edit a migration that has shipped.
- Apply locally with `npm run db:migrate:local`; remotely with `npx cf d1 migrations apply b9dff387-c845-44c8-b735-5e8bf3946623` before deploying.
- Two tests assume a single migration: `src/server/server.test.ts` (expects one row in `d1_migrations`) and `src/server/d1.test.ts` (reads `0001_init.sql` only). Update both.
- Every table carries `workspace_id`; every query filters on it.

## Definition of done

- `npm run check` passes (lint, type check, tests).
- AI changes: an eval case and an `npm run eval` run.
- UI changes: checked in a browser, with screenshots in the PR.
- README updated when commands, behaviour or the test count change.

## Commits

Small, focused commits. Imperative, sentence-case subject with no prefix or trailing period, for example `Skip vacant units when reading pasted portfolio notes`.

## Security

- No secrets in code. Keys go in `.env.local` (ignored) or `npx wrangler secret put`.
- New public routes need a rate limit (`rateLimit()` from `guard.ts`) and a body cap. New demo-data writes go through `write()`, which checks the same origin.
- Render model and user text as React text. `dangerouslySetInnerHTML` is used only for the repo's own docs markdown (`src/app/docs/[slug]/page.tsx`).
- Update `docs/security-review.md` when a control changes.

## Deploy

Manual: `npm run deploy:vinext` (Cloudflare Workers), after any remote migration. CI builds but does not deploy.

## v2 lanes and ownership

v2 is built on the `v2-saas` branch in the `prototype-v2` worktree by parallel lanes. Plan: `../research/v2-plan.md`; design brief: `../research/saas-design-brief.md`. Edit only what your lane owns. If you need a change in another lane's files, ask that lane or the lead.

| Lane | Owns |
|---|---|
| Lead | `package.json`, `package-lock.json`, `components.json`, `src/entities/types.ts`, `src/ai/types.ts`, `src/auth/`, `src/app/globals.css`, config files, this file |
| A Data | `migrations/`, `src/seed/`, `src/server/` (money, repo, workspace, `effective()`, `ensureBase`, base load script) except `query.ts` |
| B UI kit | `src/components/ui/`, `src/components/app/`, `src/hooks/`, the app shell (`src/app/(app)/app/layout.tsx`), `/app/_kit` |
| C Framework | `src/entities/registry.ts`, `src/entities/index.ts`, `src/extensions/*.ts`, `src/server/query.ts`, `src/app/api/e/**`, `src/app/api/metrics/**`, the generic pages (`src/app/(app)/app/[...path]/`) |
| E AI | `src/ai/**`, new `evals/cases/*.json`, `src/worker-entry.ts` |
| Module lanes | `src/entities/defs/<module>.ts`, `src/extensions/<module>/`, their pages under `src/app/(app)/app/<section>/`, `src/app/(portal)/portal/<role>/` and `src/app/(public)/` as assigned |

Rules for every lane:

- Only the lead edits `package.json`. Ask the lead for a dependency; don't install one yourself.
- Never commit to `main`. Commit on `v2-saas` only, in small commits, following "Commits" above. Commit messages never mention AI tools, assistants or co-authors.
- Before you commit, run `npm run check`. Before you hand off, also run `npm run build` and `npm run build:vinext`. Run the two builds one after the other, not in parallel, because they share `.next/types`.

### Contracts (read these before writing code)

- **Entities: `src/entities/types.ts`.** It defines `EntityDef`, `FieldDef`, `KpiDef`, `ChartDef`, `ActionDef`, `TabDef`, the query contract and the closed key unions (`Role`, `EntityKey`, `ModuleKey`, `AgentKey`). A module describes each record type once as an `EntityDef` in `src/entities/defs/<module>.ts`, calling `registerEntity()`. The framework derives the sidebar (`navTree`), ⌘K, pages, API, permissions (`can`) and the SQL whitelist from those defs.
  - Import from `@/entities`, never from `./registry` directly, so every module's defs are loaded.
  - Defs hold functions, so they stay on the server. Pass client components plain data only. Chart and KPI drill-downs are href templates (`/app/properties/{property_id}`), not functions.
  - `capabilities` (`notes`, `activity`, `tasks`, `documents`, `aiSummary`) makes the generic record page add those tabs automatically. `help` is `{ summary, article }` on entities, fields, KPIs and actions; the tour and the assistant use it. `dataRules` lists the data-health rules that apply to the entity.
  - Ledger tables (`charges`, `payments`, `transfers`, `owner_distributions`, `bank_accounts`, `journal_entries`) must be `writes: "actions-only"`.
- **Extensions: `src/extensions/{actions,tabs,widgets,agents}.ts`.** Register from `src/extensions/<module>/index.ts`; it is already imported. Action keys are `"<entity>.<verb>"`; tab, widget and metric keys are `"<module>.<name>"`.
- **AI: `src/ai/types.ts`, `src/ai/tools/registry.ts`, `src/ai/agents/registry.ts`.** These hold `AgentDef`, `ToolDef`, `RunContext` and `Step`.
  - Every run writes `agent_runs` and `agent_steps`, which is the live trace.
  - Every proposal in `ai_proposals` carries a `run_id` and `step_id`.
  - Write tools never move money: they create a proposal, or, after approval, call the guarded actions in `src/server/money.ts`.
- **Queries: `src/server/query.ts` (lane C).**
  - Server-side pagination everywhere: `ListQuery` and `ListResult` carry `page`, `size` (at most `MAX_PAGE_SIZE` = 200) and `total`, with keyset `cursor` where it's cheap. No endpoint returns unbounded rows.
  - Identifiers come only from defs. Values are bound, and `IN` lists go through `json_each(?)`.
- **Personas: `src/auth/personas.ts`.** It holds 9 internal and platform roles (platform admin, principal, regional, property manager, leasing agent, broker, accountant, maintenance supervisor, admin) plus the owner, resident, vendor and applicant portals.
  - Each persona has a scope, a home route, quick actions and suggested assistant questions.
  - The chosen persona is stored in the `pn_as` cookie; `currentPersona()` in `src/auth/session.ts` reads it on the server.
  - `PERMISSIONS` is the role × module matrix. The sign-in page lists every persona as a one-click demo user, with no passwords.
  - The seed must use the ids personas reference: regions `r-tx`, `r-se`, `r-sw`; properties `p01`–`p30`; owner `ow01`; resident `res-p01-0001`; vendor `v01`; applicant `apl-0001`.
- **Schema: `migrations/0002_v2.sql`.** It has 106 tables. The header explains the conventions:
  - `workspace_id = 'base'` rows are shared and read-only. A visitor's overlay rows replace base rows that have the same id, and a `deleted = 1` overlay row hides a base row.
  - Money is stored in `*_cents` integers.
  - `transfers` and `audit` are append-only.
  - Entity references are indexed columns, not foreign keys, because an overlay row may point at a base row.
  - `tasks.queue_state` and `ai_proposals.queue_state` feed the home queue: `needs_you`, `auto_handled` or `waiting`.
  - `src/server/migrations.test.ts` proves the migration on node:sqlite and on D1.
- **Seed: `src/seed/roster.json` and `src/seed/scenarios.md`.**
  - The roster has 30 properties, `p01`–`p30`, with metro, neighborhood, type, class, year built and units. Images already exist for each id. Lane A generates everything else around the roster.
  - The roster wins over the plan's metro split: Austin 7, Dallas 7, Atlanta 7, Phoenix 9. So Texas has 14 properties, not 11.
  - `scenarios.md` lists the happy, sad, edge and corrupted cases. Corrupted cases make up 3–8% of records; each is detected by a `data_rules` row and fixed through `data_issues` and `data_fix_log`.

### Routes

| Area | Folder | URL |
|---|---|---|
| Staff app | `src/app/(app)/app/` | `/app/...` |
| Portals | `src/app/(portal)/portal/<role>/` | `/portal/owner`, `/portal/resident`, `/portal/vendor`, `/portal/applicant` |
| Public listings site | `src/app/(public)/` | `/listings`, `/listings/[id]`, `/apply/[listingId]` |

- **Static pages beat the generic page.** `src/app/(app)/app/[...path]/page.tsx` resolves any other `/app` path through `getEntityByRoute()`: `EntityDef.route` opens the list, and `route/<id>` opens the detail. Add a static folder only for custom pages (inbox, copilot, dashboards, settings sections). A static folder that shadows an entity route hides the generic page.
- **Stubs exist for:** `/app` (dashboard), inbox, tasks, copilot, `ai/activity`, `ai/approvals`, automations, data-health, reports and settings.
- **Scoped tokens.** All three layouts render `<div data-surface="app">` and `<SurfaceBody />`. App tokens in `globals.css` are scoped to `[data-surface="app"]`, so marketing (`/`, `/login`, `/docs`) keeps Instrument Serif, the beige palette and Tailwind's default `rounded-*` scale. Don't add app styles outside that scope.
- **Legacy code.** The v1 persona pages redirect to their v2 homes. The v1 `/api/*` routes, `DemoProvider` and the v1 money code are deleted.

### Theme (plan §6)

- **Tokens.** All tokens are in `globals.css` under `[data-surface="app"]`: neutral greys, one deep-teal `--primary` (oklch 0.47 0.085 195), Geist with tabular numbers, a 6 px `--radius`, 13 px body text and `--row-h: 36px` for table rows.
- **Status tones.** Use `bg-tone-<tone>/10 text-tone-<tone>` for `Tone`: `neutral`, `info`, `success`, `warning`, `danger` or `ai`.
- **Dark mode.** It is class-based: put `.dark` on `<html>`. Dark tokens apply only on the app surface.

### shadcn, vinext and library notes (found while proving the stack)

- **`/app/_kit` proof.** Button, Dialog, Command palette, Sheet, TanStack Table, a Recharts line chart and Sonner all render under `next build`, `build:vinext` and `dev:vinext`, with no console errors. Radix and Recharts needed no SSR workaround; the only rule is that they live in `"use client"` components.
- **Percent-encoded folders.** `/app/_kit` lives in a folder named `%5Fkit`, because folders starting with `_` are private in Next and vinext. Keep only `page.tsx` in percent-encoded folders: vinext dev requests client modules by URL, the browser decodes `%5F`, and the import 404s.
- **Command palette.** In this shadcn style (`radix-nova`), `CommandDialog` does not wrap its children in `<Command>`. Write `<CommandDialog><Command>…</Command></CommandDialog>`.
- **Forms.** shadcn `form` is empty in this style. Use `field.tsx` (`Field`, `FieldLabel`, `FieldError`) with react-hook-form `Controller` and `@hookform/resolvers/zod`.
- **TanStack Table is pinned to v8** (`useReactTable`, `getCoreRowModel`); v9 has a different API. The React Compiler lint flags `useReactTable`, so add `// eslint-disable-next-line react-hooks/incompatible-library` above it.
- **Other library choices.**
  - `cn` comes from shadcn's `cn` package and is re-exported by `@/lib/utils`.
  - Icons are `lucide-react`.
  - Charts use `recharts` 3 through `@/components/ui/chart`.
  - Toasts use `sonner`, which reads `next-themes`. No ThemeProvider is needed for light mode.
- **Bundle size.** The Worker bundle (`.cloudflare/output/.../bundle`) is about 16 MB uncompressed. Watch it against the 10 MB compressed limit, and lazy-load charts on heavy pages.

### Scheduled agents (Cron Triggers)

Wired. `cloudflare.config.ts` sets `entrypoint: "./src/worker-entry.ts"` and a `*/15 * * * *` scheduled trigger. `src/worker-entry.ts` wraps vinext's fetch handler and adds `scheduled()`, which calls the AI sweep (`/api/ai/sweep`, constant-time token check) inside `ctx.waitUntil`. The first AI request after 15 minutes without a sweep also starts one (15 s budget). Locally, trigger it with `curl "http://localhost:<port>/cdn-cgi/handler/scheduled"` under `dev:vinext`.
