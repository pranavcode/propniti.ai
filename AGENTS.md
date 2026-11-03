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
- Apply locally with `npm run db:migrate:local`; remotely with `npx cf d1 migrations apply 3d4ff9d5-eb1e-4970-b73e-004ba9124fd8` before deploying.
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
