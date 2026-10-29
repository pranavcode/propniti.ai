## Summary

Propniti's design uses small, stateless domain services that run on any cloud. One AI orchestrator acts only through those services' APIs. The prototype at [propniti.ai](https://propniti.ai) runs the agent, AI, payment, rating and onboarding flows on a single Cloudflare Worker.

This document describes two layers. Each section says which one it covers.

| Layer | What it is | Status |
| --- | --- | --- |
| **Target architecture** | Production design: web and mobile clients, gateway and auth, five domain services, an agent layer, PostgreSQL, Redis, object storage, an event bus and an audit log, on Kubernetes in any major cloud | Designed |
| **Prototype as built** | A Next.js 16 app compiled with vinext into one Cloudflare Worker. Demo data, the simulated ledger and ratings live in a server database (Cloudflare D1), one private workspace per visitor. Six AI routes use Workers AI as the default model | Live at [propniti.ai](https://propniti.ai), source at [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0) |

Key choices:

- **The agent never touches data directly.** It calls the same service APIs as the apps, so permissions, validation and the audit trail apply to it too.
- **Models sit behind one port.** Workers AI, Claude and OpenAI are interchangeable adapters. Configuration picks one. A rule-based policy check can overrule any of them.
- **Money moves only after a person approves it** in V1. It flows through a double-entry ledger with idempotent transfers, so a retry never pays twice.
- **No host lock-in.** Application code talks to PostgreSQL, Redis, the S3 API, NATS and HTTP. Host-specific services sit behind a platform port.

## Design principles

Seven principles shape every component. The prototype already follows four of them.

| Principle | How it is applied | Prototype |
| --- | --- | --- |
| Separation of concerns | Clients render, services own data, the agent decides, the policy engine gates; no layer reaches past the next | Yes: UI, API routes, `llm.ts` (decisions), `mockAi.ts` (rules) are separate modules |
| Ports and adapters | Model providers and host services (AI, rate limiter) sit behind interfaces; adapters are swapped by configuration or build alias | Yes: model provider selection in `llm.ts`; `src/lib/platform` with a Workers adapter (D1, AI, rate limiters) and a Node default (SQLite file) |
| Defence in depth | Input schemas, size caps, file-signature checks, rate limits, schema-validated model output, a rule-based policy check, and human approval for money | Yes: approvals and payment limits are enforced on the server; no role checks yet |
| Least privilege | The agent runs with the permissions of the manager it acts for; write tools only queue actions; secrets live in the platform secret store | Partly: no accounts yet; secrets via Cloudflare secrets |
| Stateless services | Services keep no session state; all state is in PostgreSQL, Redis or the event bus, so any instance can serve any request | Yes: the Worker keeps no state; demo data is in D1 |
| Idempotent payments | Every transfer carries an idempotency key; retries never create a second transfer; the ledger is append-only | Simulated on the server: a unique index allows one live transfer per key; production ledger designed |
| Single responsibility | Each service owns one domain and its tables; others reach it only through its API or events | Designed |

## Target architecture

*Target architecture.* Clients reach five domain services through one gateway. The agent layer sits beside them. It changes data only by calling those services, never the database.

![Portable services; the agent acts only through their APIs](/docs/architecture/target-architecture.svg#760x868)

The dashed box is designed but not built. The model port is the only path to model providers, so you can swap a provider without touching the agent.

| Layer | Component | Owns | Technology (portable) | AWS / GCP / Azure option |
| --- | --- | --- | --- | --- |
| Clients | Web app | Manager, owner and admin screens | React (Next.js) | Any container host or CDN |
| Clients | Mobile app | Tenant, maintenance and vendor tasks on site | React Native (Expo) | App stores |
| Edge | Ingress gateway | TLS, routing, auth checks, rate limits | Envoy Gateway or NGINX Ingress; Auth0 | Runs in any cluster |
| Services | Users + KYC | Profiles, roles, ID verification state | TypeScript service + Persona | Container |
| Services | Property | Properties, units, tenancies, agreements, work orders | TypeScript service | Container |
| Services | Payments | Invoices, ledger, transfers, payouts, 1099 data | TypeScript service + Stripe, Plaid | Container |
| Services | Notifications | Nudges on each person's channel, consent | TypeScript service + Twilio, SendGrid | Container |
| Services | Ratings (planned) | Ratings, comments, averages | TypeScript service | Container |
| Services | Scheduler | 15-minute sweeps, reminders | Kubernetes CronJob | Runs in any cluster |
| Agent | Orchestrator, tools, policy engine | Proposals, scores, decisions | TypeScript workers behind the model port | Container |
| Data | PostgreSQL, Redis, object storage, NATS, audit log | See Data and storage | Open protocols | RDS / Cloud SQL / Azure Database; ElastiCache / Memorystore / Azure Cache; S3 / GCS / Blob |
| Ops | Observability | Logs, metrics, traces, alerts | OpenTelemetry + Grafana | Grafana Cloud or self-hosted |

## Agent design

*Target architecture.* The orchestrator is a stateless worker. It turns a trigger into a proposed action and scores it. Then the policy engine decides whether the action runs, waits for a person, or stops.

**A run, step by step**

1. **Trigger.** A 15-minute schedule (Kubernetes CronJob) sweeps for due rent, expiring leases and stuck work orders. Events (a user question, an uploaded invoice, a reply to a nudge) arrive on NATS JetStream.
2. **Context.** The worker loads only what the job needs (tenancy, PO, history) through service APIs, scoped to the requesting manager.
3. **Model call.** The model port sends the job, the tool list and any document to the configured adapter. It requires output that matches a schema.
4. **Tools.** Each tool is a typed call to a service API: `lookup_*`, `validate_document`, `send_nudge`, `create_work_order`, `propose_payment` (queues only, never pays), `verify_identity`, `prepare_1099`.
5. **Result.** Structured output: proposed action, confidence from 0 to 1, evidence (fields matched, fields not matched, source documents).
6. **Policy.** Rules recheck the evidence. In V1 every payment waits for a person. If the rules contradict a model "approve", the decision becomes "review" with confidence capped at 0.6.
7. **Audit.** Input, tool calls, output and decision are appended to the audit log.

**Model provider port**

| Adapter | When used | Notes |
| --- | --- | --- |
| Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`) | Default on Cloudflare when no API key is set | Vision model; PDFs are converted to Markdown first; JSON mode plus schema validation |
| Claude (`claude-opus-5`, override with `ANTHROPIC_MODEL`) | When `ANTHROPIC_API_KEY` is set | Images and PDFs natively; structured outputs |
| OpenAI (`gpt-5.5`, override with `OPENAI_MODEL`) | When `OPENAI_API_KEY` is set | Images natively; PDFs not sent |
| Mock rules | No provider, or any provider call fails | Validation and assistant answers use the policy engine's rule set. Document reading returns no data. The UI labels the result "Mock AI" and says why |

Selection order: `AI_PROVIDER` if set (`anthropic`, `openai`, `workers-ai`, `mock`), then an Anthropic key, then an OpenAI key, then Workers AI, then mock. `AI_PROVIDER` always wins. If the forced provider isn't configured, the rule-based mock answers. The app never sends data to a different provider.

**Keeping hallucination in check:** schema-only outputs, evidence that the policy engine can verify, per-action confidence thresholds tuned from approve/reject history, and a weekly eval set that a model or prompt change must match before it ships.

**Grounding the assistant (prototype):** before calling the model, the server computes the facts a question is likely about (overdue rent, leases up for renewal, open work orders). It computes them from the portfolio snapshot and sends them with the question. For those fact questions, the figures in the answer always come from the computed facts, never from the model. The model only suggests next actions. The answer carries the note "Figures computed from your data; suggestions by AI." Other questions get the model's answer.

## Payments and ledger

*Target architecture designed; simulated in the prototype.* Rent lands in the manager's trust account. The 8% management fee and approved vendor bills come out, and the owner receives the rest. Every movement is a balanced ledger entry, and every transfer is idempotent.

![Rent flows through a trust account; each party sees its share](/docs/architecture/payment-flow.svg#760x576)

Worked example with the prototype's sample data: Riverside Lofts #204 pays $1,850; the fee is $148; the approved CoolAir HVAC invoice for WO-1041 is $635; owner Robert Chen receives $1,850 − $148 − $635 = $1,067.

| Step | Debit | Credit | Amount |
| --- | --- | --- | --- |
| Rent received | Trust cash | Owner payable (Robert Chen) | $1,850 |
| Management fee earned | Owner payable | Fee income (manager) | $148 |
| Vendor bill paid | Owner payable | Trust cash | $635 |
| Owner payout | Owner payable | Trust cash | $1,067 |
| Fee swept to operating account | Operating cash | Trust cash | $148 |

After the five entries, the owner payable and trust cash both return to zero. This is the reconciliation check, run nightly.

- **Idempotency.** Each transfer carries a key derived from its source (invoice id, work order id, statement month). A retry with the same key returns the original transfer instead of creating a second one.
- **States.** Initiated → Pending → Cleared, or Returned. A returned transfer is retried with the same key. The ledger posts only on Cleared.
- **Approval.** In V1 a person approves every payout. The agent can only propose (`propose_payment`).
- **Visibility.** Tenants see payments and receipts. Owners see statements (rent, fee, bills, payout). Vendors see payouts and year-to-date totals for 1099-NEC.
- **Prototype today:** the same flow runs as a simulation on the server, in D1, that mirrors the target API (below). No money moves.

**Prototype simulation** (`src/server/money.ts`, with the pure rules in `src/lib/ledger.ts`). The rules above run on the server. Each money action is one D1 batch, so it runs as one transaction. Its first statement inserts the transfer only if the guards hold. The later statements run only if that transfer exists. A unique index allows one live transfer per idempotency key, so a double-click creates one payment. You can try the flow end to end:

| Function | What it does | Target equivalent |
| --- | --- | --- |
| `payInvoice` | Inserts a Pending rent transfer (key `rent:<invoice>`, e.g. `rent:INV-2611-01`) only if the invoice is still Due or Overdue at the same amount. Marks the invoice Processing | Idempotent `POST /transfers` |
| `settle` | Runs at the start of every request (settle-on-read), not on a timer. Clears Pending transfers 8 seconds after they start (`SETTLE_MS`). When rent clears, the same batch marks the invoice Paid and moves the 8% fee from trust to the manager. When a vendor payout clears, its work order is marked Paid | ACH settlement webhook from the payment provider |
| `trustBalance` | Cleared in minus cleared out; available also subtracts pending payouts. The money guards recompute it in SQL | Ledger balance query |
| `ownerStatement` | Cleared rent on the owner's properties, less fees and vendor bills (pending or cleared), for items not yet in a payout | Statement service |
| `disburseOwner` | Pays the statement balance from trust, recomputed in SQL, and stamps the included items with the payout id. Refuses when nothing is owed or trust can't cover it. The browser's `Idempotency-Key` header is the transfer key | Owner payout + statement close |
| `approveWorkOrder` | Approves only a Submitted job whose invoice hasn't changed. Refuses if available trust is less than the invoice. Creates the vendor transfer (key `vendor:<work order>`) and moves the job to Payment pending (Paid once it settles) | Server-enforced approval with role check |
| `vendorPaidYtd` | A vendor's year-to-date total: the seeded baseline plus cleared payouts; feeds the 1099-NEC threshold | 1099 reporting query |

**Gap to production:** a server-side, append-only double-entry ledger in PostgreSQL (one row per debit and credit, balances derived, never edited); real ACH through Stripe and Plaid with webhook-driven state changes, including Returned; daily reconciliation of the trust account against the bank statement; role checks on every approval. The simulation records each transfer as a single row, not a debit/credit pair. It settles transfers only when a request arrives, not on a schedule.

## Ratings and feedback service

*Target architecture designed; simulated in the prototype.* A small service records a 1–5 rating and an optional comment after each completed interaction. It publishes rolling averages that other services read.

| Who rates | Whom | When | Shown to |
| --- | --- | --- | --- |
| Tenant | Maintenance staff or vendor | Work order closed | Manager; the rated person sees their average |
| Manager | Vendor | Invoice paid | Manager; vendor sees their average |
| Tenant | Property manager and property | Every 90 days, and at lease end | Manager and owner |
| Owner | Property manager | Each monthly statement | Manager |

- **One rating per interaction**, keyed by the work order, payment or statement id, so retries and double taps do not double-count.
- **Averages are events**, published on the bus. The agent raises an alert when a vendor or staff member's 30-day average falls below 3.5.
- **Comments pass a moderation check** (model plus word list) before the rated person sees them.

**Prototype simulation** (`src/lib/ratings.ts`): the server stores ratings in each visitor's demo workspace. `upsertRating` keeps one rating per person, subject and job (rating again replaces it). `ratingSummary` gives the average and count shown on profiles, property pages and the manager's Ratings tab. `lowRatings` turns any 1–2 star rating into a dashboard alert. Tenants rate completed jobs on their unit, their manager and their building. The manager rates the vendor or staff member on each paid work order. Not yet simulated: rolling 30-day averages, events on a bus and comment moderation.

## Data and storage

*Target architecture.* PostgreSQL is the system of record, including the ledger. Files live in S3-compatible object storage, and only their keys sit in the database.

| Store | Holds | Notes |
| --- | --- | --- |
| PostgreSQL 16 (managed) | Property, User, Vendor, CommChannel, UserPaymentDetail (tokens only), Agreement, Tenancy, UserNotification, Event, Invoice, Payment, Ratings | Each service owns its schema; row-level security per management company; daily snapshots and point-in-time restore |
| Ledger (in PostgreSQL) | Double-entry journal lines and transfers with idempotency keys | Append-only; balances are sums, never edited |
| Aggregate tables | Rent roll, arrears, portfolio stats, rating averages | Refreshed by the 15-minute sweep |
| Audit log | Every agent run and human approval | Append-only; exported to object storage nightly; 7-year retention |
| Redis | Sessions, hot reads, rate limits, job locks | Nothing stored only here |
| Object storage (S3 API) | Invoices, leases, job photos, ID documents | Encrypted with the cloud's KMS; presigned URLs; ID documents in a separate bucket |
| NATS JetStream | Domain events and agent jobs | At-least-once delivery; consumers are idempotent |

*Prototype.* Demo data lives in a server database. On Workers it is Cloudflare D1 (binding `DB`, database `propniti`). On Docker and Node it is a SQLite file opened with `node:sqlite` at `DATABASE_PATH`. Both use the same schema, `migrations/0001_init.sql`, and store money as integer cents. Every row carries a workspace id, and every query filters on it. Each visitor gets a private demo workspace, found by the HttpOnly cookie `pn_ws` and cloned from the seed. It is wiped at midnight Pacific time (`America/Los_Angeles`) and cloned again on the next visit. Reset re-seeds the same workspace. A `kind` column (`demo` or `org`) leaves room for real customer workspaces later. Uploaded invoices are read in memory and discarded.

| Table | Holds | Written by |
| --- | --- | --- |
| `workspaces` | One row per visitor: expiry, hashed creator IP, onboarding progress (bank, invites, rows imported, completed), next work-order number | Workspace creation, reset, onboarding steps |
| `properties`, `users`, `vendors`, `tenancies`, `invoices` | The portfolio | Seed data; onboarding import adds properties, tenants, tenancies and next month's invoices |
| `work_orders` | Jobs; PO, submission and AI validation result as JSON | Vendor, maintenance and manager actions |
| `transfers` | Simulated ledger: kind, from, to, amount in cents, property, status (Pending, Cleared, Returned), idempotency key, statement id | `payInvoice`, `approveWorkOrder`, `disburseOwner`, `settle` |
| `ratings` | 1–5 stars, comment, who, about whom, which job | `rate` |
| `notifications`, `audit` | Simulated messages per persona; every human and agent action. The newest 2,000 of each are kept | Every server action |

## Integrations

*Target architecture.* Each external need maps to one US provider behind its own adapter. We chose these providers to keep card, bank and identity data out of our systems.

| Need | Provider | Why | Prototype |
| --- | --- | --- | --- |
| Bank linking | Plaid | Instant account verification; hands a token to Stripe | Simulated |
| Rent collection (ACH, card) | Stripe | Holds card and bank data, keeping PCI DSS scope to SAQ A | Simulated |
| Vendor and owner payouts, 1099 | Stripe Connect | Payouts plus 1099 filing for connected accounts | Simulated |
| SMS, WhatsApp, voice | Twilio | One provider for three channels | Simulated (in-app inbox) |
| Email | SendGrid | Cloud-neutral, deliverability tooling | Simulated (in-app inbox) |
| Identity verification | Persona | ID and selfie checks for tenants and vendors | Status shown only |
| Property management systems | AppFolio, Buildium | Rent-roll export (CSV/TSV) import today; API sync of properties, tenancies and ledgers needs partner access | Export import built (AI column matching); API sync not built |
| Models | Workers AI, Anthropic, OpenAI | Behind the model port; switch by configuration | Live (Workers AI default) |

## Prototype as built

*Prototype.* A single Cloudflare Worker serves every page, six AI routes and 17 demo data routes. Demo data, the simulated ledger and ratings live in D1, one private workspace per visitor. Workers AI is the model unless an API key says otherwise.

![One Worker serves the pages, AI routes and demo data; data lives in D1](/docs/architecture/prototype-runtime.svg#760x672)

Every AI request passes the guards before the LLM module chooses a provider. The platform port is the only code that knows it runs on Cloudflare. The dashed path is used only when an API key is configured.

| Route | Method | Does | Guards | Model use |
| --- | --- | --- | --- | --- |
| `/api/ai/status` | GET | Reports which provider is active | None (no input) | None |
| `/api/ai/validate` | POST | Compares a work order's invoice with its PO; returns decision, confidence, evidence | Rate limit; zod schema; 256 KB cap | Model result, then rule-based policy check |
| `/api/ai/ask` | POST | Answers a question about the portfolio with suggested actions | Rate limit; zod schema; 256 KB cap; question ≤ 500 characters | Fact questions: figures always computed from the data, model adds suggested actions; other questions: model answer; rule-based answer as fallback |
| `/api/ai/extract` | POST (multipart) | Reads an invoice or bill image or PDF | Rate limit; 4 MB cap; file-signature check | Vision model (PDF via Markdown conversion); then consistency checks |
| `/api/ai/import-map` | POST | Matches a rent roll's column headers to Propniti's fields | Rate limit; zod schema (≤ 60 headers, ≤ 5 sample rows); 256 KB cap | Model mapping kept only for headers that exist; name-based matching fills gaps |
| `/api/ai/import-parse` | POST | Turns pasted free text into tenancy rows | Rate limit; zod schema (text ≤ 20,000 characters); 256 KB cap | Model rows; fallback reads a pasted table by column name |

**Demo data routes** (`src/server/route.ts`): one GET and 16 POST routes. Every POST checks, in order: same origin (403 otherwise), 60 writes a minute per IP (`WRITE_RATE_LIMITER`), a 64 KB body cap and a zod schema. It then finds or creates the workspace, settles due transfers, applies the action and returns the fresh state. One IP can create at most 5 new workspaces an hour.

| Route | Method | Does |
| --- | --- | --- |
| `/api/state` | GET | Returns the visitor's workspace after settling due transfers. Clients that never return the cookie get seed data, and no workspace is created |
| `/api/invoices/[id]/pay` | POST | Starts a rent payment (`payInvoice`) |
| `/api/work-orders/[id]/approve` | POST | Approves a submitted job and starts the vendor payout (`approveWorkOrder`) |
| `/api/owners/[id]/disburse` | POST | Pays an owner's statement (`disburseOwner`); takes an `Idempotency-Key` header |
| `/api/work-orders/[id]/submit`, `/attach`, `/validation`, `/request-changes`, `/update` | POST | Vendor invoice; AI-read invoice (consistency checks rerun on the server); validation result; send back; in-house job progress |
| `/api/issues`, `/api/nudges`, `/api/ratings` | POST | Tenant issue becomes a work order; nudge; rating |
| `/api/onboarding/import`, `/bank`, `/invite`, `/finish` | POST | Onboarding steps; imported rows are checked again on the server |
| `/api/demo/reset` | POST | Re-seeds the visitor's workspace |

**Provider selection** (`configuredProvider` in `src/lib/llm.ts`): `AI_PROVIDER` if set (it always wins: if the forced provider isn't configured, the app uses mock, never another provider) → Anthropic key → OpenAI key → Workers AI binding → mock. A failed call never breaks the page. The app falls back to the rule-based result with the note "Real AI API not configured: the … call failed". The server logs the cause.

**Platform port** (`src/lib/platform`): the Worker build points it to an adapter that returns the `DB`, `AI`, `AI_RATE_LIMITER` and `WRITE_RATE_LIMITER` bindings. The Node and Docker build uses a default that opens a SQLite file with `node:sqlite` and returns no AI or limiter binding. So the same code falls back to API-key providers or mock, and to in-memory rate limiters.

**Modules.** The browser shows state and posts actions. Business rules are plain functions with no UI code, so they are unit-tested. Server modules apply them and hold the SQL:

| Module | Responsibility |
| --- | --- |
| `store.tsx` | Browser side: shows the state each response returns; every action posts to an API route; refetches every 2 seconds while a payment is pending, and on window focus |
| `server/route.ts` | Shared write path: origin check, write limit, body cap, schema, workspace, settlement, action, fresh state |
| `server/workspace.ts` | Per-visitor workspace: `pn_ws` cookie, clone from seed, midnight Pacific expiry, reset, new-workspace cap per IP |
| `server/money.ts` | Rent, vendor approval, owner payout and settlement as guarded SQL batches |
| `server/actions.ts` | The other demo actions (jobs, invoices, ratings, import, onboarding), with row caps |
| `server/repo.ts` | Rows to demo state and back; keeps the newest 2,000 notifications, audit entries and ratings |
| `ledger.ts` | Transfer, settlement, trust balance, owner statement and payout rules as pure functions; the screens use the balance and statement |
| `ratings.ts` | One rating per person, subject and job; summaries; low-rating alerts |
| `importer.ts` | Strict CSV/TSV parsing (bad quoting and wrong-width rows rejected), header matching, row checks, existing-unit check at preview and again at import, commercial typing, merge into the portfolio |
| `mockAi.ts` | Rule-based invoice checks, computed facts for the assistant, mock answers |

87 unit tests in 11 files cover these modules, the AI provider logic and the API routes. The storage tests run the real migrations on SQLite, plus one test on a local D1 database (Miniflare). They include two identical requests at once (a double-click) creating one payment. Coverage of the logic and API code is 81% of lines and 75% of branches (table in the README).

**What is real and what is simulated**

| Real | Simulated |
| --- | --- |
| AI invoice reading, invoice-versus-PO validation, assistant answers, column matching and paste parsing (Workers AI on propniti.ai) | Sign-in and sign-up (UI only, no accounts) |
| Rate limiting, input validation, upload checks, security headers, server-side storage per visitor (D1) | Money movement: the trust-account ledger runs on the server and ACH “settles” after 8 seconds. No money moves |
| Ledger rules (idempotency, fee, statements, payout limits), rating rules and import checks: the same logic production would run | Bank linking (Plaid), SMS, WhatsApp, email and voice. Messages appear in each persona's in-app inbox |
| Six role views, detail pages, onboarding, audit log, demo persona switcher | Shared data: each visitor has a private workspace, wiped at midnight Pacific time |

## Invoice upload and validation flow

*Prototype.* The app rate-limits, size-caps and type-checks an uploaded invoice before any model sees it. Next the invoice is read into structured fields, checked for internal consistency, and discarded. The purchase-order comparison runs as a separate step.

![An upload is checked before the model sees it, and discarded after](/docs/architecture/invoice-upload-flow.svg#760x616)

The app decides the file type from its first bytes (JPEG, PNG, WebP or `%PDF-`), never from its name or the browser's MIME type.

**Consistency checks on the extracted invoice** (`checkInvoice` in `src/lib/mockAi.ts`)

| Check | Passes when |
| --- | --- |
| Document is an invoice or bill | The model says so |
| Vendor and invoice number present | Both fields are non-empty |
| Line items add up to the stated total | Within $1 or 1%, whichever is larger |
| Amounts in US dollars | Currency is USD, $ or blank |
| Legible enough to trust | Model confidence is 70% or more |

**Validation against the purchase order** (`/api/ai/validate`), after the vendor submits:

1. The rule check compares the total with the PO (a match within 2%) and the number of required photos. It also matches line items to PO items one to one. It groups them by the text before the first comma (ignoring case) and compares each group's summed amount. It sends the invoice to review if it has no line items, any negative amount, line items that don't add up to the total to the cent, or any PO item that wasn't billed.
2. The model gives its own decision (approve, review or reject), confidence and evidence.
3. If the model says approve but the rule check found any issue, the decision becomes review. Confidence is capped at 0.6, and each rule issue is added as "Policy check: …".
4. The manager approves and pays, or sends the work order back with the issues. Confidence of 85% or more with no issues allows one-tap approval.

Verified on the live site with the bundled samples: the clean CoolAir invoice passed 5 of 5 checks and validated as approve. The sample with problems was flagged because its lines total $905 against a stated $880.

## Onboarding import flow

*Prototype.* A manager brings a portfolio from another tool in one pass. The browser parses a rent-roll export. Only its header row and up to 5 sample rows go to the model, which matches columns. Pasted free text goes to the model, which turns it into rows. The app checks every row before it imports anything.

![Imported data is checked row by row before it reaches the portfolio](/docs/architecture/onboarding-import.svg#760x376)

| Step | Where | Detail |
| --- | --- | --- |
| Parse | Browser (`parseCsv`) | RFC 4180: quoted fields, escaped quotes, commas and line breaks inside quotes; tab-separated files too. CSV/TSV up to 2 MB; Excel files must be saved as CSV |
| Match columns | `/api/ai/import-map` | Model returns a header for each of 10 fields (property, address, unit, tenant, email, phone, rent, lease start, lease end, owner). A match is kept only if that header exists in the file and isn't already used. Name-based synonyms (e.g. “Rental name”, “Lease To”) fill any gaps. Without a model, synonyms alone are used |
| Read pasted text | `/api/ai/import-parse` | Model returns one row per tenancy, copying values as written and leaving unknowns empty; without a model, a pasted table is read by column name |
| Check rows | Browser (`validateRows`) | Errors skip a row: missing property, unit, tenant or rent; rent not a positive amount; dates that aren't real dates; lease ending before it starts; duplicate property + unit. Warnings don't: doubtful email, no lease end (month-to-month), rent above $50,000 |
| Import | Server (`importPortfolio`) | Properties reused by name or created; tenants, tenancies and next month's invoice added; leases ending within 45 days marked Renewal due; IDs unique across repeated imports. The server checks the rows again first and takes at most 200 per import |

The review step shows the matches as editable dropdowns. It also shows every row with its errors and warnings, so a person confirms the result before the portfolio changes.

## Security architecture

The prototype holds no accounts or real money. It keeps each visitor's demo data only until midnight Pacific time. So its main risks are abuse of the public AI and demo data routes, unsafe uploads and leaked secrets. Each has a control. The list below shows the gaps that production must close. Full review: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

| Area | Risk | Control (prototype) |
| --- | --- | --- |
| AI routes | Cost abuse | Per-IP rate limit, 20 requests a minute: Cloudflare rate-limiting binding on Workers, keyed on cf-connecting-ip; in-memory window on Node, keyed on the TRUSTED\_IP\_HEADER header when set, otherwise one shared budget (so a spoofed header can't dodge the limit) |
| AI routes | Malformed or oversized input | Zod schemas; byte caps enforced while the body streams in, before parsing (256 KB JSON, 4 MB + 64 KB multipart); invalid input returns 400 or 413 before any model call |
| Demo data routes | Cross-site requests | Every write must carry an Origin that matches the host (403 otherwise). The workspace cookie is HttpOnly, SameSite=Lax, and Secure in production |
| Demo data routes | Storage and request abuse | 60 writes a minute per IP (WRITE\_RATE\_LIMITER on Workers, in-memory elsewhere); at most 5 new workspaces per IP an hour, keyed on a truncated SHA-256 of the IP; 64 KB body cap while streaming; zod schemas on every body; caps of 500 work orders, 1,000 tenancies (200 per import) and 200 invites; newest 2,000 notifications, audit entries and ratings kept. Clients that never return the cookie get seed data without a workspace |
| Demo data | Data leaking between visitors | Every row carries its workspace id and every query filters on it; composite foreign keys keep rows inside one workspace; a random 144-bit id in the cookie selects the workspace |
| Money rules | Overdraw, double payment, approving the wrong thing | Enforced on the server in SQL, not in the browser. Each money action is one D1 batch whose first statement inserts the transfer only if the guards hold; a unique index allows one live transfer per idempotency key. Scanned invoices that fail the consistency checks are refused on the server too |
| Uploads | Malicious or wrong files | 4 MB cap; type decided by file signature (JPEG, PNG, WebP, PDF), not by name or client MIME type; anything else returns 415 |
| Uploads | Retaining personal data | Read in memory and discarded |
| Portfolio import | Tenant personal data sent to a model | Files are parsed in the browser; only the header row and up to 5 sample rows go to `/api/ai/import-map`, or the text the user chose to paste to `/api/ai/import-parse` (≤ 20,000 characters); imported rows stay in the visitor's workspace until midnight Pacific time |
| Portfolio import | Model invents or misplaces columns | A mapping is accepted only for headers that exist in the file, each used once; every row is checked (required fields, rent, dates, duplicates) and shown for review before import |
| Model output | Prompt injection, false approvals | Documents framed as data in every prompt; schema-validated output; rule-based policy check overrides a model "approve"; payments need a person |
| Model output | Cross-site scripting | Rendered as React text only; no `dangerouslySetInnerHTML` |
| Errors | Leaking provider details | Users see a generic note; details go to server logs |
| Secrets | Keys in code | Nothing committed; Cloudflare secrets; the placeholder `unset` counts as no key |
| Browser | Clickjacking, sniffing, downgrade | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy |
| Forms | Credentials in URLs | POST forms that stay disabled until the page is interactive |
| Supply chain | Vulnerable or drifting dependencies | Locked installs (`npm ci`); CI runs lint, type check, 87 unit tests and both builds on every push |

**Known gaps before production**

- **No authentication.** Sign-in screens are UI only. Add an identity provider, server-side sessions and role checks on every route.
- **The workspace cookie is the only key.** Anyone holding a visitor's `pn_ws` cookie can read and change that demo workspace, as any persona. Real data needs accounts and role checks.
- **Imported rows are stored until midnight.** A rent roll uploaded during onboarding may hold real names, emails and phone numbers. They stay in the database until the workspace expires or is reset. The IP hash used for the creation limit is unsalted, so it is pseudonymous, not anonymous.
- **Assistant uses the browser's snapshot.** `/api/ai/ask` still receives the portfolio from the browser. Production must load it server-side, scoped to the signed-in user.
- **`'unsafe-inline'` in the CSP.** Current hydration requires it. Move to nonces when the runtime supports them.
- **Approximate rate limit.** Cloudflare's limiter counts per location. A live test saw 429 (Too Many Requests) responses from about 40 requests a minute against a limit of 20. The 60-a-minute write limiter works the same way. Shared networks share a budget, and the in-memory fallback is per instance. Add a WAF rule for a hard cap.
- **Dependencies.** Five moderate `npm audit` findings in `fflate` come in through Open Graph image generation, a code path this app does not use. We are waiting on an upstream fix.

## Deployment and environments

The same code ships to Cloudflare Workers or any container host. Host differences live in configuration and the platform port, never in application code.

| Environment | Target architecture | Prototype |
| --- | --- | --- |
| Development | Docker Compose on a laptop; preview deploy per pull request | `npm run dev` (Node) or `npm run dev:vinext` (Workers runtime, real Workers AI) |
| Staging | Separate cloud account or project; production copy with PII removed; agent eval runs | Not used |
| Production | US region, backups to a second US region; Helm charts on EKS, GKE or AKS | One Cloudflare Worker, `property-mgmt-ai-prototype`, on propniti.ai and www.propniti.ai |

- **Build paths.** `npm run build:vinext` compiles to a Worker. The Dockerfile builds a standalone Next.js server (`NEXT_STANDALONE=1`) that runs on Cloud Run, App Runner, Azure Container Apps or Kubernetes.
- **Platform port.** On Workers, the build points `@/lib/platform` to an adapter that reads the `DB`, `AI`, `AI_RATE_LIMITER` and `WRITE_RATE_LIMITER` bindings. On Node, the default opens a SQLite file and returns no other binding, so the app uses API-key providers or mock, and in-memory rate limiters.
- **Database.** On Workers, the `DB` binding points to the D1 database `propniti`. Apply the schema with `npx cf d1 migrations apply <database-id>`. For local `npm run dev:vinext`, run `npm run db:migrate:local` once first. In Docker, demo data is a SQLite file at `DATABASE_PATH` (default `/data/propniti.db`), created and migrated on first start. Mount a volume on `/data` to keep it across restarts. Expired workspaces are deleted as new ones are created, so no scheduled job is needed.
- **Secrets.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `AI_PROVIDER` are declared Worker secrets. They deploy with the placeholder `unset`. Set real values with `npx wrangler secret put`.
- **CI.** GitHub Actions on every push and pull request: install, Next.js build, type check, lint, unit tests, Worker build.
- **Infrastructure as code (target).** Terraform/OpenTofu modules per cloud plus Helm values. Feature flags (Unleash) turn agent actions on per customer.

## Cost estimate

*Target architecture.* With Workers AI as the default model, running cost is about $510 a month for a 1,000-unit pilot and about $4,500 for 25,000 units ($0.51 falling to $0.18 per unit). Infrastructure, not AI, becomes the largest line.

**Model usage assumption, per unit per month:** 10 agent runs of about 6,000 input and 1,000 output tokens each, plus 0.2 invoice reads of about 3,000 input and 500 output tokens. On Workers AI (Llama 4 Scout at $0.27 per million input and $0.85 per million output tokens) that is about $0.025 per unit per month.

| Item | Pilot: 1,000 units ($/month) | Growth: 25,000 units ($/month) | Basis |
| --- | --- | --- | --- |
| Models (Workers AI, default) | 25 | 620 | Assumption above; no prompt caching assumed |
| Cloud infrastructure | 400 | 2,500 | Managed Kubernetes, PostgreSQL, Redis, object storage, load balancer; similar on AWS, GCP, Azure; approximate |
| SMS | 33 | 830 | 4 segments per unit per month × $0.0083, plus carrier fees |
| Voice calls | 7 | 175 | 0.5 outbound minute per unit per month × $0.014, plus $1.15 per number per month |
| Observability | 0–50 | 300 | Grafana Cloud; approximate |
| Email | 20 | 90 | SendGrid plan; approximate |
| **Total** | **\~510** | **\~4,500** | Pilot total uses the observability midpoint |

- **Claude as the default instead:** the model line rises to about $400 (pilot) and $10,000 (growth) using `claude-opus-5` at $5/$25 per million tokens with prompt caching. That makes the totals about $885 and $13,900. A sensible split is Workers AI for routine sweeps and Claude for document reading and disputed invoices. Measure both on the eval set first.
- **Not included:** payment fees (Stripe, Plaid; per transaction, usually passed to the payer), Persona ID checks (per verification, quote needed), and the prototype's own Cloudflare hosting.
- **Sources:** Workers AI price from the [Llama 4 Scout model page](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/); SMS and voice from Twilio's US pricing ([SMS](https://www.twilio.com/en-us/sms/pricing/us), [voice](https://www.twilio.com/en-us/voice/pricing/us)); Claude from Anthropic's list prices. Cloud, Grafana and SendGrid figures are approximate list prices.

## Key decisions

Each decision below lists the options weighed, so you can revisit it when its reason changes.

| Decision | Options considered | Choice | Why |
| --- | --- | --- | --- |
| Hosting | AWS-only managed services; Kubernetes on any cloud; serverless platform | Kubernetes on any cloud (target); Cloudflare Workers (prototype) | No lock-in for production; Workers gives the prototype a global deploy with built-in AI, database and rate limiting at near-zero cost |
| How the agent changes data | Direct database access; service APIs | Service APIs only | One set of permissions, validation and audit for people and agents |
| Model provider | One vendor; provider port with adapters | Port with Workers AI, Claude and OpenAI adapters | Swap on cost, quality or outage without code changes; mock fallback keeps the demo usable |
| Trusting model output | Trust the model; rules only; model plus rule check | Model plus rule check, human approval for money | The model handles messy documents; rules catch the cases where it is confidently wrong |
| Money movement | Simple payments table; double-entry ledger | Double-entry ledger with idempotency keys | Balances always reconcile; retries can't pay twice |
| Prototype framework on Workers | OpenNext adapter; vinext | vinext | Cloudflare's recommended path for Next.js on Workers; native bindings |
| Uploaded documents | Store in object storage; read and discard | Read and discard (prototype) | No personal data at rest until accounts, retention and access controls exist |
| Demo data | Shared database; per-browser storage; per-visitor workspaces in a server database | Per-visitor workspaces in D1 (SQLite on Docker), wiped at midnight Pacific time | Every visitor still gets an isolated sandbox. Money rules run on the server, and two tabs can't overwrite each other. The workspace id is ready for real customer workspaces |
| Where import files are parsed | Upload the file to the server; parse in the browser | Parse in the browser; send only headers and up to 5 sample rows for matching | Only the rows the user imports reach the server; the model sees only what it needs to recognise columns |
| Trusting AI column matching | Use the model's mapping as-is; name matching only; model checked against the file's headers | Model mapping kept only for headers that exist, name matching fills gaps, the user can change any match | Handles exports from any tool without ever inventing a column |
| Payments in the prototype | Static payment records; a browser simulation; a server simulation with the target's rules | Server simulation in D1 that mirrors the target ledger API | People can try rent, fees, vendor and owner payouts end to end; the server enforces the rules in SQL, so the browser can't bypass them |

## Risks and open questions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A model misreads an invoice | Wrong amount proposed for payment | Consistency checks, PO comparison, rule-based policy check, human approval for every payment in V1 |
| Prompt injection in documents or messages | Agent misled | Documents framed as data; schema-only output; write tools only queue actions |
| Model cost grows faster than revenue | Margin | Workers AI by default, Claude only where it measurably helps; per-customer usage caps |
| AppFolio / Buildium API access needs partner agreements | Import slips | Start applications early; rent-roll export import (built) covers onboarding meanwhile |
| SMS deliverability (10DLC, TCPA consent) | Nudges not delivered | Register early; consent tracked per user |
| Approximate edge rate limiting | Burst abuse of AI and demo data routes | WAF rate rule as a hard cap |
| Rent-roll exports vary widely between tools | Import fails or puts data in the wrong field | AI matching plus an editable mapping and row-by-row review; Excel files must be saved as CSV for now |
| Simulated payments mistaken for real ones | Confusion or false trust | Labelled as simulated on every payment screen; no bank details are collected |

- [ ] Pricing model (per door, per seat, per agent action) decides which costs are absorbed.
- [ ] Real agent runs per unit per month: measure in the pilot; it drives the model line.
- [ ] Which AI tasks justify Claude over Workers AI: decide from the eval set.
- [ ] Identity provider for production auth.
