<img src="public/favicon.svg" alt="Propniti logo" width="72" height="72">

# Propniti

**Property management software for US residential and commercial portfolios.**
Eight AI agents find routine work and propose what to do. A person approves anything that involves money, legal terms or safety.

Live demo: **[propniti.ai](https://propniti.ai)** · sample data, no sign-up.

![Marcus Bell's Today page: briefing, conversations waiting, data health and KPIs](public/img/marketing/shots/home.webp)

| AI agents | Data Health | What-if |
| --- | --- | --- |
| ![Agents page with eight agents and their runs](public/img/marketing/shots/agents.webp) | ![Data Health issues with suggested fixes](public/img/marketing/shots/data-health.webp) | ![What-if simulator on the portfolio](public/img/marketing/shots/what-if.webp) |

This README describes the code on `main`, which runs at propniti.ai. [PRODUCT.md](PRODUCT.md) has the product goals and principles. [AGENTS.md](AGENTS.md) has the code conventions.

## What it does

- **One record framework.** Each of the 64 record types in 13 modules is described once (`src/entities/defs/`). From those definitions, the framework builds list and record pages, the API, permission checks and search. It also builds downloads: CSV, Excel and PDF, with optional Propniti branding.
- **A sample portfolio.** 30 properties in Austin, Dallas, Atlanta and Phoenix, with leases, ledgers, work orders, bills and history. Some records are wrong on purpose, so Data Health has issues to find.
- **A simulated trust ledger.** Rent, fees, vendor bills, owner distributions and deposits move through guarded SQL. Every transfer has an idempotency key (a unique id), so a double click pays once. No real money moves.
- **AI agents with an audit trail.** Agents run every 15 minutes, on events and on request. Each run and step is stored and viewable. Agents propose; people approve.
- **Data Health.** Rules find bad records (duplicates, miscoded bills, rent typos, unverified vendor bank changes). Each fix shows before and after and is logged.

## Personas

Sign in on `/login` with a demo account, or click a person's card to fill the form. Accounts are `<persona id>@propniti.demo`, for example `marcus@propniti.demo`. Every account uses the password `propniti-demo`. `/login?as=<id>` prefills a person, and `next` deep links are kept. Each persona sees only its own scope.

| Persona | Role | Scope | Lands on |
| --- | --- | --- | --- |
| Daniel Reyes | Principal | All 30 properties | `/app` |
| Priya Shah | Regional manager | Texas | `/app` |
| Marcus Bell | Property manager | 3 Austin properties | `/app/today` |
| Lena Ortiz | Leasing agent | 3 Austin properties | `/app/leasing/today` |
| Rachel Moore | Broker | All properties | `/app/leasing/broker` |
| Grace Kim | Accountant | All owner entities | `/app/finance` |
| Tom Alvarez | Maintenance supervisor | Texas | `/app/maintenance` |
| Sam Okafor | Admin | Org settings | `/app/admin` |
| Nadia Brooks | Platform admin | All customer orgs | `/app/admin` |
| Helen Carter | Owner (portal) | Own entities | `/portal/owner` |
| Jordan Lee | Resident (portal) | Own lease | `/portal/resident` |
| Luis Ramirez | Vendor (portal) | Own jobs | `/portal/vendor` |
| Priyanka Rao | Applicant (portal) | Own application | `/portal/applicant` |

The public listings site (`/listings`) needs no persona.

## Modules

Portfolio, leasing, residents, maintenance, receivables, payables, accounting (banking, GL, budgets, reports), owners and statements, communications, risk and compliance, settings, platform, and intelligence (agents, approvals, AI activity, Data Health, copilot). Definitions live in `src/entities/defs/<module>.ts`. Custom actions, tabs, widgets and metrics live in `src/extensions/<module>/`.

## Quick start

Requires Node.js 24.

```bash
npm ci
npm run dev          # http://localhost:3000
```

On first start, `npm run dev` creates a SQLite file at `.data/propniti.db`, applies `migrations/` and generates the sample data. You don't need an AI key. Without one, agents and the assistant use rules and say so.

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Node, SQLite) |
| `npm run dev:vinext` | Dev server on the Cloudflare Workers runtime, with a local D1 database |
| `npm run db:migrate:local` | Apply `migrations/` to the local D1 database that `dev:vinext` uses |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:coverage` | Tests with a coverage report |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types, then type check |
| `npm run check` | Lint, type check and tests; run before every pull request |
| `npm run build` | Next.js production build |
| `npm run build:vinext` | Cloudflare Workers build |
| `npm run deploy:vinext` | Deploy to Cloudflare Workers |
| `npm run eval` | Live AI eval (see below) |

### Loading the sample data into D1

You load the sample data ("base") once per database, at deploy time, never per request. Loading it wipes every visitor's changes.

```bash
node scripts/seed-d1.mjs                                     # writes .seed/base.sql
npx cf d1 migrations apply <database-id>                     # schema
npx wrangler d1 execute <DB> --remote --file .seed/base.sql --yes
npx wrangler d1 execute <DB> --remote --file .seed/ai-precompute.sql --yes   # only if the file exists
```

For the local D1 that `dev:vinext` uses, run `npm run db:migrate:local`. Then run the same `execute` commands with `--local --persist-to .cloudflare/state` in place of `--remote`.

`scripts/ai-precompute.mjs` writes `.seed/ai-precompute.sql`. That file holds record summaries a model wrote ahead of time, so first views need no live call. Instructions are at the top of the script.

## How the data works

- Base rows have `workspace_id = 'base'` and are read-only at runtime. A visitor's changes are rows under their own workspace id. The HttpOnly cookie `pn_ws` holds that id. Reads return the visitor's rows plus every base row they haven't replaced (`src/server/effective.ts`).
- The app wipes each visitor's changes at midnight Pacific time.
- Money is stored in integer cents. Each money action is one guarded SQL batch (`src/server/money.ts`).
- Migrations `0001`–`0008` are in `migrations/`. D1 and SQLite share them.

## AI

The orchestrator and agents live in `src/ai`.

- **Triggers.** A Cron Trigger starts agents every 15 minutes (`src/worker-entry.ts`). Page visits start a sweep when the cron hasn't run. Events from the `events` outbox, "Run now" on `/app/agents` and assistant chat also start them.
- **Agents.** Collections, Leasing, Renewals, Maintenance triage, Payables, Data Health, Owner Reporting and Compliance. Rules find the candidates and compute every figure. When a model is configured, it picks and words the proposals. It may only choose from the candidates.
- **Approvals.** Some agents are set to "auto within policy". Their low-risk proposals apply at once. Everything else waits in `/app/ai/approvals`. Spend above an owner's threshold waits for the owner. Before an approved proposal runs, the server checks scope, the record's key fields and the action's precondition again.
- **Traces.** The app stores every run and step in `agent_runs` and `agent_steps`. Open a run at `/app/ai/runs/<id>`.
- **Labels.** Each AI output says whether it came from a live model, was precomputed, or came from rules.

### Providers

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Use Claude (default `claude-opus-5`; override with `ANTHROPIC_MODEL`) |
| `OPENAI_API_KEY` | Use OpenAI (default `gpt-5.5`; override with `OPENAI_MODEL`), when no Anthropic key is set |
| `AI_PROVIDER` | Force `anthropic`, `openai` or `workers-ai`. If the forced provider isn't configured, rules answer. Data is never sent to another provider |
| `TRUSTED_IP_HEADER` | Off Cloudflare only: the client-IP header your proxy sets, used for per-client rate limits |

On Cloudflare with no key, the model is Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`). It uses a JSON plan loop with one tool call per turn. Claude and OpenAI use native tool calling. If a call fails, the rules answer and the label says so.

