This is a step-by-step tour of Propniti v2 at [propniti.ai](https://propniti.ai). It has one section for each staff persona, one for each portal and one for the public listings site. Each section says where the person lands, what they do and which AI shows up.

**Start here.** Open [propniti.ai/login](https://propniti.ai/login). Sign in with a demo account, for example `marcus@propniti.demo` with the password `propniti-demo` (every demo account uses it), or pick one of the 13 people in the list beside the form. *What each person sees*, below, describes each one. To switch later, open the avatar menu in the top bar and choose *Switch role (demo)*, or use *Switch* in the banner.

**First visit.** Each persona's home opens with a welcome screen once a demo day: what Propniti does for that role, what's new and up to three things waiting. *Help › Show welcome screen* brings it back. A dot in the sidebar marks a feature you haven't opened yet, and a small toast offers its tour the first time you meet it. The *Ask Propniti* panel also opens on its own once a day.

**About the data.** Names, companies and figures are sample data: 30 properties in Austin, Dallas, Atlanta and Phoenix. "Today" is 4 November 2026, and the books are closed through October. Your changes go into a private copy that only you see. It resets at midnight Pacific time. No real payments or messages are sent.

**About the AI.** Every AI output carries a label. **AI** means a live model wrote it just now. **AI · saved** means it was stored from an earlier run. **Rule-based fallback** means fixed rules wrote it. Record summaries say **Rules · from this record's current figures**, **Generated** or **Precomputed**. The figures always come from the data, never from the model, so answers can differ in wording between runs but not in numbers.

## 1. Things every staff page shares

- **Lists and the peek drawer.** Click any row in a list to open the record in a side drawer. On a phone it opens as a bottom sheet. Press J and K to move between rows, Esc to close, or *Open full page*. The URL keeps `?peek=`, so you can share the link.
- **Record pages.** Each record has tabs, an *AI summary*, a *Data health* panel, named actions and *Ask about this*. A record with no summary yet offers *Summarize with AI*.
- **Your layout.** Sections on home pages and dashboards collapse with a click and stay that way for that persona in this browser. *Reset layout* in the avatar menu opens them again and resets sidebar and panel sizes.
- **⌘K** searches records and pages, and turns a question into "Ask AI".
- **⌘J** opens the assistant, *Ask Propniti*. Pick *Ask*, *Do* or *Help*, or leave it on *Auto*. Each answer shows "Looked up N things" and a *Full trace* link to the run.
- **Ask Propniti panel.** It opens with *Right now*: up to three one-click items such as approvals waiting. The history button lists recent conversations. On a record, *Ask about this* asks about that record. In *Do* mode it can start an agent; what the agent proposes waits for approval as usual.
- **Definitions.** Hover, focus or tap a KPI, chart, column, filter or autonomy label to see what it means in plain English; *Learn more* opens the help article at `/app/help/<id>`.
- **Ask Propniti bubble.** The round button at the bottom right opens the same assistant, with questions suggested for the page you're on. Now and then it offers one tip drawn from your data, such as approvals waiting or residents 30 days past due. Tips come at most once per page and five times a session, never while you type or a dialog is open. Dismiss one and it stays dismissed; *Show tips* in the bubble's menu turns them off.
- **Sidebar.** A small sparkle marks the AI-powered pages: Inbox, Copilot, Agents, Approvals, AI activity, Automations and Data health. Breadcrumbs at the top are links: a section or group name opens its first page, and *Home* opens your home.
- **Inbox** (`/app/inbox`, or press I). One list of what needs you: conversations waiting on your reply, agent proposals you can decide, and your alerts. Tabs *All*, *Messages*, *Approvals* and *Alerts* show counts, and the sidebar badge counts what needs you. *Reply* opens the conversation; *Review* opens the proposal in the approvals inbox.
- **My tasks** (`/app/tasks`). Tasks assigned to you or to your role, from people, automations and agents. Views: *Open*, *Overdue*, *Today*, *Upcoming* and *Done*. Click the circle to mark a task done (with *Undo*), or *New task* to add one.
- **Agents and approvals.** `/app/agents` lists the eight agents. `/app/automations` shows what runs automatically, when, and under which rules. `/app/ai/approvals` holds what the agents proposed. `/app/ai/activity` lists every run.
- **Out of scope.** A link to a record outside your persona's scope opens a page that says so, with links back to the list and your home.

<!-- TODO: screenshot ![Record peek drawer open beside a work-order list](screens/marcus-peek-drawer.png) -->

<!-- TODO: screenshot ![Sign-in form with demo accounts above the persona cards](screens/login-form.png) -->

<!-- TODO: screenshot ![Ask Propniti bubble with a tip](screens/marcus-chat-bubble.png) -->

<!-- TODO: screenshot ![Welcome splash on the home page](screens/marcus-welcome.png) -->

## 2. Daniel Reyes, principal

Daniel sees all 30 properties. He lands on `/app`, the portfolio home.

1. Read the briefing card: what happened in the October close, what needs him, and what to watch. Its figures are computed from the ledger and monthly metrics.
2. Click *Explain* on the NOI tile. A sheet titled "Why did NOI change?" lists the drivers and the properties that moved it most. *View run* opens the agent run behind it.
3. In *Furthest below budget*, open a property. Its NOI is the last closed month, labelled "NOI (last month)". Open *Unit stack*, then a unit, to see its lease history.
4. Click *What-if*. Try the preset *Rent +3%*. Scenario NOI recomputes per property. Click *Explain this scenario* for a narrated version with its own run link.
5. Back on the home, use *Waiting for your decision* to approve or reject proposals.

AI here: *Explain* (facts computed, wording by a model or by rules), the what-if narration, and agent proposals.

<!-- TODO: screenshot ![Daniel's portfolio home with briefing, KPIs and Explain buttons](screens/daniel-home.png) -->

<!-- TODO: screenshot ![Explain NOI sheet with drivers and a View run link](screens/daniel-explain-noi.png) -->

<!-- TODO: screenshot ![What-if simulator with Rent +3% applied](screens/daniel-what-if.png) -->

## 3. Priya Shah, regional manager

Priya sees 14 Texas properties. She lands on `/app`, the regional version.

1. Scroll to *Property comparison*: occupancy, economic occupancy, NOI against budget, collections, delinquency and work-order SLA side by side.
2. Click *Variance* on a row to explain that property's NOI change.
3. Use her quick actions: *Concessions to approve* opens proposed concessions, and *Work orders past SLA* opens the late jobs.
4. Open `/app/settings/import` to bring in data from another system. Choose a source, for example AppFolio, and click *Load AppFolio sample files* (or upload your own CSV, TSV or Excel file). Leave *Use AI to help map and clean up* on, or turn it off for rules only. Check the column matches, accept or skip each AI suggestion, then *Preview import* and *Import N records*. *Undo import* removes the batch again, unless other records now point at it. New properties need a principal or regional manager.

AI here: per-property *Explain*, optional AI suggestions in the import, and concession proposals routed to her by the approval policy (concessions over $500 need a regional manager).

<!-- TODO: screenshot ![Priya's regional home with the property comparison table](screens/priya-home.png) -->

<!-- TODO: screenshot ![Import review step with matched columns and AI suggestions](screens/priya-import.png) -->

## 4. Marcus Bell, property manager

Marcus runs three Austin communities. He lands on `/app/today`.

1. Read *Your briefing*. It is computed from his records just now, and each line links to the rows behind it: past-due households, leases without a renewal offer, unread conversations, data issues.
2. Click *Leases ending in 60 days* to open the list. Click a row to peek at it.
3. If a KPI such as delinquency is red, click *Improve with AI* under it. The panel shows the drivers, computed from the records, and a plan of agent actions with expected effects. *Have agents do this* starts the agents; their proposals go to approvals as usual, and the card then shows what changed.
4. Review the *Approvals* section. Open *Why?* on a Collections reminder to see the reasons, the records it used and its confidence. Approve or reject it.
5. Open *Inbox*. The *Messages* tab lists conversations waiting on him; *Needs reply* means the resident wrote last. Click *Reply* on one, click *Suggest a reply*, edit it, then *Send*.
6. Open *My tasks* and switch to *Overdue*. Mark one done, then *Undo*. *Snooze* moves a task to a later date; *Reassign* hands it to someone else.
7. Open a lease and its *Abstraction* tab. Click *Abstract lease on file*. The result cites pages and flags dates that don't match the record. *Apply fix* corrects the record.
8. Open *Announcements → New*, pick a property and click *Draft with AI*. Review, then send to its residents.

AI here: the Collections and Renewals agents' proposals, suggested replies, lease abstraction and announcement drafts. Each draft links to its run.

<!-- TODO: screenshot ![Marcus's Today page with briefing, KPIs and approvals](screens/marcus-today.png) -->

<!-- TODO: screenshot ![Approval item expanded with reasons, evidence and confidence](screens/marcus-approval-why.png) -->

<!-- TODO: screenshot ![Inbox with Messages, Approvals and Alerts tabs](screens/marcus-inbox.png) -->

<!-- TODO: screenshot ![Conversation with a suggested reply ready to edit](screens/marcus-inbox-reply.png) -->

<!-- TODO: screenshot ![My tasks, Overdue view](screens/marcus-tasks.png) -->

## 5. Lena Ortiz, leasing agent

Lena handles leasing for the same three Austin properties. She lands on `/app/leasing/today`.

1. Read the *Briefing*: new leads, tours, applications, and what the agents did since yesterday.
2. Check *Today's tours* and *Follow-ups due*. The Leasing agent proposes a follow-up for prospects nobody has contacted in three days.
3. Open *Pipeline board* and move a prospect to *Tour*; *Undo* moves it back. Approval of an application stays with the broker. Under *Follow-ups due*, send one or *Send all*, and use *Rewrite with AI* on a draft.
4. Open a listing and click *Draft with AI*. Choose *Use draft, then edit*. If the text contains wording that fails the fair-housing check, the save is blocked until it's fixed.
5. Open *Renewals*, pick a draft offer and click *Ask the Renewals agent*. It prices the offer toward market rent, capped at +5%, with reasons. Accept or edit, click *Draft with AI*, then *Send offer*.

AI here: the Leasing and Renewals agents, listing drafts, and the fair-housing check.

<!-- TODO: screenshot ![Lena's leasing day with tours and follow-ups](screens/lena-leasing-today.png) -->

<!-- TODO: screenshot ![Listing editor with an AI draft and the fair-housing check](screens/lena-listing-draft.png) -->

## 6. Rachel Moore, managing broker

Rachel decides applications. She lands on `/app/leasing/broker`, the *Broker desk*.

1. Look at *Applications waiting on you*. *AI recommends* shows Approve, Conditional or Deny with a score, linked to the proposal and its run.
2. Click *Review* on a row. The application's *Leasing agent score* tab shows reasons for and against. Click *Score with AI* or *Re-score* to run it again.
3. Click *Approve with conditions*. It asks for a reason first. Add one and confirm.
4. Check *Fair-housing language* for flagged listing wording.

Criminal history is never scored; it routes to a person. An application from the public site is scored moments after it is submitted, and the recommendation lands in her approvals inbox (see [section 15](#15-public-listings-site)).

<!-- TODO: screenshot ![Broker desk with applications and AI recommendations](screens/rachel-broker-desk.png) -->

<!-- TODO: screenshot ![Application scoring tab with reasons for and against](screens/rachel-application-score.png) -->

## 7. Grace Kim, senior accountant

Grace works across all owner entities. She lands on `/app/finance`.

1. Read the briefing and KPIs: open payables, past due, unreconciled items, cash in trust, NOI and expense against budget.
2. Open *AP inbox*. Choose a sample invoice under *New invoices*. The fields are read from the invoice, GL coding is suggested, and *Payables checks* run. An invoice from a vendor whose bank details changed without verification is held.
3. Open a bill, for example `/app/payables/bills/BILL-20001`, to see its checks and coded lines.
4. Open *Owner statements*. On a line such as *Unreconciled difference*, click *Explain*. It shows what it looked up, then the answer.
5. Open *Budget vs actual* and click the ✦ on a row to explain a variance.
6. Open *Reports* and type a question, for example "show me utilities by property for Q3 vs budget". *Build report* turns it into a report you can export as CSV.
7. Open a bank reconciliation to see suggested matches with *Accept match*.

AI here: invoice reading (a vision model when configured), the Payables agent, statement and variance explanations, and the report builder.

<!-- TODO: screenshot ![Grace's finance home](screens/grace-finance-home.png) -->

<!-- TODO: screenshot ![AP inbox with fields read from an invoice and payables checks](screens/grace-ap-inbox.png) -->

<!-- TODO: screenshot ![Owner statement with an Explain popover](screens/grace-owner-statement-explain.png) -->

## 8. Tom Alvarez, maintenance supervisor

Tom oversees maintenance for 14 Texas properties. He lands on `/app/maintenance`.

1. Read the briefing and KPIs: SLA met, open work orders, waiting to dispatch, invoices to approve, units not rent-ready.
2. Look at the *Triage queue*. Each new work order shows the Maintenance triage agent's trade, urgency, estimate and suggested vendor.
3. Open *New request* (intake). Describe a problem in plain words and click *Save and triage*. Follow *Agent run and trace*, then *Dispatch* the job, or *Line up and ask owner* if it is over the owner's limit.
4. Open *Board* for the work-order board and calendar.
5. Open a work order awaiting approval and its *Invoice and PO* tab. The PO check compares the vendor's invoice with the purchase order. Click *Approve and pay*. A second click doesn't pay twice.
6. Open *Technician view*, pick a job, *Start job* and log 30 minutes.
7. Open `/app/compliance` for certificates of insurance, permits and inspections, with an expiries timeline and the Compliance agent's proposals.

AI here: the Maintenance triage and Compliance agents. The PO check is rules.

<!-- TODO: screenshot ![Tom's maintenance home with triage queue](screens/tom-maintenance-home.png) -->

<!-- TODO: screenshot ![Work order Invoice and PO tab with the PO check](screens/tom-invoice-po.png) -->

<!-- TODO: screenshot ![Compliance dashboard with expiries timeline](screens/tom-compliance.png) -->

## 9. Sam Okafor, administrator

Sam manages the org's settings. He lands on `/app/admin`.

1. Read the briefing: *What needs you*, *Risks and anomalies* and *Overnight*, the agent runs since yesterday.
2. Open *Settings → Users* and *Roles and permissions* to see the role × module matrix.
3. Open *Settings → Approvals*, click *Edit* on *Maintenance spend · org default*, change the limit and *Save policy*. The change appears in *Change history*.
4. Open *Audit log* to see every human and agent action.
5. Open *Data health*. It shows a score, open issues by rule and by property, and each suggested fix as before and after. *Apply fix* and *Apply N safe fixes* correct the records. Fixes that touch money, fraud or legal status, and any fix that isn't low risk, are labelled *Send for approval* and go to the approvals inbox instead, whoever clicks.
6. Open *Automations*. As an admin, Sam can turn agents on or off and change their autonomy here; the change is written to the audit trail.

<!-- TODO: screenshot ![Sam's admin briefing](screens/sam-admin-briefing.png) -->

<!-- TODO: screenshot ![Approval policy edit with change history](screens/sam-approval-policy.png) -->

<!-- TODO: screenshot ![Data health with before and after for a fix](screens/sam-data-health.png) -->

## 10. Nadia Brooks, platform admin

Nadia looks after every customer org. She lands on `/app/admin`, with platform quick actions.

1. Click *Customer orgs* to see organizations, seats and units managed.
2. Open *System health*: the model in use, the 15-minute sweep, queues and recent failed runs.
3. Open *AI usage*: runs per day, runs by agent, tokens and cost by model and by organization.
4. Unlike Sam, Nadia can approve agent proposals from her briefing.

<!-- TODO: screenshot ![Platform console with customer organizations](screens/nadia-platform-orgs.png) -->

<!-- TODO: screenshot ![AI usage by agent and model](screens/nadia-ai-usage.png) -->

## 11. Agents, approvals and runs

Any staff persona with AI access can follow these steps. Marcus is a good choice.

1. Open `/app/agents`. Each card shows the agent's goal, status, counters, last run and next run.
2. Click *Run now* on the Collections agent. A side sheet shows each step as it happens, in plain words such as "Looked up 14 residents", with the records it touched linked by name. *Technical details* on a step shows the raw input and output. *Open the full run* opens `/app/ai/runs/<id>`.
3. Under a card, the *Autonomy* select offers *Approve first* or *Auto within policy*. Only a principal, regional manager or admin can change it; Marcus sees it read-only. Changes are written to the audit trail.
4. The *Approval policies* table shows what agents may apply on their own and when the owner decides.
5. Open `/app/ai/approvals`. The tabs are *Needs you*, *Handled automatically*, *Waiting on others* and *Decided*. Filter by agent, risk or record type, then *Approve all low-risk matching*. On *Waiting on others*, *Notify approver* reminds the person who decides. Life-safety items, such as an overdue fire inspection, go only to the property's regional manager or the principal.
6. Open `/app/ai/activity` for every run, with trigger (*Schedule*, *Event*, *Run now* or *Assistant*), model, tokens and summary.
7. Open `/app/automations`. The header shows how many agents are on, when the next 15-minute sweep is due and how many events are waiting. The tables list each agent's trigger, autonomy, last run, next run and runs and failures over 30 days; the event triggers, including the ones nothing in the product raises yet; the approval rules; and the rules built into the product, such as late-fee caps and the midnight reset.

Agents also run without anyone: every 15 minutes on a schedule, on events such as an overdue charge or a new application, and on the first visit after a missed sweep.

<!-- TODO: screenshot ![Agents page with cards and Run now](screens/marcus-agents.png) -->

<!-- TODO: screenshot ![Live run sheet streaming steps](screens/marcus-run-live.png) -->

<!-- TODO: screenshot ![Approvals inbox, Needs you tab](screens/marcus-approvals.png) -->

<!-- TODO: screenshot ![Automations page with agents, sweep and approval rules](screens/marcus-automations.png) -->

## 12. Owner portal (Helen Carter)

Helen owns Bluebonnet Residential Fund II. She lands on `/portal/owner`.

1. Read *Your monthly briefing*: why her distribution moved, computed from her statements.
2. Open *Statements*, pick a month, and click *Explain* on *Distributed to owner*.
3. Open *Approvals*. Repairs over her approval limit wait here with *Why this needs you*. Click *Approve $…*, add an optional note, and confirm. The property manager is notified.
4. Click *Ask AI* and choose "Why was my distribution lower this month?".

<!-- TODO: screenshot ![Owner portal home with the monthly briefing](screens/owner-home.png) -->

<!-- TODO: screenshot ![Owner repair approval with reasons](screens/owner-approvals.png) -->

## 13. Resident portal (Jordan Lee)

Jordan rents #412 at The Lofts at Riverside. He lands on `/portal/resident`.

1. Open *Pay*. Tick the charges, click *Pay $… by ACH*, and confirm. Turn autopay on or off.
2. Open *Requests → New request*. Type "The kitchen sink is leaking under the cabinet". *AI's first read* suggests the trade and a typical cost from past jobs. A person on the maintenance team confirms it before anyone is sent. *Send request* creates a work order.
3. Open *Lease* to see the lease, renters insurance and any renewal offer.

The first read is rules. *Ask AI* answers from Jordan's own records.

<!-- TODO: screenshot ![Resident pay page](screens/resident-pay.png) -->

<!-- TODO: screenshot ![New request with the AI first read](screens/resident-request-triage.png) -->

## 14. Vendor portal (Luis Ramirez) and applicant portal (Priyanka Rao)

**Vendor.** Luis works for Lone Star Plumbing. He lands on `/portal/vendor`.

1. Open *Jobs → New*. *Accept* a job, with an optional visit time.
2. Open *Invoices → Send an invoice*. Pick the job and upload a photo or PDF of the invoice. With a model configured, the lines fill in from the file; check each one. Click *Send invoice*. The work order moves to Submitted, and the property manager sees it on the job's *Invoice and PO* tab.
3. Open *Insurance* to upload a new certificate. It stays *Pending verification* until staff verify it.

You can test invoice reading with the sample files: [clean invoice](https://propniti.ai/samples/coolair-invoice.png) or [invoice with problems](https://propniti.ai/samples/coolair-invoice-bad.png).

**Applicant.** Priyanka applied at Barton Creek Commons. She lands on `/portal/applicant`.

1. The status timeline runs from Started to Lease signing. *Still needed* lists missing documents.
2. Open *Documents* to upload. Only the file name is kept.
3. Open *Fee* and pay $55. No real card is charged.

<!-- TODO: screenshot ![Vendor invoice read from an uploaded file](screens/vendor-invoice.png) -->

<!-- TODO: screenshot ![Applicant status timeline and checklist](screens/applicant-status.png) -->

## 15. Public listings site

No sign-in is needed. Open [propniti.ai/listings](https://propniti.ai/listings).

1. Choose a metro, for example Austin, and open a listing. It shows pricing and fees, the total due before move-in, the floor plan and lease terms.
2. Under *Ask about this unit*, ask "What's the total to move in?". Questions about fair housing, safety or schools get a fixed policy answer labelled *Fair housing policy*.
3. Under *Schedule a tour*, choose a type, day and time, and *Book tour*. It goes on the leasing team's calendar.
4. Click *Apply now* and complete the five steps: details, where you've lived, income, documents, review and sign. Click *Submit application*.
5. The status page shows what happens next. Within moments, the *AI screening summary* panel shows how the Leasing agent scored the application. *Open the broker's approvals* opens the broker's inbox at that proposal.

Tours and applications stay in your private copy and reset at midnight Pacific.

<!-- TODO: screenshot ![Public listing with pricing, fees and Ask about this unit](screens/public-listing.png) -->

<!-- TODO: screenshot ![Application status with the AI screening summary](screens/public-application-status.png) -->

## 16. Known limits

- **No real accounts.** The demo password is published and anyone can sign in as any persona. Payments, bank feeds, email and SMS are simulated.
- **No reset button.** Your private copy resets at midnight Pacific.
- **Portal invoices skip the AP inbox.** They appear on the work order's *Invoice and PO* tab only.
- **Owner approvals.** The owner portal lists repairs over the owner's limit. Agent proposals waiting on an owner appear in the staff *Waiting on others* tab, not in the portal.
- **Locked records** still show *Edit*. Saving is refused.
- **Events with no source.** Some agent events (an expiring insurance certificate, a closed owner statement, a new data issue) aren't raised by anything yet; those agents cover the work on their schedule. The Automations page marks them.

More detail: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).
