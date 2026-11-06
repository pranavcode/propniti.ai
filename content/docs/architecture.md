## Summary

Propniti is one Next.js 16 app, compiled by vinext into a single Cloudflare Worker that serves the marketing site, staff app, four portals, public listings site and API. Data lives in one D1 database: a shared, read-only base plus a private overlay per visitor. Eight AI agents run in the same Worker on a 15-minute Cron Trigger, on events and on demand, and change data only by proposing named actions.

- Propniti has 63 kinds of record, such as properties, leases and work orders. Each kind is described once in code. The app builds everything else for it from that one description: its sidebar link, its ⌘K search entry, its list and detail pages, its API, who may see or change it, and which database columns queries may read. In code this description is an `EntityDef` in `src/entities/defs/`.
- Agents only propose changes. When a person approves one, the app runs the same server action a person's click runs, with the same checks.
- Fixed rules compute every figure from the data. A model only writes the wording of answers and suggests actions.
- Each action that moves money is one group of database writes that land together or not at all. Checks inside the SQL decide whether it runs, and each transfer has a unique key, so a repeated click moves the money once.
- The app can use Workers AI, Claude or OpenAI. All three plug in the same way, so one can replace another. With none set up, AI features run on fixed rules and are labelled **Rules**.

Source: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

![System architecture: browsers reach one Cloudflare Worker at propniti.ai, which serves pages and APIs, checks scope, runs the AI runtime, reads a D1 database with a shared base and per-visitor overlays, and calls models through one provider layer; a Cron Trigger starts the sweep every 15 minutes](/docs/architecture/system-architecture.svg#1000x560)

*When no model is configured or a call fails, rules answer.*

| Component | What it is | What it does here |
| --- | --- | --- |
| Browser | The visitor's web browser | Loads every page and calls every API on propniti.ai over HTTPS |
| Staff app | The signed-in workspace at `/app` | Records, queues, reports, AI and settings for the 9 staff roles |
| Portals | Self-service sites at `/portal/owner`, `/resident`, `/vendor` and `/applicant` | Show each person only their own records and let them pay, approve, report or apply |
| Public site | Listings and applications at `/listings` and `/apply` | Lets prospects browse units, ask questions and apply without signing in |
| Marketing and docs | Static pages at `/`, `/pricing`, `/security` and `/docs` | Describe the product and serve these docs |
| Cloudflare Worker · propniti.ai | Cloudflare Workers: serverless code that runs in Cloudflare's data centres, started per request, with no server to manage | Runs the whole app as one Worker, `property-mgmt-ai-prototype`, on propniti.ai and www.propniti.ai |
| Cron Trigger `*/15 * * * *` | Cloudflare Cron Triggers: a schedule that calls the Worker's `scheduled()` handler | Every 15 minutes, `scheduled()` in `src/worker-entry.ts` sends one internal request to `/api/ai/sweep`, which runs one unit of agent work |
| vinext (Next.js App Router) | A Vite-based build of the Next.js App Router that outputs a Worker | Serves pages and API routes |
| Scope and permissions | The role × module matrix in `src/auth/personas.ts` and the scope filters in the query layer | Decides what each persona can see and change; reads filter to the persona's scope in SQL |
| AI runtime | The orchestrator, 8 agents, assistant, summaries and Explain in `src/ai` | Runs agents within time, step and cost limits and turns their proposals into approval routing and named actions |
| Provider layer `src/ai/providers` | One interface over every model | Picks one model per request; when none answers, the rules do |
| Rate limiters | Cloudflare Rate Limiting bindings: per-key counters kept by Cloudflare and checked from Worker code | Cap AI routes at 20 requests a minute and writes at 60 a minute per IP (`AI_RATE_LIMITER`, `WRITE_RATE_LIMITER`). Counts are approximate, kept per Cloudflare location |
| ASSETS | Workers static assets: files uploaded with the Worker and served from Cloudflare's network | Serve built `/_next/static` files directly; the app serves images, fonts and docs files through the binding |
| D1 · propniti-v2 | Cloudflare D1: a managed SQLite database reached from the Worker through a binding | Holds all app data in one database |
| Shared base | Rows with `workspace_id = 'base'` | The sample portfolio of 30 properties that every visitor reads; read-only at runtime |
| Visitor overlay | Rows with the visitor's workspace id from the `pn_ws` cookie | Hold the visitor's own changes, replace base rows with the same id, and are wiped at midnight Pacific |
| Workers AI (default) | Cloudflare's hosted model inference, called through the `AI` binding | Runs Llama 4 Scout when no API key is set, and turns PDF invoices into text for it |
| Anthropic or OpenAI | Hosted model APIs reached with an API key | Answer instead of Workers AI when `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `AI_PROVIDER` is set |
| Rules fallback | Code that computes answers from the data | Answers when no model is configured or a call fails; output is labelled **Rules** |
| Arrows: HTTPS, SQL, sweep | The three connections | Browser requests to the Worker; queries from the Worker to D1; the cron's internal request into the AI runtime |

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

| Component | What it is | What it does here |
| --- | --- | --- |
| Persona | Who you are acting as, chosen at sign-in or from a one-click card | Stored in the `pn_as` cookie; sets your role, scope and home page |
| Role | One of 9 staff roles or 4 portal roles | Selects your row in the permission matrix |
| Module permission | none, read, write or approve, per role and module | Sets whether you can open, change or approve records in each module |
| Scope | platform, org, region, property or self | Sets which properties and records you can reach |
| What you see | The read side of access | Lists, metrics, charts, exports, search and the assistant filter to your scope in SQL; an out-of-scope record looks the same as a missing one |
| What you can do | The write side of access | Writes need entity rights and re-check scope inside the batch. Agent proposals follow the decide rule (`src/ai/decide.ts`): low risk with no amount needs write access; money, legal or safety needs approve access |
| Life-safety items | Proposals that touch life safety, including taking a vendor with open emergency or life-safety jobs off work | Only the property's regional manager or the principal can decide them |
| Portals are self-scoped | The scope for the 4 portal roles | Owners see their own entities and properties; residents their lease and household; vendors their jobs, invoices and certificates; applicants their application |
| Over the owner's limit | Maintenance spend above the owner's approval threshold | The owner decides in the portal, or a principal does |

- **`EntityDef`** (`src/entities/types.ts`) describes a record type: table, route, fields, list columns, KPIs, charts, tabs, actions, permissions, help text, data rules and AI facts. Modules register them in `src/entities/defs/<module>.ts`.
- **Named actions** (`src/extensions/*/actions.ts`), keyed `<entity>.<verb>`, carry workflow and money changes. Status and approval fields are `system` fields only actions set. Ledger tables (charges, payments, credits, deposits, bank accounts and transactions, reconciliations, journal entries, owner distributions) accept actions only.
- **Locked records.** `lockedWhen` refuses edits and deletes of paid bills, sent renewal offers, decided concessions and ended leases.
- **Role × module matrix** (`src/auth/personas.ts`): none, read, write or approve. A record type's own role lists narrow it.
- **Scope.** Reads filter to the persona's properties in SQL, and writes check scope inside the batch. Data Health issues, and proposals with no property, also show on records with no property (such as vendors) when the role can read that record type. Portal personas get only rows tied to their own record.
- **Paging.** 25, 50 or 100 rows (default 50), with keyset cursors where cheap. Downloads stop at 10,000 rows.

## Money

`src/server/money.ts` holds the money actions: rent payments, recorded payments, late fees, bill approval and payment, work-order approve-and-pay, owner distributions and adjustments, the $55 application fee, deposit dispositions, payment moves and returned payments.

| Rule | How |
| --- | --- |
| One batch per action | The first statement inserts the transfer only if the SQL guards hold; later statements run only if it exists |
| Idempotency | A unique index allows one live transfer per key per workspace, so a double click creates one payment |
| Trust balance | Recomputed in SQL |
| Authority | Each action re-checks approve rights and property scope. Maintenance spend over the owner threshold needs the owner's recorded approval |
| Bank changes | Bill and work-order payouts wait while an unverified vendor bank change is open. Approving the hold doesn't release them; only a callback by a different person does |
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

| Component | What it is | What it does here |
| --- | --- | --- |
| Schedule | The Cron Trigger, every 15 minutes | Starts a sweep that runs one agent's events or the most overdue scheduled agent |
| Run on visit | A fallback in `src/ai/sweep.ts` | If no sweep has run for 17 minutes, the first AI request starts one with a 15-second budget |
| Events outbox | The `events` table, for example `charge.overdue` | Actions write events here; the sweep hands them to the agents that listen for them |
| Run now | A button on the Agents page | Starts one agent's run on demand |
| Do mode | The assistant's action mode in chat | Each turn is a run of the `copilot` agent; it can only propose |
| Improve with AI | A plan for a red KPI, run on chosen records | Starts plan runs that skip the model and act only on records that still qualify |
| Orchestrator `src/ai/orchestrator.ts` | The run manager | Writes `agent_runs` and `agent_steps` and enforces the deadline, step limit and 50-cent model budget |
| One of 8 agents | Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance or Data Health | Works through its goal with its own tool allow-list |
| 1 · Collect | The rules step | Finds candidates with scoped read tools |
| 2 · Model (optional) | A model call, when one is configured | Checks and words each case; a proposal must match a rules candidate |
| 3 · Rules | The fallback step | Proposes the candidates when there is no model or it fails; mandatory items (fraud, safety, legal) are always proposed |
| Proposal (`ai_proposals`) | A stored suggestion | Carries risk, amount, confidence, reasons, source label and a snapshot of the record |
| Routing | The autonomy and policy check | Weighs the agent's autonomy (Approve first or Auto within policy) and approval-policy limits; legal, safety and high-risk items always go to a person |
| Applies on its own | The automatic path | Low risk, within the limit, and the agent is Auto within policy |
| Waits for a person | The approval path | A person allowed by the decide rule decides; over the owner's limit, the owner does |
| Registered named action | The same server action a person's click runs | Re-checks scope, the record snapshot and the precondition, runs once, then writes effects, audit and activity |

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
- **Vendors on life-safety jobs** (`src/ai/life-safety.ts`). Setting a vendor to Inactive or Do not use while it has open emergency or life-safety work orders is a life-safety decision. The record API refuses it, and deleting the vendor, for other roles (403), and an agent proposal that does it goes to the regional manager or principal. A payment hold after a suspicious bank change is the exception: the accountant still decides it. If the vendor has such jobs when the hold is proposed or approved, the hold leaves it on work and taking it off work becomes a separate proposal.

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
| Leaking model provider errors | Model failures show "The AI service didn't respond. Try again in a minute." (503), or the assistant uses the rule-based answer and says so; detail goes to the server log |
| Imports | Role and scope checks per record type, payload caps, one locked batch, guarded undo |
| AI file detection | The model sees file names, headers and 3 rows per file, and may only name a tool and record type |
| Data Health fixes | Fixes touching money, fraud or legal status always queue for approval, whoever clicks (an admin's fixes too) |
| Granting access | The principal can invite people but can't grant the admin role, and only within their own scope |
| Spreadsheet injection | Downloads neutralise cells starting with `=`, `+`, `-` or `@` |
| Invented figures | Figures from rules; unsupported model figures rejected |
| AI cost | 20 AI calls a minute per IP (approximate, counted per Cloudflare location); per-run deadline, step limit and budget |
| Cross-site writes | Same-origin check in app code on writes and AI routes (`src/app/api/e/_lib/http.ts`, `src/ai/session.ts`); HttpOnly, SameSite=Lax, Secure workspace cookie |
| Request abuse | 60 writes a minute per IP (approximate, counted per Cloudflare location); body caps (64 KB records, 16 KB AI, 4 MB uploads) |
| Uploads | File type from its signature (JPEG, PNG, WebP, PDF); not stored |
| Cron route | Per-isolate token compared in constant time, or a session whose role approves on the AI module (principal, regional manager, property manager, broker, accountant, maintenance supervisor, platform admin) |
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

## Running on other clouds

Each Cloudflare service Propniti uses (`cloudflare.config.ts`), with the nearest service elsewhere.

| Cloudflare service (what Propniti uses it for) | AWS | Google Cloud | Azure | Self-hosted / other |
| --- | --- | --- | --- | --- |
| Workers (runs the app; vinext build) | ECS on Fargate running the Docker image, or Lambda behind CloudFront with an adapter such as OpenNext | Cloud Run | Azure Container Apps or App Service | The Docker image on a VM or Kubernetes; Fly.io, Render, Vercel or Netlify |
| D1 (SQLite database: shared base plus visitor overlays) | RDS or Aurora for PostgreSQL; or SQLite on an EBS volume for a single instance | Cloud SQL for PostgreSQL or AlloyDB | Azure Database for PostgreSQL | A SQLite file (already supported), Turso (libSQL) or PostgreSQL |
| Workers AI binding (default model; PDF to text) | Amazon Bedrock | Vertex AI | Azure AI Foundry (including Azure OpenAI) | Anthropic or OpenAI APIs with a key (already supported); Ollama or vLLM |
| Cron Triggers (agent sweep every 15 minutes) | EventBridge Scheduler | Cloud Scheduler | Azure Functions timer trigger or Container Apps jobs | cron, a systemd timer or a Kubernetes CronJob |
| Rate Limiting bindings (AI 20 a minute, writes 60 a minute, per IP) | AWS WAF rate-based rules; API Gateway throttling | Cloud Armor rate-limiting rules | Front Door WAF rate-limit rules or API Management | A Redis-backed limiter or nginx `limit_req` |
| Static assets (Workers assets) | S3 and CloudFront | Cloud Storage and Cloud CDN | Blob Storage and Front Door | The Node server serves `public/` itself; nginx or Caddy in front |
| Custom domains, TLS and CDN | Route 53, CloudFront and ACM certificates | Cloud DNS, Cloud CDN and Google-managed certificates on a load balancer | Azure DNS and Front Door managed certificates | Caddy or nginx with Let's Encrypt |
| Smart Placement (runs the Worker near the database) | Deploy the app in the database's region | Deploy the app in the database's region | Deploy the app in the database's region | Run the app next to the database |
| Workers Logs (requests, errors, AI fallbacks) | CloudWatch Logs | Cloud Logging | Azure Monitor (Log Analytics) | stdout to Grafana Loki, or OpenTelemetry |
| Secrets (`wrangler secret put`) | Secrets Manager or SSM Parameter Store | Secret Manager | Key Vault | Environment variables, a `.env` file or HashiCorp Vault |

What moving takes in this codebase:

- App code reaches the database, models and rate limiters only through `getPlatform()` (`src/lib/platform`). The Node version of that port already uses a SQLite file, API-key models and in-memory rate limiters, and the `Dockerfile` builds it with `next build` as a standalone Node server instead of the vinext Worker build. A single container with a SQLite volume runs with no code changes.
- A database other than SQLite needs a new `Db` adapter and a SQL port. Queries use SQLite's `?1` numbered parameters, `json_each`, `json_extract`, `julianday`, `date()` and `INSERT OR IGNORE`/`OR REPLACE`.
- Money code (`src/server/money.ts`) relies on `db.batch()` running its statements in order as one transaction, with no other write landing in between, as D1 does. The replacement must give each batch one transaction with serialized writes (for example SERIALIZABLE isolation with retry, or a lock per workspace), a changed-row count per statement, and the partial unique index `transfers_live_key`.
- `scheduled()` exists only on Workers. `/api/ai/sweep` accepts the token `scheduled()` keeps in memory, or a session whose role approves on the AI module, so an outside scheduler needs a shared secret check added to that route. Until then, Run on visit starts a sweep on the first AI request after 17 minutes.
- The in-memory rate limiters count per instance. With more than one instance, implement the `RateLimiter` port over a shared store such as Redis, or limit at the load balancer.
- Bedrock, Vertex AI, Foundry or a local model each need a provider in `src/ai/providers` and `src/lib/llm.ts`. Anthropic and OpenAI keys already work on any host.

## Tests and evals

| Check | Count | What it covers |
| --- | --- | --- |
| Unit tests (Vitest) | 1,306 in 143 files | Money, rules, parsing, scope, migrations on SQLite and local D1, the AI runtime and routes |
| End-to-end tests (Playwright) | 191 in 34 specs | Each persona's main flows, the portals, the public site, import, guided setup, downloads, the assistant and approvals |
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
