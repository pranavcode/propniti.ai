## Overview

Propniti is property management software for US residential and commercial portfolios. Eight AI agents do routine operations work. People approve anything that involves money, legal terms or safety. This spec describes the product live at [propniti.ai](https://propniti.ai). It marks each requirement as built, partial or not built. Source code: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

**Promise.** Know your portfolio is right. Propniti checks, explains and corrects the operations data that money decisions depend on.

| Area | What Propniti has |
| --- | --- |
| Staff app | One app at `/app` for nine staff roles, each with its own home page and scope |
| Record types | 64 record types in 13 modules (portfolio, leasing, residents, maintenance, communications, receivables, payables, accounting, owners, risk, intelligence, settings, platform) |
| AI agents | Collections, Renewals, Leasing, Maintenance triage, Payables, Owner reporting, Compliance and Data Health |
| Portals | Owner, resident, vendor and applicant portals at `/portal/...` |
| Public site | Listings, tour booking and applications at `/listings` and `/apply/...`, with no sign-in |
| Sample data | 30 properties (3,318 units) in Austin, Dallas, Atlanta and Phoenix, with 18 closed months of history |

![System architecture: browsers reach one Cloudflare Worker at propniti.ai, which serves pages and APIs, checks scope, runs the AI runtime, reads a D1 database with a shared base and per-visitor overlays, and calls models through one provider layer; a Cron Trigger starts the sweep every 15 minutes](/docs/architecture/system-architecture.svg#1000x560)

*System architecture. One Worker serves everything. Data is a shared read-only base plus a private overlay per visitor. Models sit behind one provider layer, with rules as the fallback.*

**Product principles.**

- **AI is visible and accountable.** Every AI output shows its source: a live model, a stored earlier result, or rules. It links to the run that produced it.
- **Figures come from data, never from the model.** The code computes every number. A model only words answers and suggests actions. If model text states a figure the data doesn't contain, the app throws it away and shows the rules text instead.
- **Every number clicks through.** KPIs, charts and totals open the records behind them.
- **Fair housing.** Applicant scoring never uses protected characteristics. Criminal history is never scored; it goes to a person.

## Goals and non-goals

**Goals**

- Each role sees its own home, records and next actions. Its region, properties or own record set the scope.
- Agents run on a schedule and on events, without a person starting them. The app records each run step by step.
- Agents propose; people decide. When an admin allows it, low-risk actions inside approval-policy limits may apply on their own.
- The app finds and fixes bad data before owners or auditors see it.
- Money rules (idempotent payments, trust balance checks, bank-change holds) run on the server.

**Non-goals**

- Real accounts, real payments and real messages. Sign-in uses demo accounts with one published password. Payments and messages are simulated.
- Live sync with other property management systems. Data comes in through file import only.
- Markets outside the US.

## Personas

All names and companies are fictional. A visitor signs in on [propniti.ai/login](https://propniti.ai/login) with a demo account, or picks a person from the list beside the form. They can switch at any time from the avatar menu in the top bar (*Switch role (demo)*). `/demo` redirects to `/login`.

**Demo accounts.** Each persona has the email `<id>@propniti.demo` (for example `marcus@propniti.demo`). Every account uses the published password `propniti-demo`. Beside the form, *Pick a person* lists all 13 people. Click one (or move with the arrow keys) to fill the form, then click *Sign in as …*. A double-click signs in straight away. *What each person sees*, below, describes each persona. `/login?as=<id>` prefills a person. The app keeps a `next` link to an `/app` or `/portal` page. The browser remembers the last person. A visitor who is already signed in sees *Continue as …* and *Switch person*. The form also works without JavaScript.

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

A role × module matrix sets what each role may do in each module: none, read, write or approve. Settings → Roles shows it. Portal personas see only rows tied to their own record. Staff pages send them back to their portal.

## Functional requirements

Status: **Built** means it works end to end on propniti.ai. **Partial** means part of it works; the note says which part. **Not built** means it is not in the code.

### Navigation and records

| Requirement | Status | Notes |
| --- | --- | --- |
| Sign-in at `/login` with a demo email and password, or the *Pick a person* list beside the form (click fills, arrow keys move, double-click signs in); role switch from the avatar menu or the banner's *Switch* | Built | One published password, checked on the server in constant time. A cookie holds the chosen persona. Not an account system |
| A home page per role | Built | See [Personas](#personas) for each landing page |
| List pages for every record type, with search, filters, status tabs, saved and shared views and server-side paging (25, 50 or 100 rows) | Built | Generated from each record type's definition |
| *Download* on lists, reports and owner statements: CSV, Excel (.xlsx) or PDF, with optional Propniti branding (logo, scope, filters, time and a footer) on Excel and PDF | Built | Downloads what is on screen: same permission, scope, filters and visible fields as the list. Up to 10,000 rows. The app neutralises cells that start like a spreadsheet formula |
| Action feedback: a top progress bar while a page loads, a summary line after a filter click ("Showing … · Clear") that scrolls the results into view, toasts for approvals, bulk actions and refreshes, and "Updated just now" on sections whose figures changed | Built | Clicking the sidebar link of the current page refreshes it |
| Light, dark and system themes from the top bar or ⌘K | Built | *System* is the default and follows the device. Portals and `/docs` use the same choice |
| Dates read like "Nov 4, 2026"; date inputs don't depend on the browser's locale | Partial | Tables, record pages and date inputs follow it. A few KPI tiles and report subtitles still show "2026-11-04" |
| Every sidebar link opens a page the persona can use; each persona's home is in the sidebar; the section holding the current page opens | Built | Checked for all 13 personas |
| No sideways scrolling on phones | Built | Wide tables scroll inside their card, with edge shades |
| *Select all N matching* for bulk actions, real bulk labels, *New* forms prefilled from the current filter, *View* links in toasts | Built | Bulk selection is rate limited |
| Record pages with tabs, Activity, Notes, Tasks and Documents, an AI summary and a Data health panel | Built | Tabs appear when the record type supports them |
| Record peek drawer: a list row opens the record in a side drawer (a bottom sheet on phones), with J and K to move between rows and *Open full page* | Built | The URL carries `?peek=<id>`, so you can link to a drawer |
| ⌘K command palette: records, pages, quick actions and "Ask AI" | Built | |
| Breadcrumbs: section and group names open their first page; *Home* opens the persona's home | Built | |
| AI-powered pages marked in the sidebar and ⌘K with a sparkle (Inbox, Copilot, Agents, Approvals, AI activity, Automations, Data health); the *AI agents* section sits near the top of the sidebar | Built | Tooltip: "AI-powered: agents propose, you approve" |
| Inbox at `/app/inbox`: conversations waiting on your reply, agent proposals you can decide, and your alerts, with tabs *All*, *Messages*, *Approvals* and *Alerts* | Built | 25 rows a page. A sidebar badge counts what needs you. *Reply* and *Review* open the page that does the work |
| My tasks at `/app/tasks`: tasks assigned to you or your role, with *Open*, *Overdue*, *Today*, *Upcoming* and *Done* views, filters, *New task*, mark done or reopen, *Snooze* and *Reassign* | Built | Due dates use the demo date. A double click changes a task once |
| A record outside your scope opens an in-app page: "This record isn't in your scope or doesn't exist" | Built | Unknown and out-of-scope records look the same |
| Locked records (paid bills, sent offers, ended leases) can't be edited | Partial | The server refuses the save, but the Edit button still shows |
| Natural-language list filter | Not built | The `/api/ai/nl-filter` route exists, but no list page calls it |

### Portfolio and reporting

| Requirement | Status | Notes |
| --- | --- | --- |
| Portfolio and regional homes with KPIs, charts, a property comparison and an approvals queue | Built | Daniel and Priya |
| *Explain* on KPIs and per-property variance: drivers and the properties that moved the number | Built | Code computes the facts. A model words them, or rules do |
| Property NOI shows the last closed month | Built | Labelled "NOI (last month)". The month in progress is never used |
| What-if: rent, occupancy and expense changes recompute NOI per property, with an optional narrated explanation | Built | The math is deterministic. The narration is a traced agent run |
| Reports: P&L, rent roll, AR aging, NOI by property, cash forecast; *Build report* from a question | Built | Open to the principal, regional managers, property managers and accountants. Other roles see a page saying reports aren't part of their role. The question becomes a report spec. Rules answer when no model does |
| One past-due figure: *Delinquent* on the principal's home, Finance and the delinquency page all count open charges past their due date today, in every aging bucket | Built | Compared with the balance at the last month-end close |
| Budget vs actual with *Explain a variance* | Built | |

### Leasing

| Requirement | Status | Notes |
| --- | --- | --- |
| Leasing day view: briefing, tours, follow-ups due, agent proposals | Built | Lena |
| Pipeline board: move prospects between stages, with *Undo* | Built | |
| Follow-ups: send one or *Send all*; stale leads followed up or reassigned in bulk; *Rewrite with AI* on drafts | Built | |
| Listing editor with *Draft with AI* and a fair-housing language check | Built | Flagged wording blocks the save |
| Application scoring with reasons for and against, and a recommendation | Built | Rules score. Criminal history is never scored |
| Broker decision on the application record: approve, approve with conditions, deny | Built | A conditional approval needs a reason |
| Renewals: the agent prices an offer with reasons; a person accepts or edits, drafts with AI and sends; renewal drafts prepared in bulk and renewal follow-ups | Built | An approver's edits reach the sent message |

### Residents and communications

| Requirement | Status | Notes |
| --- | --- | --- |
| Property manager's Today page: briefing with links, KPIs, charts, approvals, leases ending without an offer | Built | Marcus |
| Resident 360: ledger, lease, terms and rent schedule | Built | |
| Conversations (`/app/communications/inbox`): *Suggest a reply*, edit, send | Built | The app stores messages but delivers nothing outside the app |
| Lease abstraction: reads the lease on file, cites pages, flags mismatches and fixes the record | Built | |
| Announcements: AI draft for a property, then send to its residents | Built | Delivery is simulated |
| Delivery by email or SMS | Not built | Settings → Integrations shows simulated connection status only |

### Maintenance and compliance

| Requirement | Status | Notes |
| --- | --- | --- |
| Maintenance home: SLA KPIs, triage queue, approvals, invoices to approve, vendor insurance | Built | Tom |
| Intake: the app saves a plain-language request and the agent triages it (trade, urgency, cost estimate, vendor); *Dispatch as suggested* | Built | Uses the same decide rule. The server checks confidence |
| Request certificates of insurance from vendors; vendor certificates prefilled and read by AI; escalate late make-readies | Built | |
| Board and calendar of open work orders | Built | |
| Technician view: start a job, log time, mark done | Built | |
| Vendor invoice check against the purchase order, then *Approve and pay* once | Built | Rules only (totals within 2%, line groups, line sums, photos on file). The app blocks payment while a vendor bank change is unverified. It also blocks payment above the owner's limit without the owner's approval |
| Compliance: certificates of insurance, permits, inspections, legal cases, with an expiries timeline | Built | Roles without access don't see legal cases |

### Finance

| Requirement | Status | Notes |
| --- | --- | --- |
| Receivables: delinquency aging that drills to residents, ledgers and charges | Built | |
| Record a payment; a double click records one payment | Built | Simulated money |
| Collections workbench: a rules risk score with reasons, drafted reminders in English or Spanish; *Remind* and *Record payment* from the delinquency list | Built | |
| Payment run: pay approved bills in one run; bills over the limit go to staff approvers | Built | Simulated money |
| Collection rate: the share of each month's own charges paid so far, never over 100% | Built | Payments toward older balances don't count toward the current month |
| Returned payments with a state-capped fee; deposit dispositions | Built | |
| AP inbox: read an uploaded invoice, suggest GL coding, run payables checks, approve and pay | Built | A vision model reads the invoice when one is configured. Otherwise, a person enters it by hand |
| Hold payments on an unverified vendor bank change; a different person must verify it | Built | |
| Owner statements with *Explain* per line and distributions | Built | |
| Bank reconciliation with suggested matches | Built | |
| 1099 preparation | Built | |
| Vendor invoices from the portal reach the AP inbox | Not built | They appear only on the work order's *Invoice and PO* tab |

### AI and data health

| Requirement | Status | Notes |
| --- | --- | --- |
| Eight agents on a schedule, on events and on *Run now* | Built | See [Agent behaviour](#agent-behaviour). Agent names read in title case, for example *Collections Agent* |
| Agents page: status, counters, autonomy, *Run now*, approval-policy limits | Built | `/app/agents` |
| Approvals inbox with tabs *Needs you*, *Handled automatically*, *Waiting on others*, *Decided*; bulk approve of low-risk items | Built | `/app/ai/approvals` |
| Approvals deep link: `?proposal=<id>` or `?record=applications/<id>` opens and highlights that proposal | Built | |
| Approvals inbox filters, *Approve all low-risk matching*, *Waiting on others* with *Notify approver* | Built | Bulk approval covers low-risk items only |
| Owner approves proposals waiting on the owner | Partial | The owner portal lists repairs over the owner's limit. Agent proposals in *Waiting on others* don't appear there. A principal can decide them |
| AI activity: every run with trigger, model, tokens and cost; an AI audit log | Built | `/app/ai/activity` |
| Run trace that streams steps while the run is going | Built | `/app/ai/runs/<id>` |
| Assistant (⌘J and `/app/copilot`): Ask, Do and Help modes; each turn is a traced run; saved conversations | Built | Do mode turns rent-reminder requests into proposals. `/app/copilot` lists the 30 most recent conversations. The side panel keeps a conversation for the session only. On desktop, tablet and phone, the chat fills the page and the message box stays on screen |
| Sample Copilot conversations: 28 threads across the staff, owner, resident and vendor personas, marked *Sample* | Built | The rules assistant computed them from the sample data, and they ship in the base. Each belongs to its persona. A follow-up continues the thread in the visitor's own copy |
| *Ask Propniti* chat bubble on staff pages: opens the assistant with page-aware suggested questions, and offers one tip at a time from real data | Built | At most one tip per page view, two minutes apart and five per session. No tips during a tour, typing or a dialog. *Show tips* turns them off |
| Chat history in the assistant panel: recent conversations per persona, *New*, open as a page | Built | |
| *Ask about this* on a record: the assistant answers about that record, using its facts by name | Built | Also in the portals, limited to the person's own records |
| *Right now* in the assistant panel: up to three one-click items from your counts (approvals waiting, past-due balances, data issues) | Built | |
| Do mode can start agents | Built | Their proposals follow the normal approval rules |
| *Improve with AI* on a red KPI (delinquency, occupancy, work-order SLA): drivers computed from the records, a plan of real agent actions with expected effects from history, and *Have agents do this* | Built | Proposals go through the normal approval rules. The card then shows what changed on the plan's records. While one plan runs, the app refuses a second plan for the same card |
| Definitions on labels: KPI, chart, column, filter, record-fact and autonomy labels show a plain-English definition on hover, focus or tap, with a *Learn more* link | Built | Field or KPI help comes first, then a glossary of property-management terms |
| Help article pages at `/app/help/<id>` | Built | The assistant's help citations link here |
| Readable run steps: each agent step as a plain sentence with linked record names, raw input and output behind *Technical details* | Built | Records outside the viewer's scope show their type only |
| *Summarize with AI* on a record without a summary (record page and peek drawer) | Built | Same scope checks, figure checks and rules fallback as stored summaries. The app keeps the result in the visitor's copy |
| AI summaries on records, computed from the record's current figures | Built | See [Source labels](#source-labels) |
| Data Health: score, issues by rule and property, before/after fixes, *Apply N safe fixes*, filters from links, bulk apply up to 50 | Built | Counts are scoped to the persona. Issues show rule names, record names and readable values, never rule ids or raw keys. An issue with no automatic fix gives a manual next step and a link to the record. Some fixes always wait in the approvals inbox, whoever clicks: those that touch money, fraud or legal status, and anything not low risk. A low-risk fix runs only if the person clicking may decide it. An admin's fixes go to the approvals inbox |
| Automations at `/app/automations`: every agent with its schedule, events, autonomy, last run, next run and 30-day runs and failures; the 15-minute sweep; event triggers; approval rules; rules built into the product | Built | The page marks events that nothing raises yet. Settings → Automations opens this page |

### Portals and public site

| Requirement | Status | Notes |
| --- | --- | --- |
| Owner portal: briefing, statements with *Explain*, repair approvals, properties, documents, messages | Built | |
| Resident portal: pay rent, autopay, requests with an AI first read, lease and renewal (*Ask about renewing*), renters insurance upload, messages | Built | Rules give the first read. Staff verify uploaded insurance |
| Vendor portal: accept or decline jobs, send invoices (read from a file), payments, insurance certificates | Built | |
| Applicant portal: status timeline, documents checklist, $55 fee, messages | Built | No real card is charged |
| *Ask AI* in each portal, answered from the person's own records | Built | Rules answer. A model may reword without adding figures |
| Public listings: search by metro, listing detail with pricing and fees, ask about a unit, book a tour | Built | Fair-housing questions get fixed policy text |
| Public application in five steps; the Leasing agent scores it right away; the broker sees it in approvals | Built | For documents, the app stores only file names |

### Settings and platform

| Requirement | Status | Notes |
| --- | --- | --- |
| Users, roles matrix, approval policies with change history, state rules, audit log, notifications | Built | |
| Import from other systems: properties, units, residents, leases (rent roll, deposits, opening balances), owners, vendors and aged balances | Built | `/app/settings/import`. See [Import](#import) |
| Guided setup at `/app/onboarding`: company, data import with file detection, suggested approval limits and agent autonomy, team, and a Data Health check with a summary | Built | Principal, regional manager or admin. See [Guided setup](#guided-setup) |
| Integrations | Partial | Status cards only. The app calls no outside service |
| Platform console: customer orgs, system health, AI usage | Built | Platform admin only |
| Collapsible home and dashboard sections, remembered per persona in this browser; *Reset layout* in the avatar menu | Built | Reset clears collapsed sections and sidebar, panel and drawer sizes. It keeps tours, tips, theme and saved views |
| Welcome splash on the home page once a demo day per persona (greeting, what Propniti does for the role, what's new, up to three things waiting); *Don't show again*; *Help › Show welcome screen* brings it back | Built | |
| New-feature dots in the sidebar until the page is visited, and one tour offer per browser session | Built | The offer sits over the foot of the sidebar, so it never covers a table. On phones, tablets and the collapsed rail, the chat bubble offers it |
| The assistant panel opens on its own once a demo day per persona | Built | After the splash closes, or on the day's first page view |
| Real sign-in and accounts | Not built | |

## Import

`/app/settings/import` (*Settings → Import data*) brings a portfolio over from another system in six steps: *Source*, *Files*, *Columns*, *Review*, *Preview*, *Done*.

- **Sources.** AppFolio, Buildium, Yardi Breeze, Yardi Voyager, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata, or *Other / spreadsheet*. Each tool has a tile with its report presets, which match columns by name. The tile also has *Try samples*, which loads that tool's synthetic sample files in one click.
- **What it creates.** Properties, units, residents, leases from a rent roll (with deposits, recurring charges and opening balances when the file has them), owners and owner entities, vendors, and open balances by age.
- **Files.** CSV, TSV or Excel (.xlsx); up to 6 files, 3 MB and 2,000 rows each. The browser reads the files.
- **Checks are code.** Code does the parsing, value checks, preview and write. You must fix errors or leave them out before importing. The import matches and counts records already on file, and never changes them. Opening balances post only to leases the same import creates.
- **AI is optional.** With *Use AI to help map and clean up* on, a model sees only the column headers, the first 5 rows and up to 30 flagged cells per file (60 characters each). It suggests matches for unmatched columns, and cleanups. Nothing changes until a person accepts a suggestion, one by one or with *Accept all*. With the switch off, or no model configured, presets and names match the columns. Nothing goes to a model.
- **One write, once.** The import is one database batch behind an audit lock. If you run the same import twice, the second run writes nothing.
- **Who.** Staff only. Each record type follows the role's create rights. New properties need a principal or regional manager. Opening balances, deposits and recurring charges need a principal, regional manager, property manager or accountant.
- **Undo.** *Recent imports* lists the last 10, each with *Undo import*. Undo removes the records that import created, including later edits to them. The app refuses undo if other records now point at them (a work order, a note, a payment, a unit added by hand). It also refuses if any are at a property outside the person's scope. Imported data lives in the visitor's private copy and resets at midnight Pacific.
- **After import.** The import raises `import.completed`. The Data Health agent checks the new records at the next sweep.

## Guided setup

`/app/onboarding` (*Set up your portfolio*) takes a new customer from nothing to a checked portfolio in five steps. A principal, regional manager or admin can use it; other roles see who can. You can skip each step. The app saves progress to the org's settings on every move, so the flow resumes where you left it.

| Step | What happens |
| --- | --- |
| Company | Company name, the states you operate in and roughly how many units you manage. Late-fee caps, notice periods and deposit rules follow the states |
| Bring your data | Drop exports in any mix, or *Try sample files*. Rules identify each file's source tool and contents from its columns and name, with a confidence and the reason. *Use AI to identify files and suggest fixes* is on by default when a model is available. With it on, a model may name files the rules can't place. Only file names, header rows and the first 3 rows go to it, each cell cut to 60 characters. The file then goes through the import wizard, starting at column matching |
| Approval rules | Approval limits and agent autonomy sized from the records: medians and percentiles of completed work orders, bills and rents. Each has its basis sentence, sample size and confidence. *Accept*, *Edit* or *Keep current* each one. Code computes the figures; the model plays no part. The step never suggests rules for legal, safety or owner distributions |
| Your team | Add people with a role and what they cover (whole company, regions or properties). The principal and the admin can add people. A principal can't grant the admin role or cover properties outside their scope. People exist only in the visitor's copy. No email is sent |
| Check and finish | Data Health runs its rules over the imported records and files each problem as an issue. A summary shows what was imported, issues found, rules set and people added |

Each step reuses the existing import, approval-policy, agent and user routes, so the same permission checks apply. Saves run one at a time, so a quick *Continue* can't overwrite a limit that was just saved.

## Agent behaviour

Each agent has a goal, a tool allow-list, triggers, a default autonomy level and the actions its proposals may run.

![Agent run flow: six triggers start a run in the orchestrator; the agent collects candidates with read tools and an optional model; each proposal is routed by autonomy, policy limits and always-a-person rules; it applies on its own or waits for a person allowed by the decide rule; the registered action re-checks the record and runs once](/docs/architecture/agent-run-flow.svg#1000x622)

*How an agent run turns into a change. Agents only propose. Every change runs through a registered action that first re-checks scope and the record.*

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

These are the defaults in code. The sample data's agent settings can set other schedules, and an admin can change them. The Agents and Automations pages show the schedule in effect, in plain words.

Nothing in the product raises `coi.expiring`, `screening.completed`, `statement.closed`, `data_issue.detected` or `prospect.created` yet. The Automations page says so. Those agents cover that work on their schedule.

### Triggers

- **Schedule.** A Cloudflare Cron Trigger runs a sweep every 15 minutes. Each sweep does one unit of work: the events of one listening agent, or the most overdue scheduled agent. Sweeps run only in visitor workspaces active in the last 30 minutes, at most 10 of them.
- **Run on visit.** If no sweep has run for about 17 minutes, the first AI page or request starts one in the background.
- **Events.** Actions write events to an outbox. The sweep also raises date-driven events. It raises `charge.overdue` when rent passes its 3-day grace, and `lease.expiring` when a lease comes within 90 days. A public application starts the Leasing agent right away. A completed import raises `import.completed`. The Data Health agent picks it up at the next sweep.
- **Run now.** Any role with access to the intelligence module can start an agent from `/app/agents`. A side sheet shows the run as it happens.

`/app/automations` shows all of this in one place. It lists each agent's schedule and events, the sweep's last and next run, and how many events are waiting. It also shows the approval rules and the rules built into the product (data health checks, late-fee and returned-payment fee caps, payment clearing, the midnight reset).

Each run has a time limit, a step limit and a 50-cent model budget. A run that hits its time limit keeps what it already did.

### How a run works

1. **Collect.** Rules find candidates through logged tool calls. Figures come from the data.
2. **Model.** When a model is configured, it checks the candidates with the same read tools, drafts messages and proposes. Every proposal must match a rules candidate. The rules set its amount, risk and confidence.
3. **Rules.** With no model, or if the model fails, the rules propose the candidates as written. The rules always propose candidates they mark mandatory (fraud, safety, legal), whatever the model says.

Write tools never move money. They create a proposal, or, after approval, call the guarded money actions.

### Routing: autonomy, risk and policy

The Agents and Automations pages offer two autonomy levels per agent. Only a principal, regional manager or admin can turn an agent on or off. Only they can change its autonomy, schedule or approval policies. Other roles see the setting read-only. Legal and safety policies can't be set to act alone.

- **Approve first.** Every proposal waits for a person.
- **Auto within policy.** A proposal applies on its own only when all of these hold: its risk is Low, it is not marked always-human, and its amount is within the policy limit. It runs in the visitor's own workspace, and the app logs it.

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

Some owner entities override the maintenance and bill limits. On money actions, the money code enforces only the owner threshold for maintenance spend. The other limits route proposals.

### Approvals

- Each proposal shows its title, amount, risk, source, reasons, confidence (High, Medium or Low with a percentage), the records it used and a link to its run.
- A person approves or rejects. They can also edit the wording of a drafted message and then approve. Nobody can edit the recipient, record or amounts.
- Before an approved proposal runs, the server checks three things again. The record is in the approver's scope. Its key fields haven't changed since the agent looked. The action is still allowed. Then it runs once.
- One decision rule (`src/ai/decide.ts`) sets the buttons, the *Needs you* counts and the server check, so they always agree. Low-risk items with no amount need write access to the module. Anything with money, legal or safety risk needs approve access. Only the property's regional manager or the principal decides life-safety items: high-risk items in the risk module, such as an overdue fire inspection. Over the owner's limit, the owner or a principal decides.
- A proposal can run from the approvals inbox, a record's action buttons or Data Health. Wherever it runs, a proposal the person can't decide stays in the approvals inbox. If it is low risk, the app refuses it instead.
- Re-running an agent doesn't duplicate a proposal that is still open.

### Source labels

Every AI output says where it came from.

| Where | Labels |
| --- | --- |
| Badges on proposals, answers and drafts | **AI** (a live model call), **AI · saved** (stored from an earlier run), **Rules** (no model, so fixed rules wrote it; figures still come from the data) |
| AI summaries on record pages and in the peek drawer | **Rules · from this record's current figures**, **Generated · model · time**, **Precomputed · model · time** |

The app shows a stored model summary only while its source facts still match the record. When the figures change, the rules write a sentence from the current figures instead.

Model choice: an Anthropic key, then an OpenAI key, then Workers AI (Llama 4 Scout) on Cloudflare. `AI_PROVIDER` can force one. With no model, everything runs on rules and says so.

## Data model

| Layer | What it holds |
| --- | --- |
| Shared base | The sample portfolio: 30 properties, their units, residents, leases, ledgers, vendors, owners, work orders, 18 closed months of metrics, agent history and data issues. Read-only while the app runs |
| Visitor overlay | Each visitor's changes, in rows with the same ids. An overlay row replaces the base row with that id. A deleted overlay row hides it |

- The schema has 106 tables (`migrations/0002_v2.sql`, plus migrations 0003–0008 for indexes and further fields).
- Money is stored as integer cents. Transfers and the audit log are append-only.
- AI tables: agent definitions, runs, steps, events, proposals, decisions, approval policies, summaries and assistant threads.
- Each visitor's overlay is private and found by an HttpOnly cookie. The app deletes it at the first midnight Pacific after it was created.
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

| Area | Requirement | How Propniti meets it |
| --- | --- | --- |
| Scale | Bounded queries and pages | 30 properties and 3,318 units of sample data; pages of 25, 50 or 100 rows; downloads capped at 10,000 rows |
| Scope | No reads or writes outside a persona's scope | Every list, metric and download filters by scope in SQL. Portal users see only their own records. The scope check runs inside the write |
| Workflow | Status fields change only through their actions | Only named actions set system fields. Ledger tables are actions-only. Locked records refuse edits |
| Money | No double payments; nothing paid that isn't held | Guarded SQL batches, one live transfer per idempotency key, trust balance recomputed in SQL, bank-change hold |
| AI safety | Model output can't act or invent figures | Untrusted text framed as data; schema-checked output; proposals must match a rules candidate; unsupported figures rejected |
| AI cost | Bounded spend | 20 AI calls a minute per IP; per-run step limit, deadline and 50-cent budget |
| Abuse | Bounded writes | Same-origin check on writes and on the AI routes the app calls, except the read-only status and run-stream routes. 60 writes a minute per IP. Body size caps. 30 new workspaces per IP an hour |
| Reliability | AI failure doesn't block work | Rules take over and the label says so |
| Tests | Regressions caught before deploy | Measured on 4 November 2026: 1,279 unit tests in 141 files; 190 end-to-end tests in 34 specs. After each deploy, the touched specs run against production |
| Errors | No database internals shown to people | For database errors, AI routes, Data Health results and run steps show "The database is busy; try again in a moment". The detail goes to the server log |

**Known gaps.** No real authentication. The demo password is published, and anyone can sign in as any persona. The persona cookie is not a security boundary. The workspace cookie is the only key to a visitor's changes. There is no per-org AI quota. Some fields have no named action, so generic edits can change them: lease status, budget approval, capex, 1099s, legal cases, service requests and message threads. The full list is in [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).

## Roadmap

Propniti has been live at [propniti.ai](https://propniti.ai) since 4 November 2026. Not built yet, for a pilot: real accounts and an identity provider, real payment and messaging providers in test mode, owner-portal approval of agent proposals, AP inbox intake of portal invoices, and natural-language list filters.

## Open questions

- [ ] Which agent actions, if any, may run without approval beyond the current low-risk limits?
- [ ] Should the broker desk also list scored applications still at Submitted?
- [ ] Pricing model: per door, per seat or per agent action?
- [x] Market: US only.
- [x] Autonomy: two levels, Approve first and Auto within policy.
- [x] Property NOI: the last closed month.
