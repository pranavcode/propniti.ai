## Summary

Propniti v2 is one Next.js 16 app, compiled with vinext into a single Cloudflare Worker. It serves the marketing site, the staff app, four portals, the public listings site and every API route. Data lives in one D1 database: a shared, read-only base dataset plus a private overlay per visitor. Eight AI agents run inside the same Worker on a 15-minute Cron Trigger, on events and on demand. They change data only by proposing named actions that a person or an approval policy lets through.

Key choices:

- **Record types are defined once.** Each of the 64 record types is an `EntityDef`. The sidebar, ⌘K, list and record pages, the API, permissions and the SQL column whitelist all come from those definitions.
- **Agents act only through named actions.** Write tools create proposals. An approved proposal runs the same server action a person's click would, with the same scope and money checks.
- **Figures come from data.** Rules compute every number. A model words answers and suggests actions; model text with a figure the data doesn't contain is discarded.
- **Money rules run in SQL.** Each money action is one guarded D1 batch, and an idempotency key allows one live transfer per action.
- **Models sit behind one port.** Workers AI, Claude and OpenAI are interchangeable. With none configured, every AI feature runs on rules and says so.

Source: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

![System architecture: browsers reach one Cloudflare Worker at propniti.ai, which serves pages and APIs, checks scope, runs the AI runtime, reads a D1 database with a shared base and per-visitor overlays, and calls models through one provider layer; a Cron Trigger starts the sweep every 15 minutes](/docs/architecture/system-architecture.svg#1000x560)

*System architecture. One Worker serves everything; data is a shared read-only base plus a private overlay per visitor; models sit behind one provider layer, with rules as the fallback.*

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
| Sign-in | `/login`, `/api/session` | Demo email and password form beside a compact list of the 13 people; the server checks the published password in constant time and sets the `pn_as` cookie (30 days). Works without JavaScript |
| Staff app | `/app/...` | Static pages for homes and custom screens (Inbox, My tasks, Automations, Copilot, Data health, reports, guided setup at `/app/onboarding`, settings); `/app/[...path]` resolves every other path to a record type's list or record page. Out-of-scope or unknown records render an in-app not-found page |
| Portals | `/portal/owner`, `/portal/resident`, `/portal/vendor`, `/portal/applicant` | Each has its own `ask` route |
| Public site | `/listings`, `/listings/[id]`, `/apply/[listingId]` | Ask, tour and submit routes; no sign-in |
| Records API | `/api/e/[entity]`, `/[id]`, `/actions/[action]`, notes, tasks, documents, activity, `export.csv`, `export.xlsx`, `export.pdf` | Generic reads and writes, scoped by persona |
| Downloads | `/api/export/report`, `/api/export/statement` | A report or an owner statement as CSV, Excel or PDF |
| Metrics and views | `/api/metrics/[key]`, `/api/views` | KPI and chart data; saved views |
| Import | `/api/import`, `/api/import/undo`, `/api/import/ai` | Commit a checked import as one batch, undo a batch, and the optional AI pass |
| Guided setup | `/api/onboarding`, `/api/onboarding/detect`, `/api/onboarding/check` | Save setup progress, the optional AI file detection, and Data Health over the imported records |
| Guide and alerts | `/api/guide`, `/api/notifications`, `/api/notifications/read` | Counts behind the chat bubble's tips, *Right now* and the welcome screen; the bell's alerts and mark read |
| Help | `/app/help/<id>` | Renders the seeded help articles that definitions and assistant citations link to |
| AI API | `/api/ai/...` | Agents, runs (with a streaming trace), proposals, assistant, summaries, data health, policies, sweep, events, invoice reading |

Old v1 routes (`/demo`, `/pm`, `/owner`, `/tenant`, `/vendor`, `/maintenance`, `/admin`, `/onboarding`) redirect to their v2 pages (`/onboarding` goes to `/app`; guided setup is `/app/onboarding`), and `/app/settings/automations` redirects to `/app/automations`.

**Links.** Every in-app link uses `@/components/Link`, which prefetches a page on hover, focus or touch instead of for every visible link. A lint rule blocks importing `next/link` directly. Opening `/app` went from 29 prefetch requests to 2.

## Data: shared base and visitor overlay

All rows live in one database. Every table has a `workspace_id`.

| Layer | `workspace_id` | Contents |
| --- | --- | --- |
| Base | `base` | The generated sample portfolio: 30 properties, units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history, data issues. Read-only at runtime |
| Overlay | The visitor's id | Only the rows that visitor created or changed. A row with the same id replaces the base row; a `deleted = 1` row hides it |

- **Reading.** Queries read the effective rows: overlay rows, plus base rows the overlay doesn't replace. When a visitor has no overlay rows in a table, the query reads base directly. Append-only tables (transfers, audit) read both layers. The overlay reads are written so SQLite and D1 use indexes.
- **Workspace.** The HttpOnly cookie `pn_ws` holds a random id. The workspace row is created on the first write and expires at the next midnight Pacific. At most 30 new workspaces per IP an hour.
- **Demo clock.** "Today" is `AS_OF` (2026-11-04) plus the current Pacific time of day. Everything compared with data or shown to people uses this clock. Real time is used only for timeouts, rate limits, cron claims and settlement timers.
- **Schema.** `migrations/0002_v2.sql` defines 106 tables; 0003–0008 add indexes, stored balances, org usage and payment fields (0008 adds indexes for household charges and the Data Health duplicate checks). Money is integer cents. References are indexed columns, not foreign keys, because an overlay row can point at a base row.
- **Loading the base.** A generator builds the dataset. Node and SQLite run it in process. For D1, `scripts/seed-d1.mjs` writes it as SQL, loaded with `wrangler d1 execute` at deploy time. Reloading the base wipes every overlay. Stored model summaries load from `.seed/ai-precompute.sql` when it exists.

## Record types and permissions


![Access model: persona, role, module permission and scope decide what is visible; writes re-check scope; agent proposals follow the decide rule, with life-safety items reserved for the regional manager or principal; portal personas are self-scoped](/docs/architecture/access-model.svg#1000x420)

*Who sees and does what. Scope filters every read in SQL; the decide rule sets who may approve each proposal.*

- **`EntityDef`** (`src/entities/types.ts`) describes a record type once: table, route, fields, list columns, KPIs, charts, tabs, actions, permissions, help text, data rules and AI facts. Modules register them in `src/entities/defs/<module>.ts`.
- **Named actions** (`src/extensions/*/actions.ts`), keyed `<entity>.<verb>`, carry workflow and money changes. Status and approval fields are `system` fields that only actions set. Ledger tables (charges, payments, credits, deposits, bank accounts and transactions, reconciliations, journal entries, owner distributions) accept actions only.
- **Locked records.** `lockedWhen` refuses edits and deletes of paid bills, sent renewal offers, decided concessions and ended leases.
- **Role × module matrix** (`src/auth/personas.ts`): none, read, write or approve, per role and module. A record type's own role lists narrow it.
- **Scope.** Every list, facet, metric and export filters to the persona's properties in SQL. Portal personas get only rows tied to their own record. The scope check runs inside the write batch, and every reference must point at a record in scope.
- **Paging.** 25, 50 or 100 rows a page (default 50), with keyset cursors where cheap. Downloads stop at 10,000 rows.

## Money

`src/server/money.ts` holds rent payments, recorded payments, late fees, bill approval and payment, work-order approve-and-pay, owner distributions and adjustments, the $55 application fee, deposit dispositions, payment moves and returned payments.

- **One batch per action.** Its first statement inserts the transfer only if the SQL guards hold. Later statements run only if that transfer exists.
- **Idempotency.** A unique index allows one live transfer per key per workspace, and the guards also check base transfers. A double click creates one payment.
- **Trust balance** is recomputed in SQL.
- **Authority.** Each money action re-checks the role's approve right and the property scope. Maintenance spend over the owner threshold needs the owner's recorded approval.
- **Bank changes.** No bill or work-order payout while an unverified vendor bank change is open. A different person from the one who entered the change must verify it, read from the audit log.
- **Settlement.** A new transfer is Pending and clears 8 seconds later. Settlement runs at the start of a request (settle on read), at most 10 transfers per call, and skips the database until the next transfer is due.
- **Fee.** The 8% management fee comes from one constant, `MANAGEMENT_FEE_RATE`.
- **Ledger.** Payments apply to the oldest open charge first, and stored balances must match the ledger.

No money moves. Bank feeds, ACH and card payments are simulated.

## AI runtime

### Models

`src/ai/providers` picks one model per request: `AI_PROVIDER` if set, otherwise an Anthropic key (`claude-opus-5` by default), then an OpenAI key (`gpt-5.5`), then the Workers AI binding (`@cf/meta/llama-4-scout-17b-16e-instruct`). With none, every AI feature uses rules, labelled as such. A failed call falls back to rules for that answer and is logged.

### Agents

Eight agents are registered in `src/ai/agents`: Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health. Each has a goal, a tool allow-list, a schedule, the events it listens for, a default autonomy and the actions its proposals may run. A principal, regional manager or admin can turn an agent on or off and change its autonomy or schedule on the Agents or Automations page (`canEditPolicies` in `src/ai/policy-editors.ts`, enforced by `PATCH /api/ai/agents/[key]` and `/api/ai/policies/[id]`); the change is stored in their overlay and audited. `/app/automations` (`src/ai/automations.ts`) reads agents, sweep slots, waiting events and approval policies into one page.

Every agent runs the same loop (`framework.ts`):

1. **Collect.** Rules gather candidates through logged tool calls.
2. **Model.** If a model is configured, it investigates with the same read tools, drafts messages and proposes. A guard accepts a proposal only if it matches a rules candidate, and takes amount, risk and confidence from the rules.
3. **Rules.** With no model, or if it fails or proposes nothing, the rules propose the candidates. Mandatory candidates (fraud, safety, legal) are always proposed.

**Tools** (`src/ai/tools`): `records.search`, `records.get`, `records.related`, `ledger.delinquency`, `ledger.lookup`, `metrics.monthly`, `metrics.explain_noi`, `data.issues`, `help.search`, `policy.lookup`, `messages.draft`, `actions.propose`, `data.propose_fix`, `actions.execute`. Inputs are zod-checked, each tool checks the caller's role, and read tools use the scoped query layer. Write tools never touch ledger tables.

### Orchestrator and triggers


![Agent run flow: six triggers start a run in the orchestrator; the agent collects candidates with read tools and an optional model; each proposal is routed by autonomy, policy limits and always-a-person rules; it applies on its own or waits for a person allowed by the decide rule; the registered action re-checks the record and runs once](/docs/architecture/agent-run-flow.svg#1000x622)

*How an agent run turns into a change. Agents only propose; every change runs through a registered action that re-checks scope and the record first.*

`src/ai/orchestrator.ts` turns a trigger into an `agent_runs` row, runs the agent under a time limit, and records every step in `agent_steps`. The run page streams those steps over server-sent events. `src/ai/trace.ts` turns each step into a plain sentence and links the records it touched by name, filling names only for records the viewer may see; raw input and output stay under *Technical details*.

| Trigger | How it starts |
| --- | --- |
| Schedule | The Cron Trigger posts to `/api/ai/sweep`. Each sweep does one unit of work: the events of one listening agent, or the most overdue scheduled agent, alternating when both wait |
| Run on visit | If no sweep has run for 17 minutes, the first AI request starts one in the background with a 15-second budget |
| Event | Actions write to the `events` outbox. The sweep also raises `charge.overdue` and `lease.expiring` from the demo calendar. A public application drains its events right away; `import.completed` waits for the next sweep. Five listened-for events (`coi.expiring`, `prospect.created`, `screening.completed`, `statement.closed`, `data_issue.detected`) have no source yet, and the Automations page says so |
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
- **One decision rule** (`src/ai/decide.ts`, enforced by `canDecide`). Buttons, *Needs you* counts and the server read the same rule; life-safety items go only to the property's regional manager or the principal. The approvals inbox, the generic record action route (`/api/e/<entity>/<id>/actions/<action>`), Data Health and *Dispatch as suggested* all apply it. A proposal the caller can't decide that involves money, legal or safety, or isn't low risk, stays queued (202 with the proposal id); a refused low-risk one returns 403. Data Health fixes that touch money, fraud or legal status always queue, whoever clicks.

### Improve with AI

`src/components/app/ai/ImproveWithAI.tsx`. A red delinquency, occupancy or SLA KPI offers a panel with drivers computed from the records and a plan of agent actions, with expected effects from history in scope. *Have agents do this* starts plan runs: each takes a unique run id from the caller (a double start fails), keeps its input in the opening step, skips the model loop and only considers the plan's records that still qualify. One plan per card at a time; plan starts count against the AI rate limit. Proposals follow the normal approval rules.

### Inbox, tasks and import

- **Inbox** (`src/extensions/inbox`). One query per source, all scoped: open conversations assigned to the persona or nobody (*Needs reply* when the last message is inbound), proposals the persona can decide (same rule as `canDecide`), and the persona's notifications. 25 rows a page. The sidebar badge count is cached for 30 seconds per workspace and persona and cleared by decisions, replies and mark read.
- **My tasks** (`src/extensions/intelligence/tasks.ts`, `my-tasks.ts`). Tasks assigned to the persona or to `role:<role>`, in scope, bucketed by the demo date. Mark done and reopen are named actions, idempotent and audited; a new task carries an idempotency key.
- **Import** (`src/extensions/import`). Files are parsed in the browser; the server takes only cleaned records (4 MB body, zod caps), re-matches them to existing records and creates only what the role may create at in-scope properties. The commit is one D1 batch whose first statement is a unique audit row, so a repeat writes nothing. Undo deletes only that batch's overlay rows, and is refused when any live row outside the batch points at one (the reference map is derived from the migrations and checked by a test) or any row is outside the actor's scope. The optional AI pass gets headers, 5 sample rows and up to 30 flagged cells, at most 20,000 characters, under the AI rate limit.

### Guided setup and downloads

- **Guided setup** (`src/extensions/onboarding`). Five steps (company, data, rules, team, check) with progress stored in the org's settings; the browser sends saves one at a time (`oneAtATime` in `state.ts`), so a quick *Continue* can't overwrite a save in flight. File detection runs rules first (`detect.ts`: header presets and file names, with a confidence and reason); the optional model pass (`ai.ts`) sees file names, header rows and 3 rows per file, cells cut to 60 characters, and may only name a tool and record kind. Suggested approval limits and agent autonomy (`suggest.ts`) are medians and percentiles computed from the workspace's work orders, bills and rents; no model is involved. The steps call the existing import, policy, agent and user routes, so their permission checks apply: the principal, a regional manager or the admin may run setup, and the principal can invite people but not grant the admin role.
- **Downloads** (`src/extensions/export`, `src/lib/export`). One document model rendered as CSV, XLSX (a minimal zip writer, numbers and dates kept typed) or PDF (a small PDF writer), with an optional branded header and footer on XLSX and PDF. List downloads reuse the list query, so they carry the same permission, scope, filters and visible fields; reports check the report roles; statements check owner or staff access to the entity. Each route takes the write rate limit, stops at 10,000 rows, and neutralises cells that start like a spreadsheet formula.
- **Theme.** The `pn_theme` cookie holds *light* or *dark*; with none, the OS decides. An inline script sets the class before the first paint on the app, the portals and `/docs`, so a dark page never flashes light.

### Summaries, explanations and the assistant

- **Record summaries** (`src/ai/summaries.ts`). Facts come from the record type's `ai.facts`. A stored model summary is shown only while its facts equal the current facts; otherwise the rules sentence is written from the current figures. Labels: *Rules*, *Generated* or *Precomputed*. A record with no summary offers *Summarize with AI*, which calls the same summary route and stores the result in the visitor's overlay.
- **Explain** (KPIs, statement lines, budget variances, what-if). Code computes the facts; a model words them only when every number it writes is in the facts.
- **Assistant** (`src/ai/assistant.ts`). Chat, actions and help modes over the agents' tools. Conversations are stored per persona and listed in the panel's history menu. The base ships 28 sample conversations (ids `smp-…`), computed by the rules assistant over the base data and marked *Sample*; a follow-up writes to the visitor's overlay only. *Ask about this* passes the record's facts by name; *Right now* reads the same counts as the chat bubble; Do mode can start an agent run. The *Ask Propniti* chat bubble (`src/components/app/guide`) opens it with page-aware questions and shows at most one data-backed tip at a time, from counts served by `/api/guide`. Common questions are answered by rules from tool results. Any dollar figure in a model answer must appear in the tool output, or the rules answer is used. Action mode only proposes; each item waits for a person.
- **Prompt hygiene.** Records, documents, messages and questions are framed as data, never instructions, in every prompt. Model output is schema-validated.

## Security

The app has no real accounts and moves no real money. Main controls:

| Risk | Control |
| --- | --- |
| Reading or writing outside scope | Scope filters in SQL; scope checked inside the write batch; portal personas see only their own rows; out-of-scope records look the same as missing ones |
| Skipping a workflow step | System fields set only by actions; actions-only ledger tables; locked records |
| Double payment or overdraw | Guarded batches, idempotency keys, trust balance in SQL |
| Paying a changed bank account | Payment hold until a different person verifies the change |
| AI acting on data | Proposals only; registered actions only; re-checks before an approved proposal runs; one `canDecide` rule on every path that runs a proposal, including Data Health and record actions |
| Leaking database internals | AI routes, Data Health results and run steps show "The database is busy; try again in a moment" (503) for D1 and SQLite errors; the detail goes to the server log. Model-provider errors are not masked |
| Imports | Role and scope checks per record type, payload caps, one locked batch, undo refused when other records depend on the batch |
| Invented figures | Figures from rules; unsupported model figures rejected |
| AI cost | 20 AI calls a minute per IP; per-run deadline, step limit and budget |
| Cross-site writes | Same-origin check on writes and on the AI routes the app calls (read-only status and run-stream excepted; precompute needs a token); HttpOnly, SameSite=Lax, Secure workspace cookie |
| Request abuse | 60 writes a minute per IP; streamed body caps (64 KB records, 16 KB AI, 4 MB uploads) |
| Uploads | File type from its signature (JPEG, PNG, WebP, PDF); read in memory and discarded |
| Cron route | Per-isolate token compared in constant time, or an admin session |
| Sign-in | Demo password compared in constant time (an unknown email takes as long), same-origin, rate limited, 4 KB body; `next` limited to `/app` and `/portal` paths |
| Browser | CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy |

**Known gaps.**

- **No authentication.** The demo password is published; anyone can sign in as any persona, and the `pn_as` cookie is not HttpOnly and not a security boundary.
- **One key.** The workspace cookie is the only key to a visitor's changes.
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
| Unit tests (Vitest) | 1,272 in 141 files (1 skipped) | Money, rules, parsing, scope, migrations on SQLite and local D1, the AI runtime and routes, including double-click tests for money actions |
| End-to-end tests (Playwright) | 190 in 34 specs | Each persona's main flows, the portals, the public site, the peek drawer, sign-in, Inbox, My tasks, Automations, import, guided setup, downloads, action feedback, layout and theme, the chat bubble, assistant history, *Ask about this*, *Right now*, the welcome screen, readable runs, summaries, collapsible sections, bulk actions and approvals; the touched specs run against production after each deploy |
| Live AI evals | 17 case files, 138 cases (86 live) | Agent and assistant behaviour against a live model, scored by fixed-rule graders (`npm run eval`) |

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
| Sign-in | Demo accounts with one published password, plus one-click cards | Shows a real sign-in flow without pretending to be an account system |
| Import | Code parses, checks and writes; AI only suggests, and a person accepts | Imported records are correct whether or not a model is available |
| Prefetch | On hover or focus only | Prefetching every visible link loaded D1 on each page view |
