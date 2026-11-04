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

- Real accounts, real payments and real messages. Sign-in uses demo accounts with one published password; payments and messages are simulated.
- Live sync with other property management systems. Data comes in through file import only.
- Markets outside the US.

## Personas

All names and companies are fictional. A visitor signs in on [propniti.ai/login](https://propniti.ai/login) with a demo account, or picks a person's card, and can switch at any time from the avatar menu in the top bar (*Switch role (demo)*). The old `/demo` link now goes to `/login`.

**Demo accounts.** Each persona has the email `<id>@propniti.demo` (for example `marcus@propniti.demo`), and every account uses the published password `propniti-demo`. Clicking a card fills the form; double-clicking a card, or its *Sign in now* button, signs in straight away. `/login?as=<id>` prefills a person, and a `next` link to an `/app` or `/portal` page is kept. The browser remembers the last person, and a visitor who is already signed in sees *Continue as …* and *Switch person*. The form also works without JavaScript.

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
| Sign-in at `/login` with a demo email and password, or a compact list of the 13 people beside the form (descriptions in *What each person sees* below); role switch from the avatar menu or the banner's *Switch* | Built | One published password, checked on the server in constant time; a cookie holds the chosen persona. Not an account system |
| A home page per role | Built | See [Personas](#personas) for each landing page |
| List pages for every record type, with search, filters, status tabs, saved and shared views, CSV export and server-side paging (25, 50 or 100 rows) | Built | Generated from each record type's definition |
| *Select all N matching* for bulk actions, real bulk labels, *New* forms prefilled from the current filter, *View* links in toasts | Built | Bulk selection is rate limited |
| Record pages with tabs, Activity, Notes, Tasks and Documents, an AI summary and a Data health panel | Built | Tabs appear when the record type supports them |
| Record peek drawer: a list row opens the record in a side drawer (a bottom sheet on phones), with J and K to move between rows and *Open full page* | Built | The URL carries `?peek=<id>`, so a drawer can be linked |
| ⌘K command palette: records, pages, quick actions and "Ask AI" | Built | |
| Breadcrumbs: section and group names open their first page; *Home* opens the persona's home | Built | |
| AI-powered pages marked in the sidebar and ⌘K with a sparkle (Inbox, Copilot, Agents, Approvals, AI activity, Automations, Data health); the *AI agents* section sits near the top of the sidebar | Built | Tooltip: "AI-powered: agents propose, you approve" |
| Inbox at `/app/inbox`: conversations waiting on your reply, agent proposals you can decide, and your alerts, with tabs *All*, *Messages*, *Approvals* and *Alerts* | Built | 25 rows a page; a sidebar badge counts what needs you. *Reply* and *Review* open the page that does the work |
| My tasks at `/app/tasks`: tasks assigned to you or your role, with *Open*, *Overdue*, *Today*, *Upcoming* and *Done* views, filters, *New task*, mark done or reopen, *Snooze* and *Reassign* | Built | Due dates use the demo date. A double click changes a task once |
| A record outside your scope opens an in-app page: "This record isn't in your scope or doesn't exist" | Built | Unknown and out-of-scope records look the same |
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
| Pipeline board: move prospects between stages, with *Undo* | Built | |
| Follow-ups: send one or *Send all*; stale leads followed up or reassigned in bulk; *Rewrite with AI* on drafts | Built | |
| Listing editor with *Draft with AI* and a fair-housing language check | Built | Flagged wording blocks the save |
| Application scoring with reasons for and against, and a recommendation | Built | Rules score; criminal history is never scored |
| Broker decision on the application record: approve, approve with conditions, deny | Built | A conditional approval needs a reason |
| Renewals: the agent prices an offer with reasons; a person accepts or edits, drafts with AI and sends; renewal drafts prepared in bulk and renewal follow-ups | Built | An approver's edits reach the sent message |

### Residents and communications

| Requirement | Status | Notes |
| --- | --- | --- |
| Property manager's Today page: briefing with links, KPIs, charts, approvals, leases ending without an offer | Built | Marcus |
| Resident 360: ledger, lease, terms and rent schedule | Built | |
| Conversations (`/app/communications/inbox`): *Suggest a reply*, edit, send | Built | Messages are stored; nothing is delivered outside the app |
| Lease abstraction: reads the lease on file, cites pages, flags mismatches and fixes the record | Built | |
| Announcements: AI draft for a property, then send to its residents | Built | Delivery is simulated |
| Delivery by email or SMS | Not built | Settings → Integrations shows simulated connection status only |

### Maintenance and compliance

| Requirement | Status | Notes |
| --- | --- | --- |
| Maintenance home: SLA KPIs, triage queue, approvals, invoices to approve, vendor insurance | Built | Tom |
| Intake: a plain-language request is saved and triaged by the agent (trade, urgency, cost estimate, vendor); *Dispatch as suggested* | Built | Uses the same decide rule; confidence is checked on the server |
| Request certificates of insurance from vendors; vendor certificates prefilled and read by AI; escalate late make-readies | Built | |
| Board and calendar of open work orders | Built | |
| Technician view: start a job, log time, mark done | Built | |
| Vendor invoice check against the purchase order, then *Approve and pay* once | Built | Rules only (totals within 2%, line groups, line sums, photos on file). Payment is blocked while a vendor bank change is unverified, or above the owner's limit without the owner's approval |
| Compliance: certificates of insurance, permits, inspections, legal cases, with an expiries timeline | Built | Legal cases are hidden from roles without access |

### Finance

| Requirement | Status | Notes |
| --- | --- | --- |
| Receivables: delinquency aging that drills to residents, ledgers and charges | Built | |
| Record a payment; a double click records one payment | Built | Simulated money |
| Collections workbench: a rules risk score with reasons, drafted reminders in English or Spanish; *Remind* and *Record payment* from the delinquency list | Built | |
| Payment run: pay approved bills in one run; bills over the limit go to staff approvers | Built | Simulated money |
| Collection rate: the share of each month's own charges paid so far, never over 100% | Built | Paying down older balances no longer counts toward the current month |
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
| Eight agents on a schedule, on events and on *Run now* | Built | See [Agent behaviour](#agent-behaviour). Agent names read in title case, for example *Collections Agent* |
| Agents page: status, counters, autonomy, *Run now*, approval-policy limits | Built | `/app/agents` |
| Approvals inbox with tabs *Needs you*, *Handled automatically*, *Waiting on others*, *Decided*; bulk approve of low-risk items | Built | `/app/ai/approvals` |
| Approvals deep link: `?proposal=<id>` or `?record=applications/<id>` opens and highlights that proposal | Built | |
| Approvals inbox filters, *Approve all low-risk matching*, *Waiting on others* with *Notify approver* | Built | Bulk approval covers low-risk items only |
| Owner approves proposals waiting on the owner | Partial | The owner portal lists repairs over the owner's limit. Agent proposals in *Waiting on others* don't appear there; a principal can decide them |
| AI activity: every run with trigger, model, tokens and cost; an AI audit log | Built | `/app/ai/activity` |
| Run trace that streams steps while the run is going | Built | `/app/ai/runs/<id>` |
| Assistant (⌘J and `/app/copilot`): Ask, Do and Help modes; each turn is a traced run; saved conversations | Built | Do mode turns rent-reminder requests into proposals. `/app/copilot` lists the 30 most recent conversations; the side panel keeps a conversation for the session only |
| *Ask Propniti* chat bubble on staff pages: opens the assistant with page-aware suggested questions, and offers one tip at a time from real data | Built | At most one tip per page view, two minutes apart and five per session; never during a tour, typing or a dialog. *Show tips* turns them off |
| Chat history in the assistant panel: recent conversations per persona, *New*, open as a page | Built | |
| *Ask about this* on a record: the assistant answers about that record, using its facts by name | Built | Also in the portals, limited to the person's own records |
| *Right now* in the assistant panel: up to three one-click items from your counts (approvals waiting, past-due balances, data issues) | Built | |
| Do mode can start agents | Built | Their proposals follow the normal approval rules |
| *Improve with AI* on a red KPI (delinquency, occupancy, work-order SLA): drivers computed from the records, a plan of real agent actions with expected effects from history, and *Have agents do this* | Built | Proposals go through the normal approval rules; the card then shows what changed on the plan's records. A second plan for the same card is refused while one runs |
| Definitions on labels: KPI, chart, column, filter, record-fact and autonomy labels show a plain-English definition on hover, focus or tap, with a *Learn more* link | Built | From field or KPI help first, then a glossary of property-management terms |
| Help article pages at `/app/help/<id>` | Built | The assistant's help citations link here |
| Readable run steps: each agent step as a plain sentence with linked record names, raw input and output behind *Technical details* | Built | Records outside the viewer's scope show their type only |
| *Summarize with AI* on a record without a summary (record page and peek drawer) | Built | Same scope checks, figure checks and rules fallback as stored summaries; the result is kept in the visitor's copy |
| AI summaries on records, computed from the record's current figures | Built | See [Source labels](#source-labels) |
| Data Health: score, issues by rule and property, before/after fixes, *Apply N safe fixes*, filters from links, bulk apply up to 50 | Built | Fixes that touch money, fraud or legal status, and anything not low risk, always wait in the approvals inbox, whoever clicks. A low-risk fix runs only if the person clicking may decide it |
| Automations at `/app/automations`: every agent with its schedule, events, autonomy, last run, next run and 30-day runs and failures; the 15-minute sweep; event triggers; approval rules; rules built into the product | Built | Events that nothing raises yet are marked as such. Settings → Automations now opens this page |

### Portals and public site

| Requirement | Status | Notes |
| --- | --- | --- |
| Owner portal: briefing, statements with *Explain*, repair approvals, properties, documents, messages | Built | |
| Resident portal: pay rent, autopay, requests with an AI first read, lease and renewal (*Ask about renewing*), renters insurance upload, messages | Built | The first read is rules; staff verify uploaded insurance |
| Vendor portal: accept or decline jobs, send invoices (read from a file), payments, insurance certificates | Built | |
| Applicant portal: status timeline, documents checklist, $55 fee, messages | Built | No real card is charged |
| *Ask AI* in each portal, answered from the person's own records | Built | Rules answer; a model may reword without adding figures |
| Public listings: search by metro, listing detail with pricing and fees, ask about a unit, book a tour | Built | Fair-housing questions get fixed policy text |
| Public application in five steps; the Leasing agent scores it right away; the broker sees it in approvals | Built | Only file names are stored for documents |

### Settings and platform

| Requirement | Status | Notes |
| --- | --- | --- |
| Users, roles matrix, approval policies with change history, state rules, audit log, notifications | Built | |
| Import from other systems: properties, units, residents, leases (rent roll, deposits, opening balances), owners, vendors and aged balances | Built | `/app/settings/import`. See [Import](#import) |
| Integrations | Partial | Status cards only; no outside service is called |
| Platform console: customer orgs, system health, AI usage | Built | Platform admin only |
| Collapsible home and dashboard sections, remembered per persona in this browser; *Reset layout* in the avatar menu | Built | Reset clears collapsed sections and sidebar, panel and drawer sizes; tours, tips, theme and saved views are kept |
| Welcome splash on the home page once a demo day per persona (greeting, what Propniti does for the role, what's new, up to three things waiting); *Don't show again*; *Help › Show welcome screen* brings it back | Built | |
| New-feature dots in the sidebar until the page is visited, and one toast per page view offering that feature's tour | Built | |
| The assistant panel opens on its own once a demo day per persona | Built | After the splash closes, or on the day's first page view |
| Real sign-in and accounts | Not built | |

## Import

`/app/settings/import` (*Settings → Import data*) brings a portfolio over from another system in six steps: *Source*, *Files*, *Columns*, *Review*, *Preview*, *Done*.

- **Sources.** AppFolio, Buildium, Yardi Breeze, Yardi Voyager, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata, or *Other / spreadsheet*. Each tool has report presets that match columns by name, and synthetic sample files to try.
- **What it creates.** Properties, units, residents, leases from a rent roll (with deposits, recurring charges and opening balances when the file has them), owners and owner entities, vendors, and open balances by age.
- **Files.** CSV, TSV or Excel (.xlsx); up to 6 files, 3 MB and 2,000 rows each. Files are read in the browser.
- **Checks are code.** Parsing, value checks, the preview and the write are all done by code. Errors must be fixed or left out before importing. Records already on file are matched and counted, never changed. Opening balances post only to leases the same import creates.
- **AI is optional.** With *Use AI to help map and clean up* on, a model sees only the column headers, the first 5 rows and up to 30 flagged cells per file (60 characters each). It suggests column matches for unmatched columns and cleanups. Nothing changes until a person accepts a suggestion, one by one or with *Accept all*. With the switch off, or no model configured, columns are matched by preset and name, and nothing is sent to a model.
- **One write, once.** The import is one database batch behind an audit lock, so running the same import twice writes nothing the second time.
- **Who.** Staff only. Each record type follows the role's create rights: new properties need a principal or regional manager; opening balances, deposits and recurring charges need a principal, regional manager, property manager or accountant.
- **Undo.** *Recent imports* lists the last 10, each with *Undo import*. Undo removes the records that import created, including later edits to them. It is refused if other records now point at them (a work order, a note, a payment, a unit added by hand) or if any are at a property outside the person's scope. Imported data lives in the visitor's private copy and resets at midnight Pacific.
- **After import.** The import raises `import.completed`; the Data Health agent checks the new records at the next sweep.

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
| Data Health | Admin | Open data issues: duplicates, miscoded bills, contact details, addresses | Daily 06:00 | `data_issue.detected`, `import.completed` | Auto within policy |

Nothing in the product raises `coi.expiring`, `screening.completed`, `statement.closed`, `data_issue.detected` or `prospect.created` yet. The Automations page says so, and those agents cover that work on their schedule.

### Triggers

- **Schedule.** A Cloudflare Cron Trigger runs a sweep every 15 minutes. Each sweep does one unit of work: either the events of one listening agent, or the most overdue scheduled agent. Sweeps run only in visitor workspaces that were active in the last 30 minutes, at most 10 of them.
- **Run on visit.** If no sweep has run for about 17 minutes, the first AI page or request starts one in the background.
- **Events.** Actions write events to an outbox. The sweep raises date-driven events too: `charge.overdue` when rent passes its 3-day grace, and `lease.expiring` when a lease comes within 90 days. A public application starts the Leasing agent right away. A completed import raises `import.completed`, which the Data Health agent picks up at the next sweep.
- **Run now.** Any role with access to the intelligence module can start an agent from `/app/agents`. A side sheet shows the run as it happens.

`/app/automations` shows all of this in one place: each agent's schedule and events, the sweep's last and next run, how many events are waiting, the approval rules, and the rules built into the product (data health checks, late-fee and returned-payment fee caps, payment clearing, the midnight reset).

Each run has a time limit, a step limit and a 50-cent model budget. A run that hits its time limit keeps what it already did.

### How a run works

1. **Collect.** Rules find candidates through logged tool calls. Figures come from the data.
2. **Model.** When a model is configured, it checks the candidates with the same read tools, drafts messages and proposes. Every proposal must match a rules candidate, and the rules set its amount, risk and confidence.
3. **Rules.** With no model, or if the model fails, the rules propose the candidates as written. Candidates the rules mark mandatory (fraud, safety, legal) are always proposed, whatever the model says.

Write tools never move money. They create a proposal, or, after approval, call the guarded money actions.

### Routing: autonomy, risk and policy

The Agents and Automations pages offer two autonomy levels per agent. Only a principal, regional manager or admin can turn an agent on or off or change its autonomy, schedule or approval policies; other roles see the setting read-only. Legal and safety policies can't be set to act alone.

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
- One decision rule (`src/ai/decide.ts`) sets the buttons, the *Needs you* counts and the server check, so they always agree. Low-risk items with no amount need write access to the module; anything with money, legal or safety risk needs approve access. Life-safety items (high-risk items in the risk module, such as an overdue fire inspection) are decided only by the property's regional manager or the principal. Over the owner's limit, the owner or a principal decides.
- Wherever a proposal can be run (the approvals inbox, a record's action buttons, Data Health), one the person can't decide stays in the approvals inbox, or is refused if it is low risk.
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
| Other property management systems | AppFolio, Buildium, Yardi Breeze, Yardi Voyager, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata, any spreadsheet | File import (CSV, TSV, XLSX); no live sync |

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
| Tests | Regressions caught before deploy | 922 unit tests in 98 files; 85 end-to-end tests in 20 specs, run against production after each deploy |
| Errors | No database internals shown to people | AI routes, Data Health results and run steps show "The database is busy; try again in a moment" for database errors; the detail goes to the server log |

**Known gaps.** No real authentication: the demo password is published, anyone can sign in as any persona, and the persona cookie is not a security boundary. The workspace cookie is the only key to a visitor's changes. Six AI routes have no origin check (they are rate limited and size capped). There is no per-org AI quota. Some fields are still editable through generic edits until their actions exist: lease status, budget approval, capex, 1099s, legal cases, service requests and message threads. The full list is in [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Release plan

| Release | Contents | Status |
| --- | --- | --- |
| V1 prototype | Six role views, AI invoice reading and validation, simulated trust-account payments, ratings, rent-roll import | Replaced by v2 |
| v2 | 13 personas with scoped homes; 64 record types in 13 modules; eight scheduled and event-driven agents with approvals, autonomy and policy limits; run traces; assistant; Data Health; record peek drawer; four portals; public listings and applications; per-visitor overlay on a shared base | Live at propniti.ai since 4 November 2026 |
| v2 updates | Demo sign-in form; Inbox; My tasks; Automations; import from other tools with optional AI help; *Ask Propniti* chat bubble; sparkle marks on AI pages; clickable breadcrumbs; approval checks on Data Health fixes and record actions; in-app not-found page; readable run steps; *Summarize with AI*; collapsible home sections | Live, 4 November 2026 |
| v2 updates (evening) | Chat history, *Ask about this*, *Right now*, Do mode starts agents; welcome splash, tour toasts and new-feature dots; approvals and bulk friction fixes; leasing, money and operations shortcuts; one decide rule with life-safety approvals; collection rate per month's charges; *Improve with AI*; label definitions and help pages; compact sign-in layout | Live, 4 November 2026 <!-- confirm after the batch 4 deploy --> |
| Pilot readiness | Real accounts and identity provider, real payment and messaging providers in test mode, owner-portal approval of agent proposals, AP inbox intake of portal invoices, natural-language list filters | Not built |

## Open questions

- [ ] Which agent actions, if any, may run without approval beyond the current low-risk limits?
- [ ] Should the broker desk also list scored applications still at Submitted?
- [ ] Pricing model: per door, per seat or per agent action?
- [x] Market: US only.
- [x] Autonomy: two levels, Approve first and Auto within policy.
- [x] Property NOI: the last closed month.