## Tests, evals and coverage

Measured on 2026-11-04.

- **Vitest:** 1279 tests in 141 files: 1278 pass and 1 is skipped. They cover money, scope, the query layer, the seed generator, module actions, agents and the assistant. They also run migrations on SQLite and on local D1 (Miniflare). Each money action has a double-click test that must move money once.
- **Playwright:** 190 browser tests in 34 flows in `tests/e2e/`. There is one flow per module, plus portals and public listings. Other flows cover sign-in, Inbox, My tasks, Automations, import, the chat bubble, assistant history, the welcome screen and bulk actions. The tests run against a dev server at `BASE_URL` (default `http://localhost:3201`): `npx playwright test tests/e2e/<flow>.spec.ts`.
- **Coverage** (`npm run test:coverage`, scope `src/lib`, `src/server`, `src/app/api`): 70% of lines and 61% of branches. `src/ai` and `src/extensions` are outside that scope.

| Area | Lines | Branches |
| --- | --- | --- |
| Money actions (`server/money.ts`) | 98% | 76% |
| Workspaces (`server/workspace.ts`) | 100% | 90% |
| Query layer (`server/query.ts`) | 88% | 79% |
| Scope and permissions (`server/permissions.ts`) | 93% | 79% |
| Base and overlay reads (`server/effective.ts`) | 93% | 88% |
| Base load (`server/base.ts`) | 94% | 83% |
| Rate limits and body caps (`lib/guard.ts`) | 97% | 88% |
| Model calls (`lib/llm.ts`) | 82% | 64% |
| API routes (`app/api`) | 32% | 26% |

