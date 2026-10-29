## Overview

Propniti is an agent-first property management platform for US multifamily and commercial portfolios. AI agents do the routine operations work. A property manager approves anything that moves money. This spec covers V1 — what the live prototype at [propniti.ai](https://propniti.ai) already does, and what is planned next. Source code: [github.com/pranavcode/propniti.ai](https://github.com/pranavcode/propniti.ai) (AGPL-3.0).

**Problem.** Property managers spend their day on repetitive work: chasing rent, checking vendor invoices against purchase orders, reminding tenants about renewals and re-keying data between tools. Incumbents such as AppFolio and Buildium are systems of record. They store the data, but the manager still does the work.

**Solution.** An always-on orchestrator agent watches every property, tenancy, work order and payment. It nudges people about pending actions. It reads and validates documents such as invoices and bills. It runs multi-step operations end to end. The manager approves or sends work back. The agent does the rest.

**Moat.** An agent validates financial documents, and an audit log records every decision. The agent reads a vendor's invoice (photo or PDF), checks it against the purchase order and scores its confidence. Rule-based checks can overrule the model. Every payment waits for a person.

**Long-term direction.** The same property data feeds ESG reporting. V2 starts with CRREM (Carbon Risk Real Estate Monitor) decarbonisation-pathway analysis for large multifamily and commercial properties. ESG platforms such as Measurabl use this analysis.

## Goals and non-goals

V1 proves that agents can take routine operations off a property manager's plate without making costly mistakes.

**Goals (V1)**

- A new manager brings in their existing portfolio within minutes. They use the rent roll their current tool already exports.
- One manager sees and acts on everything that needs attention from a single dashboard. Each item takes one click.
- The agent reads each vendor invoice and checks it against the purchase order before anyone pays. A clean invoice takes one approval.
- Every dollar is traceable through the trust account: rent in, management fee, vendor bills and owner payouts. Each party sees their own share.
- Overdue rent, expiring leases and poor ratings show up as alerts. Alerts reach each person on their preferred channel.
- Every AI result carries a confidence score and its evidence. No AI result moves money on its own.
- Every role — manager, owner, tenant, maintenance, vendor, admin — has a view built for its job.

**Non-goals (V1)**

- Replacing AppFolio or Buildium as the accounting system of record.
- Marketing and CRM for leasing vacant units.
- CRREM and ESG reporting (V2).
- Markets outside the US. Decided: V1 is US-only — ACH payments, US phone numbers and IRS 1099-NEC forms for vendors.

## Personas

The property manager is the primary user and buyer. Every other role sees only its own slice.

| Persona | Needs | Views in the prototype |
| --- | --- | --- |
| **Property manager** (primary) | Run more properties with less manual work; approve agent actions | Dashboard, properties, tenants, work orders, assistant; a detail page for each work order, tenancy and property |
| Owner | See how their buildings perform without chasing the manager | Overview, tenants, maintenance and payouts — for their properties only |
| Tenant | Know what they owe and when; pay; raise issues | Home, rent and invoices (pay by ACH), maintenance requests |
| Maintenance | Receive jobs, report progress, prove completion | My jobs: start, add photo notes, mark complete |
| Vendor | Get work orders, invoice against the PO, get paid | Work orders with AI invoice upload, payments and 1099-NEC status, company profile |
| Admin | Manage users and watch the system | System health (including the active AI provider), users and ID-verification status, audit log |

In the demo, a separate **Demo** control at the bottom of the screen switches between roles. It is a demo aid, not part of the product.

## Use cases and status

The prototype covers nine use cases end to end. They include simulated payment flows, ratings and AI-native onboarding. Live sync with other tools, marketing and CRREM come later.

| Use case | Feature | Personas | Status |
| --- | --- | --- | --- |
| Run more properties per manager | Dashboard with portfolio stats, alerts with one-click actions and agent activity; detail pages | Manager | Built |
| Vendor work-order automation | AI validation of the invoice against the PO, confidence score, approve and pay, or send back | Manager, vendor | Built |
| Read invoices and bills with AI | Upload a photo or PDF; a vision model extracts vendor, line items and total, and checks the document is consistent | Vendor, manager | Built |
| Track critical events | Overdue-rent, lease-renewal and low-rating alerts; nudges on each person's channel | Manager, tenant | Built |
| Query to action | Assistant answers from portfolio data. The app computes figures for overdue rent, renewals and open work orders; the model suggests next actions | Manager | Built |
| A view per role | Role-specific screens | All | Built |
| Money through a trust account | Rent → trust account → 8% management fee → owner payout net of vendor bills; vendor payouts on approval; pending → cleared (simulated ACH) | Tenant, manager, owner, vendor | Built (simulated) |
| Ratings and feedback | Ratings after jobs and for managers and properties; profile averages; 1–2★ alerts | Tenant, manager, maintenance, vendor | Built |
| Onboarding and data import | AI-native setup: import a CSV/TSV rent roll from AppFolio, Buildium, Yardi or a spreadsheet, or paste free text; row checks; bank connection and invites (simulated) | Manager | Built |
| Live sync with other tools | Ongoing two-way sync with AppFolio or Buildium through their APIs | Manager | Later |
| Marketing and CRM | Lead follow-up for vacant units | Manager | Later |
| CRREM carbon pathways | Property energy data compared with decarbonisation pathways | Owner, manager | V2 |

## Functional requirements

Each requirement states what must be true for it to count as done. Items marked built are verified in the live prototype.

### Dashboard and detail pages (built)

- The dashboard shows the number of properties and units, occupancy, rent collected against rent billed for the month, and the count of items needing attention.
- Each alert (overdue rent, lease renewal, invoice to validate) links to its detail page. It offers its action in one click: Nudge tenant, Send renewal offer or Review.
- Work orders, tenancies and properties each have a detail page with a "Back to dashboard" link. Work-order IDs in the agent activity feed link to their page.
- A tenancy page shows rent, lease dates, overdue balance, contact details and preferred channel, invoices and messages sent. A property page shows occupancy, owner, tenancies and work orders.

### Vendor invoice validation (built)

- For a submitted work order, "Run AI validation" compares the total, each line item and the photo count with the purchase order. It returns a decision (approve, review or reject), a confidence from 0 to 1, the matched evidence and every issue.
- A total within 2% of the PO counts as a match. Validation groups line items by the text before the first comma (ignoring case). It compares each group one-to-one with the same group on the PO. So a changed quantity shows as a price mismatch. Validation never approves an invoice if it has no lines, contains negative amounts, its lines don't add up to its stated total to the cent, or it leaves out a PO item.
- At 85% confidence or higher with no issues the action reads "Approve & pay (one tap)". Otherwise it reads "Approve & pay anyway". "Send back to vendor" sends the issues to the vendor.
- Only a submitted job can be approved, so a repeat click does nothing. The app refuses approval when the trust account can't cover the payout. An approved vendor job shows Payment pending until its payout clears, then Paid. The vendor gets a message. Their year-to-date total counts cleared payouts only. The app discards a validation result if the invoice changed while it was running.

### AI document reading (built)

- Vendors (on their work order) and managers (on the work-order page) can upload a JPEG, PNG, WebP or PDF of up to 4 MB.
- The model extracts vendor, invoice number, date, line items, total and currency. Five checks follow: it is an invoice or bill; vendor and invoice number are present; line items add up to the total (within 1% or $1); amounts are in US dollars; legibility is 70% or higher.
- A failed check blocks use of the result. A legibility score under 70% needs an explicit confirmation that someone checked the figures against the document. The extracted lines can then fill the vendor's invoice or replace the submitted figures on a work order. Validation then runs again.
- Files are read in memory and discarded; nothing is stored. The upload panel links two sample invoices, one clean and one with problems.

### Events and nudges (built)

- Overdue rent invoices and leases ending within 45 days raise alerts.
- A nudge or renewal offer goes to the person's preferred channel (SMS, WhatsApp, email or voice). It also appears in their in-app inbox and the audit log. The prototype simulates delivery.

### Assistant (built)

- The manager asks a question in plain English. The answer uses portfolio data only and lists up to three suggested actions. Suggested prompts cover late rent, lease renewals and open work orders.
- For questions about overdue rent, lease renewals and open work orders, the figures in the answer always come from the app's own calculation. The model adds only the suggested actions, and a note says so. For other questions, the model answers from the portfolio data. The app tells the model to treat that data as data, never instructions.

### Other roles (built)

- **Tenant:** sees next payment, rent and lease dates; pays an invoice (simulated ACH); reports an issue, which creates a job assigned to maintenance.
- **Maintenance:** starts a job, adds photo notes and marks it complete (status Completed).
- **Vendor:** submits an invoice against the PO with photos; sees payouts and 1099-NEC status (issued at $600 or more a year).
- **Owner:** sees occupancy, last payout, tenants and work orders for their own properties only.
- **Admin:** sees users and ID-verification status, system health including the active AI provider, and the full audit log; can reset the demo data to its starting state.

### Payments through a trust account (simulated)

- A tenant pays a due or overdue invoice by bank (ACH). The invoice shows Processing, and a pending transfer into the trust account appears. About 8 seconds later (simulated settlement), the transfer clears. The invoice then shows Paid, and the app tells the tenant the payment was received.
- When rent clears, the 8% management fee moves from trust to the manager in the same step (e.g. $148 on $1,850).
- Approving a vendor invoice creates a pending vendor payout from trust, charged to that property's owner. The payout clears the same way, and the app notifies the vendor.
- Each owner's statement shows, since their last payout: cleared rent, minus management fees, minus vendor bills (pending or cleared). *Pay owner* sends the balance from trust and closes the statement. The app refuses it when nothing is owed or the trust account can't cover it.
- Every transfer carries an idempotency key (e.g. one rent transfer per invoice), so a double click or retry never moves money twice. The server enforces every money rule, and the browser can't bypass them.
- The manager's Payments tab shows the trust balance (cleared, available, incoming, outgoing), owner statements and every transfer, newest first; owners and vendors see their own payouts.

### Ratings and feedback

- Tenants rate each finished job on their unit, their property manager and their building. A job is finished when it is Paid, or Completed for in-house work. For a job, tenants rate the vendor or the in-house maintenance worker. Managers rate the vendor or maintenance worker on each paid job.
- A rating is 1–5 stars plus an optional comment of up to 300 characters; submitting requires a star value.
- One rating per person, subject and job: rating again replaces the earlier one.
- Averages and counts show on the vendor profile, the maintenance worker's page, property pages, the owner's overview and the manager's Ratings tab.
- Any 1–2 star rating raises a dashboard alert for the manager, linked to the work order when there is one.

### Onboarding and portfolio import

- A manager who signs up lands on a five-step setup: portfolio, review, get paid, invite, done. The manager can skip it and reopen it from the Properties tab.
- **Import a file:** a CSV or TSV rent roll (up to 2 MB) from AppFolio, Buildium, Yardi, Rent Manager or a spreadsheet. AI matches the columns to property, address, unit, tenant, email, phone, rent, lease start, lease end and owner. The app accepts a match only if that column exists. Name-based matching fills any gaps. The manager can change every match.
- **Paste anything:** AI turns free text (an email, notes, a copied table) into rows. Without a model, the app still reads a pasted table. For free text, it asks for a table or file instead.
- The app checks every row before import. Errors (row skipped): missing property, unit, tenant or rent; rent that isn't a positive amount; invalid dates; lease ending before it starts; the same property and unit twice; a unit already in the portfolio. Warnings (row kept): no lease end (month-to-month), doubtful email, rent above $50,000.
- Importing adds properties (reused by name), tenants, tenancies (marked *Renewal due* when the lease ends within 45 days) and next month's rent invoice. Repeated imports never reuse IDs or duplicate a unit already in the portfolio. Properties with retail, office or plaza-style names or “Suite” units are typed commercial. The app rejects files with an unclosed or misplaced quote, or rows of the wrong width, and shows a message.
- Then: connect a trust account (simulated bank selection) and invite owners and vendors by email. Invalid addresses block sending. *Done* opens the dashboard with the imported portfolio.
- The app does not accept Excel (.xlsx). The screen asks for a CSV export.

### Form validation

- Sign-in, sign-up and password reset require a valid email and an 8+ character password. Forms stay disabled until the page has loaded.
- Vendor invoices need a description on every line, amounts of $0 or more, and a total above $0.
- A tenant's issue report needs at least 5 characters. Maintenance photos and assistant questions can't be submitted empty.

### Access (prototype only)

- The marketing site at propniti.ai links to sign-in, sign-up and password-reset screens. They are UI only: no accounts are created and nothing is sent.

## Agent behaviour and confidence policy

The agent decides and explains. People approve anything that moves money. Rule-based checks can overrule the model.

| Action | What the agent does | Example from the prototype |
| --- | --- | --- |
| Nudge | Reminds a person about a pending action on their preferred channel | Overdue-rent reminder to Marcus Lee by SMS |
| Validate | Checks an invoice and its photos against the PO | WO-1042 bills $575 against a $300 PO: flagged |
| Read documents | Extracts structured data from an invoice or bill image or PDF | CoolAir HVAC invoice CA-88342, $600 |
| Sequence of operations | Runs a multi-step task end to end | Invoice → validation → approval → vendor payout and message |
| Answer | Answers portfolio questions with suggested actions | "Who is late on rent?" |

**Triggers.** In the design, a scheduled sweep every 15 minutes looks for due rent, expiring leases and stuck work orders. Events (a question, an upload, a submission, a reply) start work immediately. In the prototype, the agent runs when a person triggers it.

**Confidence policy.**

- Every result carries a confidence from 0 to 1 and the evidence behind it.
- 85% or higher with no issues allows one-tap approval. Below that, a person reviews the evidence.
- The model can't approve what the rule-based checks flag: the decision drops to review and confidence is capped at 60%.
- Every payment needs a person's approval in V1, however confident the agent is.
- Every result is labelled with its source — Workers AI, Claude, OpenAI or Mock AI. If no real model is configured, or a call fails, the app shows the rule-based result and says so.

### Example: vendor work order

![Money moves only after a manager approves](/docs/spec/vendor-work-order-flow.svg#760x316)

In V1 every payment needs a manager's approval. A confident result takes one tap. A doubtful one shows the evidence, and the manager can send it back to the vendor.

## Core data entities

Tenancy is the hub that ties a property to a tenant and their lease. A work order ties a property to a vendor and a purchase order.

| Entity | Key fields | Status |
| --- | --- | --- |
| Property | name, address, type, units, occupied units, owner | Built |
| User | role, contact, preferred channel, ID-verification status | Built |
| Vendor | company, trade, paid this year before the ledger (cleared payouts are added) | Built |
| Tenancy | property, unit, tenant, rent, cadence, lease start and end, status | Built |
| Rent invoice | tenancy, amount, generated and due dates, status (due, overdue, processing, paid) | Built |
| Work order | property, unit, vendor or in-house assignee, estimate, status (assigned, in progress, submitted, changes requested, payment pending, paid, completed), purchase order, submission, validation result | Built |
| Purchase order | number, line items, total, photos required | Built (part of the work order) |
| Transfer | idempotency key, kind (rent, management fee, vendor payout, owner payout), from and to party, amount, property, reference, status (pending, cleared, returned), statement it was paid out in | Built (simulated ACH) |
| Rating | rater, subject (maintenance worker, vendor, manager or property), stars 1–5, comment, work order | Built |
| Notification | recipient, channel, message, time | Built |
| Audit entry | time, actor (person or agent), action, detail | Built |
| Setup | connected bank, invites sent, rows imported, completed | Built (onboarding) |

The prototype folds the design's separate communication-channel and agreement entities into User and Tenancy. Prototype data lives on the server, in Cloudflare D1 (SQLite on Docker). Each visitor gets a private copy, kept by a cookie, that resets at midnight Pacific time. Production uses PostgreSQL (see the [Solution Architecture document](/docs/architecture)).

## Integrations

AI providers are live today. Payment, messaging and identity providers are chosen, and the prototype simulates them.

| Need | Provider | Status |
| --- | --- | --- |
| AI, vision and text (default) | Cloudflare Workers AI — Llama 4 Scout 17B | Live on propniti.ai |
| AI (optional) | Anthropic Claude or OpenAI | Live when an API key is configured |
| Bank linking | Plaid | Planned; simulated |
| Rent collection and payouts | Stripe and Stripe Connect (ACH, 1099 filing) | Planned; simulated |
| SMS, WhatsApp, voice | Twilio | Planned; simulated |
| Email | SendGrid | Planned; simulated |
| Identity verification | Persona | Planned; status shown on users |
| Property management systems | AppFolio, Buildium | Later; needs partner API access |
| Carbon pathways | CRREM | V2 |

## Non-functional requirements

Security and trust come first because the product handles money and personal data.

| Area | Requirement | Prototype today |
| --- | --- | --- |
| Security | Validate and size-cap every input; rate-limit AI routes per client; strict browser security headers | Schema validation; byte limits enforced while the body streams in (256 KB JSON, 4 MB uploads); 20 AI requests a minute per client on every AI route (invoice reading, validation, assistant, import mapping and parsing), with the client identified by Cloudflare's client IP, or a configured trusted proxy header elsewhere; CSP, HSTS, framing denied |
| Uploads | Accept only known document types; never retain files | File-signature check (JPEG, PNG, WebP, PDF), 4 MB cap, read and discard |
| Imports | Bounded, private handling of portfolio files | CSV/TSV up to 2 MB, read in the browser; only column headers and up to 5 sample rows go to the AI for column matching; pasted text capped at 20,000 characters |
| Money | No double payments; nothing paid out that isn't held | Idempotency key per transfer; only submitted jobs can be approved; vendor approvals and owner payouts refused when trust can't cover them; enforced on the server, so a double click creates one payment |
| AI safety | Treat documents as data; validate model output; let rules overrule the model; people approve payments | In place, plus computed figures in assistant answers |
| Privacy | Hold payment tokens, never card or bank numbers; encrypt personal data at rest | By design; no real personal data in the prototype. Imported rows stay stored until the visitor's workspace is wiped at midnight Pacific time |
| Reliability | An AI failure must not block the workflow | Falls back to the rule-based result with a visible note |
| Portability | Run on any cloud | Cloudflare Workers and a Docker image |
| Accessibility | Labelled controls, keyboard use, readable contrast, reduced motion respected | Labelled controls and star-rating radio groups; reduced motion respected on the marketing site |
| Auditability | Record every human and agent action | Audit log in admin and on each work-order page, including transfers, payouts, ratings and imports |

Authentication is not built: the sign-in screens are UI only. The workspace cookie is the only key to a visitor's demo data. The assistant still reads the portfolio the browser sends, not the server's copy.

## Success metrics

V1 succeeds if managers run more properties and trust the agent's work. Targets are set from a pilot baseline.

| Metric | What it shows |
| --- | --- |
| Properties (doors) per manager | The core promise: more properties, same team |
| Share of agent actions completed without human edits | Automation is real |
| Approval rate of agent-proposed actions | Agent judgement matches the manager's |
| Invoice extraction accuracy (fields correct against the document) | Document reading can be trusted |
| Invoice errors caught before payment | Vendor automation saves money |
| Agent approvals later reversed | Hallucination stays low |
| Missed renewals and late payments | Event tracking works |
| Time to onboard a portfolio | Onboarding is smooth, once built |

## Release plan

V1 is live as a prototype. It now includes simulated payment flows, ratings, AI-native onboarding and server-side demo storage. Next is the work needed for a real pilot.

| Release | Contents | Status |
| --- | --- | --- |
| V1 prototype | Marketing site and demo sign-in; six role views; dashboard and detail pages; AI invoice reading and validation with confidence and policy checks; alerts and nudges; assistant with computed figures; security hardening; Cloudflare and Docker deployment | Live at propniti.ai |
| V1 additions | Trust-account payment flows with the 8% management fee, owner statements and payouts (simulated ACH); ratings and feedback with low-rating alerts; AI-native onboarding with CSV/TSV and pasted-text import; stricter form validation; server-side demo storage (a private Cloudflare D1 workspace per visitor, reset at midnight Pacific time) with money rules enforced on the server | Live at propniti.ai |
| Pilot readiness | Real authentication, shared database, Stripe, Plaid and Twilio in test mode, Excel import, live AppFolio and Buildium API sync | Later |
| V2 | CRREM carbon-pathway reporting; marketing and CRM | Later |

## Open questions

- [ ] AppFolio and Buildium: one-time file import is built. Should we also build live two-way sync through their APIs? It needs partner access.
- [ ] Which payment actions, if any, may the agent run without approval once its accuracy is proven?
- [ ] Target portfolio for V1: small residential, or large multifamily and commercial (the CRREM audience)?
- [ ] Pricing model: per door, per manager seat or per agent action?
- [x] Market for V1 — decided: US properties only; vendor tax handling uses IRS 1099-NEC.
- [x] Management fee for payment flows — decided: 8% of rent collected.
