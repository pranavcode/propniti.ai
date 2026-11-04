## Overview

Propniti is property management software for US residential and commercial portfolios. Eight AI agents do routine operations work. People approve anything that involves money, legal terms or safety. This spec describes v2, the version live at [propniti.ai](https://propniti.ai), and marks each requirement as built, partial or not built. Source code: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

**Promise.** Know your portfolio is right. Propniti checks, explains and corrects the operations data that money decisions depend on.

| Area | What v2 has |
| --- | --- |
| Staff app | One app at `/app` for nine staff roles, each with its own home page and scope |
| Record types | 64 record types in 13 modules (portfolio, leasing, residents, maintenance, communications, receivables, payables, accounting, owners, risk, intelligence, settings, platform) |
| AI agents | Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health |
| Portals | Owner, resident, vendor and applicant portals at `/portal/...` |
| Public site | Listings, tour booking and applications at `/listings` and `/apply/...`, with no sign-in |
| Sample data | 30 properties (3,318 units) in Austin, Dallas, Atlanta and Phoenix, with 18 closed months of history |

**Product principles.**

- **AI is visible and accountable.** Every AI output shows its source (a live model, a stored earlier result, or rules) and links to the run that produced it.
- **Figures come from data, never from the model.** The code computes every number. A model only words answers and suggests actions. Model text that states a figure the data doesn't contain is thrown away and the rules text is shown instead.
- **Every number clicks through.** KPIs, charts and totals open the records behind them.
- **Fair housing.** Applicant scoring never uses protected characteristics. Criminal history is never scored; it goes to a person.

## Goals and non-goals

**Goals (v2)**

- Each role sees its own home, its own records and its own next actions, scoped to its region, properties or own record.
- Agents run on a schedule and on events, without a person starting them. Each run is recorded step by step.
- Agents propose; people decide. Low-risk actions inside approval-policy limits may apply on their own when an admin allows it.
- Bad data is found and fixed before owners or auditors see it.
- Money rules (idempotent payments, trust balance checks, bank-change holds) run on the server.

**Non-goals (v2)**

- Real accounts, real payments and real messages. Sign-in is a persona picker; payments and messages are simulated.
- Live sync with other property management systems.
- Markets outside the US.

## Personas

All names and companies are fictional. A visitor picks a persona on [propniti.ai/login](https://propniti.ai/login) and can switch at any time from the avatar menu in the top bar (*Switch role (demo)*). The old `/demo` link now goes to `/login`.

| Persona | Role | Scope | Lands on |
| --- | --- | --- | --- |
| Daniel Reyes | Principal | All 30 properties, 4 metros | `/app` (portfolio home) |
| Priya Shah | Regional manager | Texas, 14 properties | `/app` (regional home) |
| Marcus Bell | Property manager | 3 Austin properties | `/app/today` |
| Lena Ortiz | Leasing agent | 3 Austin properties | `/app/leasing/today` |
| Rachel Moore | Managing broker | Brokerage, all properties | `/app/leasing/broker` |
| Grace Kim | Senior accountant | All owner entities | `/app/finance` |
| Tom Alvarez | Maintenance supervisor | Texas, 14 properties | `/app/maintenance` |
| Sam Okafor | Administrator | Org settings | `/app/admin` |
| Nadia Brooks | Platform admin | All customer orgs | `/app/admin` |
| Helen Carter | Owner, Bluebonnet Residential Fund II | Own entities | `/portal/owner` |
| Jordan Lee | Resident, The Lofts at Riverside #412 | Own lease | `/portal/resident` |
| Luis Ramirez | Vendor, Lone Star Plumbing | Own jobs | `/portal/vendor` |
| Priyanka Rao | Applicant, Barton Creek Commons | Own application | `/portal/applicant` |

A role × module matrix sets what each role may do in each module: none, read, write or approve. Settings → Roles shows it. Portal personas see only rows tied to their own record, and staff pages send them back to their portal.

## Functional requirements

Status: **Built** means it works end to end on propniti.ai. **Partial** means part of it works; the note says which part. **Not built** means it is not in the code.

### Navigation and records

| Requirement | Status | Notes |
| --- | --- | --- |
| Persona sign-in at `/login` and role switch from the avatar menu | Built | No passwords; a cookie holds the chosen persona |
| A home page per role | Built | See [Personas](#personas) for each landing page |
| List pages for every record type, with search, filters, status tabs, saved and shared views, CSV export and server-side paging (25, 50 or 100 rows) | Built | Generated from each record type's definition |
| Record pages with tabs, Activity, Notes, Tasks and Documents, an AI summary and a Data health panel | Built | Tabs appear when the record type supports them |
| Record peek drawer: a list row opens the record in a side drawer (a bottom sheet on phones), with J and K to move between rows and *Open full page* | Built | The URL carries `?peek=<id>`, so a drawer can be linked |
| ⌘K command palette: records, pages, quick actions and "Ask AI" | Built | |
| Locked records (paid bills, sent offers, ended leases) can't be edited | Partial | The server refuses the save; the Edit button still shows |
| Natural-language list filter | Not built | The `/api/ai/nl-filter` route exists, but no list page calls it |

### Portfolio and reporting

| Requirement | Status | Notes |
| --- | --- | --- |
| Portfolio and regional homes with KPIs, charts, a property comparison and an approvals queue | Built | Daniel and Priya |
| *Explain* on KPIs and per-property variance: drivers and the properties that moved the number | Built | Facts computed; a model words them, or rules do |
| Property NOI shows the last closed month | Built | Labelled "NOI (last month)"; the month in progress is never used |
| What-if: rent, occupancy and expense changes recompute NOI per property, with an optional narrated explanation | Built | The math is deterministic; the narration is a traced agent run |
| Reports: P&L, rent roll, AR aging, NOI by property, cash forecast; *Build report* from a question | Built | The question becomes a report spec; rules are the fallback |
| Budget vs actual with *Explain a variance* | Built | |

### Leasing

| Requirement | Status | Notes |
| --- | --- | --- |
| Leasing day view: briefing, tours, follow-ups due, agent proposals | Built | Lena |
| Pipeline board: move prospects between stages | Built | |
| Listing editor with *Draft with AI* and a fair-housing language check | Built | Flagged wording blocks the save |
| Application scoring with reasons for and against, and a recommendation | Built | Rules score; criminal history is never scored |
| Broker decision on the application record: approve, approve with conditions, deny | Built | A conditional approval needs a reason |
| Renewals: the agent prices an offer with reasons; a person accepts or edits, drafts with AI and sends | Built | |

### Residents and communications

| Requirement | Status | Notes |
| --- | --- | --- |
| Property manager's Today page: briefing with links, KPIs, charts, approvals, leases ending without an offer | Built | Marcus |
| Resident 360: ledger, lease, terms and rent schedule | Built | |
| Inbox: *Suggest a reply*, edit, send | Built | Messages are stored; nothing is delivered outside the app |
| Lease abstraction: reads the lease on file, cites pages, flags mismatches and fixes the record | Built | |
| Announcements: AI draft for a property, then send to its residents | Built | Delivery is simulated |
| Delivery by email or SMS | Not built | Settings → Integrations shows simulated connection status only |

### Maintenance and compliance

| Requirement | Status | Notes |
| --- | --- | --- |
| Maintenance home: SLA KPIs, triage queue, approvals, invoices to approve, vendor insurance | Built | Tom |
| Intake: a plain-language request is saved and triaged by the agent (trade, urgency, cost estimate, vendor) | Built | |
| Board and calendar of open work orders | Built | |
| Technician view: start a job, log time, mark done | Built | |
| Vendor invoice check against the purchase order, then *Approve and pay* once | Built | Rules only (totals within 2%, line groups, line sums, photos on file). Payment is blocked while a vendor bank change is unverified, or above the owner's limit without the owner's approval |
| Compliance: certificates of insurance, permits, inspections, legal cases, with an expiries timeline | Built | Legal cases are hidden from roles without access |

### Finance

| Requirement | Status | Notes |
| --- | --- | --- |
| Receivables: delinquency aging that drills to residents, ledgers and charges | Built | |
| Record a payment; a double click records one payment | Built | Simulated money |
| Collections workbench: a rules risk score with reasons, drafted reminders in English or Spanish | Built | |
| Returned payments with a state-capped fee; deposit dispositions | Built | |
| AP inbox: read an uploaded invoice, suggest GL coding, run payables checks, approve and pay | Built | Reading uses a vision model when one is configured; otherwise manual entry |
| Hold payments on an unverified vendor bank change; a different person must verify it | Built | |
| Owner statements with *Explain* per line and distributions | Built | |
| Bank reconciliation with suggested matches | Built | |
| 1099 preparation | Built | |
| Vendor invoices from the portal reach the AP inbox | Not built | They appear on the work order's *Invoice and PO* tab only |

### AI and data health

| Requirement | Status | Notes |
| --- | --- | --- |
| Eight agents on a schedule, on events and on *Run now* | Built | See [Agent behaviour](#agent-behaviour) |
| Agents page: status, counters, autonomy, *Run now*, approval-policy limits | Built | `/app/agents` |
| Approvals inbox with tabs *Needs you*, *Handled automatically*, *Waiting on others*, *Decided*; bulk approve of low-risk items | Built | `/app/ai/approvals` |
| Approvals deep link: `?proposal=<id>` or `?record=applications/<id>` opens and highlights that proposal | Built | |
| Approvals inbox filter controls | Partial | `?agent=` filters; there are no filter controls on the page |
| Owner approves proposals waiting on the owner | Partial | The owner portal lists repairs over the owner's limit. Agent proposals in *Waiting on others* don't appear there; a principal can decide them |
| AI activity: every run with trigger, model, tokens and cost; an AI audit log | Built | `/app/ai/activity` |
| Run trace that streams steps while the run is going | Built | `/app/ai/runs/<id>` |
| Assistant (⌘J and `/app/copilot`): Ask, Do and Help modes; each turn is a traced run; saved conversations | Built | Do mode turns rent-reminder requests into proposals |
| AI summaries on records, computed from the record's current figures | Built | See [Source labels](#source-labels) |
| Data Health: score, issues by rule and property, before/after fixes, *Apply N safe fixes* | Built | Fixes that touch money, fraud or legal status go to the approvals inbox |
| Automations builder | Not built | `/app/automations` is a placeholder |

### Portals and public site

| Requirement | Status | Notes |
| --- | --- | --- |
| Owner portal: briefing, statements with *Explain*, repair approvals, properties, documents, messages | Built | |
| Resident portal: pay rent, autopay, requests with an AI first read, lease and renewal, messages | Built | The first read is rules |
| Vendor portal: accept or decline jobs, send invoices (read from a file), payments, insurance certificates | Built | |
| Applicant portal: status timeline, documents checklist, $55 fee, messages | Built | No real card is charged |
| *Ask AI* in each portal, answered from the person's own records | Built | Rules answer; a model may reword without adding figures |
| Public listings: search by metro, listing detail with pricing and fees, ask about a unit, book a tour | Built | Fair-housing questions get fixed policy text |
| Public application in five steps; the Leasing agent scores it right away; the broker sees it in approvals | Built | Only file names are stored for documents |

### Settings and platform

| Requirement | Status | Notes |
| --- | --- | --- |
| Users, roles matrix, approval policies with change history, state rules, audit log, notifications | Built | |
| Import properties and units from a CSV with AI column matching | Built | `/app/settings/import`. Creates properties and units only, not leases or residents |
| Integrations | Partial | Status cards only; no outside service is called |
| Platform console: customer orgs, system health, AI usage | Built | Platform admin only |
| Real sign-in and accounts | Not built | |

## Agent behaviour

Each agent has a goal, a tool allow-list, triggers, a default autonomy level and the actions its proposals may run.

| Agent | Owner role | Watches for | Schedule (UTC) | Events | Default autonomy |
| --- | --- | --- | --- | --- | --- |
| Collections | Property manager | Residents who owe rent: reminder, payment plan at 31–90 days, legal referral at 90+ | Daily 14:00 | `payment.failed`, `charge.overdue` | Approve first |
| Renewals | Property manager | Leases ending within 90 days with no offer; price toward market, capped at +5% | Mondays 13:00 | `lease.expiring` | Approve first |
| Leasing | Leasing agent | Applications to score for the broker; prospects with no contact in 3 days | Every 4 hours | `application.submitted`, `screening.completed` | Approve first |
| Maintenance triage | Maintenance supervisor | New work orders: trade, urgency, cost estimate, best vendor, owner limit | Every 15 minutes | `wo.created`, `service_request.created` | Auto within policy |
| Payables | Accountant | Bills waiting for approval: coding, amount history, duplicates, bank changes | Every 2 hours | `invoice.received`, `vendor.bank_changed` | Approve first |
| Owner reporting | Accountant | Owner NOI changes over 3% month over month, explained from computed drivers | 1st of the month 12:00 | `statement.closed` | Approve first |
| Compliance | Maintenance supervisor | Certificates expiring within 30 days, vendors working uninsured, permits and inspections | Daily 15:00 | `coi.expiring` | Auto within policy |
| Data Health | Admin | Open data issues: duplicates, miscoded bills, contact details, addresses | Daily 06:00 | `data_issue.detected`, `import.completed` | Approve first |

### Triggers

- **Schedule.** A Cloudflare Cron Trigger runs a sweep every 15 minutes. Each sweep does one unit of work: either the events of one listening agent, or the most overdue scheduled agent. Sweeps run only in visitor workspaces that were active in the last 30 minutes, at most 10 of them.
- **Run on visit.** If no sweep has run for about 17 minutes, the first AI page or request starts one in the background.
- **Events.** Actions write events to an outbox. The sweep raises date-driven events too: `charge.overdue` when rent passes its 3-day grace, and `lease.expiring` when a lease comes within 90 days. A public application and a completed import start their agent right away.
- **Run now.** Any role with access to the intelligence module can start an agent from `/app/agents`. A side sheet shows the run as it happens.

Each run has a time limit, a step limit and a 50-cent model budget. A run that hits its time limit keeps what it already did.

### How a run works

1. **Collect.** Rules find candidates through logged tool calls. Figures come from the data.
2. **Model.** When a model is configured, it checks the candidates with the same read tools, drafts messages and proposes. Every proposal must match a rules candidate, and the rules set its amount, risk and confidence.
3. **Rules.** With no model, or if the model fails, the rules propose the candidates as written. Candidates the rules mark mandatory (fraud, safety, legal) are always proposed, whatever the model says.

Write tools never move money. They create a proposal, or, after approval, call the guarded money actions.

### Routing: autonomy, risk and policy

The Agents page offers two autonomy levels per agent:

- **Approve first.** Every proposal waits for a person.
- **Auto within policy.** A proposal applies on its own only when all of these hold: its risk is Low, it is not marked always-human, and its amount is within the policy limit. It runs in the visitor's own workspace and is logged.

Every other proposal goes to a person. A proposal with no stated risk counts as Medium. An amount with no policy limit counts as over the limit. An amount over the owner threshold waits for the owner.

Approval policies in the sample data (org defaults):

| Category | Auto-approve up to | Owner approves over | Approver |
| --- | --- | --- | --- |
| Maintenance spend | $750 | $2,500 | Property manager |
| Bill payment | $5,000 | — | Accountant |
| Concession | $500 | — | Regional manager |
| Write-off | $0 | — | Accountant |
| Legal | Always a person | — | Principal |
| Safety | Always a person | — | Maintenance supervisor |
| Owner distribution | Always a person | — | Accountant |

Some owner entities override the maintenance and bill limits. On money actions, only the owner threshold for maintenance spend is enforced in the money code; the other limits route proposals.

### Approvals

- Each proposal shows its title, amount, risk, source, reasons, confidence (High, Medium or Low with a percentage), the records it used and a link to its run.
- A person approves, rejects, or edits the wording of a drafted message and then approves. Recipient, record and amounts can't be edited.
- Before an approved proposal runs, the server checks again that the record is in the approver's scope, that its key fields haven't changed since the agent looked, and that the action is still allowed. It runs once.
- Re-running an agent doesn't duplicate a proposal that is still open.

### Source labels

Every AI output says where it came from.

| Where | Labels |
| --- | --- |
| Badges on proposals, answers and drafts | **AI** (a live model call), **AI · saved** (stored from an earlier run), **Rule-based fallback** (no model, so fixed rules wrote it; figures still come from the data) |
| AI summaries on record pages and in the peek drawer | **Rules · from this record's current figures**, **Generated · model · time**, **Precomputed · model · time** |

A stored model summary is shown only while the facts it was written from still match the record. When the figures change, the rules sentence is written from the current figures instead.

Model choice: an Anthropic key, then an OpenAI key, then Workers AI (Llama 4 Scout) on Cloudflare; `AI_PROVIDER` can force one. With no model, everything runs on rules and says so.

## Data model

| Layer | What it holds |
| --- | --- |
| Shared base | The sample portfolio: 30 properties, their units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history and data issues. Read-only while the app runs |
| Visitor overlay | Each visitor's changes, in rows with the same ids. An overlay row replaces the base row with that id; a deleted overlay row hides it |

- The schema has 106 tables (`migrations/0002_v2.sql`, plus migrations 0003–0007 for indexes and later fields).
- Money is stored as integer cents. Transfers and the audit log are append-only.
- AI tables: agent definitions, runs, steps, events, proposals, decisions, approval policies, summaries and assistant threads.
- Each visitor's overlay is private, found by an HttpOnly cookie, and deleted at the first midnight Pacific after it was created.
- **Demo clock.** "Today" is fixed at 4 November 2026 plus the current Pacific time of day. Books are closed through October 2026.

## Integrations

Model providers are live. Everything else is simulated.

| Need | Provider | Status |
| --- | --- | --- |
| AI (default on Cloudflare) | Workers AI, Llama 4 Scout | Live |
| AI (optional) | Anthropic Claude or OpenAI | Live when a key is set |
| Bank feeds, ACH, card payments | Plaid, bank ACH, Stripe | Simulated; status cards in Settings → Integrations |
| Email and SMS | — | Simulated; messages stay in the app |
| Listing syndication | — | Simulated status card |
| Other property management systems | — | CSV import of properties and units only |

## Non-functional requirements

| Area | Requirement | v2 today |
| --- | --- | --- |
| Scale | Bounded queries and pages | 30 properties and 3,318 units of sample data; pages of 25, 50 or 100 rows; CSV exports capped at 10,000 rows |
| Scope | No reads or writes outside a persona's scope | Every list, metric and export filters by scope in SQL. Portal users see only their own records. The scope check runs inside the write |
| Workflow | Status fields change only through their actions | System fields are set only by named actions; ledger tables are actions-only; locked records refuse edits |
| Money | No double payments; nothing paid that isn't held | Guarded SQL batches, one live transfer per idempotency key, trust balance recomputed in SQL, bank-change hold |
| AI safety | Model output can't act or invent figures | Untrusted text framed as data; schema-checked output; proposals must match a rules candidate; unsupported figures rejected |
| AI cost | Bounded spend | 20 AI calls a minute per IP; per-run step limit, deadline and 50-cent budget |
| Abuse | Bounded writes | Same-origin check on writes; 60 writes a minute per IP; body size caps; 30 new workspaces per IP an hour |
| Reliability | AI failure doesn't block work | Rules take over and the label says so |
| Tests | Regressions caught before deploy | 580 unit tests in 68 files; 47 end-to-end tests across 12 specs, run against production after each deploy |

**Known gaps.** No real authentication: anyone can pick any persona, and the persona cookie is not a security boundary. The workspace cookie is the only key to a visitor's changes. Six AI routes have no origin check (they are rate limited and size capped). There is no per-org AI quota. Some fields are still editable through generic edits until their actions exist: lease status, budget approval, capex, 1099s, legal cases, service requests and message threads. The full list is in [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Release plan

| Release | Contents | Status |
| --- | --- | --- |
| V1 prototype | Six role views, AI invoice reading and validation, simulated trust-account payments, ratings, rent-roll import | Replaced by v2 |
| v2 | 13 personas with scoped homes; 64 record types in 13 modules; eight scheduled and event-driven agents with approvals, autonomy and policy limits; run traces; assistant; Data Health; record peek drawer; four portals; public listings and applications; per-visitor overlay on a shared base | Live at propniti.ai since 4 November 2026 |
| Pilot readiness | Real sign-in and accounts, real payment and messaging providers in test mode, owner-portal approval of agent proposals, AP inbox intake of portal invoices, natural-language list filters | Not built |

## Open questions

- [ ] Which agent actions, if any, may run without approval beyond the current low-risk limits?
- [ ] Should the broker desk also list scored applications still at Submitted?
- [ ] Pricing model: per door, per seat or per agent action?
- [x] Market: US only.
- [x] Autonomy: two levels, Approve first and Auto within policy.
- [x] Property NOI: the last closed month.
