This is a step-by-step tour of Propniti at [propniti.ai](https://propniti.ai). It has one section for each staff persona, one for each portal and one for the public listings site. Each section says where the person lands, what they do and which AI shows up.

**Start here.** Open [propniti.ai/login](https://propniti.ai/login). Sign in with a demo account, for example `marcus@propniti.demo` with the password `propniti-demo`. Every demo account uses that password. Or pick one of the 13 people in the *Pick a person* list beside the form. Click a person (or use the arrow keys) to fill the form, then click *Sign in as …*. Double-click a person to sign in straight away. *What each person sees*, below, describes each one. To switch later, open the avatar menu in the top bar and choose *Switch role (demo)*, or use *Switch* in the banner.

**First visit.** Each persona's home opens with a welcome screen once a demo day. It shows what Propniti does for that role, a *What's new* list of features and up to three things waiting. *Help › Show welcome screen* brings it back. A dot in the sidebar marks a feature you haven't opened yet. Once per browser session, a small card offers a tour. The card sits over the foot of the sidebar, so it never covers a table. On a phone or with the sidebar collapsed, the chat bubble offers the tour instead. The *Ask Propniti* panel also opens on its own once a day.

**About the data.** Names, companies and figures are sample data: 30 properties in Austin, Dallas, Atlanta and Phoenix. "Today" is 4 November 2026, and the books are closed through October. Your changes go into a private copy that only you see. It resets at midnight Pacific time. Propniti sends no real payments or messages.

**About the AI.** Every AI output carries a label. **AI** means a live model wrote it just now. **AI · saved** means it was stored from an earlier run. **Rules** means fixed rules wrote it. Record summaries say **Rules · from this record's current figures**, **Generated** or **Precomputed**. The figures always come from the data, never from the model. So the wording of an answer can differ between runs, but the numbers can't.

## 1. Things every staff page shares

- **Lists and the peek drawer.** Click any row in a list to open the record in a side drawer. On a phone it opens as a bottom sheet. Press J and K to move between rows, Esc to close, or *Open full page*. The URL keeps `?peek=`, so you can share the link.
- **Record pages.** Each record has tabs, an *AI summary*, a *Data health* panel, named actions and *Ask about this*. A record with no summary yet offers *Summarize with AI*.
- **Your layout.** Click a section on a home page or dashboard to collapse it. It stays collapsed for that persona in this browser. *Reset layout* in the avatar menu opens the sections again and resets sidebar and panel sizes.
- **⌘K** searches records and pages, and turns a question into "Ask AI".
- **⌘J** opens the assistant, *Ask Propniti*. Pick *Ask*, *Do* or *Help*, or leave it on *Auto*. Each answer shows "Looked up N things" and a *Full trace* link to the run.
- **Ask Propniti panel.** It opens with *Right now*: up to three one-click items such as approvals waiting. The history button lists recent conversations. On a record, *Ask about this* asks about that record. In *Do* mode it can start an agent. The agent's proposals wait for approval as usual.
- **Definitions.** Hover, focus or tap a KPI, chart, column, filter or autonomy label to see what it means in plain English. *Learn more* opens the help article at `/app/help/<id>`.
- **Ask Propniti bubble.** The round button at the bottom right opens the same assistant. It suggests questions for the page you're on. Now and then it offers one tip drawn from your data, such as approvals waiting or residents 30 days past due. It shows a tip at most once per page and five times a session. It never shows one while you type or a dialog is open. A tip you dismiss stays dismissed. *Show tips* in the bubble's menu turns tips off.
- **Sidebar.** A small sparkle marks the AI-powered pages: Inbox, Copilot, Agents, Approvals, AI activity, Automations and Data health. The breadcrumbs at the top are links. A section or group name opens its first page, and *Home* opens your home.
- **Inbox** (`/app/inbox`, or press I). One list of what needs you: conversations waiting on your reply, agent proposals you can decide, and your alerts. The tabs *All*, *Messages*, *Approvals* and *Alerts* show counts. The sidebar badge counts what needs you. *Reply* opens the conversation; *Review* opens the proposal in the approvals inbox.
- **My tasks** (`/app/tasks`). Tasks assigned to you or to your role, from people, automations and agents. Views: *Open*, *Overdue*, *Today*, *Upcoming* and *Done*. Click the circle to mark a task done (with *Undo*). Click *New task* to add one.
- **Agents and approvals.** `/app/agents` lists the eight agents. `/app/automations` shows what runs automatically, when, and under which rules. `/app/ai/approvals` holds what the agents proposed. `/app/ai/activity` lists every run.
- **Out of scope.** A link to a record outside your persona's scope opens a page that says so. The page links back to the list and your home. Every sidebar link opens a page your persona can use. Each persona's home is in the sidebar.
- **Downloads.** Lists, reports and owner statements have a *Download* menu: *CSV* (plain data), *Excel (.xlsx)* (numbers and dates stay numbers and dates) or *PDF* (a printable table). It downloads what is on screen, up to 10,000 rows. The file keeps the same filters, search, view and scope. *Include Propniti branding* adds the logo, scope, filters, time and a footer to Excel and PDF files. CSV has no branding.
- **Feedback on actions.** A thin bar at the top shows that a page is loading. After you click a filter, a line such as "Showing 608 warning open issues · Clear" states what the list now shows. The page then scrolls the results into view. Approvals, bulk actions and refreshes confirm with a toast. Click the sidebar link of the page you're on to refresh it; a toast says it is up to date. A section whose figures changed after an action shows "Updated just now" for a few seconds.
- **Theme.** The theme button in the top bar offers *Light*, *Dark* and *System*. *System* is the default; it follows your device and changes with it. The portals and these docs use the same choice. ⌘K also has *Switch to dark theme* and the others.
- **Copilot** (`/app/copilot`). The full-page assistant. Each persona starts with sample conversations, marked *Sample*. They hold questions such as "Who is 30+ days late on rent?". The rules assistant computed the answers from the sample data. Ask a follow-up to continue a conversation. Propniti keeps the continuation in your private copy.

![Record peek drawer open beside a work-order list](/docs/walkthrough/screens/marcus-peek-drawer.webp#2880x1800)

![Sign-in form beside the Pick a person list](/docs/walkthrough/screens/login-form.webp#2880x1800)

![Ask Propniti bubble with a tip](/docs/walkthrough/screens/marcus-chat-bubble.webp#2880x1800)

![Welcome splash on the home page](/docs/walkthrough/screens/marcus-welcome.webp#2880x1800)

![Copilot with a sample conversation open: the Sample banner, proposed reminders with Approve buttons and the Rules label](/docs/walkthrough/screens/marcus-copilot-sample.webp#2880x1800)

![Download menu on the AR aging report: CSV, Excel and PDF, with Include Propniti branding ticked](/docs/walkthrough/screens/grace-download-menu.webp#2880x1800)

## 2. Daniel Reyes, principal

Daniel sees all 30 properties. He lands on `/app`, the portfolio home.

1. Read the briefing card: what happened in the October close, what needs him, and what to watch. Propniti computes its figures from the ledger and monthly metrics.
2. Click *Explain* on the NOI tile. A sheet titled "Why did NOI change?" lists the drivers and the properties that moved it most. *View run* opens the agent run behind it.
3. In *Furthest below budget*, open a property. Its NOI is the last closed month, labelled "NOI (last month)". Open *Unit stack*, then a unit, to see its lease history.
4. Click *What-if*. Try the preset *Rent +3%*. Propniti recomputes scenario NOI per property. Click *Explain this scenario* for a narrated version with its own run link.
5. Back on the home, a red KPI such as *Occupancy* shows *Improve with AI* under it. The panel says why the number is red. It lists what agents can do and the expected effect of each. *Have agents do this* starts them. Their proposals wait for approval as usual.
6. Use *Waiting for your decision* to approve or reject proposals.

AI here: *Explain* (facts computed, wording by a model or by rules), the what-if narration, *Improve with AI*, and agent proposals.

### Guided setup

`/app/onboarding` (*Set up your portfolio*) walks a new customer through five steps. You can also reach it from *Guided setup* in the *Finish setup* checklist at the foot of the sidebar. A principal, regional manager or admin can use it; other roles see who can. You can skip any step. Propniti saves progress on each move, so the flow resumes where you left it.

1. **Company.** The company name, the states you operate in and roughly how many units you manage. The states set late-fee caps, notice periods and deposit rules.
2. **Bring your data.** Drop exports from your current tool, in any mix, or click *Try sample files*. Rules first identify each file's source tool and contents from its columns and name. Each result shows a confidence and the reason. *Use AI to identify files and suggest fixes* is optional. It is on when a model is available. It sends only file names, header rows and the first few rows of each file. Turn it off and nothing goes to a model. *Match columns* then continues in the import wizard (columns, checks, preview, import and undo). Nothing is saved until you confirm the preview.
3. **Approval rules.** Propniti suggests approval limits and agent autonomy, sized from your records. For example: "Median completed vendor work order $386 across 3,853 jobs → auto-approve up to $400". Each suggestion shows its basis and confidence. *Accept*, *Edit* or *Keep current* each one. Propniti never suggests rules for legal, safety or owner distributions; those stay with a person.
4. **Your team.** Add people with a role and the properties, regions or whole company they cover. A principal can add people. A principal can't grant the admin role or cover properties outside their own scope. People added here exist only in your private copy, and Propniti sends no email.
5. **Check and finish.** Data Health runs its rules over the records you imported. A summary then shows what you imported, the data issues found, the rules set and the people added.

![Guided setup, step 1: company name, states and units managed](/docs/walkthrough/screens/daniel-onboarding-company.webp#2880x1800)

![Guided setup, step 2: Try sample files, the optional AI switch off, and files identified by rules with a confidence and reason](/docs/walkthrough/screens/daniel-onboarding-data.webp#2880x1800)

![Guided setup, step 3: suggested approval limits with their basis, confidence and Accept, Edit or Keep current](/docs/walkthrough/screens/daniel-onboarding-rules.webp#2880x1800)

![Guided setup, step 4: adding a property manager scoped to the imported properties](/docs/walkthrough/screens/daniel-onboarding-team.webp#2880x1800)

![Guided setup, step 5: Data Health on the imported records and the setup summary](/docs/walkthrough/screens/daniel-onboarding-check.webp#2880x1800)

![Daniel's portfolio home with briefing, KPIs and Explain buttons](/docs/walkthrough/screens/daniel-home.webp#2880x1800)

![Explain NOI sheet with drivers and a View run link](/docs/walkthrough/screens/daniel-explain-noi.webp#2880x1800)

![What-if simulator with Rent +3% applied](/docs/walkthrough/screens/daniel-what-if.webp#2880x1800)

![Improve with AI on a red Occupancy KPI: drivers, a plan of agent actions and Have agents do this](/docs/walkthrough/screens/daniel-improve-ai.webp#2880x1800)

## 3. Priya Shah, regional manager

Priya sees 14 Texas properties. She lands on `/app`, which shows her regional home.

1. Scroll to *Property comparison*: occupancy, economic occupancy, NOI against budget, collections, delinquency and work-order SLA side by side.
2. Click *Variance* on a row to explain that property's NOI change.
3. Use her quick actions: *Concessions to approve* opens proposed concessions, and *Work orders past SLA* opens the late jobs.
4. Open `/app/settings/import` to bring in data from another system. Each tool has a tile. Click *Try samples* on one, for example AppFolio, to load its synthetic sample files. Or pick the tile and upload your own CSV, TSV or Excel file. Leave *Use AI to help map and clean up* on, or turn it off for rules only. Check the column matches and accept or skip each AI suggestion. Then click *Preview import* and *Import N records*. *Undo import* removes the batch again, unless other records now point at it. Only a principal or regional manager can import new properties.

AI here: per-property *Explain*, optional AI suggestions in the import, and concession proposals. The approval policy routes concessions to her: concessions over $500 need a regional manager.

![Priya's regional home with the property comparison table](/docs/walkthrough/screens/priya-home.webp#2880x1800)

![Import, Source step: a tile for each tool with Try samples](/docs/walkthrough/screens/priya-import-samples.webp#2880x1800)

![Import, Columns step: each column matched by preset, with sample values](/docs/walkthrough/screens/priya-import.webp#2880x1800)

## 4. Marcus Bell, property manager

Marcus runs three Austin communities. He lands on `/app/today`.

1. Read *Your briefing*. Propniti computes it from his records just now. Each line links to the rows behind it: past-due households, leases without a renewal offer, unread conversations, data issues.
2. Click *Leases ending in 60 days* to open the list. Click a row to peek at it.
3. If a KPI such as delinquency is red, click *Improve with AI* under it. The panel shows the drivers, computed from the records. It also shows a plan of agent actions with expected effects. *Have agents do this* starts the agents. Their proposals go to approvals as usual, and the card then shows what changed.
4. Review the *Approvals* section. Open *Why?* on a Collections reminder to see the reasons, the records it used and its confidence. Approve or reject it.
5. Open *Inbox*. The *Messages* tab lists conversations waiting on him; *Needs reply* means the resident wrote last. Click *Reply* on one, click *Suggest a reply*, edit it, then *Send*.
6. Open *My tasks* and switch to *Overdue*. Mark one done, then *Undo*. *Snooze* moves a task to a later date; *Reassign* hands it to someone else.
7. Open a lease and its *Abstraction* tab. Click *Abstract lease on file*. The result cites pages and flags dates that don't match the record. *Apply fix* corrects the record.
8. Open *Announcements → New*, pick a property and click *Draft with AI*. Review, then send to its residents.

AI here: the Collections and Renewals agents' proposals, suggested replies, lease abstraction and announcement drafts. Each draft links to its run.

![Marcus's Today page with briefing, KPIs and approvals](/docs/walkthrough/screens/marcus-today.webp#2880x1800)

![Approvals inbox: each proposal with its reasons, risk and confidence](/docs/walkthrough/screens/marcus-approval-why.webp#2880x1800)

![Inbox with Messages, Approvals and Alerts tabs](/docs/walkthrough/screens/marcus-inbox.webp#2880x1800)

![Conversation with a suggested reply ready to edit](/docs/walkthrough/screens/marcus-inbox-reply.webp#2880x1800)

![My tasks, Overdue view](/docs/walkthrough/screens/marcus-tasks.webp#2880x1800)

## 5. Lena Ortiz, leasing agent

Lena handles leasing for the same three Austin properties. She lands on `/app/leasing/today`.

1. Read the *Briefing*: new leads, tours, applications, and what the agents did since yesterday.
2. Check *Today's tours* and *Follow-ups due*. The Leasing agent proposes a follow-up for prospects nobody has contacted in three days.
3. Open *Pipeline board* and move a prospect to *Tour*; *Undo* moves it back. The broker still approves applications. Under *Follow-ups due*, send one or *Send all*. Use *Rewrite with AI* on a draft.
4. Open a listing and click *Draft with AI*. Choose *Use draft, then edit*. If any wording fails the fair-housing check, Propniti blocks the save until Lena fixes it.
5. Open *Renewals*, pick a draft offer and click *Ask the Renewals agent*. The agent prices the offer toward market rent, capped at +5%, and gives reasons. Accept or edit, click *Draft with AI*, then *Send offer*.

AI here: the Leasing and Renewals agents, listing drafts, and the fair-housing check.

![Lena's leasing day with tours and follow-ups](/docs/walkthrough/screens/lena-leasing-today.webp#2880x1800)

![Listing editor with an AI draft and the fair-housing check](/docs/walkthrough/screens/lena-listing-draft.webp#2880x1800)

## 6. Rachel Moore, managing broker

Rachel decides applications. She lands on `/app/leasing/broker`, the *Broker desk*.

1. Look at *Applications waiting on you*. *AI recommends* shows Approve, Conditional or Deny with a score, linked to the proposal and its run.
2. Click *Review* on a row. The application's *Leasing agent score* tab shows reasons for and against. Click *Score with AI* or *Re-score* to run it again.
3. Click *Approve with conditions*. It asks for a reason first. Add one and confirm.
4. Check *Fair-housing language* for flagged listing wording.

Criminal history is never scored; it routes to a person. The Leasing agent scores an application from the public site moments after the applicant submits it. The recommendation lands in her approvals inbox (see [section 15](#15-public-listings-site)).

![Broker desk with applications and AI recommendations](/docs/walkthrough/screens/rachel-broker-desk.webp#2880x1800)

![Application scoring tab with reasons for and against](/docs/walkthrough/screens/rachel-application-score.webp#2880x1800)

## 7. Grace Kim, senior accountant

Grace works across all owner entities. She lands on `/app/finance`.

1. Read the briefing and KPIs: open payables, past due, unreconciled items, cash in trust, NOI and expense against budget.
2. Open *AP inbox*. Choose a sample invoice under *New invoices*. Propniti reads the fields from the invoice, suggests GL coding and runs *Payables checks*. It holds an invoice from a vendor whose bank details changed without verification.
3. Open a bill, for example `/app/payables/bills/BILL-20001`, to see its checks and coded lines.
4. Open *Owner statements*. On a line such as *Unreconciled difference*, click *Explain*. It shows what it looked up, then the answer.
5. Open *Budget vs actual* and click the ✦ on a row to explain a variance.
6. Open *Reports* and type a question, for example "show me utilities by property for Q3 vs budget". *Build report* turns it into a report. *Download* on any report gives CSV, Excel or PDF. The principal, regional managers, property managers and accountants can use reports. Other roles see a page saying reports aren't part of their role.
7. On *Owner statements*, *Download statement* saves the statement as a file.
8. Open a bank reconciliation to see suggested matches with *Accept match*.

AI here: invoice reading (a vision model when configured), the Payables agent, statement and variance explanations, and the report builder.

![Grace's finance home](/docs/walkthrough/screens/grace-finance-home.webp#2880x1800)

![AP inbox with fields read from an invoice and payables checks](/docs/walkthrough/screens/grace-ap-inbox.webp#2880x1800)

![Owner statement with an Explain popover](/docs/walkthrough/screens/grace-owner-statement-explain.webp#2880x1800)

## 8. Tom Alvarez, maintenance supervisor

Tom oversees maintenance for 14 Texas properties. He lands on `/app/maintenance`.

1. Read the briefing and KPIs: SLA met, open work orders, waiting to dispatch, invoices to approve, units not rent-ready.
2. Look at the *Triage queue*. Each new work order shows the Maintenance triage agent's trade, urgency, estimate and suggested vendor.
3. Open *New request* (intake). Describe a problem in plain words and click *Save and triage*. Follow *Agent run and trace*. Then *Dispatch* the job, or click *Line up and ask owner* if it is over the owner's limit.
4. Open *Board* for the work-order board and calendar.
5. Open a work order awaiting approval and its *Invoice and PO* tab. The PO check compares the vendor's invoice with the purchase order. Click *Approve and pay*. A second click doesn't pay twice.
6. Open *Technician view*, pick a job, *Start job* and log 30 minutes.
7. Open `/app/compliance` for certificates of insurance, permits and inspections, with an expiries timeline and the Compliance agent's proposals.

AI here: the Maintenance triage and Compliance agents. The PO check is rules.

![Tom's maintenance home with triage queue](/docs/walkthrough/screens/tom-maintenance-home.webp#2880x1800)

![Work order Invoice and PO tab with the PO check](/docs/walkthrough/screens/tom-invoice-po.webp#2880x1800)

![Compliance dashboard with expiries timeline](/docs/walkthrough/screens/tom-compliance.webp#2880x1800)

## 9. Sam Okafor, administrator

Sam manages the org's settings. He lands on `/app/admin`.

1. Read the briefing: *What needs you*, *Risks and anomalies* and *Overnight*, the agent runs since yesterday.
2. Open *Settings → Users* and *Roles and permissions* to see the role × module matrix.
3. Open *Settings → Approvals*, click *Edit* on *Maintenance spend · org default*, change the limit and *Save policy*. The change appears in *Change history*.
4. Open *Audit log* to see every human and agent action.
5. Open *Data health*. It shows a score and open issues by rule and by property, counted within the persona's scope. It lists each issue by its rule name and the record's name. A suggested fix shows the fields before and after, in readable values. An issue with no automatic fix says "No automatic fix — a person needs to check this". It gives the next step and a link to the record. An example step: "Call the vendor on a number already on file to confirm the new bank details". As an admin, Sam can't apply fixes himself. Each fix shows *Send for approval* and goes to the approvals inbox. A principal, regional manager or property manager applies low-risk fixes with *Apply fix* or *Apply N safe fixes*. Some fixes go to the approvals inbox whoever clicks: fixes that touch money, fraud or legal status, and any fix that isn't low risk.
6. Open *Automations*. As an admin, Sam can turn agents on or off and change their autonomy here. Propniti writes the change to the audit trail.

![Sam's admin briefing](/docs/walkthrough/screens/sam-admin-briefing.webp#2880x1800)

![Approval policies: org defaults and owner-entity limits](/docs/walkthrough/screens/sam-approval-policy.webp#2880x1800)

![Data health, warnings: a fix with before and after values, and Send for approval for the admin](/docs/walkthrough/screens/sam-data-health.webp#2880x1800)

![Data health issue with no automatic fix: the reasons and a manual next step with a link to the vendor](/docs/walkthrough/screens/sam-data-health-next-step.webp#2880x1800)

## 10. Nadia Brooks, platform admin

Nadia looks after every customer org. She lands on `/app/admin`, with platform quick actions.

1. Click *Customer orgs* to see organizations, seats and units managed.
2. Open *System health*: the model in use, the 15-minute sweep, queues and recent failed runs.
3. Open *AI usage*: runs per day, runs by agent, tokens and cost by model and by organization.
4. Unlike Sam, Nadia can approve agent proposals from her briefing.

![Platform console with customer organizations](/docs/walkthrough/screens/nadia-platform-orgs.webp#2880x1800)

![AI usage by agent and model](/docs/walkthrough/screens/nadia-ai-usage.webp#2880x1800)

## 11. Agents, approvals and runs

Any staff persona with AI access can follow these steps. Marcus is a good choice.

1. Open `/app/agents`. Each card shows the agent's goal, status, counters, last run, next run and the model its last run used. It also says when the agent runs, in plain words (for example "Daily at 14:00 UTC · on Payment returned"). The header says when Propniti last checked schedules and when the next check is due.
2. Click *Run now* on the Collections agent. A side sheet shows each step as it happens, in plain words such as "Looked up 14 residents". It links the records each step touched by name. *Technical details* on a step shows the raw input and output. *Open the full run* opens `/app/ai/runs/<id>`.
3. Under a card, the *Autonomy* select offers *Approve first* or *Auto within policy*. Only a principal, regional manager or admin can change it; Marcus sees it read-only. Propniti writes changes to the audit trail.
4. The *Approval policies* table shows what agents may apply on their own and when the owner decides.
5. Open `/app/ai/approvals`. The tabs are *Needs you*, *Handled automatically*, *Waiting on others* and *Decided*. Filter by agent, risk or record type, then click *Approve all low-risk matching*. On *Waiting on others*, *Notify approver* reminds the person who decides. Life-safety items, such as an overdue fire inspection, go only to the property's regional manager or the principal.
6. Open `/app/ai/activity` for every run, with trigger (*Schedule*, *Event*, *Run now* or *Assistant*), model, tokens and summary.
7. Open `/app/automations`. The header shows how many agents are on, when the next 15-minute sweep is due and how many events are waiting. The tables list each agent's trigger, autonomy, last run, next run, and runs and failures over 30 days. They also list the event triggers, including the ones nothing in the product raises yet. Last come the approval rules and the rules built into the product, such as late-fee caps and the midnight reset.

Agents also run with no one starting them. They run every 15 minutes on a schedule, on events such as an overdue charge or a new application, and on the first visit after a missed sweep.

![Agents page with cards and Run now](/docs/walkthrough/screens/marcus-agents.webp#2880x1800)

![An agent run in plain words, with the proposal it made](/docs/walkthrough/screens/marcus-run-live.webp#2880x1800)

![Approvals inbox, Needs you tab](/docs/walkthrough/screens/marcus-approvals.webp#2880x1800)

![Automations page with agents, sweep and approval rules](/docs/walkthrough/screens/marcus-automations.webp#2880x1800)

## 12. Owner portal (Helen Carter)

Helen owns Bluebonnet Residential Fund II. She lands on `/portal/owner`.

1. Read *Your monthly briefing*: why her distribution moved, computed from her statements.
2. Open *Statements*, pick a month, and click *Explain* on *Distributed to owner*. *Download statement* saves it as CSV, Excel or PDF.
3. Open *Approvals*. Repairs over her approval limit wait here with *Why this needs you*. Click *Approve $…*, add an optional note, and confirm. The property manager is notified.
4. Click *Ask AI* and choose "Why was my distribution lower this month?".

![Owner portal home with the monthly briefing](/docs/walkthrough/screens/owner-home.webp#2880x1800)

![Owner repair approval with reasons](/docs/walkthrough/screens/owner-approvals.webp#2880x1800)

## 13. Resident portal (Jordan Lee)

Jordan rents #412 at The Lofts at Riverside. He lands on `/portal/resident`.

1. Open *Pay*. Tick the charges, click *Pay $… by ACH*, and confirm. Turn autopay on or off.
2. Open *Requests → New request*. Type "The kitchen sink is leaking under the cabinet". *AI's first read* suggests the trade and a typical cost from past jobs. A person on the maintenance team confirms it before anyone is sent. *Send request* creates a work order.
3. Open *Lease* to see the lease, renters insurance and any renewal offer.

The first read is rules. *Ask AI* answers from Jordan's own records.

![Resident pay page](/docs/walkthrough/screens/resident-pay.webp#2880x1800)

![New request with the AI first read](/docs/walkthrough/screens/resident-request-triage.webp#2880x1800)

## 14. Vendor portal (Luis Ramirez) and applicant portal (Priyanka Rao)

**Vendor.** Luis works for Lone Star Plumbing. He lands on `/portal/vendor`.

1. Open *Jobs → New*. *Accept* a job, with an optional visit time.
2. Open *Invoices → Send an invoice*. Pick the job and upload a photo or PDF of the invoice. With a model configured, the lines fill in from the file. Check each one. Click *Send invoice*. The work order moves to Submitted. The property manager sees the invoice on the job's *Invoice and PO* tab.
3. Open *Insurance* to upload a new certificate. It stays *Pending verification* until staff verify it.

You can test invoice reading with the sample files: [clean invoice](https://propniti.ai/samples/coolair-invoice.png) or [invoice with problems](https://propniti.ai/samples/coolair-invoice-bad.png).

**Applicant.** Priyanka applied at Barton Creek Commons. She lands on `/portal/applicant`.

1. The status timeline runs from Started to Lease signing. *Still needed* lists missing documents.
2. Open *Documents* to upload. Only the file name is kept.
3. Open *Fee* and pay $55. No real card is charged.

![Vendor invoice read from an uploaded file](/docs/walkthrough/screens/vendor-invoice.webp#2880x1800)

![Applicant status timeline and checklist](/docs/walkthrough/screens/applicant-status.webp#2880x1800)

## 15. Public listings site

No sign-in is needed. Open [propniti.ai/listings](https://propniti.ai/listings).

1. Choose a metro, for example Austin, and open a listing. It shows pricing and fees, the total due before move-in, the floor plan and lease terms.
2. Under *Ask about this unit*, ask "What's the total to move in?". Questions about fair housing, safety or schools get a fixed policy answer labelled *Fair housing policy*.
3. Under *Schedule a tour*, choose a type, day and time, then click *Book tour*. The tour goes on the leasing team's calendar.
4. Click *Apply now* and complete the five steps: details, where you've lived, income, documents, review and sign. Click *Submit application*.
5. The status page shows what happens next. Within moments, the *AI screening summary* panel shows how the Leasing agent scored the application. *Open the broker's approvals* opens the broker's inbox at that proposal.

Tours and applications stay in your private copy and reset at midnight Pacific.

![Public listing with pricing, fees and Ask about this unit](/docs/walkthrough/screens/public-listing.webp#2880x1800)

![Application form, step 1 of 5, beside the listing's pricing](/docs/walkthrough/screens/public-apply.webp#2880x1800)

## 16. Known limits

- **No real accounts.** The demo password is published and anyone can sign in as any persona. Payments, bank feeds, email and SMS are simulated.
- **No reset button.** Your private copy resets at midnight Pacific.
- **Portal invoices skip the AP inbox.** They appear on the work order's *Invoice and PO* tab only.
- **Owner approvals.** The owner portal lists repairs over the owner's limit. Agent proposals waiting on an owner appear in the staff *Waiting on others* tab, not in the portal.
- **Locked records** still show *Edit*. Saving is refused.
- **Events with no source.** Nothing raises some agent events yet: an expiring insurance certificate, a closed owner statement, a new data issue. Those agents cover the work on their schedule. The Automations page marks these events.

More detail: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).
