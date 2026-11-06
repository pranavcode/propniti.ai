## Overview

Propniti is property management software for US residential and commercial portfolios. Eight AI agents handle routine operations work, and a person approves anything involving money, legal terms or safety. This spec covers the live product at [propniti.ai](https://propniti.ai). Source: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

Propniti finds wrong operations data that money decisions rely on, shows why it's wrong and fixes it.

| Area | What Propniti has |
| --- | --- |
| Staff app | One app at `/app` for nine staff roles, each with its own home page and scope |
| Record types | 64 record types in 13 modules (portfolio, leasing, residents, maintenance, communications, receivables, payables, accounting, owners, risk, intelligence, settings, platform) |
| AI agents | Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health |
| Portals | Owner, resident, vendor and applicant portals at `/portal/...` |
| Public site | Listings, tour booking and applications at `/listings` and `/apply/...`, with no sign-in |
| Sample data | 30 properties (3,318 units) in Austin, Dallas, Atlanta and Phoenix, with 18 closed months of history |

![System architecture: browsers reach one Cloudflare Worker at propniti.ai, which serves pages and APIs, checks scope, runs the AI runtime, reads a D1 database with a shared base and per-visitor overlays, and calls models through one provider layer; a Cron Trigger starts the sweep every 15 minutes](/docs/architecture/system-architecture.svg#1000x560)

**Product principles**

- AI output shows its source (a live model, a stored earlier result, or rules) and links to the run that produced it.
- Code computes the figures. A model writes the wording and suggests actions; if its text states a figure the data doesn't contain, the app shows the rules text instead.
- KPIs, charts and totals open the records behind them.
- Fair housing: applicant scoring ignores protected characteristics, and criminal history goes to a person instead of being scored.

## Goals and non-goals

**Goals**

- Each role sees its own home, records and next actions, scoped to its region, properties or own record.
- Agents run on a schedule and on events, and each run is recorded step by step.
- Agents make proposals and a person decides each one. An admin can let low-risk actions within approval-policy limits apply without a person.
- Data Health finds and fixes bad records before they reach owner statements or an audit.
- Money rules (idempotent payments, trust balance checks, bank-change holds) run on the server.

**Non-goals**

- Real accounts, payments and messages. Sign-in uses demo accounts with one published password; payments and messages are simulated.
- Live sync with other property management systems. Data comes in by file import.
- Markets outside the US.

## Personas

All names and companies are fictional. Sign in at [propniti.ai/login](https://propniti.ai/login) with a demo account, or pick a person from the list in the same card. Switch later from the avatar menu (*Switch role (demo)*). `/demo` redirects to `/login`.

Accounts are `<id>@propniti.demo` (for example `marcus@propniti.demo`) with the password `propniti-demo`. In *Pick a person*, a click fills the form and a double-click signs in. `/login?as=<id>` prefills a person.

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

A role × module matrix (Settings → Roles) sets each role's access per module: none, read, write or approve. Portal personas see only rows tied to their own record and are sent back to their portal from staff pages.

## Functional requirements

Status is Built (works end to end on propniti.ai), Partial (the note says what's missing) or Not built.

### Navigation and records

| Requirement | Status | Notes |
| --- | --- | --- |
| Sign-in at `/login` with a demo account or *Pick a person*; role switch from the avatar menu | Built | One published password, checked on the server. Not an account system |
| A home page per role | Built | See [Personas](#personas) |
| List pages for every record type: search, filters, status tabs, saved and shared views, paging (25, 50 or 100 rows) | Built | |
| *Download* on lists, reports and owner statements as CSV, Excel (.xlsx) or PDF, optionally branded | Built | What's on screen, up to 10,000 rows |
| Action feedback: page-load progress bar, filter summary line, toasts, "Updated just now" on changed sections | Built | |
| Light, dark and system themes from the top bar or ⌘K | Built | *System* is the default |
| Dates read like "Nov 4, 2026", independent of browser locale | Partial | A few KPI tiles and report subtitles still show "2026-11-04" |
| Sidebar links open only pages the persona can use | Built | Checked for all 13 personas |
| No sideways scrolling on phones | Built | Wide tables scroll inside their card |
| *Select all N matching* for bulk actions; *New* forms prefilled from the current filter | Built | |
| Record pages with tabs, Activity, Notes, Tasks, Documents, an AI summary and a Data health panel | Built | Tabs depend on the record type |
| Record peek drawer, with J and K to move between rows | Built | Linkable with `?peek=<id>` |
| ⌘K command palette: records, pages, quick actions and "Ask AI" | Built | |
| Breadcrumbs that open each section's first page | Built | |
| A sparkle marks AI-powered pages in the sidebar and ⌘K | Built | |
| Inbox (`/app/inbox`): messages awaiting your reply, proposals you can decide, alerts | Built | Sidebar badge counts what needs you |
| My tasks (`/app/tasks`): views by due date, *New task*, *Snooze*, *Reassign* | Built | |
| Out-of-scope records show "This record isn't in your scope or doesn't exist" | Built | |
| Locked records (paid bills, sent offers, ended leases) can't be edited | Partial | The server refuses the save, but the Edit button still shows |
| Natural-language list filter | Not built | `/api/ai/nl-filter` exists, but no list page calls it |

### Portfolio and reporting

| Requirement | Status | Notes |
| --- | --- | --- |
| Portfolio and regional homes with KPIs, charts, a property comparison and an approvals queue | Built | Daniel and Priya |
| *Explain* on KPIs and per-property variance: drivers and the properties that moved the number | Built | |
| Property NOI shows the last closed month | Built | Labelled "NOI (last month)" |
| What-if: rent, occupancy and expense changes recompute NOI per property, with optional narration | Built | Deterministic math; the narration is a traced agent run |
| Reports: P&L, rent roll, AR aging, NOI by property, cash forecast; *Build report* from a question | Built | Principal, regional managers, property managers and accountants. Rules answer when no model does |
| One past-due figure across the principal's home, Finance and the delinquency page: open charges past due today | Built | |
| Budget vs actual with *Explain a variance* | Built | |

### Leasing

| Requirement | Status | Notes |
| --- | --- | --- |
| Leasing day view: briefing, tours, follow-ups due, agent proposals | Built | Lena |
| Pipeline board with *Undo* | Built | |
| Follow-ups: send one or *Send all*; bulk follow-up or reassign stale leads; *Rewrite with AI* on drafts | Built | |
| Listing editor with *Draft with AI* and a fair-housing language check | Built | Flagged wording blocks the save |
| Application scoring with reasons for and against, and a recommendation | Built | Rules score; criminal history isn't scored |
| Broker decision on the application: approve, approve with conditions, deny | Built | A conditional approval needs a reason |
| Renewals: the agent prices an offer with reasons; a person accepts or edits, then sends | Built | Bulk drafts and follow-ups |

### Residents and communications

| Requirement | Status | Notes |
| --- | --- | --- |
| Property manager's Today page: briefing, KPIs, charts, approvals, leases ending without an offer | Built | Marcus |
| Resident 360: ledger, lease, terms and rent schedule | Built | |
| Conversations (`/app/communications/inbox`): *Suggest a reply*, edit, send | Built | Messages stay in the app |
| Lease abstraction: reads the lease on file, cites pages, flags mismatches and fixes the record | Built | |
| Announcements: AI draft for a property, sent to its residents | Built | Delivery is simulated |
| Delivery by email or SMS | Not built | Settings → Integrations shows simulated status only |

### Maintenance and compliance

| Requirement | Status | Notes |
| --- | --- | --- |
| Maintenance home: SLA KPIs, triage queue, approvals, invoices to approve, vendor insurance | Built | Tom |
| Intake: a plain-language request is triaged by the agent (trade, urgency, cost estimate, vendor); *Dispatch as suggested* | Built | The server checks confidence |
| Request certificates of insurance (read by AI); escalate late make-readies | Built | |
| Board and calendar of open work orders | Built | |
| Technician view: start a job, log time, mark done | Built | |
| Vendor invoice check against the purchase order, then *Approve and pay* | Built | Rules: totals within 2%, line sums, photos. Blocked on an unverified bank change or above the owner's limit |
| Compliance: certificates of insurance, permits, inspections, legal cases, with an expiries timeline | Built | Legal cases are hidden from roles without access |
| Set a vendor to Inactive or Do not use while it has open emergency or life-safety work orders | Built | Only the principal or a regional manager. Others reassign the jobs first. Agent proposals that do this go to them too. A payment hold after a suspicious bank change stays with the accountant; taking that vendor off work becomes a separate proposal |

### Finance

| Requirement | Status | Notes |
| --- | --- | --- |
| Receivables: delinquency aging that drills to residents, ledgers and charges | Built | |
| Record a payment; a double click records one payment | Built | Simulated money |
| Collections workbench: risk score with reasons, reminders in English or Spanish | Built | |
| Payment run for approved bills; bills over the limit go to staff approvers | Built | Simulated money |
| Collection rate: the share of each month's own charges paid so far, capped at 100% | Built | Payments toward older balances don't count |
| Returned payments with a state-capped fee; deposit dispositions | Built | |
| AP inbox: read an uploaded invoice, suggest GL coding, run payables checks, approve and pay | Built | Manual entry when no vision model is configured |
| Hold payments on an unverified vendor bank change; a different person verifies it | Built | |
| Owner statements with per-line *Explain*, and distributions | Built | |
| Bank reconciliation with suggested matches | Built | |
| 1099 preparation | Built | |
| Vendor invoices from the portal reach the AP inbox | Not built | They appear only on the work order's *Invoice and PO* tab |

### AI and data health

| Requirement | Status | Notes |
| --- | --- | --- |
| Eight agents on a schedule, on events and on *Run now* | Built | See [Agent behaviour](#agent-behaviour) |
| Agents page (`/app/agents`): status, counters, autonomy, *Run now*, approval-policy limits | Built | |
| Approvals inbox (`/app/ai/approvals`): *Needs you*, *Handled automatically*, *Waiting on others*, *Decided*; *Approve all low-risk matching* | Built | Deep links: `?proposal=<id>` or `?record=applications/<id>` |
| Owner approves proposals waiting on the owner | Partial | The owner portal lists repairs over the limit, not agent proposals. A principal can decide those |
| AI activity (`/app/ai/activity`): runs with trigger, model, tokens and cost; an AI audit log | Built | |
| Run trace that streams steps live | Built | `/app/ai/runs/<id>` |
| Assistant (⌘J and `/app/copilot`): Ask, Do and Help modes, traced turns, saved conversations | Built | Do mode can create proposals and start agents. 28 *Sample* conversations ship with the data |
| *Ask Propniti* chat bubble on staff pages, with page-aware questions and tips from real data | Built | At most five tips a session |
| *Ask about this* on a record | Built | Also in the portals, limited to the person's own records |
| *Right now* in the assistant: up to three one-click items (approvals waiting, past-due balances, data issues) | Built | |
| *Improve with AI* on a red KPI (delinquency, occupancy, work-order SLA): drivers, a plan of agent actions, *Have agents do this* | Built | Proposals follow normal approval rules |
| Plain-English definitions on labels, with *Learn more* | Built | |
| Help articles at `/app/help/<id>` | Built | Assistant citations link here |
| Readable run steps with linked record names; raw input and output under *Technical details* | Built | Out-of-scope records show their type only |
| AI summaries on records from current figures; *Summarize with AI* where none exists | Built | See [Source labels](#source-labels) |
| Data Health: score, issues by rule and property, before/after fixes, *Apply N safe fixes* (up to 50) | Built | Fixes touching money, fraud or legal status wait in the approvals inbox. Property-scoped roles see issues on their properties, plus issues on records with no property (such as vendors) that they can read. Only the principal or a payables approver can dismiss a critical, money or fraud issue |
| Leases still Active after their end date | Built | A person picks *Mark as ended* or *Switch to month-to-month*; either goes to the approvals inbox |
| Model failures show a plain message, never the provider's error | Built | The assistant says it used the rule-based answer. Other AI requests say "The AI service didn't respond. Try again in a minute." |
| Automations (`/app/automations`): each agent's schedule, events, autonomy and recent runs; the sweep; approval and built-in rules | Built | |

### Portals and public site

| Requirement | Status | Notes |
| --- | --- | --- |
| Owner portal: briefing, statements with *Explain*, repair approvals, properties, documents, messages | Built | |
| Resident portal: pay rent, autopay, requests with an AI first read, lease and renewal, renters insurance, messages | Built | |
| Vendor portal: accept or decline jobs, send invoices (read from a file), payments, insurance certificates | Built | |
| Applicant portal: status timeline, documents checklist, $55 fee, messages | Built | No real card is charged |
| *Ask AI* in each portal, answered from the person's own records | Built | Rules answer; a model may reword without adding figures |
| Public listings: search by metro, listing detail with pricing and fees, ask about a unit, book a tour | Built | Fair-housing questions get fixed policy text |
| Public application in five steps, scored right away by the Leasing agent and sent to the broker's approvals | Built | Only document file names are stored |

### Settings and platform

| Requirement | Status | Notes |
| --- | --- | --- |
| Company profile, users, roles matrix, approval policies with change history, state rules, audit log, notifications | Built | The principal and admins edit the company profile. The principal can add people but can't grant the admin role |
| Import of properties, units, residents, leases, owners, vendors and aged balances | Built | See [Import](#import) |
| Guided setup at `/app/onboarding` | Built | See [Guided setup](#guided-setup) |
| Integrations | Partial | Status cards only; no outside service is called |
| Platform console: customer orgs, system health, AI usage | Built | Platform admin only |
| Collapsible home sections; *Reset layout* in the avatar menu | Built | |
| Welcome splash and assistant panel once a demo day per persona; new-feature dots; one tour offer per session | Built | *Help › Show welcome screen* brings the splash back |
| Real sign-in and accounts | Not built | |

## Import

*Settings → Import data* (`/app/settings/import`) brings a portfolio over in six steps: *Source*, *Files*, *Columns*, *Review*, *Preview*, *Done*.

| What | Details |
| --- | --- |
| Sources | AppFolio, Buildium, Yardi Breeze, Yardi Voyager, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata, or *Other / spreadsheet*. Each tile has column presets and *Try samples* |
| Creates | Properties, units, residents, leases from a rent roll (with deposits, recurring charges and opening balances), owners and owner entities, vendors, open balances by age |
| Files | CSV, TSV or Excel (.xlsx); up to 6 files, 3 MB and 2,000 rows each |
| Who | Staff, within their create rights. New properties need a principal or regional manager; opening balances, deposits and recurring charges need a principal, regional manager, property manager or accountant |

Code checks every row before writing anything. Fix or exclude each error first. Records already on file are matched but not changed. Running the same import twice writes nothing the second time.

With *Use AI to help map and clean up* on, a model sees the headers, the first 5 rows and up to 30 flagged cells per file, and suggests column matches and cleanups for you to accept.

*Recent imports* lists the last 10, each with *Undo import*. Undo is refused once other records point at the imported ones. The Data Health agent checks new records at the next sweep.

## Guided setup

*Set up your portfolio* (`/app/onboarding`) has five steps and ends with a Data Health check on the imported records. A principal, regional manager or admin can use it. Steps can be skipped, and the flow resumes where you left it.

| Step | What happens |
| --- | --- |
| Company | Company name, operating states and approximate unit count. Late-fee caps, notice periods and deposit rules follow the states |
| Bring your data | Drop exports in any mix, or *Try sample files*. Rules identify each file's source tool and contents; with AI on, a model may name files the rules can't place. Files then continue in the import wizard |
| Approval rules | Limits and agent autonomy suggested from past work orders, bills and rents, each with its basis and confidence. *Accept*, *Edit* or *Keep current* |
| Your team | Add people with a role and coverage (company, regions or properties). No email is sent |
| Check and finish | Data Health runs over the imported records. A summary shows what was imported, issues found, rules set and people added |

## Agent behaviour

Each agent has a goal, a tool allow-list, triggers, a default autonomy level and the actions its proposals may run.

![Agent run flow: six triggers start a run in the orchestrator; the agent collects candidates with read tools and an optional model; each proposal is routed by autonomy, policy limits and always-a-person rules; it applies on its own or waits for a person allowed by the decide rule; the registered action re-checks the record and runs once](/docs/architecture/agent-run-flow.svg#1000x622)

| Agent | Owner role | Watches for | Schedule (UTC) | Events | Default autonomy |
| --- | --- | --- | --- | --- | --- |
| Collections | Property manager | Residents who owe rent: reminder, payment plan at 31–90 days, legal referral at 90+ | Daily 14:00 | `payment.failed`, `charge.overdue` | Approve first |
| Renewals | Property manager | Leases ending within 90 days with no offer; price toward market, capped at +5% | Mondays 13:00 | `lease.expiring` | Approve first |
| Leasing | Leasing agent | Applications to score for the broker; prospects with no contact in 3 days | Every 4 hours | `application.submitted`, `screening.completed` | Approve first |
| Maintenance triage | Maintenance supervisor | New work orders: trade, urgency, cost estimate, best vendor, owner limit | Every 15 minutes | `wo.created`, `service_request.created` | Auto within policy |
| Payables | Accountant | Bills waiting for approval: coding, amount history, duplicates, bank changes | Every 2 hours | `invoice.received`, `vendor.bank_changed` | Approve first |
| Owner reporting | Accountant | Owner NOI changes over 3% month over month, explained from computed drivers | 1st of the month 12:00 | `statement.closed` | Approve first |
| Compliance | Maintenance supervisor | Certificates expiring within 30 days, vendors working uninsured, permits and inspections | Daily 15:00 | `coi.expiring` | Auto within policy |
| Data Health | Admin | Open data issues: duplicates, miscoded bills, contact details, addresses | Daily 06:00 | `data_issue.detected`, `import.completed` | Auto within policy |

An admin can change these schedules. Nothing raises `coi.expiring`, `screening.completed`, `statement.closed` or `data_issue.detected` yet; those agents cover that work on their schedule.

### Triggers

- **Schedule.** A Cloudflare Cron Trigger runs a sweep every 15 minutes. Each sweep does one unit of work (one agent's events, or the most overdue scheduled agent) in up to 10 visitor workspaces active in the last 30 minutes.
- **Run on visit.** If no sweep has run for about 17 minutes, the first AI page or request starts one.
- **Events.** Actions write events to an outbox. The sweep raises `charge.overdue` after a 3-day grace and `lease.expiring` at 90 days out. A public application starts the Leasing agent right away.
- **Run now.** Roles with intelligence-module access can start an agent from `/app/agents` and watch it in a side sheet.

Each run has a time limit, a step limit and a 50-cent model budget.

### How a run works

1. **Collect.** Rules find candidates through logged tool calls, with figures from the data.
2. **Model.** If configured, a model checks the candidates with the same read tools, drafts messages and proposes. Each proposal must match a rules candidate, and the rules set its amount, risk and confidence.
3. **Rules.** With no model, or on model failure, the rules propose the candidates as written. Candidates the rules mark mandatory (fraud, safety, legal) are proposed regardless of the model.

Write tools never move money. They create a proposal, or, after approval, call the guarded money actions.

### Routing: autonomy, risk and policy

Each agent has one of two autonomy levels. Only a principal, regional manager or admin can turn an agent on or off or change its autonomy, schedule or approval policies. Legal and safety policies can't act alone.

| Level | Behaviour |
| --- | --- |
| Approve first | Every proposal waits for a person |
| Auto within policy | Applies on its own only if risk is Low, it isn't marked always-human and the amount is within the policy limit |

A proposal with no stated risk counts as Medium; an amount with no policy limit counts as over it. Amounts over the owner threshold wait for the owner.

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

Some owner entities override the maintenance and bill limits.

### Approvals

A proposal shows its title, amount, risk, source, reasons, confidence (High, Medium or Low with a percentage), the records it used and a link to its run. A person approves or rejects it, and may edit a drafted message's wording first; recipient, record and amounts can't be edited.

Before an approved proposal runs, the server re-checks that the record is in the approver's scope, its key fields haven't changed and the action is still allowed. Then it runs once.

One decision rule (`src/ai/decide.ts`) sets the buttons, the *Needs you* counts and the server check:

| Proposal | Who decides |
| --- | --- |
| Low risk, no amount | Write access to the module |
| Money, legal or safety risk | Approve access to the module |
| Life-safety (high-risk items in the risk module, such as an overdue fire inspection) | The property's regional manager or the principal |
| Over the owner's limit | The owner or a principal |

Re-running an agent doesn't duplicate a proposal that is still open.

### Source labels

| Where | Labels |
| --- | --- |
| Badges on proposals, answers and drafts | **AI** (a live model call), **AI · saved** (stored from an earlier run), **Rules** (no model; figures still come from the data) |
| AI summaries on record pages and in the peek drawer | **Rules · from this record's current figures**, **Generated · model · time**, **Precomputed · model · time** |

A stored model summary shows only while its source facts still match the record. Otherwise the rules write a sentence from the current figures.

Model choice: an Anthropic key, then an OpenAI key, then Workers AI (Llama 4 Scout) on Cloudflare. `AI_PROVIDER` can force one. With no model, everything runs on rules and is labelled **Rules**.

## Data model

| Layer | What it holds |
| --- | --- |
| Shared base | The sample portfolio: 30 properties, their units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history and data issues. Read-only while the app runs |
| Visitor overlay | Each visitor's changes, in rows with the same ids. An overlay row replaces the base row with that id; a deleted overlay row hides it |

- 106 tables (`migrations/0002_v2.sql`, plus migrations 0003–0008 for indexes and further fields).
- Money is stored as integer cents. Transfers and the audit log are append-only.
- AI tables: agent definitions, runs, steps, events, proposals, decisions, approval policies, summaries and assistant threads.
- A visitor's overlay is private, found by an HttpOnly cookie, and deleted at the first midnight Pacific after it was created.
- **Demo clock.** "Today" is 4 November 2026 plus the current Pacific time of day. Books are closed through October 2026.

## Integrations

| Need | Provider | Status |
| --- | --- | --- |
| AI (default on Cloudflare) | Workers AI, Llama 4 Scout | Live |
| AI (optional) | Anthropic Claude or OpenAI | Live when a key is set |
| Bank feeds, ACH, card payments | Plaid, bank ACH, Stripe | Simulated; status cards in Settings → Integrations |
| Email and SMS | — | Simulated; messages stay in the app |
| Listing syndication | — | Simulated status card |
| Other property management systems | AppFolio, Buildium, Yardi Breeze, Yardi Voyager, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata, any spreadsheet | File import (CSV, TSV, XLSX); no live sync |

## Non-functional requirements

| Area | Requirement | How Propniti meets it |
| --- | --- | --- |
| Scale | Bounded queries and pages | 30 properties and 3,318 units of sample data; pages of 25, 50 or 100 rows; downloads capped at 10,000 rows |
| Scope | No reads or writes outside a persona's scope | Scope filters in SQL, including inside writes |
| Workflow | Status fields change only through their actions | Named actions set system fields. Ledger tables are actions-only. Locked records refuse edits |
| Money | No double payments; nothing paid that isn't held | Guarded SQL batches, one live transfer per idempotency key, trust balance recomputed in SQL, bank-change hold |
| AI safety | Model output can't act or invent figures | Untrusted text framed as data; schema-checked output; proposals must match a rules candidate; unsupported figures rejected |
| AI cost | Bounded spend | 20 AI calls a minute per IP; per-run step limit, deadline and 50-cent budget |
| Abuse | Bounded writes | Same-origin check; 60 writes a minute per IP; body size caps; 30 new workspaces per IP an hour |
| Reliability | AI failure doesn't block work | Rules take over, and the output is labelled Rules |
| Tests | Regressions caught before deploy | 1,298 unit tests; 191 end-to-end tests |
| Errors | No database internals shown to people | Database errors show "The database is busy; try again in a moment"; the detail goes to the server log |

**Known gaps.** No real authentication: the password is published and anyone can sign in as any persona. The workspace cookie is the only key to a visitor's changes. No per-org AI quota. Some fields (lease status, budget approval, capex, 1099s, legal cases, service requests, message threads) have no named action, so generic edits can change them. Full list: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Roadmap

Not built yet, for a pilot: real accounts and an identity provider, real payment and messaging providers in test mode, owner-portal approval of agent proposals, AP inbox intake of portal invoices, and natural-language list filters.

## Open questions

- [ ] Which agent actions, if any, may run without approval beyond the current low-risk limits?
- [ ] Should the broker desk also list scored applications still at Submitted?
- [ ] Pricing model: per door, per seat or per agent action?
- [x] Market: US only.
- [x] Autonomy: two levels, Approve first and Auto within policy.
- [x] Property NOI: the last closed month.
