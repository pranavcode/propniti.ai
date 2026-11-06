## Summary

Propniti is one Next.js 16 app, compiled by vinext into a single Cloudflare Worker that serves the marketing site, staff app, four portals, public listings site and API. Data lives in one D1 database: a shared, read-only base plus a private overlay per visitor. Eight AI agents run in the same Worker on a 15-minute Cron Trigger, on events and on demand, and change data only by proposing named actions.

- Each of the 64 record types is defined once as an `EntityDef`, from which the sidebar, ⌘K, pages, API, permissions and SQL column whitelist are built.
- An approved agent proposal runs the same named server action, with the same checks, as a person's click.
- Rules compute every figure from the data. A model writes the wording of answers and suggests actions.
- Each money action is one guarded D1 batch, with one live transfer per idempotency key.
- Workers AI, Claude and OpenAI sit behind one provider port and are interchangeable. With none configured, AI features run on rules and are labelled **Rules**.

Source: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

![System architecture: browsers reach one Cloudflare Worker at propniti.ai, which serves pages and APIs, checks scope, runs the AI runtime, reads a D1 database with a shared base and per-visitor overlays, and calls models through one provider layer; a Cron Trigger starts the sweep every 15 minutes](/docs/architecture/system-architecture.svg#1000x560)

*When no model is configured or a call fails, rules answer.*

## Runtime

| Part | What it is |
| --- | --- |
| Worker | `property-mgmt-ai-prototype` on propniti.ai and www.propniti.ai. Entry `src/worker-entry.ts`: vinext's fetch handler plus `scheduled()` |
| Cron Trigger | `*/15 * * * *`, posting to `/api/ai/sweep` with a per-isolate token |
| CPU limit | 60 seconds per invocation |
| `DB` | D1 database `propniti-v2` |
| `AI` | Workers AI, the default model when no API key is set |
| `AI_RATE_LIMITER` | 20 requests a minute per IP on AI routes |
| `WRITE_RATE_LIMITER` | 60 writes a minute per IP |
| Secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_PROVIDER` (`unset` counts as no key) |
| Logs | Workers Logs: requests, errors and AI fallbacks |

App code reaches the database, model binding and rate limiters through `getPlatform()` (`src/lib/platform`). The Worker build uses D1. The Node and Docker build uses a SQLite file, API-key models or rules, and in-memory rate limiters.

## Routes

| Area | Path | Notes |
| --- | --- | --- |
| Marketing and docs | `/`, `/pricing`, `/product/...`, `/security`, `/docs` | Static pages |
| Sign-in | `/login`, `/api/session` | Sets the `pn_as` cookie (30 days) |
| Staff app | `/app/...` | Static pages for homes and custom screens; `/app/[...path]` resolves other paths to a record type's list or record page |
| Portals | `/portal/owner`, `/portal/resident`, `/portal/vendor`, `/portal/applicant` | Each has its own `ask` route |
| Public site | `/listings`, `/listings/[id]`, `/apply/[listingId]` | Ask, tour and submit routes; no sign-in |
| Records API | `/api/e/[entity]`, `/[id]`, `/actions/[action]`, notes, tasks, documents, activity, `export.csv`, `export.xlsx`, `export.pdf` | Scoped generic reads and writes |
| Downloads | `/api/export/report`, `/api/export/statement` | Reports and owner statements as CSV, Excel or PDF |
| Metrics and views | `/api/metrics/[key]`, `/api/views` | KPI and chart data; saved views |
| Import | `/api/import`, `/api/import/undo`, `/api/import/ai` | Commit, undo, optional AI pass |
| Guided setup | `/api/onboarding`, `/api/onboarding/detect`, `/api/onboarding/check` | Progress, AI file detection, Data Health check |
| Guide and alerts | `/api/guide`, `/api/notifications`, `/api/notifications/read` | Tip counts; alerts |
| Help | `/app/help/<id>` | Help articles |
| AI API | `/api/ai/...` | Agents, runs, proposals, assistant, summaries, data health, policies, sweep, events, invoice reading |

Short paths redirect: `/demo` → `/login`; `/pm` and `/onboarding` → `/app`; `/owner`, `/tenant`, `/vendor` → their portals; `/maintenance` → `/app/maintenance/work-orders`; `/admin` → `/app/settings`; `/app/settings/automations` → `/app/automations`.

In-app links use `@/components/Link`, which prefetches on hover, focus or touch only. A lint rule blocks importing `next/link` directly.

## Data: shared base and visitor overlay

Every table has a `workspace_id`.

| Layer | `workspace_id` | Contents |
| --- | --- | --- |
| Base | `base` | The generated sample portfolio: 30 properties, units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history, data issues. Read-only at runtime |
| Overlay | The visitor's id | Rows that visitor created or changed. A row with the same id replaces the base row; a `deleted = 1` row hides it |

- **Reading.** Queries read overlay rows plus the base rows they don't replace.
- **Workspace.** The HttpOnly cookie `pn_ws` holds a random id. The workspace is created on the first write and expires at the next midnight Pacific.
- **Demo clock.** "Today" is `AS_OF` (2026-11-04) plus the current Pacific time of day.
- **Schema.** `migrations/0002_v2.sql` defines 106 tables; 0003–0008 add indexes, stored balances, org usage and payment fields. Money is integer cents. References are indexed columns rather than foreign keys, since an overlay row can point at a base row.
- **Loading the base.** A generator builds the dataset. For D1, `scripts/seed-d1.mjs` writes SQL that `wrangler d1 execute` loads at deploy; stored model summaries come from `.seed/ai-precompute.sql`. Reloading the base wipes every overlay.

## Record types and permissions

![Access model: persona, role, module permission and scope decide what is visible; writes re-check scope; agent proposals follow the decide rule, with life-safety items reserved for the regional manager or principal; portal personas are self-scoped](/docs/architecture/access-model.svg#1000x420)

*Scope filters reads in SQL. The decide rule sets who may approve each proposal.*

- **`EntityDef`** (`src/entities/types.ts`) describes a record type: table, route, fields, list columns, KPIs, charts, tabs, actions, permissions, help text, data rules and AI facts. Modules register them in `src/entities/defs/<module>.ts`.
- **Named actions** (`src/extensions/*/actions.ts`), keyed `<entity>.<verb>`, carry workflow and money changes. Status and approval fields are `system` fields only actions set. Ledger tables (charges, payments, credits, deposits, bank accounts and transactions, reconciliations, journal entries, owner distributions) accept actions only.
- **Locked records.** `lockedWhen` refuses edits and deletes of paid bills, sent renewal offers, decided concessions and ended leases.
- **Role × module matrix** (`src/auth/personas.ts`): none, read, write or approve. A record type's own role lists narrow it.
- **Scope.** Reads filter to the persona's properties in SQL, and writes check scope inside the batch. Portal personas get only rows tied to their own record.
- **Paging.** 25, 50 or 100 rows (default 50), with keyset cursors where cheap. Downloads stop at 10,000 rows.

## Money

`src/server/money.ts` holds the money actions: rent payments, recorded payments, late fees, bill approval and payment, work-order approve-and-pay, owner distributions and adjustments, the $55 application fee, deposit dispositions, payment moves and returned payments.

| Rule | How |
| --- | --- |
| One batch per action | The first statement inserts the transfer only if the SQL guards hold; later statements run only if it exists |
| Idempotency | A unique index allows one live transfer per key per workspace, so a double click creates one payment |
| Trust balance | Recomputed in SQL |
| Authority | Each action re-checks approve rights and property scope. Maintenance spend over the owner threshold needs the owner's recorded approval |
| Bank changes | Bill and work-order payouts wait while an unverified vendor bank change is open. A different person must verify it |
| Settlement | A new transfer is Pending and clears 8 seconds later |
| Fee | 8% management fee from `MANAGEMENT_FEE_RATE` |
| Ledger | Payments apply to the oldest open charge first; stored balances must match the ledger |

Bank feeds, ACH and card payments are simulated.

## AI runtime

### Models

`src/ai/providers` picks one model per request: `AI_PROVIDER` if set, else an Anthropic key (`claude-opus-5` by default), then an OpenAI key (`gpt-5.5`), then the Workers AI binding (`@cf/meta/llama-4-scout-17b-16e-instruct`). With none, AI features use rules and label their output that way. A failed call falls back to rules and is logged.

### Agents

`src/ai/agents` registers eight agents: Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health. Each has a goal, a tool allow-list, a schedule, events and a default autonomy.

A principal, regional manager or admin can turn an agent on or off and change its autonomy or schedule (`canEditPolicies` in `src/ai/policy-editors.ts`, enforced by `PATCH /api/ai/agents/[key]` and `/api/ai/policies/[id]`). `/app/automations` (`src/ai/automations.ts`) shows agents, sweep slots, waiting events and approval policies.

The agent loop (`framework.ts`):

1. **Collect.** Rules gather candidates through logged tool calls.
2. **Model.** If configured, a model investigates with the same read tools, drafts messages and proposes. A guard accepts only proposals that match a rules candidate and takes amount, risk and confidence from the rules.
3. **Rules.** With no model, or when it fails or proposes nothing, the rules propose the candidates. Mandatory candidates (fraud, safety, legal) are always proposed.

**Tools** (`src/ai/tools`): `records.search`, `records.get`, `records.related`, `ledger.delinquency`, `ledger.lookup`, `metrics.monthly`, `metrics.explain_noi`, `data.issues`, `help.search`, `policy.lookup`, `messages.draft`, `actions.propose`, `data.propose_fix`, `actions.execute`. Inputs are zod-checked and role-checked. Read tools use the scoped query layer; write tools never touch ledger tables.

### Orchestrator and triggers

![Agent run flow: six triggers start a run in the orchestrator; the agent collects candidates with read tools and an optional model; each proposal is routed by autonomy, policy limits and always-a-person rules; it applies on its own or waits for a person allowed by the decide rule; the registered action re-checks the record and runs once](/docs/architecture/agent-run-flow.svg#1000x622)

*Agents only propose. A change runs through a registered action, which re-checks scope and the record first.*

`src/ai/orchestrator.ts` turns a trigger into an `agent_runs` row and records each step in `agent_steps`, which the run page streams over server-sent events. `src/ai/trace.ts` writes each step as a sentence with linked record names.

| Trigger | How it starts |
| --- | --- |
| Schedule | The Cron Trigger posts to `/api/ai/sweep`. Each sweep does one unit of work: one agent's events, or the most overdue scheduled agent |
| Run on visit | If no sweep has run for 17 minutes, the first AI request starts one with a 15-second budget |
| Event | Actions write to the `events` outbox; the sweep also raises `charge.overdue` and `lease.expiring` from the demo calendar. `coi.expiring`, `prospect.created`, `screening.completed`, `statement.closed` and `data_issue.detected` have no source yet |
| Run now | `POST /api/ai/agents/[key]/run` from the Agents page |
| Chat | Each assistant turn is a run of the `copilot` agent |

Sweeps cover up to 10 visitor workspaces active in the last 30 minutes, never the base. Each run has a deadline, a step limit and a 50-cent model budget.

### Proposals and approvals

`proposeImpl` in `src/ai/runtime.ts` writes each proposal to `ai_proposals` with its run, step, reasons, evidence, confidence, risk, amount, source and a snapshot of the record.

- **Routing.** A proposal applies on its own only if the agent is *Auto within policy*, the workspace isn't the base, risk is Low, it isn't always-human, and the amount is within the policy limit. Over the owner threshold it waits for the owner; everything else waits for a person.
- **Deduplication.** One open proposal per agent, record and action.
- **Approval** (`src/ai/effects.ts`, `src/ai/http.ts`). The server re-checks scope, the record's key fields against the snapshot, the action's precondition and the approver's role. A guarded `ai_decisions` insert runs it once.
- **Decision rule** (`src/ai/decide.ts`, enforced by `canDecide`). Buttons, *Needs you* counts and the server share it. Life-safety items go only to the property's regional manager or the principal. It applies in the approvals inbox, the record action route (`/api/e/<entity>/<id>/actions/<action>`), Data Health and *Dispatch as suggested*. A proposal the caller can't decide stays queued (202 with the proposal id) if it involves money, legal or safety or isn't low risk; a refused low-risk proposal returns 403.

### Improve with AI

`src/components/app/ai/ImproveWithAI.tsx`. A red delinquency, occupancy or SLA KPI offers drivers computed from the records, a plan of agent actions and expected effects from history. *Have agents do this* starts plan runs that skip the model loop and act only on records that still qualify. One plan runs per card at a time.

### Inbox, tasks and import

- **Inbox** (`src/extensions/inbox`). One scoped query per source: open conversations assigned to the persona or nobody, proposals the persona can decide (`canDecide`), and notifications.
- **My tasks** (`src/extensions/intelligence/tasks.ts`, `my-tasks.ts`). Tasks assigned to the persona or to `role:<role>`, in scope, grouped by the demo date. Mark done and reopen are idempotent, audited named actions.
- **Import** (`src/extensions/import`). The browser parses files; the server takes cleaned records (4 MB body), re-matches them and creates only what the role may create in scope. The commit is one D1 batch led by a unique audit row, so a repeat writes nothing. Undo deletes that batch's overlay rows unless live rows outside it point at them. The optional AI pass gets headers, 5 sample rows and up to 30 flagged cells.

### Guided setup and downloads

- **Guided setup** (`src/extensions/onboarding`). Five steps: company, data, rules, team, check. Progress lives in the org's settings. File detection runs rules first (`detect.ts`); the optional model pass (`ai.ts`) sees file names, header rows and 3 rows per file. Suggested limits and autonomy (`suggest.ts`) are medians and percentiles of the workspace's work orders, bills and rents. Steps call the existing import, policy, agent and user routes.
- **Downloads** (`src/extensions/export`, `src/lib/export`). One document model renders as CSV, XLSX or PDF, with an optional branded header and footer. List downloads reuse the list query, so they match the screen. Each route stops at 10,000 rows.
- **Theme.** The `pn_theme` cookie holds *light* or *dark*; without it, the OS decides.

### Summaries, explanations and the assistant

- **Record summaries** (`src/ai/summaries.ts`). Facts come from the record type's `ai.facts`. A stored model summary shows only while its facts equal the current ones; otherwise the rules sentence is used. Labels: *Rules*, *Generated* or *Precomputed*. *Summarize with AI* stores a new summary in the visitor's overlay.
- **Explain** (KPIs, statement lines, budget variances, what-if). Code computes the facts. A model may reword them but can't add a number that isn't in them.
- **Assistant** (`src/ai/assistant.ts`). Chat, actions and help modes over the agents' tools, with conversations stored per persona. The base ships 28 sample conversations (ids `smp-…`). *Right now* and the *Ask Propniti* chat bubble (`src/components/app/guide`) read counts from `/api/guide`. A dollar figure in a model answer must appear in the tool output, or the rules answer is used. Action mode only proposes.
- **Prompt hygiene.** Prompts frame records, documents, messages and questions as data, never instructions. A schema validates model output.

## Security

The app has no real accounts and moves no real money.

| Risk | Control |
| --- | --- |
| Reading or writing outside scope | Scope filters in SQL and inside the write batch; portal personas see only their own rows; out-of-scope records look like missing ones |
| Skipping a workflow step | System fields set only by actions; actions-only ledger tables; locked records |
| Double payment or overdraw | Guarded batches, idempotency keys, trust balance in SQL |
| Paying a changed bank account | Payment hold until a different person verifies the change |
| AI acting on data | Proposals only; registered actions only; re-checks before running; one `canDecide` rule on every path |
| Leaking database internals | D1 and SQLite errors show "The database is busy; try again in a moment" (503); detail goes to the server log |
| Imports | Role and scope checks per record type, payload caps, one locked batch, guarded undo |
| AI file detection | The model sees file names, headers and 3 rows per file, and may only name a tool and record type |
| Data Health fixes | Fixes touching money, fraud or legal status always queue for approval, whoever clicks (an admin's fixes too) |
| Granting access | The principal can invite people but can't grant the admin role, and only within their own scope |
| Spreadsheet injection | Downloads neutralise cells starting with `=`, `+`, `-` or `@` |
| Invented figures | Figures from rules; unsupported model figures rejected |
| AI cost | 20 AI calls a minute per IP; per-run deadline, step limit and budget |
| Cross-site writes | Same-origin check on writes and AI routes; HttpOnly, SameSite=Lax, Secure workspace cookie |
| Request abuse | 60 writes a minute per IP; body caps (64 KB records, 16 KB AI, 4 MB uploads) |
| Uploads | File type from its signature (JPEG, PNG, WebP, PDF); not stored |
| Cron route | Per-isolate token compared in constant time, or an admin session |
| Sign-in | Constant-time password check, same-origin, rate limited, 4 KB body cap; `next` limited to `/app` and `/portal` paths |
| Browser | CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy |

**Known gaps**

- No authentication. The demo password is published, and the `pn_as` cookie is not HttpOnly or a security boundary.
- The workspace cookie is the only key to a visitor's changes.
- No per-org AI quota.
- The money code enforces only the owner threshold on maintenance spend; other policy limits only route proposals.
- Some fields have no named action, so generic edits can change them.

Full review: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Deployment and environments

| Environment | Runs on | Notes |
| --- | --- | --- |
| Local | `npm run dev` (Node, SQLite) or `npm run dev:vinext` (Workers runtime) | Cron can be triggered by hand under `dev:vinext` |
| Preview | Worker `propniti-v2-preview` | Shares the D1 database; no Cron Trigger |
| Production | Worker `property-mgmt-ai-prototype` | Deployed by hand from `main` with `npm run deploy:vinext`, after any remote migration |
| Container | `Dockerfile` | Standalone Next.js server with a SQLite file at `DATABASE_PATH` |

`wrangler rollback` returns to the previous Worker version. CI (GitHub Actions) runs on pushes to `main` and pull requests: `npm ci`, lint, type check, unit tests, the Next.js build and the Worker build. It doesn't deploy.

## Tests and evals

| Check | Count | What it covers |
| --- | --- | --- |
| Unit tests (Vitest) | 1,279 in 141 files | Money, rules, parsing, scope, migrations on SQLite and local D1, the AI runtime and routes |
| End-to-end tests (Playwright) | 190 in 34 specs | Each persona's main flows, the portals, the public site, import, guided setup, downloads, the assistant and approvals |
| Live AI evals | 17 case files, 138 cases (86 live) | Agent and assistant behaviour against a live model, scored by fixed-rule graders (`npm run eval`) |

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Hosting | One Cloudflare Worker, with a Docker build as the portable path | Database, AI and rate limiting built in |
| Visitor data | Shared read-only base plus a private overlay, wiped at midnight Pacific | A full portfolio per visitor without copying it |
| Demo date | Fixed `AS_OF`; one demo clock | The data stays in step with "today" |
| How agents change data | Proposals that run named actions | People and agents pass the same scope, money and audit checks |
| Autonomy | Two levels: Approve first, Auto within policy | Low-risk work can run alone; money, legal and safety can't |
| Trusting model output | Rules compute figures; a model only writes the wording | If the model is wrong or down, figures still come from the rules |
| Ledger | The lease ledger is the source of truth; oldest charge paid first | Stored balances match the ledger |
| Application fee | $55 into the property's trust account as owner income | — |
| Property NOI | The last closed month | A partial month skews expenses |
| Sign-in | Demo accounts with one published password, plus one-click cards | Not an account system |
| Import | Code parses, checks and writes; AI only suggests | A model can suggest column matches but never writes a record |
| Prefetch | On hover or focus only | Keeps D1 load per page view low |
