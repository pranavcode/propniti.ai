## Summary

Propniti is one Next.js 16 app. vinext compiles it into a single Cloudflare Worker. The Worker serves the marketing site, the staff app, four portals, the public listings site and every API route. Data lives in one D1 database. It holds a shared, read-only base dataset plus a private overlay per visitor. Eight AI agents run inside the same Worker. They run on a 15-minute Cron Trigger, on events and on demand. They change data only by proposing named actions. A person or an approval policy lets each one through.

Key choices:

- **Record types are defined once.** Each of the 64 record types is an `EntityDef`. The sidebar, ⌘K, list and record pages, the API, permissions and the SQL column whitelist all come from those definitions.
- **Agents act only through named actions.** Write tools create proposals. An approved proposal runs the same server action as a person's click. It passes the same scope and money checks.
- **Figures come from data.** Rules compute every number. A model words answers and suggests actions. The app discards model text with a figure the data doesn't contain.
- **Money rules run in SQL.** Each money action is one guarded D1 batch. An idempotency key allows one live transfer per action.
- **Models sit behind one port.** Workers AI, Claude and OpenAI are interchangeable. With none configured, every AI feature runs on rules and says so.

Source: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

![System architecture: browsers reach one Cloudflare Worker at propniti.ai, which serves pages and APIs, checks scope, runs the AI runtime, reads a D1 database with a shared base and per-visitor overlays, and calls models through one provider layer; a Cron Trigger starts the sweep every 15 minutes](/docs/architecture/system-architecture.svg#1000x560)

*System architecture. One Worker serves everything. Data is a shared read-only base plus a private overlay per visitor. Models sit behind one provider layer, with rules as the fallback.*

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
| Secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_PROVIDER`. The placeholder `unset` counts as no key |
| Logs | Workers Logs: requests, errors and AI fallbacks |

**Platform port** (`src/lib/platform`). App code calls `getPlatform()` for the database, the model binding and the rate limiters. The Worker build uses the D1 adapter. The Node and Docker build opens a SQLite file and returns no AI binding. It falls back to API-key providers or rules, and to in-memory rate limiters.

## Routes

| Area | Path | Notes |
| --- | --- | --- |
| Marketing and docs | `/`, `/pricing`, `/product/...`, `/security`, `/docs` | Static pages |
| Sign-in | `/login`, `/api/session` | Demo email and password form beside a compact list of the 13 people. The server checks the published password in constant time and sets the `pn_as` cookie (30 days). Works without JavaScript |
| Staff app | `/app/...` | Static pages for homes and custom screens (Inbox, My tasks, Automations, Copilot, Data health, reports, guided setup at `/app/onboarding`, settings). `/app/[...path]` resolves every other path to a record type's list or record page. Out-of-scope or unknown records show an in-app not-found page |
| Portals | `/portal/owner`, `/portal/resident`, `/portal/vendor`, `/portal/applicant` | Each has its own `ask` route |
| Public site | `/listings`, `/listings/[id]`, `/apply/[listingId]` | Ask, tour and submit routes; no sign-in |
| Records API | `/api/e/[entity]`, `/[id]`, `/actions/[action]`, notes, tasks, documents, activity, `export.csv`, `export.xlsx`, `export.pdf` | Generic reads and writes, scoped by persona |
| Downloads | `/api/export/report`, `/api/export/statement` | A report or an owner statement as CSV, Excel or PDF |
| Metrics and views | `/api/metrics/[key]`, `/api/views` | KPI and chart data; saved views |
| Import | `/api/import`, `/api/import/undo`, `/api/import/ai` | Commit a checked import as one batch, undo a batch, and the optional AI pass |
| Guided setup | `/api/onboarding`, `/api/onboarding/detect`, `/api/onboarding/check` | Save setup progress, the optional AI file detection, and Data Health over the imported records |
| Guide and alerts | `/api/guide`, `/api/notifications`, `/api/notifications/read` | Counts for the chat bubble's tips, *Right now* and the welcome screen; the bell's alerts and mark read |
| Help | `/app/help/<id>` | Shows the seeded help articles that definitions and assistant citations link to |
| AI API | `/api/ai/...` | Agents, runs (with a streaming trace), proposals, assistant, summaries, data health, policies, sweep, events, invoice reading |

Short paths redirect to their pages. `/demo` goes to `/login`. `/pm` and `/onboarding` go to `/app`; guided setup is `/app/onboarding`. `/owner`, `/tenant` and `/vendor` go to their portals. `/maintenance` goes to `/app/maintenance/work-orders`. `/admin` goes to `/app/settings`. `/app/settings/automations` goes to `/app/automations`.

**Links.** Every in-app link uses `@/components/Link`. It prefetches a page on hover, focus or touch, not for every visible link. A lint rule blocks importing `next/link` directly. Opening `/app` makes 2 prefetch requests. Prefetching every visible link would make 29.

## Data: shared base and visitor overlay

All rows live in one database. Every table has a `workspace_id`.

| Layer | `workspace_id` | Contents |
| --- | --- | --- |
| Base | `base` | The generated sample portfolio: 30 properties, units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history, data issues. Read-only at runtime |
| Overlay | The visitor's id | Only the rows that visitor created or changed. A row with the same id replaces the base row. A `deleted = 1` row hides it |

- **Reading.** Queries read the effective rows: overlay rows, plus base rows the overlay doesn't replace. When a visitor has no overlay rows in a table, the query reads base directly. Append-only tables (transfers, audit) read both layers. The overlay reads let SQLite and D1 use indexes.
- **Workspace.** The HttpOnly cookie `pn_ws` holds a random id. The app creates the workspace row on the first write. The row expires at the next midnight Pacific. Each IP can create at most 30 new workspaces an hour.
- **Demo clock.** "Today" is `AS_OF` (2026-11-04) plus the current Pacific time of day. Everything compared with data or shown to people uses this clock. Real time is used only for timeouts, rate limits, cron claims and settlement timers.
- **Schema.** `migrations/0002_v2.sql` defines 106 tables. Migrations 0003–0008 add indexes, stored balances, org usage and payment fields. 0008 adds indexes for household charges and the Data Health duplicate checks. Money is integer cents. References are indexed columns, not foreign keys, because an overlay row can point at a base row.
- **Loading the base.** A generator builds the dataset. Node and SQLite run it in process. For D1, `scripts/seed-d1.mjs` writes it as SQL. `wrangler d1 execute` loads that SQL at deploy time. Reloading the base wipes every overlay. Stored model summaries load from `.seed/ai-precompute.sql` when it exists.

## Record types and permissions


![Access model: persona, role, module permission and scope decide what is visible; writes re-check scope; agent proposals follow the decide rule, with life-safety items reserved for the regional manager or principal; portal personas are self-scoped](/docs/architecture/access-model.svg#1000x420)

*Who sees and does what. Scope filters every read in SQL. The decide rule sets who may approve each proposal.*

- **`EntityDef`** (`src/entities/types.ts`) describes a record type once. It covers table, route, fields, list columns, KPIs, charts, tabs, actions, permissions, help text, data rules and AI facts. Modules register them in `src/entities/defs/<module>.ts`.
- **Named actions** (`src/extensions/*/actions.ts`), keyed `<entity>.<verb>`, carry workflow and money changes. Status and approval fields are `system` fields that only actions set. Ledger tables accept actions only. These are charges, payments, credits, deposits, bank accounts and transactions, reconciliations, journal entries and owner distributions.
- **Locked records.** `lockedWhen` refuses edits and deletes of paid bills, sent renewal offers, decided concessions and ended leases.
- **Role × module matrix** (`src/auth/personas.ts`): none, read, write or approve, per role and module. A record type's own role lists narrow it.
- **Scope.** Every list, facet, metric and export filters to the persona's properties in SQL. Portal personas get only rows tied to their own record. The scope check runs inside the write batch. Every reference must point at a record in scope.
- **Paging.** 25, 50 or 100 rows a page (default 50), with keyset cursors where cheap. Downloads stop at 10,000 rows.

## Money

`src/server/money.ts` holds these money actions: rent payments, recorded payments, late fees, bill approval and payment, work-order approve-and-pay, owner distributions and adjustments, the $55 application fee, deposit dispositions, payment moves and returned payments.

- **One batch per action.** Its first statement inserts the transfer only if the SQL guards hold. Later statements run only if that transfer exists.
- **Idempotency.** A unique index allows one live transfer per key per workspace. The guards also check base transfers. A double click creates one payment.
- **Trust balance.** SQL recomputes it.
- **Authority.** Each money action re-checks the role's approve right and the property scope. Maintenance spend over the owner threshold needs the owner's recorded approval.
- **Bank changes.** No bill or work-order payout runs while an unverified vendor bank change is open. A different person from the one who entered the change must verify it. The check reads the audit log.
- **Settlement.** A new transfer is Pending and clears 8 seconds later. Settlement runs at the start of a request (settle on read). It handles at most 10 transfers per call. It skips the database until the next transfer is due.
- **Fee.** The 8% management fee comes from one constant, `MANAGEMENT_FEE_RATE`.
- **Ledger.** Payments apply to the oldest open charge first. Stored balances must match the ledger.

No money moves. Bank feeds, ACH and card payments are simulated.

## AI runtime

### Models

`src/ai/providers` picks one model per request. It uses `AI_PROVIDER` if set. Otherwise it tries an Anthropic key (`claude-opus-5` by default), then an OpenAI key (`gpt-5.5`). Last comes the Workers AI binding (`@cf/meta/llama-4-scout-17b-16e-instruct`). With none, every AI feature uses rules and labels its output that way. When a call fails, rules answer instead and the app logs the failure.

### Agents

`src/ai/agents` registers eight agents: Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health. Each has a goal, a tool allow-list, a schedule, the events it listens for, a default autonomy and the actions its proposals may run.

A principal, regional manager or admin can turn an agent on or off. They can also change its autonomy or schedule on the Agents or Automations page. `canEditPolicies` in `src/ai/policy-editors.ts` sets who may do this. `PATCH /api/ai/agents/[key]` and `/api/ai/policies/[id]` enforce it. The app stores the change in their overlay and audits it. `/app/automations` (`src/ai/automations.ts`) shows agents, sweep slots, waiting events and approval policies on one page.

Every agent runs the same loop (`framework.ts`):

1. **Collect.** Rules gather candidates through logged tool calls.
2. **Model.** If a model is configured, it investigates with the same read tools, drafts messages and proposes. A guard accepts a proposal only if it matches a rules candidate. The guard takes amount, risk and confidence from the rules.
3. **Rules.** The rules propose the candidates when there is no model, or when it fails or proposes nothing. Mandatory candidates (fraud, safety, legal) are always proposed.

**Tools** (`src/ai/tools`): `records.search`, `records.get`, `records.related`, `ledger.delinquency`, `ledger.lookup`, `metrics.monthly`, `metrics.explain_noi`, `data.issues`, `help.search`, `policy.lookup`, `messages.draft`, `actions.propose`, `data.propose_fix`, `actions.execute`. Zod checks every input. Each tool checks the caller's role. Read tools use the scoped query layer. Write tools never touch ledger tables.

### Orchestrator and triggers


![Agent run flow: six triggers start a run in the orchestrator; the agent collects candidates with read tools and an optional model; each proposal is routed by autonomy, policy limits and always-a-person rules; it applies on its own or waits for a person allowed by the decide rule; the registered action re-checks the record and runs once](/docs/architecture/agent-run-flow.svg#1000x622)

*How an agent run turns into a change. Agents only propose. Every change runs through a registered action, which re-checks scope and the record first.*

`src/ai/orchestrator.ts` turns a trigger into an `agent_runs` row. It runs the agent under a time limit and records every step in `agent_steps`. The run page streams those steps over server-sent events. `src/ai/trace.ts` turns each step into a plain sentence. It links the records the step touched by name, but fills in names only for records the viewer may see. Raw input and output stay under *Technical details*.

| Trigger | How it starts |
| --- | --- |
| Schedule | The Cron Trigger posts to `/api/ai/sweep`. Each sweep does one unit of work: the events of one listening agent, or the most overdue scheduled agent. When both wait, sweeps alternate |
| Run on visit | If no sweep has run for 17 minutes, the first AI request starts one in the background with a 15-second budget |
| Event | Actions write to the `events` outbox. The sweep also raises `charge.overdue` and `lease.expiring` from the demo calendar. A public application drains its events right away. `import.completed` waits for the next sweep. Five listened-for events (`coi.expiring`, `prospect.created`, `screening.completed`, `statement.closed`, `data_issue.detected`) have no source yet, and the Automations page says so |
| Run now | `POST /api/ai/agents/[key]/run` from the Agents page |
| Chat | Each assistant turn is a run of the `copilot` agent |

- **Claims.** The cron and visits claim separate sweep slots in one guarded update, so they never both run the same scheduled agent.
- **Workspaces.** Sweeps cover only visitor workspaces active in the last 30 minutes, at most 10. The shared base never gets runs.
- **Limits.** Each run has a deadline, a step limit and a 50-cent model budget. A run that hits its deadline keeps what it already did. The app marks runs failed when they stay "running" for 10 minutes.

### Proposals and approvals

`proposeImpl` in `src/ai/runtime.ts` writes each proposal to `ai_proposals`. The row holds its run, step, reasons, evidence, confidence, risk, amount, source and a snapshot of the record.

- **Routing.** A proposal applies on its own only when these all hold. The agent's autonomy is *Auto within policy*. The workspace is not the base. Risk is Low. The proposal is not always-human. Its amount is within the policy limit. Over the owner threshold, it waits for the owner. Everything else waits for a person.
- **Deduplication.** One open proposal per agent, record and action.
- **Approval** (`src/ai/effects.ts`, `src/ai/http.ts`). The server re-checks scope, the record's key fields against the snapshot, the action's precondition and the approver's role. A guarded `ai_decisions` insert runs it once.
- **One decision rule** (`src/ai/decide.ts`, enforced by `canDecide`). Buttons, *Needs you* counts and the server read the same rule. Life-safety items go only to the property's regional manager or the principal. The rule applies in the approvals inbox, the generic record action route (`/api/e/<entity>/<id>/actions/<action>`), Data Health and *Dispatch as suggested*. Some proposals the caller can't decide stay queued (202 with the proposal id). These are proposals that involve money, legal or safety, or aren't low risk. A refused low-risk proposal returns 403. Data Health fixes that touch money, fraud or legal status always queue, whoever clicks.

### Improve with AI

`src/components/app/ai/ImproveWithAI.tsx`. A red delinquency, occupancy or SLA KPI offers a panel. The panel shows drivers computed from the records and a plan of agent actions. It shows expected effects from history in scope. *Have agents do this* starts plan runs. Each takes a unique run id from the caller, so a double start fails. It keeps its input in the opening step. It skips the model loop. It considers only the plan's records that still qualify. Each card runs one plan at a time. Plan starts count against the AI rate limit. Proposals follow the normal approval rules.

### Inbox, tasks and import

- **Inbox** (`src/extensions/inbox`). The Inbox runs one scoped query per source. The sources are open conversations assigned to the persona or nobody, proposals the persona can decide, and the persona's notifications. A conversation shows *Needs reply* when the last message is inbound. Proposals use the same rule as `canDecide`. It shows 25 rows a page. The app caches the sidebar badge count for 30 seconds per workspace and persona. Decisions, replies and mark read clear the cache.
- **My tasks** (`src/extensions/intelligence/tasks.ts`, `my-tasks.ts`). It lists tasks assigned to the persona or to `role:<role>`, in scope. It groups them by the demo date. Mark done and reopen are named actions, idempotent and audited. A new task carries an idempotency key.
- **Import** (`src/extensions/import`). The browser parses files. The server takes only cleaned records (4 MB body, zod caps). It re-matches them to existing records. It creates only what the role may create at in-scope properties. The commit is one D1 batch whose first statement is a unique audit row, so a repeat writes nothing. Undo deletes only that batch's overlay rows. Undo is refused when any live row outside the batch points at one of its rows. The reference map comes from the migrations, and a test checks it. Undo is also refused when any row is outside the actor's scope. The optional AI pass gets headers, 5 sample rows and up to 30 flagged cells, at most 20,000 characters. It runs under the AI rate limit.

### Guided setup and downloads

- **Guided setup** (`src/extensions/onboarding`). It has five steps: company, data, rules, team, check. The org's settings store the progress. The browser sends saves one at a time (`oneAtATime` in `state.ts`), so a quick *Continue* can't overwrite a save in flight. File detection runs rules first (`detect.ts`: header presets and file names, with a confidence and reason). The optional model pass (`ai.ts`) sees file names, header rows and 3 rows per file, with cells cut to 60 characters. The model may only name a tool and record kind. Suggested approval limits and agent autonomy (`suggest.ts`) are medians and percentiles. Code computes them from the workspace's work orders, bills and rents; no model is involved. The steps call the existing import, policy, agent and user routes, so their permission checks apply. The principal, a regional manager or the admin may run setup. The principal can invite people but can't grant the admin role.
- **Downloads** (`src/extensions/export`, `src/lib/export`). One document model renders as CSV, XLSX or PDF. XLSX uses a minimal zip writer that keeps numbers and dates typed. PDF uses a small PDF writer. XLSX and PDF can carry an optional branded header and footer. List downloads reuse the list query. This way they carry the same permission, scope, filters and visible fields. Reports check the report roles. Statements check owner or staff access to the entity. Each route takes the write rate limit and stops at 10,000 rows. It neutralises cells that start like a spreadsheet formula.
- **Theme.** The `pn_theme` cookie holds *light* or *dark*. With no cookie, the OS decides. An inline script sets the class before the first paint on the app, the portals and `/docs`. This way a dark page never flashes light.

### Summaries, explanations and the assistant

- **Record summaries** (`src/ai/summaries.ts`). Facts come from the record type's `ai.facts`. The app shows a stored model summary only while its facts equal the current facts. Otherwise it writes the rules sentence from the current figures. Labels: *Rules*, *Generated* or *Precomputed*. A record with no summary offers *Summarize with AI*. It calls the same summary route and stores the result in the visitor's overlay.
- **Explain** (KPIs, statement lines, budget variances, what-if). Code computes the facts. A model words them only when every number it writes is in the facts.
- **Assistant** (`src/ai/assistant.ts`). It offers chat, actions and help modes over the agents' tools. The app stores conversations per persona and lists them in the panel's history menu. The base ships 28 sample conversations (ids `smp-…`). The rules assistant computed them over the base data, and they are marked *Sample*. A follow-up writes to the visitor's overlay only. *Ask about this* passes the record's facts by name. *Right now* reads the same counts as the chat bubble. Do mode can start an agent run. The *Ask Propniti* chat bubble (`src/components/app/guide`) opens the assistant with page-aware questions. It shows at most one data-backed tip at a time, from counts served by `/api/guide`. Rules answer common questions from tool results. Any dollar figure in a model answer must appear in the tool output, or the rules answer is used. Action mode only proposes. Each item waits for a person.
- **Prompt hygiene.** Every prompt frames records, documents, messages and questions as data, never instructions. A schema validates model output.

## Security

The app has no real accounts and moves no real money. Main controls:

| Risk | Control |
| --- | --- |
| Reading or writing outside scope | Scope filters in SQL; scope checked inside the write batch; portal personas see only their own rows; out-of-scope records look the same as missing ones |
| Skipping a workflow step | System fields set only by actions; actions-only ledger tables; locked records |
| Double payment or overdraw | Guarded batches, idempotency keys, trust balance in SQL |
| Paying a changed bank account | Payment hold until a different person verifies the change |
| AI acting on data | Proposals only; registered actions only; re-checks before an approved proposal runs; one `canDecide` rule on every path that runs a proposal, including Data Health and record actions |
| Leaking database internals | For D1 and SQLite errors, AI routes, Data Health results and run steps show "The database is busy; try again in a moment" (503). The detail goes to the server log. Model-provider errors are not masked |
| Imports | Role and scope checks per record type, payload caps, one locked batch, undo refused when other records depend on the batch |
| Invented figures | Figures from rules; unsupported model figures rejected |
| AI cost | 20 AI calls a minute per IP; per-run deadline, step limit and budget |
| Cross-site writes | Same-origin check on writes and on the AI routes the app calls. Read-only status and run-stream are exempt; precompute needs a token. HttpOnly, SameSite=Lax, Secure workspace cookie |
| Request abuse | 60 writes a minute per IP; streamed body caps (64 KB records, 16 KB AI, 4 MB uploads) |
| Uploads | File type from its signature (JPEG, PNG, WebP, PDF); read in memory and discarded |
| Cron route | Per-isolate token compared in constant time, or an admin session |
| Sign-in | Demo password compared in constant time (an unknown email takes as long), same-origin, rate limited, 4 KB body; `next` limited to `/app` and `/portal` paths |
| Browser | CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy |

**Known gaps.**

- **No authentication.** The demo password is published, so anyone can sign in as any persona. The `pn_as` cookie is not HttpOnly and is not a security boundary.
- **One key.** The workspace cookie is the only key to a visitor's changes.
- **Quotas.** There is no per-org AI quota.
- **Approval policies.** The money code enforces only the owner threshold on maintenance spend. The other limits only route proposals.
- **Generic edits.** Some fields have no named action. Generic edits can change them.

Full review: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Deployment and environments

| Environment | Runs on | Notes |
| --- | --- | --- |
| Local | `npm run dev` (Node, SQLite) or `npm run dev:vinext` (Workers runtime) | You can trigger the cron by hand under `dev:vinext` |
| Preview | Worker `propniti-v2-preview` | Shares the D1 database. It has no Cron Trigger, so only production sweeps |
| Production | Worker `property-mgmt-ai-prototype` | Deployed by hand from `main` with `npm run deploy:vinext`, after any remote migration |
| Container | `Dockerfile` | A standalone Next.js server with a SQLite file at `DATABASE_PATH` |

- **Rollback.** `wrangler rollback` returns to the previous Worker version.
- **CI** (GitHub Actions). CI runs on every push to `main` and every pull request. It runs `npm ci`, then lint, type check and unit tests, the Next.js build and the Worker build. CI does not deploy.

## Tests and evals

Measured on 4 November 2026.

| Check | Count | What it covers |
| --- | --- | --- |
| Unit tests (Vitest) | 1,279 in 141 files (1 skipped) | Money, rules, parsing, scope, migrations on SQLite and local D1, the AI runtime and routes, including double-click tests for money actions |
| End-to-end tests (Playwright) | 190 in 34 specs | Each persona's main flows, the portals, the public site, the peek drawer, sign-in, Inbox, My tasks, Automations, import, guided setup, downloads, action feedback, layout and theme, the chat bubble, assistant history, *Ask about this*, *Right now*, the welcome screen, readable runs, summaries, collapsible sections, bulk actions and approvals. After each deploy, the touched specs run against production |
| Live AI evals | 17 case files, 138 cases (86 live) | Agent and assistant behaviour against a live model, scored by fixed-rule graders (`npm run eval`) |

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Hosting | One Cloudflare Worker, with a Docker build as the portable path | Global deploy with a database, AI and rate limiting built in |
| Visitor data | Shared read-only base plus a private overlay, wiped at midnight Pacific | Every visitor gets a full portfolio without copying it. Nobody changes anyone else's data |
| Demo date | `AS_OF` stays fixed; one demo clock | The data never runs ahead of or behind "today" |
| How agents change data | Proposals that run named actions | People and agents pass one set of scope, money and audit checks |
| Autonomy | Two levels: Approve first, Auto within policy | Low-risk work can run alone; money, legal and safety never do |
| Trusting model output | Rules compute figures; the model words them | Numbers stay correct when the model is wrong or absent |
| Ledger | The lease ledger is the source of truth; payments apply oldest charge first | Stored balances always match the ledger |
| Application fee | $55 into the property's trust account as owner income | Matches how the fee is accounted for |
| Property NOI | The last closed month | The month in progress has a full month of rent against a few days of expenses |
| Sign-in | Demo accounts with one published password, plus one-click cards | Shows a real sign-in flow without pretending to be an account system |
| Import | Code parses, checks and writes; AI only suggests, and a person accepts | Imported records are correct whether or not a model is available |
| Prefetch | On hover or focus only | Prefetching every visible link would load D1 on each page view |