The `DemoState` helpers in `server/repo.ts` are in the coverage scope and mostly untested. They lower the totals.

### AI evals

`evals/cases/` holds 17 files with 138 cases. Every grader is a fixed rule. No model grades another.

- `npm run eval` sends 86 cases in 11 areas to a running app (`BASE_URL`, default `https://propniti.ai`). It writes [`evals/results/latest.md`](evals/results/latest.md). It exits 1 below `MIN_PASS` (default 0.8). It is not part of CI. A manual **AI eval** workflow runs it.
- 43 more cases (triage, drafts, data fixes, applicant scoring, resident replies) run inside `npm test`. They grade the rules output, with no model.
- The 9 invoice-vs-PO cases need the `/api/state` demo state. The app doesn't serve it, so these cases are skipped.

**Latest live run:** 2026-11-04 15:52 UTC, Workers AI on a local server, **74/86 (86%)**, above the 0.8 bar. Invoice reading, insurance declarations, the AI filter, record summaries, column mapping and pasted notes passed every case. Agent runs passed 4 of 8; the other 4 fell back to rules. Onboarding file detection scored 0/5 in that run. Run alone against the current file detection, those 5 cases passed 5/5. The full suite has not been run against it.

## Deploy

```bash
npx cf auth login
npx cf d1 migrations apply <database-id>
# load the base (see "Loading the sample data into D1")
npm run deploy:vinext
npx wrangler secret put ANTHROPIC_API_KEY   # optional
```

`cloudflare.config.ts` sets the Worker name, domains, the D1 binding and the Workers AI binding. It also sets two rate limiters (20 AI calls and 60 writes a minute per IP), the `src/worker-entry.ts` entry and the 15-minute Cron Trigger. The preview runs as a separate Worker with its own D1 database. To deploy it, change the name, domains and database id before `deploy:vinext`. Run remote migrations before deploying.

**Docker** (any container host):

```bash
docker build -t propniti .
docker run -p 3000:3000 -v propniti-data:/data propniti
```

Data is a SQLite file at `DATABASE_PATH` (default `/data/propniti.db`). The app migrates and seeds it on first start. There is no Cron Trigger off Cloudflare, so page visits start agents, at most once every 15 minutes.

## Limits of this demo

- Personas are demo accounts with one published password (`propniti-demo`), or a one-click card. There are no real accounts or stored passwords. Anyone can act as any persona.
- Payments are simulated in SQL. Transfers settle 8 seconds after they start. The app sends no SMS, email or voice.
- See [docs/security-review.md](docs/security-review.md) for the controls and known gaps.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability and [docs/security-review.md](docs/security-review.md) for the current review.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md); run `npm run check` before opening a pull request. Code conventions are in [AGENTS.md](AGENTS.md).

## License

[GNU Affero General Public License v3.0](LICENSE). You can use, modify and self-host Propniti. If you run a modified version as a network service, you must publish your changes under the same license.
