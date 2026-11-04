## Summary

Propniti v2 is one Next.js 16 app, compiled with vinext into a single Cloudflare Worker. It serves the marketing site, the staff app, four portals, the public listings site and every API route. Data lives in one D1 database: a shared, read-only base dataset plus a private overlay per visitor. Eight AI agents run inside the same Worker on a 15-minute Cron Trigger, on events and on demand. They change data only by proposing named actions that a person or an approval policy lets through.

Key choices:

- **Record types are defined once.** Each of the 64 record types is an `EntityDef`. The sidebar, ⌘K, list and record pages, the API, permissions and the SQL column whitelist all come from those definitions.
- **Agents act only through named actions.** Write tools create proposals. An approved proposal runs the same server action a person's click would, with the same scope and money checks.
- **Figures come from data.** Rules compute every number. A model words answers and suggests actions; model text with a figure the data doesn't contain is discarded.
- **Money rules run in SQL.** Each money action is one guarded D1 batch, and an idempotency key allows one live transfer per action.
- **Models sit behind one port.** Workers AI, Claude and OpenAI are interchangeable. With none configured, every AI feature runs on rules and says so.

Source: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

## Runtime

| Part | What it is |
| --- | --- |
| Worker | `property-mgmt-ai-prototype` on propniti.ai and www.propniti.ai. Entry `src/worker-entry.ts`: vinext's fetch handler plus a `scheduled()` handler |
| Cron Trigger | `*/15 * * * *`. Sends one internal request to `/api/ai/sweep` with a per-isolate token |
| CPU limit | 60 seconds per invocation |
| `DB` | D1 database `propniti-v2` |
| `AI` | Workers AI, the default model when no API key is set |
| `AI_RATE_LIMITER` | 20 requests a minute per IP on AI routes |
| `WRITE_RATE_LIMITER` | 60 writes a minute per IP |
| Secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_PROVIDER`; the placeholder `unset` counts as no key |
| Logs | Workers Logs: requests, errors and AI fallbacks |

**Platform port** (`src/lib/platform`). App code calls `getPlatform()` for the database, the model binding and the rate limiters. The Worker build uses the D1 adapter. The Node and Docker build opens a SQLite file and returns no AI binding, so it falls back to API-key providers or rules, and to in-memory rate limiters.

## Routes

| Area | Path | Notes |
| --- | --- | --- |
| Marketing and docs | `/`, `/pricing`, `/product/...`, `/security`, `/docs` | Static pages |
| Sign-in | `/login`, `/api/session` | A persona picker; sets the `pn_as` cookie |
| Staff app | `/app/...` | Static pages for homes and custom screens; `/app/[...path]` resolves every other path to a record type's list or record page |
| Portals | `/portal/owner`, `/portal/resident`, `/portal/vendor`, `/portal/applicant` | Each has its own `ask` route |
| Public site | `/listings`, `/listings/[id]`, `/apply/[listingId]` | Ask, tour and submit routes; no sign-in |
| Records API | `/api/e/[entity]`, `/[id]`, `/actions/[action]`, notes, tasks, documents, activity, `export.csv` | Generic reads and writes, scoped by persona |
| Metrics and views | `/api/metrics/[key]`, `/api/views` | KPI and chart data; saved views |
| AI API | `/api/ai/...` | Agents, runs (with a streaming trace), proposals, assistant, summaries, data health, policies, sweep, events, invoice reading, import mapping |

Old v1 routes (`/demo`, `/pm`, `/owner`, `/tenant`, `/vendor`, `/maintenance`, `/admin`, `/onboarding`) redirect to their v2 pages.

## Data: shared base and visitor overlay

All rows live in one database. Every table has a `workspace_id`.

| Layer | `workspace_id` | Contents |
| --- | --- | --- |
| Base | `base` | The generated sample portfolio: 30 properties, units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history, data issues. Read-only at runtime |
| Overlay | The visitor's id | Only the rows that visitor created or changed. A row with the same id replaces the base row; a `deleted = 1` row hides it |

- **Reading.** Queries read the effective rows: overlay rows, plus base rows the overlay doesn't replace. When a visitor has no overlay rows in a table, the query reads base directly. Append-only tables (transfers, audit) read both layers.
- **Workspace.** The HttpOnly cookie `pn_ws` holds a random id. The workspace row is created on the first write and expires at the next midnight Pacific. At most 30 new workspaces per IP an hour.
- **Demo clock.** "Today" is `AS_OF` (2026-11-04) plus the current Pacific time of day. Everything compared with data or shown to people uses this clock. Real time is used only for timeouts, rate limits, cron claims and settlement timers.
- **Schema.** `migrations/0002_v2.sql` defines 106 tables; 0003–0007 add indexes, stored balances, org usage and payment fields. Money is integer cents. References are indexed columns, not foreign keys, because an overlay row can point at a base row.
- **Loading the base.** A generator builds the dataset. Node and SQLite run it in process. For D1, `scripts/seed-d1.mjs` writes it as SQL, loaded with `wrangler d1 execute` at deploy time. Reloading the base wipes every overlay. Stored model summaries load from `.seed/ai-precompute.sql` when it exists.

## Record types and permissions

- **`EntityDef`** (`src/entities/types.ts`) describes a record type once: table, route, fields, list columns, KPIs, charts, tabs, actions, permissions, help text, data rules and AI facts. Modules register them in `src/entities/defs/<module>.ts`.
- **Named actions** (`src/extensions/*/actions.ts`), keyed `<entity>.<verb>`, carry workflow and money changes. Status and approval fields are `system` fields that only actions set. Ledger tables (charges, payments, credits, deposits, bank accounts and transactions, reconciliations, journal entries, owner distributions) accept actions only.
- **Locked records.** `lockedWhen` refuses edits and deletes of paid bills, sent renewal offers, decided concessions and ended leases.
- **Role × module matrix** (`src/auth/personas.ts`): none, read, write or approve, per role and module. A record type's own role lists narrow it.
- **Scope.** Every list, facet, metric and export filters to the persona's properties in SQL. Portal personas get only rows tied to their own record. The scope check runs inside the write batch, and every reference must point at a record in scope.
- **Paging.** 25, 50 or 100 rows a page (default 50), with keyset cursors where cheap. CSV exports stop at 10,000 rows.

## Money

`src/server/money.ts` holds rent payments, recorded payments, late fees, bill approval and payment, work-order approve-and-pay, owner distributions and adjustments, the $55 application fee, deposit dispositions, payment moves and returned payments.

- **One batch per action.** Its first statement inserts the transfer only if the SQL guards hold. Later statements run only if that transfer exists.
- **Idempotency.** A unique index allows one live transfer per key per workspace, and the guards also check base transfers. A double click creates one payment.
- **Trust balance** is recomputed in SQL.
- **Authority.** Each money action re-checks the role's approve right and the property scope. Maintenance spend over the owner threshold needs the owner's recorded approval.
- **Bank changes.** No bill or work-order payout while an unverified vendor bank change is open. A different person from the one who entered the change must verify it, read from the audit log.
- **Settlement.** A new transfer is Pending and clears 8 seconds later. Settlement runs at the start of a request (settle on read), at most 10 transfers per call.
- **Fee.** The 8% management fee comes from one constant, `MANAGEMENT_FEE_RATE`.
- **Ledger.** Payments apply to the oldest open charge first, and stored balances must match the ledger.

No money moves. Bank feeds, ACH and card payments are simulated.

## AI runtime

### Models

`src/ai/providers` picks one model per request: `AI_PROVIDER` if set, otherwise an Anthropic key (`claude-opus-5` by default), then an OpenAI key (`gpt-5.5`), then the Workers AI binding (`@cf/meta/llama-4-scout-17b-16e-instruct`). With none, every AI feature uses rules, labelled as such. A failed call falls back to rules for that answer and is logged.

### Agents

Eight agents are registered in `src/ai/agents`: Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health. Each has a goal, a tool allow-list, a schedule, the events it listens for, a default autonomy and the actions its proposals may run. Staff with approve rights can turn an agent on or off and change its autonomy on the Agents page; the change is stored in their overlay and audited.

Every agent runs the same loop (`framework.ts`):

1. **Collect.** Rules gather candidates through logged tool calls.
2. **Model.** If a model is configured, it investigates with the same read tools, drafts messages and proposes. A guard accepts a proposal only if it matches a rules candidate, and takes amount, risk and confidence from the rules.
3. **Rules.** With no model, or if it fails or proposes nothing, the rules propose the candidates. Mandatory candidates (fraud, safety, legal) are always proposed.

**Tools** (`src/ai/tools`): `records.search`, `records.get`, `records.related`, `ledger.delinquency`, `ledger.lookup`, `metrics.monthly`, `metrics.explain_noi`, `data.issues`, `help.search`, `policy.lookup`, `messages.draft`, `actions.propose`, `data.propose_fix`, `actions.execute`. Inputs are zod-checked, each tool checks the caller's role, and read tools use the scoped query layer. Write tools never touch ledger tables.

### Orchestrator and triggers

`src/ai/orchestrator.ts` turns a trigger into an `agent_runs` row, runs the agent under a time limit, and records every step in `agent_steps`. The run page streams those steps over server-sent events.

| Trigger | How it starts |
| --- | --- |
| Schedule | The Cron Trigger posts to `/api/ai/sweep`. Each sweep does one unit of work: the events of one listening agent, or the most overdue scheduled agent, alternating when both wait |
| Run on visit | If no sweep has run for 17 minutes, the first AI request starts one in the background with a 15-second budget |
| Event | Actions write to the `events` outbox. The sweep also raises `charge.overdue` and `lease.expiring` from the demo calendar. A public application and a completed import drain their events right away |
| Run now | `POST /api/ai/agents/[key]/run` from the Agents page |
| Chat | Each assistant turn is a run of the `copilot` agent |

- **Claims.** The cron and visits claim separate sweep slots in one guarded update, so they never both run the same scheduled agent.
- **Workspaces.** Sweeps cover only visitor workspaces active in the last 30 minutes, at most 10. The shared base never gets runs.
- **Limits.** Each run has a deadline, a step limit and a 50-cent model budget. A run that hits its deadline keeps what it already did. Runs left "running" for 10 minutes are marked failed.

### Proposals and approvals

`proposeImpl` in `src/ai/runtime.ts` writes each proposal to `ai_proposals` with its run, step, reasons, evidence, confidence, risk, amount, source and a snapshot of the record.

- **Routing.** A proposal applies on its own only when the agent's autonomy is *Auto within policy*, the workspace is not the base, risk is Low, it is not always-human, and its amount is within the policy limit. Over the owner threshold it waits for the owner. Everything else waits for a person.
- **Deduplication.** One open proposal per agent, record and action.
- **Approval** (`src/ai/effects.ts`, `src/ai/http.ts`). The server re-checks scope, the record's key fields against the snapshot, the action's precondition and the approver's role. A guarded `ai_decisions` insert runs it once.

### Summaries, explanations and the assistant

- **Record summaries** (`src/ai/summaries.ts`). Facts come from the record type's `ai.facts`. A stored model summary is shown only while its facts equal the current facts; otherwise the rules sentence is written from the current figures. Labels: *Rules*, *Generated* or *Precomputed*.
- **Explain** (KPIs, statement lines, budget variances, what-if). Code computes the facts; a model words them only when every number it writes is in the facts.
- **Assistant** (`src/ai/assistant.ts`). Chat, actions and help modes over the agents' tools. Common questions are answered by rules from tool results. Any dollar figure in a model answer must appear in the tool output, or the rules answer is used. Action mode only proposes; each item waits for a person.
- **Prompt hygiene.** Records, documents, messages and questions are framed as data, never instructions, in every prompt. Model output is schema-validated.

## Security

The app has no real accounts and moves no real money. Main controls:

| Risk | Control |
| --- | --- |
| Reading or writing outside scope | Scope filters in SQL; scope checked inside the write batch; portal personas see only their own rows |
| Skipping a workflow step | System fields set only by actions; actions-only ledger tables; locked records |
| Double payment or overdraw | Guarded batches, idempotency keys, trust balance in SQL |
| Paying a changed bank account | Payment hold until a different person verifies the change |
| AI acting on data | Proposals only; registered actions only; re-checks before an approved proposal runs |
| Invented figures | Figures from rules; unsupported model figures rejected |
| AI cost | 20 AI calls a minute per IP; per-run deadline, step limit and budget |
| Cross-site writes | Same-origin check; HttpOnly, SameSite=Lax, Secure workspace cookie |
| Request abuse | 60 writes a minute per IP; streamed body caps (64 KB records, 16 KB AI, 4 MB uploads) |
| Uploads | File type from its signature (JPEG, PNG, WebP, PDF); read in memory and discarded |
| Cron route | Per-isolate token compared in constant time, or an admin session |
| Browser | CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy |

**Known gaps.**

- **No authentication.** Anyone can pick any persona, and the `pn_as` cookie is not a security boundary.
- **One key.** The workspace cookie is the only key to a visitor's changes.
- **Origin checks.** Six AI routes (`extract`, `validate`, `import-map`, `import-parse`, `nl-filter`, `report-spec`) have no origin check. They are rate limited and size capped.
- **Quotas.** There is no per-org AI quota.
- **Approval policies.** Only the owner threshold on maintenance spend is enforced in the money code; the other limits route proposals.
- **Generic edits.** Some fields are still editable through generic edits until their actions exist.

Full review: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Deployment and environments

| Environment | Runs on | Notes |
| --- | --- | --- |
| Local | `npm run dev` (Node, SQLite) or `npm run dev:vinext` (Workers runtime) | The cron can be triggered by hand under `dev:vinext` |
| Preview | Worker `propniti-v2-preview` | Shares the D1 database; no Cron Trigger, so only production sweeps |
| Production | Worker `property-mgmt-ai-prototype` | Deployed by hand from `main` with `npm run deploy:vinext`, after any remote migration |
| Container | `Dockerfile` | A standalone Next.js server with a SQLite file at `DATABASE_PATH` |

- **Rollback.** `wrangler rollback` returns to the previous Worker version.
- **CI** (GitHub Actions, on every push to `main` and every pull request): `npm ci`, then lint, type check and unit tests, the Next.js build and the Worker build. CI does not deploy.

## Tests and evals

| Check | Count | What it covers |
| --- | --- | --- |
| Unit tests (Vitest) | 580 in 68 files | Money, rules, parsing, scope, migrations on SQLite and local D1, the AI runtime and routes, including double-click tests for money actions |
| End-to-end tests (Playwright) | 47 in 12 specs | Each persona's main flows, the portals, the public site and the peek drawer; run against production after each deploy |
| Live AI evals | 15 case files | Agent and assistant behaviour against a live model, scored by fixed-rule graders (`npm run eval`) |

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Hosting | One Cloudflare Worker, with a Docker build as the portable path | Global deploy with a database, AI and rate limiting built in |
| Visitor data | Shared read-only base plus a private overlay, wiped at midnight Pacific | Every visitor gets a full portfolio without copying it; nobody changes anyone else's data |
| Demo date | `AS_OF` stays fixed; one demo clock | The data never runs ahead of or behind "today" |
| How agents change data | Proposals that run named actions | One set of scope, money and audit checks for people and agents |
| Autonomy | Two levels: Approve first, Auto within policy | Low-risk work can run alone; money, legal and safety never do |
| Trusting model output | Rules compute figures; the model words them | Numbers stay correct when the model is wrong or absent |
| Ledger | The lease ledger is the source of truth; payments apply oldest charge first | Stored balances always match the ledger |
| Application fee | $55 into the property's trust account as owner income | Matches how the fee is accounted for |
| Property NOI | The last closed month | The month in progress has a full month of rent against a few days of expenses |
