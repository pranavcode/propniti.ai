A tour of Propniti at [propniti.ai](https://propniti.ai), with one section per staff persona, portal and the public listings site.

Open [propniti.ai/login](https://propniti.ai/login) and sign in with a demo account, for example `marcus@propniti.demo` with the password `propniti-demo` (shared by all accounts). Or click one of the 13 people in *Pick a person* to fill the form; double-click to sign in at once. To switch later, use *Switch role (demo)* in the avatar menu or *Switch* in the banner.

Each persona's home opens with a welcome screen once a demo day: what Propniti does for the role, *What's new* and up to three things waiting. *Help › Show welcome screen* brings it back. Sidebar dots mark features you haven't opened, a card offers a tour once per session, and the *Ask Propniti* panel opens once a day.

Everything is sample data: 30 properties in Austin, Dallas, Atlanta and Phoenix. "Today" is 4 November 2026, with books closed through October. Your changes go into a private copy that resets at midnight Pacific. No real payments or messages are sent.

AI output is labelled **AI** (a live model, just now), **AI · saved** (stored from an earlier run) or **Rules** (fixed rules). Record summaries say **Rules · from this record's current figures**, **Generated** or **Precomputed**. Figures come from the data, so wording can differ between runs but numbers can't.

## 1. Things every staff page shares

| Feature | How it works |
| --- | --- |
| Peek drawer | Click a list row to open the record in a side drawer (a bottom sheet on phones). J and K move between rows; Esc closes. The `?peek=` URL can be shared |
| Record pages | Tabs, *AI summary* (or *Summarize with AI*), *Data health* panel, named actions and *Ask about this* |
| Layout | Click a home-page section to collapse it. *Reset layout* in the avatar menu restores sections and panel sizes |
| ⌘K | Searches records and pages, and turns a question into "Ask AI" |
| ⌘J, *Ask Propniti* | Opens the assistant in *Ask*, *Do*, *Help* or *Auto* mode. Answers show "Looked up N things" and a *Full trace* link. *Right now* offers up to three one-click items; the history button lists past conversations. *Do* mode can start an agent |
| Chat bubble | The round button at the bottom right opens the assistant with questions for the current page, and now and then a tip from your data. *Show tips* turns tips off |
| Definitions | Hover or tap a KPI, chart, column, filter or autonomy label for a plain-English definition. *Learn more* opens `/app/help/<id>` |
| Sidebar | A sparkle marks AI-powered pages. Breadcrumbs open each section's first page |
| Inbox | `/app/inbox` (or press I): conversations waiting on you, proposals you can decide, alerts. *Reply* opens the conversation; *Review* opens the proposal |
| My tasks | `/app/tasks`: tasks for you or your role, in *Open*, *Overdue*, *Today*, *Upcoming* and *Done* views. Click the circle to mark one done |
| Agents | `/app/agents` (the eight agents), `/app/automations` (what runs when), `/app/ai/approvals` (proposals), `/app/ai/activity` (runs) |
| Out of scope | A record outside your scope shows "This record isn't in your scope or doesn't exist" |
| Downloads | *Download* on lists, reports and owner statements: *CSV*, *Excel (.xlsx)* or *PDF*, up to 10,000 rows, matching the screen. *Include Propniti branding* adds a logo and footer to Excel and PDF |
| Feedback | A thin bar shows page loads. A filter click adds a line such as "Showing 608 warning open issues · Clear"; changed sections show "Updated just now". Toasts confirm approvals and bulk actions |
| Theme | *Light*, *Dark* or *System* (the default) from the top bar or ⌘K |
| Copilot | `/app/copilot`, the full-page assistant. Each persona starts with *Sample* conversations, such as "Who is 30+ days late on rent?"; follow-ups continue in your private copy |

![Record peek drawer open beside a work-order list](/docs/walkthrough/screens/marcus-peek-drawer.webp#2880x1800)

![Sign-in card with the form and the Pick a person list](/docs/walkthrough/screens/login-form.webp#2880x1800)

![Ask Propniti bubble with a tip](/docs/walkthrough/screens/marcus-chat-bubble.webp#2880x1800)

![Welcome splash on the home page](/docs/walkthrough/screens/marcus-welcome.webp#2880x1800)

![Copilot with a sample conversation open: the Sample banner, proposed reminders with Approve buttons and the Rules label](/docs/walkthrough/screens/marcus-copilot-sample.webp#2880x1800)

![Download menu on the AR aging report: CSV, Excel and PDF, with Include Propniti branding ticked](/docs/walkthrough/screens/grace-download-menu.webp#2880x1800)

## 2. Daniel Reyes, principal

All 30 properties. Lands on `/app`, the portfolio home.

1. Read the briefing card: the October close, what needs him, what to watch.
2. Click *Explain* on the NOI tile to see the drivers and the properties that moved it. *View run* opens the run behind it.
3. In *Furthest below budget*, open a property ("NOI (last month)"), then *Unit stack* and a unit for its lease history.
4. Click *What-if*, try *Rent +3%*, then *Explain this scenario*.
5. Under a red KPI such as *Occupancy*, click *Improve with AI* to see why it's red and what agents can do. *Have agents do this* starts them.
6. Approve or reject proposals in *Waiting for your decision*.

Daniel and admins can edit *Settings → Company profile*; other roles see it read-only.

### Guided setup

`/app/onboarding` (*Set up your portfolio*, also linked from the *Finish setup* checklist at the foot of the sidebar) has five steps. A principal, regional manager or admin can use it. Steps can be skipped, and progress is saved.

1. **Company.** Name, operating states and approximate unit count. States set late-fee caps, notice periods and deposit rules.
2. **Bring your data.** Drop exports in any mix, or *Try sample files*. Rules identify each file's tool and contents with a confidence and reason; *Use AI to identify files and suggest fixes* is optional. *Match columns* continues in the import wizard.
3. **Approval rules.** Suggested limits and autonomy from your records, for example "Median completed vendor work order $386 across 3,853 jobs → auto-approve up to $400". *Accept*, *Edit* or *Keep current* each one.
4. **Your team.** Add people with a role and coverage. No email is sent.
5. **Check and finish.** Data Health checks the imported records, then a summary shows imports, issues, rules and people.

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

14 Texas properties. Lands on `/app`, her regional home.

1. Scroll to *Property comparison*: occupancy, economic occupancy, NOI against budget, collections, delinquency and work-order SLA.
2. Click *Variance* on a row to explain that property's NOI change.
3. Use the quick actions *Concessions to approve* and *Work orders past SLA*.
4. Open `/app/settings/import` and click *Try samples* on a tool tile (for example AppFolio), or upload a CSV, TSV or Excel file. Review the column matches and AI suggestions, then *Preview import* and *Import N records*. *Undo import* reverses it.

Concessions over $500 need a regional manager, so the agents' concession proposals come to Priya.

![Priya's regional home with the property comparison table](/docs/walkthrough/screens/priya-home.webp#2880x1800)

![Import, Source step: a tile for each tool with Try samples](/docs/walkthrough/screens/priya-import-samples.webp#2880x1800)

![Import, Columns step: each column matched by preset, with sample values](/docs/walkthrough/screens/priya-import.webp#2880x1800)

## 4. Marcus Bell, property manager

Three Austin communities. Lands on `/app/today`.

1. Read *Your briefing*. Each line links to the rows behind it: past-due households, leases without a renewal offer, unread conversations, data issues.
2. Click *Leases ending in 60 days* and peek at a row.
3. On a red KPI such as delinquency, click *Improve with AI*, then *Have agents do this*.
4. In *Approvals*, open *Why?* on a Collections reminder for its reasons, records and confidence. Approve or reject.
5. In *Inbox → Messages*, *Needs reply* means the resident wrote last. Click *Reply*, then *Suggest a reply*, edit the draft and *Send*.
6. In *My tasks → Overdue*, mark one done, then *Undo*. Try *Snooze* and *Reassign*.
7. Open a lease's *Abstraction* tab and click *Abstract lease on file*. It cites pages and flags mismatched dates; *Apply fix* corrects the record.
8. In *Announcements → New*, pick a property, *Draft with AI*, review and send.
9. Open *Data health*. It lists issues on his properties and on vendors. Two leases are still Active after their end date: pick *Mark as ended* or *Switch to month-to-month*, which goes to approvals.

![Marcus's Today page with briefing, KPIs and approvals](/docs/walkthrough/screens/marcus-today.webp#2880x1800)

![Approvals inbox: each proposal with its reasons, risk and confidence](/docs/walkthrough/screens/marcus-approval-why.webp#2880x1800)

![Inbox with Messages, Approvals and Alerts tabs](/docs/walkthrough/screens/marcus-inbox.webp#2880x1800)

![Conversation with a suggested reply ready to edit](/docs/walkthrough/screens/marcus-inbox-reply.webp#2880x1800)

![My tasks, Overdue view](/docs/walkthrough/screens/marcus-tasks.webp#2880x1800)

## 5. Lena Ortiz, leasing agent

The same three Austin properties. Lands on `/app/leasing/today`.

1. Read the *Briefing*: new leads, tours, applications and overnight agent work.
2. Check *Today's tours* and *Follow-ups due*. The Leasing agent proposes follow-ups for prospects not contacted in three days.
3. On the *Pipeline board*, move a prospect to *Tour* (*Undo* moves it back). Send a follow-up or *Send all*; *Rewrite with AI* edits a draft.
4. Open a listing, click *Draft with AI*, then *Use draft, then edit*. Wording that fails the fair-housing check blocks the save.
5. In *Renewals*, pick a draft offer and click *Ask the Renewals Agent*. It prices toward market, capped at +5%. Accept or edit it, click *Draft with AI*, then *Send offer*.

![Lena's leasing day with tours and follow-ups](/docs/walkthrough/screens/lena-leasing-today.webp#2880x1800)

![Listing editor with an AI draft and the fair-housing check](/docs/walkthrough/screens/lena-listing-draft.webp#2880x1800)

## 6. Rachel Moore, managing broker

Decides applications. Lands on `/app/leasing/broker`, the *Broker desk*.

1. In *Applications waiting on you*, *AI recommends* shows Approve, Conditional or Deny with a score.
2. Click *Review*. The *Leasing agent score* tab shows reasons for and against; *Re-score* runs it again.
3. Click *Approve with conditions*, add the required reason and confirm.
4. Check *Fair-housing language* for flagged listing wording.

Criminal history isn't scored; it goes to a person. Applications from the public site are usually scored right away (see [section 15](#15-public-listings-site)).

![Broker desk with applications and AI recommendations](/docs/walkthrough/screens/rachel-broker-desk.webp#2880x1800)

![Application scoring tab with reasons for and against](/docs/walkthrough/screens/rachel-application-score.webp#2880x1800)

## 7. Grace Kim, senior accountant

All owner entities. Lands on `/app/finance`.

1. Read the briefing and KPIs: open payables, past due, unreconciled items, cash in trust, NOI and expense against budget.
2. In *AP inbox*, choose a sample invoice. Propniti reads it, suggests GL coding and runs *Payables checks*, holding invoices from vendors with unverified bank changes.
3. Open a bill such as `/app/payables/bills/BILL-20001` to see its checks and coded lines.
4. In *Owner statements*, click *Explain* on a line such as *Unreconciled difference*. *Download statement* saves it as a file.
5. In *Budget vs actual*, click ✦ on a row to explain a variance.
6. In *Reports*, type a question such as "show me utilities by property for Q3 vs budget" and click *Build report*.
7. Open a bank reconciliation and *Accept match* on a suggestion.

![Grace's finance home](/docs/walkthrough/screens/grace-finance-home.webp#2880x1800)

![AP inbox with fields read from an invoice and payables checks](/docs/walkthrough/screens/grace-ap-inbox.webp#2880x1800)

![Owner statement with an Explain popover](/docs/walkthrough/screens/grace-owner-statement-explain.webp#2880x1800)

## 8. Tom Alvarez, maintenance supervisor

14 Texas properties. Lands on `/app/maintenance`.

1. Read the briefing and KPIs: SLA met, open work orders, waiting to dispatch, invoices to approve, units not rent-ready.
2. In the *Triage queue*, each work order shows the agent's trade, urgency, estimate and vendor.
3. In *New request*, describe a problem and click *Save and triage*. Then *Dispatch*, or *Line up and ask owner* if it's over the owner's limit.
4. Open *Board* for the work-order board and calendar.
5. On a work order's *Invoice and PO* tab, review the PO check and click *Approve and pay*.
6. In *Technician view*, *Start job* and log 30 minutes.
7. Open `/app/compliance` for insurance certificates, permits, inspections and the expiries timeline.

The PO check uses fixed rules, not a model. Tom can't set a vendor to Inactive or Do not use while it has open emergency or life-safety jobs; he reassigns them first, or asks Priya or Daniel.

![Tom's maintenance home with triage queue](/docs/walkthrough/screens/tom-maintenance-home.webp#2880x1800)

![Work order Invoice and PO tab with the PO check](/docs/walkthrough/screens/tom-invoice-po.webp#2880x1800)

![Compliance dashboard with expiries timeline](/docs/walkthrough/screens/tom-compliance.webp#2880x1800)

## 9. Sam Okafor, administrator

Org settings. Lands on `/app/admin`.

1. Read the briefing: *What needs you*, *Risks and anomalies* and *Overnight*.
2. Open *Settings → Users* and *Roles and permissions* for the role × module matrix.
3. In *Settings → Approvals*, *Edit* *Maintenance spend · org default*, change the limit and *Save policy*. It shows in *Change history*.
4. Open *Audit log* for human and agent actions.
5. Open *Data health* for the score and issues by rule and property. Fixes show values before and after; issues with no automatic fix give a manual next step and a link. As an admin, Sam sends fixes for approval with *Send for approval*.
6. In *Automations*, turn agents on or off and change their autonomy.

![Sam's admin briefing](/docs/walkthrough/screens/sam-admin-briefing.webp#2880x1800)

![Approval policies: org defaults and owner-entity limits](/docs/walkthrough/screens/sam-approval-policy.webp#2880x1800)

![Data health, warnings: a fix with before and after values, and Send for approval for the admin](/docs/walkthrough/screens/sam-data-health.webp#2880x1800)

![Data health issue with no automatic fix: the reasons and a manual next step with a link to the vendor](/docs/walkthrough/screens/sam-data-health-next-step.webp#2880x1800)

## 10. Nadia Brooks, platform admin

All customer orgs. Lands on `/app/admin`, with platform quick actions.

1. *Customer orgs*: organizations, seats and units managed.
2. *System health*: the model in use, the 15-minute sweep, queues and failed runs.
3. *AI usage*: runs per day and by agent, tokens and cost by model and organization.
4. Unlike Sam, Nadia can approve agent proposals from her briefing.

![Platform console with customer organizations](/docs/walkthrough/screens/nadia-platform-orgs.webp#2880x1800)

![AI usage by agent and model](/docs/walkthrough/screens/nadia-ai-usage.webp#2880x1800)

## 11. Agents, approvals and runs

Any staff persona with AI access; Marcus works well.

1. Open `/app/agents`. Each card shows goal, status, counters, last and next run, model and schedule in plain words ("Daily at 14:00 UTC · on Payment returned").
2. Click *Run now* on the Collections agent. A side sheet streams steps such as "Looked up 14 residents"; *Technical details* shows raw input and output. *Open the full run* opens `/app/ai/runs/<id>`.
3. Under a card, check the *Autonomy* select: *Approve first* or *Auto within policy*. Only a principal, regional manager or admin can change it.
4. Read the *Approval policies* table to see what agents may apply on their own and when the owner decides.
5. In `/app/ai/approvals` (*Needs you*, *Handled automatically*, *Waiting on others*, *Decided*), filter by agent, risk or record type and click *Approve all low-risk matching*. *Notify approver* nudges whoever decides. Life-safety items go only to the regional manager or principal.
6. `/app/ai/activity` lists runs with trigger (*Schedule*, *Event*, *Run now* or *Assistant*), model, tokens and summary.
7. `/app/automations` shows agents on, the next sweep, waiting events, each agent's triggers and 30-day runs and failures, and the approval and built-in rules.

Agents also run on their own: every 15 minutes on a schedule, on events such as an overdue charge or a new application, and on the first visit after a missed sweep.

![Agents page with cards and Run now](/docs/walkthrough/screens/marcus-agents.webp#2880x1800)

![An agent run in plain words, with the proposal it made](/docs/walkthrough/screens/marcus-run-live.webp#2880x1800)

![Approvals inbox, Needs you tab](/docs/walkthrough/screens/marcus-approvals.webp#2880x1800)

![Automations page with agents, sweep and approval rules](/docs/walkthrough/screens/marcus-automations.webp#2880x1800)

## 12. Owner portal (Helen Carter)

Bluebonnet Residential Fund II. Lands on `/portal/owner`.

1. Read *Your monthly briefing* on why her distribution moved.
2. In *Statements*, pick a month and click *Explain* on *Distributed to owner*. *Download statement* saves it.
3. In *Approvals*, repairs over her limit show *Why this needs you*. Click *Approve $…*, add a note and confirm.
4. Click *Ask AI* and choose "Why was my distribution lower this month?".

![Owner portal home with the monthly briefing](/docs/walkthrough/screens/owner-home.webp#2880x1800)

![Owner repair approval with reasons](/docs/walkthrough/screens/owner-approvals.webp#2880x1800)

## 13. Resident portal (Jordan Lee)

Unit #412 at The Lofts at Riverside. Lands on `/portal/resident`.

1. In *Pay*, tick the charges, click *Pay $… by ACH* and confirm. Turn autopay on or off.
2. In *Requests → New request*, type "The kitchen sink is leaking under the cabinet". *AI's first read* (rules) suggests a trade and typical cost, which staff confirm. *Send request* creates a work order.
3. *Lease* shows the lease, renters insurance and any renewal offer.

*Ask AI* answers from Jordan's own records.

![Resident pay page](/docs/walkthrough/screens/resident-pay.webp#2880x1800)

![New request with the AI first read](/docs/walkthrough/screens/resident-request-triage.webp#2880x1800)

## 14. Vendor portal (Luis Ramirez) and applicant portal (Priyanka Rao)

**Vendor.** Lone Star Plumbing. Lands on `/portal/vendor`.

1. In *Jobs → New*, *Accept* a job, with an optional visit time.
2. In *Invoices → Send an invoice*, pick the job and upload a photo or PDF. With a model configured, the lines fill in from the file. Check them and *Send invoice*; it appears on the job's *Invoice and PO* tab.
3. In *Insurance*, upload a certificate. It stays *Pending verification* until staff verify it.

Sample files: [clean invoice](https://propniti.ai/samples/coolair-invoice.png) or [invoice with problems](https://propniti.ai/samples/coolair-invoice-bad.png).

**Applicant.** Barton Creek Commons. Lands on `/portal/applicant`.

1. The status timeline runs from Started to Lease signing; *Still needed* lists missing documents.
2. Upload in *Documents* (only the file name is kept).
3. Pay the $55 fee in *Fee*. No real card is charged.

![Vendor invoice read from an uploaded file](/docs/walkthrough/screens/vendor-invoice.webp#2880x1800)

![Applicant status timeline and checklist](/docs/walkthrough/screens/applicant-status.webp#2880x1800)

## 15. Public listings site

No sign-in. Open [propniti.ai/listings](https://propniti.ai/listings).

1. Choose a metro such as Austin and open a listing: pricing, fees, total due before move-in, floor plan and lease terms.
2. Under *Ask about this unit*, ask "What's the total to move in?". Fair-housing, safety or school questions get a fixed *Fair housing policy* answer.
3. Under *Schedule a tour*, pick a type, day and time, then *Book tour*.
4. Click *Apply now*, complete the five steps and *Submit application*.
5. The status page's *AI screening summary* shows the Leasing agent's score, usually right away. *Open the broker's approvals* jumps to that proposal.

![Public listing with pricing, fees and Ask about this unit](/docs/walkthrough/screens/public-listing.webp#2880x1800)

![Application form, step 1 of 5, beside the listing's pricing](/docs/walkthrough/screens/public-apply.webp#2880x1800)

## 16. Known limits

- No real accounts: the demo password is published. Payments, bank feeds, email and SMS are simulated.
- No reset button; your private copy resets at midnight Pacific.
- Portal invoices appear only on the work order's *Invoice and PO* tab, not the AP inbox.
- Agent proposals waiting on an owner show in the staff *Waiting on others* tab, not the owner portal.
- Locked records still show *Edit*, but saving is refused.
- Some agent events (an expiring insurance certificate, a closed owner statement, a new data issue) have no source yet; those agents run on their schedule.

More detail: [docs/security-review.md](https://github.com/pranavcode/propniti.ai/blob/main/docs/security-review.md).
