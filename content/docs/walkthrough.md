This is a step-by-step tour of the live Propniti prototype at [propniti.ai](https://propniti.ai). It has one section for each type of user. Then it walks through each main use case from start to finish. All screenshots come from the live site, taken in a fresh browser session. The prototype uses Llama 4 Scout on Cloudflare Workers AI. This model can read images.

**Try it yourself:** Open [propniti.ai/demo](https://propniti.ai/demo) and pick a role. The property manager is the main role, and Try the live demo on the home page opens that view directly. You don't need to sign up. To test how the AI reads invoices, download a sample invoice ([clean](https://propniti.ai/samples/coolair-invoice.png) or [with problems](https://propniti.ai/samples/coolair-invoice-bad.png)). Then upload it as the vendor. All roles share one copy of the demo data. Your copy is private to you and resets at midnight Pacific time. To start over sooner, go to Admin → *Reset demo data*.

**Try onboarding:** Sign up as a manager, or open [propniti.ai/onboarding](https://propniti.ai/onboarding). Then load a sample file: the [AppFolio-style rent roll](https://propniti.ai/samples/appfolio-style-rent-roll.csv) or the [Buildium-style export (with errors)](https://propniti.ai/samples/buildium-style-export.csv).

**How to read this:** Each step has a role and a number, like *PM 6*. AI results can vary a little between runs, so each caption describes its screenshot.

## 1. Use cases

The prototype covers nine use cases from start to finish. They include the trust-account payments ledger, ratings and feedback, and AI-driven onboarding with portfolio import.

| \# | Use cases and personas | Where in the app and walkthrough steps |
| --- | --- | --- |
| [UC1](#uc1-read-invoices-and-bills-with-ai) | Read invoices and bills with AI<br>*(Persona: Vendor, property manager)* | Vendor → Work orders; PM → work order page<br>*(Steps: [§5.2–5.4](#5-vendor-derek-simmons-coolair-hvac))* |
| [UC2](#uc2-validate-vendor-invoices-against-the-po) | Validate vendor invoices against the PO<br>*(Persona: Property manager)* | Dashboard alert → work order page → *Run AI validation*<br>*(Steps: [§4.5–4.8](#4-property-manager-maya-patel))* |
| [UC3](#uc3-track-critical-events-and-nudge-people) | Track critical events and nudge people<br>*(Persona: Property manager, tenant)* | Dashboard alerts; tenancy page; tenant inbox<br>*(Steps: [§4.2–4.3, 4.15](#4-property-manager-maya-patel), [§6.1](#6-tenant-jasmine-brooks-riverside-lofts-204))* |
| [UC4](#uc4-ask-the-portfolio) | Ask the portfolio a question<br>*(Persona: Property manager)* | Dashboard → Assistant<br>*(Steps: [§4.9](#4-property-manager-maya-patel))* |
| [UC5](#uc5-drill-into-details-and-back) | Drill into details and back<br>*(Persona: Property manager)* | Any dashboard item → detail page → *Back to dashboard*<br>*(Steps: [§4.2, 4.4, 4.5](#4-property-manager-maya-patel))* |
| [UC6](#uc6-money-through-a-trust-account) | Money through a trust account<br>*(Persona: Tenant, property manager, owner, vendor)* | Tenant → Rent and invoices; PM → Payments; Owner → Payouts; Vendor → Payments and 1099<br>*(Steps: [§6.4–6.5](#6-tenant-jasmine-brooks-riverside-lofts-204), [§4.11–4.13](#4-property-manager-maya-patel), [§7.3](#7-owner-robert-chen), [§5.6](#5-vendor-derek-simmons-coolair-hvac))* |
| [UC7](#uc7-ratings-and-feedback) | Ratings and feedback<br>*(Persona: Tenant, property manager, owner, vendor, maintenance)* | Tenant → Home and Maintenance requests; PM → work order page and Ratings<br>*(Steps: [§6.6–6.7](#6-tenant-jasmine-brooks-riverside-lofts-204), [§4.12, 4.14–4.15](#4-property-manager-maya-patel), [§7.4](#7-owner-robert-chen), [§5.7](#5-vendor-derek-simmons-coolair-hvac), [§8.3](#8-maintenance-luis-romero))* |
| [UC8](#uc8-onboarding-and-import) | Onboard and import a portfolio<br>*(Persona: Property manager)* | Sign up → */onboarding*; Properties → *Import tenancies*<br>*(Steps: [§3.1–3.9](#3-onboarding-new-property-manager))* |
| UC9 | A view per role<br>*(Persona: All six)* | Persona routes; demo switcher<br>*(Steps: all persona sections, [§3](#3-onboarding-new-property-manager)–[§9](#9-admin-sam-okafor-and-the-demo-switcher))* |

### UC1. Read invoices and bills with AI

Steps: *§5.2–5.4*. Upload a JPEG, PNG, WebP or PDF up to 4 MB. The server checks the file type from its first bytes, sends the file to the vision model, then deletes it. (PDFs become text first.) The model returns the vendor, invoice number, date, line items, total, currency and a legibility score. Then five rule-based checks confirm that it is an invoice, has a vendor and number, adds up, is in US dollars and is at least 70% legible. If a check fails, the vendor can't use the invoice. If legibility is low, the vendor must confirm “I've checked these figures”. The manager can attach a paper invoice to a work order the same way.

### UC2. Validate vendor invoices against the PO

Steps: *§4.5–4.8, §4.10*. The model compares the totals, each line item and the photo count with the purchase order. It returns a decision (approve, review or reject), a confidence score and its evidence. Rules on top of the model decide what happens next:

- 85% or higher with no issues: the app offers one-tap approve.
- Anything else: the button reads *Approve & pay anyway*.
- If the model says approve but the rule check finds an issue, the app changes the decision to review and caps confidence at 60%.
- The app never approves an invoice whose lines don't add up to its total, that has no lines or negative amounts, or that leaves out a PO item.
- In V1, a person must approve every payment.

### UC3. Track critical events and nudge people

Steps: *§4.1–4.3*, *§6.1*. Overdue rent, lease renewals and invoices waiting for review show up as dashboard alerts with one-click actions. Each nudge goes out on the person's preferred channel. It also lands in their inbox and the activity log.

### UC4. Ask the portfolio

Steps: *§4.9*. The assistant answers from the portfolio data and suggests next actions. Each answer shows its source. For overdue rent, renewals and open work orders, the app calculates the figures itself and the model only suggests next steps. The manager still decides what to do.

### UC5. Drill into details and back

Steps: *§4.2, 4.4, 4.5*. Every dashboard alert, tenant, property and work order links to a detail page, and so does every work-order mention in the activity feed. Each detail page has *← Back to dashboard*.

### UC6. Money through a trust account

Steps: *§6.4–6.5*, *§4.11–4.13*, *§7.3*, *§5.6*. Rent goes into the manager's trust account as a Pending ACH transfer and clears seconds later (simulated). The app takes the 8% management fee at the same moment. When the manager approves a vendor invoice, the app sends the payout from trust and charges it to that property's owner. The job shows Payment pending, then Paid when the payout clears. Each owner statement equals cleared rent − fee − vendor bills since the owner's last payout. *Pay owner* sends that amount and closes the statement. The app refuses any payout larger than the available trust balance. Every transfer has an idempotency key (a unique ID), so a double click or a retry can't move money twice.

### UC7. Ratings and feedback

Steps: *§6.6–6.7*, *§4.12, 4.14–4.15*, *§7.4*, *§5.7*, *§8.3*. Tenants rate finished jobs on their unit, plus their manager and their building. Managers rate the vendor or staff member on each paid job. Each person rates each job once; rating again replaces the old rating. Averages show on profiles, on the owner's properties and in the Ratings tab. Any 1–2 star rating raises a dashboard alert.

### UC8. Onboarding and import

Steps: *§3.1–3.9*. The browser reads a rent-roll CSV or TSV from AppFolio, Buildium, Yardi, Rent Manager or a spreadsheet. Workers AI matches its columns and checks them against the real headers, with name-based matching as a fallback. Before import, the app checks every row for a missing property, unit, tenant or rent; non-numeric rent; bad or reversed dates; duplicates; and doubtful emails. Workers AI also turns pasted free text into rows. Then the manager links a bank (simulated) and invites owners and vendors, and the imported properties appear on the dashboard.

**AI provider and fallback.** On propniti.ai, Workers AI runs by default and needs no API key. You can switch to Claude or OpenAI by setting a key. If no model is available or a call fails, the app shows rule-based mock results labelled *Mock AI*, with a note that the real AI isn't set up. Each IP address has a rate limit on AI routes.

## 2. Getting started

1. **Home page:** Open [propniti.ai](https://propniti.ai) to see what the product does. Click *Try the live demo* to explore or *Get started* to sign up.

![Propniti home page: "Buildings that run themselves." with Try the live demo and Get started buttons](/docs/walkthrough/01-propniti-home-page-buildings-that-run.png#2880x1800)

2. **Pick a persona:** *Try the live demo* opens the property manager's dashboard, the main role. The demo menu's All personas item opens the persona picker. It shows six people, one for each role. Click one to open their view of the app.

![Persona picker: "Who do you want to be?" with six persona cards](/docs/walkthrough/02-persona-picker-who-do-you-want.png#2880x1800)

3. **Sign in (demo):** The sign-in, sign-up and password reset screens are for show only. Any email works, and the app stores or sends nothing. Signing in opens the property manager view.

![Sign-in screen: "Welcome back." with email and password fields](/docs/walkthrough/03-sign-in-screen-welcome-back-with.png#2880x1800)

## 3. Onboarding (new property manager)

When a manager signs up, a five-step setup starts. They bring in the portfolio from another tool, check it, connect the trust account, invite people, and then go to the dashboard.

1. **Start setup.** Sign up as a manager (*I run properties*). The app opens */onboarding*. You can *Import a file* (a CSV or TSV rent roll, up to 2 MB) or *Paste anything*. Two sample exports are linked for testing.

![Onboarding step 1: Bring your portfolio in minutes, with Import a file and Paste anything](/docs/walkthrough/04-onboarding-step-1-bring-your-portfolio.png#2880x1800)

2. **Import a file with problems.** Choose *Buildium-style export (with errors)*. Workers AI matches every column (Rental name → Property, Resident name → Tenant name, Rent amount → Monthly rent, Owner name → Owner). Address and phone show as *Not in file*. Of 5 rows, 2 are ready and 3 need fixing: the rent “two thousand” is not a positive amount, Lakeview Townhomes T3 appears twice, and T4 has no tenant name. The app flags Ravi Shah's email “ravi.shah@example” as a warning but doesn't block it.

![Review step: columns matched by AI, 2 ready and 3 need fixing with reasons per row](/docs/walkthrough/05-review-step-columns-matched-by-ai.png#2880x2464)

3. **Import a clean rent roll.** Go *Back* and choose *AppFolio-style rent roll*. All 6 rows are ready, across Maple Court Apartments and Cedar Plaza Retail.

![Review step for the AppFolio-style rent roll: 6 ready](/docs/walkthrough/06-review-step-for-the-appfolio-style.png#2880x2282)

4. **Get paid.** Click *Import 6 tenancies*, then pick a bank. The trust account shows *Connected*: “Wells Fargo trust account ending 4821”. Production uses a Plaid link; the demo simulates it.

![Get paid: Imported 6 tenancies; Wells Fargo trust account ending 4821 connected](/docs/walkthrough/07-get-paid-imported-6-tenancies-wells.png#2880x1800)

5. **Invite people — the app catches a bad address.** The app pre-fills owner emails for Robert Chen and Linda Alvarez. The imported properties get a placeholder owner, *Owner to invite*. If you type “ops@coolair.example, not-an-email” for vendors, the app shows “Check these addresses: not-an-email” and keeps *Send 4 invites* disabled.

![Invite step with Check these addresses: not-an-email and the Send button disabled](/docs/walkthrough/08-invite-step-with-check-these-addresses.png#2880x1920)

6. **Send the invites.** Remove the bad address and click *Send 3 invites*. The app confirms “3 invites sent (simulated)”.
7. **Done.** The summary shows 5 properties and 12 tenancies, the Wells Fargo trust account connected, and 3 people invited. A note says the 15-minute agent sweep is planned but doesn't run in this demo.

![You're set: 5 properties and 12 tenancies, Wells Fargo connected, 3 people invited, sweep noted as not running in the demo](/docs/walkthrough/09-youre-set-5-properties-and-12.png#2880x1520)

8. **See the imported properties.** Click *Go to my dashboard* → *Properties*. Maple Court Apartments (4 units, 4/4) and Cedar Plaza Retail (2 units, 2/2) now sit next to the existing three, with owner *Owner to invite*. The *Import tenancies* link on this card reopens onboarding.

![Properties tab with Maple Court Apartments (Multifamily) and Cedar Plaza Retail (Commercial) added](/docs/walkthrough/10-properties-tab-with-maple-court-apartments.png#2240x892)

9. **Paste anything.** Go back to */onboarding*, paste three lines of notes about Willow Flats and choose *Read with AI*. Workers AI returns 2 rows. Unit 1: Ana Gomez, $1,650, lease ends 2027-08-31 (ready). Unit 2: Ben Carter, $1,700, with the warning “No lease end date: treated as month-to-month”.

![Pasted notes read by Workers AI into 2 rows, both importable](/docs/walkthrough/11-pasted-notes-read-by-workers-ai.png#2880x1800)

## 4. Property manager (Maya Patel)

The manager starts her day on one dashboard. Every alert opens a detail page, and anything that moves money waits for her approval.

1. **Dashboard.** The top shows four stats: 3 properties, 91% occupancy, $9,400 of $12,475 October rent collected, and 6 items that need attention. Below are alerts with one-click actions and the agent's activity log. The header shows the active AI provider (*AI: Workers AI*). The dark *Demo* pill at the bottom switches personas.

![PM dashboard: stats, six alerts with Nudge tenant, Send renewal offer and Review buttons, agent activity](/docs/walkthrough/12-pm-dashboard-stats-six-alerts-with.png#2880x1800)

2. **Open an alert.** Click *Rent overdue: Marcus Lee* to open his tenancy page. It shows rent of $1,725, a lease to 2027-05-31, $1,725 overdue (INV-2610-02), his contact details and his preferred channel (SMS). *← Back to dashboard* takes you back.

![Tenancy page for Marcus Lee with back link, stats, tenancy details and invoices](/docs/walkthrough/13-tenancy-page-for-marcus-lee-with.png#2880x1800)

3. **Send a reminder.** Click *Send rent reminder*. The app sends an SMS, his preferred channel, and lists it right away under *Messages sent*: “Hi Marcus, reminder: INV-2610-02 for $1,725 is overdue (due 2026-10-01).”

![Tenancy page with the new SMS reminder listed under Messages sent](/docs/walkthrough/14-tenancy-page-with-the-new-sms.png#2880x2376)

4. **Property detail.** Click a property name in the Properties tab or on a tenancy page to open the property page. Harbor View Commercial is commercial and 83% occupied (5 of 6 units). It has $4,200 rent on file, owner Linda Alvarez and two open work orders (WO-1042, WO-1046). Each work order links to its own page.

![Harbor View Commercial property page with tenancies and work orders](/docs/walkthrough/15-harbor-view-commercial-property-page-with.png#2880x2278)

5. **Validate a clean invoice.** Open the alert *Invoice to validate: WO-1041*. The work-order page shows the PO and the vendor's invoice side by side. Click *Run AI validation*. The result is **approve, 100% confidence (Workers AI)**, with three matched checks and no issues. The button now reads *Approve & pay (one tap) · $635*.

![WO-1041 validated by Workers AI: approve, 100% confidence, Approve & pay (one tap) $635](/docs/walkthrough/16-wo-1041-validated-by-workers-ai.png#2880x2820)

6. **Approve.** One tap approves WO-1041. It shows Payment pending until the payout clears (*§4.11–4.12*). The history logs “Payment approved · WO-1041: $635 to CoolAir HVAC by ACH”, and the app notifies the vendor (see *§5.5*).

![WO-1041 history after approval: payment approved and invoice validated](/docs/walkthrough/17-wo-1041-history-after-approval-payment.png#2880x1800)

7. **Catch a bad invoice.** WO-1042 (QuickFix Plumbing) bills $575 against a $300 PO. It adds an after-hours fee, doubles the labor hours and includes only one of two photos. The model returns **reject, 20% confidence** and lists the issues. The approve button changes to *Approve & pay anyway*.

![WO-1042 flagged by Workers AI: reject, 20% confidence, four issues](/docs/walkthrough/18-wo-1042-flagged-by-workers-ai.png#2880x2848)

8. **Send it back.** Click *Send back to vendor*. The app sets the status to *Changes requested*, sends the issues to the vendor and logs it. In this run the model found four issues: the total doesn't match the PO, the line items don't match, there aren't enough photos, and one item isn't in the PO.

![WO-1042 history: changes requested, sent back to QuickFix Plumbing](/docs/walkthrough/19-wo-1042-history-changes-requested-sent.png#2880x1800)

9. **Ask the assistant.** Open the Assistant tab and ask *Who is late on rent?* The answer lists both overdue tenants with amounts and due dates (Marcus Lee, $1,725; Aisha Khan, $1,350). Workers AI suggests a reminder for each. For overdue rent, renewals and open work orders, the app calculates the figures itself and the model only adds suggestions. So a wrong or manipulated model answer can't change a balance or a date. A note under the answer says so: “Figures computed from your data; suggestions by AI.”

![Assistant: Who is late on rent? Computed list of 2 overdue invoices with amounts and due dates; suggestions by Workers AI](/docs/walkthrough/20-assistant-who-is-late-on-rent.png#2240x764)

10. **Validate a vendor's AI-read invoice.** After the vendor submits WO-1046 (see *§5.3–5.4*), the manager runs validation. The result is **approve, 100% confidence (Workers AI)**, with four matched checks and *Approve & pay (one tap) · $600*. The history shows the vendor's submission and the validation.

![WO-1046 validated: approve, 100% confidence, Approve & pay $600](/docs/walkthrough/21-wo-1046-validated-approve-100-confidence.png#2880x2914)

11. **The payout starts as pending.** Right after the approval in *§4.6*, WO-1041 shows *Payment pending*. “Payout $635 to CoolAir HVAC” leaves the trust account as **Pending**: “ACH in progress (simulated: clears in seconds)”. The server refuses the approval if the trust account can't cover the payout, and an error banner says why. Buttons stay disabled while the app saves. A second click creates no second payment; the app shows a message instead.

![WO-1041 approved: status Payment pending, payout $635 to CoolAir HVAC Pending](/docs/walkthrough/22-wo-1041-approved-status-payment-pending.png#2240x1312)

12. **The payout clears; rate the vendor.** About nine seconds later the payout shows **Cleared**, the job turns Paid, and a rating box appears. Rate CoolAir HVAC 5 stars with “On time, tidy work, invoice matched the PO.” The app saves it and shows “✓ Saved”. Each person rates each job once; rating again updates it.

![WO-1041 Paid: payout Cleared, CoolAir HVAC rated 5 stars, ✓ Saved](/docs/walkthrough/23-wo-1041-paid-payout-cleared-coolair.png#2240x1682)

13. **Payments tab: pay an owner from a statement.** The trust account shows $9,875 cleared and $9,875 available. Each owner statement shows cleared rent minus the 8% fee and vendor bills since that owner's last payout. Robert Chen: $7,050 rent − $564 fee − $635 vendor bills = **$5,851** owed. His rent includes Jasmine's November payment from *§6.4–6.5*. Linda Alvarez: $4,200 − $336 − $0 = $3,864.

![Owner statements: Robert Chen owed $5,851, Linda Alvarez owed $3,864, each with Pay owner](/docs/walkthrough/24-owner-statements-robert-chen-owed-5851.png#2240x582)

Click *Pay owner* for Robert. The app sends $5,851 from trust and closes his statement, so every column drops to $0. A second click has nothing to pay.

![Owner statements after paying Robert Chen: his row shows $0](/docs/walkthrough/25-owner-statements-after-paying-robert-chen.png#2240x582)

14. **Ratings tab.** Each subject shows its average and latest comment: Maya Patel 4.0 (2), Riverside Lofts 4.5 (2), Harbor View Commercial 4.0 (1), Luis Romero 4.5 (2), CoolAir HVAC 5.0 (2), QuickFix Plumbing 2.0 (1). Half stars show exactly. Oak Street Duplex and BrightSpark Electric have no ratings yet.

![Ratings by subject with exact half-star averages, counts and latest feedback](/docs/walkthrough/26-ratings-by-subject-with-exact-half.png#2240x1002)

15. **Low ratings raise an alert.** Any 1–2 star rating shows on the dashboard. For example: “Low rating: 2★ for QuickFix Plumbing”, from Maya Patel on WO-1031: “Arrived three hours late; added charges not on the PO.”

![Dashboard alerts with Low rating: 2 stars for QuickFix Plumbing](/docs/walkthrough/27-dashboard-alerts-with-low-rating-2.png#1326x1112)

## 5. Vendor (Derek Simmons, CoolAir HVAC)

The vendor uploads a photo or PDF of their invoice. A vision model reads it, checks that it adds up, and fills in the submission.

1. **Work orders.** This page lists CoolAir's jobs with their purchase orders. WO-1041 shows *Paid* once its payout clears (approved in *§4.6*). WO-1046, the quarterly rooftop service (PO-5530, $600, 2 photos required), is *In progress* and shows the AI upload panel and the invoice form.

![Vendor work orders: WO-1041 paid, WO-1046 in progress with upload panel](/docs/walkthrough/28-vendor-work-orders-wo-1041-paid.png#2880x1800)

2. **Upload an invoice with problems.** Upload the *with problems* sample. Workers AI reads CA-88343, dated 2026-10-27: rooftop service $600, refrigerant top-up $180, emergency call-out surcharge $125, and a stated total of $880. **4 of 5 checks pass.** The lines add up to $905, not $880, so the check *Line items add up to the stated total* fails.

![Bad sample read by Workers AI: three lines, stated total $880, 4/5 checks, add-up check failed](/docs/walkthrough/29-bad-sample-read-by-workers-ai.png#2880x2812)

3. **Upload the clean invoice.** The *clean* sample reads as CA-88342: one line (quarterly rooftop unit service, 4 units, $600) and a total of $600. **All 5 checks pass.** Click *Fill my invoice from this* to copy the line items and invoice number into the submission. The vendor then adds before and after photo notes.

![Clean sample read by Workers AI: CA-88342, $600, 5/5 checks passed](/docs/walkthrough/30-clean-sample-read-by-workers-ai.png#2880x2716)

4. **Submit.** Click *Submit invoice*. WO-1046 moves to *Submitted* (invoice CA-88342, $600, 2 photos), and the app notifies the manager. The manager validates it in *§4.10*.

![WO-1046 submitted: invoice CA-88342 for $600 with 2 photos](/docs/walkthrough/31-wo-1046-submitted-invoice-ca-88342.png#2880x1800)

5. **Payouts and 1099.** After both approvals, *Payments and 1099* shows $6,095 paid this year and *1099-NEC: Will be issued* (the IRS threshold is $600). It lists payouts for WO-1046 ($600), WO-1041 ($635) and the earlier WO-1019 ($1,240). The inbox has one approval email per payout.

![Vendor payments: $6,095 paid this year, 1099-NEC will be issued, payout list, inbox with two approval emails](/docs/walkthrough/32-vendor-payments-6095-paid-this-year.png#2880x1800)

6. **Payouts clear.** In a separate run, only WO-1041 was approved (*§4.11–4.12*). *Payments and 1099* lists 2026-10-28 · WO-1041 · $635 · **Cleared**, above the September payout of $1,240. Paid this year is $5,495, and the 1099-NEC “Will be issued”.

![Vendor payouts: WO-1041 $635 Cleared, paid this year $5,495](/docs/walkthrough/33-vendor-payouts-wo-1041-635-cleared.png#2880x1800)

7. **Rating and feedback on the profile.** *Profile* shows CoolAir HVAC at 5.0 (3), with each comment and job: “AC works perfectly again, thank you!” (Jasmine Brooks, WO-1041), “On time, tidy work, invoice matched the PO.” (Maya Patel, WO-1041), and “On time, invoice matched the PO.” (Maya Patel, WO-1019).

![Vendor profile with a 5.0 rating from 3 reviews and the feedback list](/docs/walkthrough/34-vendor-profile-with-a-50-rating.png#2240x774)

## 6. Tenant (Jasmine Brooks, Riverside Lofts #204)

The tenant sees only her own tenancy, what she owes, and the messages from the manager and the agent.

1. **Home and inbox.** Her next payment is $1,850, due 2026-11-01. Her lease runs 2025-12-13 to 2026-12-12 (*Renewal due*). The inbox shows the renewal offer the manager sent by SMS from the dashboard (“renew for 12 months at $1,850/month? Reply YES”). Below it are the agent's earlier renewal nudge and rent reminder.

![Tenant home with inbox open: renewal offer by SMS and earlier reminders](/docs/walkthrough/35-tenant-home-with-inbox-open-renewal.png#2880x1800)

2. **Rent and invoices.** INV-2611-01 ($1,850, due 2026-11-01) has a *Pay by bank (ACH)* button. October's INV-2610-01 is paid. A note says no money moves in the demo.

![Tenant invoices: November due with Pay by bank (ACH), October paid](/docs/walkthrough/36-tenant-invoices-november-due-with-pay.png#2880x1800)

3. **Report an issue.** Submit “Bathroom extractor fan is not working”. The app creates WO-1056, assigns it to in-house maintenance and lists it as *Assigned*. WO-1041 for the same unit shows *Paid*.

![Tenant maintenance requests: WO-1056 assigned, WO-1041 paid](/docs/walkthrough/37-tenant-maintenance-requests-wo-1056-assigned.png#2880x1800)

4. **Pay rent — the payment starts processing.** On *Rent and invoices*, click *Pay by bank (ACH)* on INV-2611-01 ($1,850). The invoice changes to **Processing** (“Clearing…”), and a **Pending** line appears under *Your payments*. The money goes into the manager's trust account. The demo simulates ACH, so it clears in seconds instead of 1–2 business days.

![Tenant invoice INV-2611-01 Processing; payment Pending](/docs/walkthrough/38-tenant-invoice-inv-2611-01-processing.png#2240x894)

5. **The payment clears.** Seconds later INV-2611-01 shows **Paid** and the payment shows **Cleared**. At the same moment, the app takes the 8% management fee from trust and sends the tenant a “Payment received” message.

![Tenant invoices both Paid; payments both Cleared](/docs/walkthrough/39-tenant-invoices-both-paid-payments-both.png#2240x894)

6. **Rate the manager and the building.** Go to *Home* → *How are we doing?* to see Jasmine's earlier ratings (Maya Patel 5 stars, “Replies the same day, every time.”). Rate Riverside Lofts 4 stars with “Quiet and clean; the gym hours could be longer.” This replaces her earlier building rating, and the app shows “✓ Saved”.

![How are we doing? ratings for Maya Patel and Riverside Lofts, ✓ Saved](/docs/walkthrough/40-how-are-we-doing-ratings-for.png#2240x562)

7. **Rate a finished job.** Once WO-1041 on her unit is Paid, *Maintenance requests* offers “Rate CoolAir HVAC for WO-1041”. Give 5 stars and “AC works perfectly again, thank you!”, and the app saves it.

![Rate CoolAir HVAC for WO-1041 with 5 stars, ✓ Saved](/docs/walkthrough/41-rate-coolair-hvac-for-wo-1041.png#2120x352)

## 7. Owner (Robert Chen)

The owner gets a read-only view of his two Austin properties only.

1. **Overview.** This page shows properties, units, occupancy, last payout and open work orders for Riverside Lofts and Oak Street Duplex only. Tabs show tenants and maintenance for those properties.

![Owner overview for Robert Chen's properties](/docs/walkthrough/42-owner-overview-for-robert-chens-properties.png#2880x1800)

2. **Payouts.** The September statement payout of $35,200 went out on 2026-10-06.

![Owner payouts: $35,200 Sep statement, sent](/docs/walkthrough/43-owner-payouts-35200-sep-statement-sent.png#2880x1800)

3. **Open statement and payout history.** After the manager pays Robert (*§4.13*), *Payouts* shows the open statement back at $0 (rent collected, 8% management fee, vendor bills, owed to you). The new payout sits above the 2026-10-06 $35,200 payout: 2026-10-28 · $5,851 · Statement 2026-10-28 · **Cleared**.

![Owner payouts: open statement at $0; $5,851 payout Cleared](/docs/walkthrough/44-owner-payouts-open-statement-at-0.png#2240x744)

4. **Tenant ratings per property.** The property table on the overview shows Riverside Lofts at 4.0 (2). Oak Street Duplex has no ratings yet.

![Owner properties with a Tenant rating column](/docs/walkthrough/45-owner-properties-with-a-tenant-rating.png#2240x462)

## 8. Maintenance (Luis Romero)

In-house staff see their assigned jobs with time estimates. They record progress with photos.

1. **My jobs.** The tenant's new request WO-1056 (from *§6.3*) arrives as *Assigned*. It sits next to the hallway light fixtures (WO-1044) and the bathroom drain (WO-1045).

![Maintenance jobs list](/docs/walkthrough/46-maintenance-jobs-list.png#2880x1800)

2. **Start a job and add a photo.** Click *Start job* on WO-1044 to move it to *In progress*. Click *Add photo* to record “Both new LED fixtures installed and lit”; the app then offers *Mark complete*. The manager's activity feed logs each step.

![WO-1044 in progress with a photo note and Mark complete](/docs/walkthrough/47-wo-1044-in-progress-with-a.png#2880x1806)

3. **Your rating.** The top of *My jobs* shows Luis's average: 4.5 from 2 ratings. The comments are “Fixed the leak the same afternoon.” (Marcus Lee, WO-1033, 5 stars) and “Friendly and tidy.” (Tom Becker, WO-1036, 4 stars).

![Maintenance Your rating card: 4.5 shown as four and a half stars from 2 ratings](/docs/walkthrough/48-maintenance-your-rating-card-45-shown.png#2240x380)

## 9. Admin (Sam Okafor) and the demo switcher

1. **System.** This page shows the active AI provider: Workers AI makes live model calls and falls back to mock results on any error. It also shows that the 15-minute sweep is planned (not running in the demo) and that messaging and payments are simulated. *Reset demo data* restores the starting data for your copy. The page notes: “Your demo data is private to you and resets at midnight Pacific Time.”

![Admin system health (Workers AI, sweep Planned, messaging and payments Simulated) above the Demo data card with its Reset demo data button](/docs/walkthrough/49-admin-system-health-workers-ai-sweep.png#2240x1037)

2. **Audit log.** The log lists every action by a person or the agent, newest first, with the time, actor and details.

![Admin audit log](/docs/walkthrough/50-admin-audit-log.png#2880x1800)

3. **Demo switcher.** The dark *Demo · Viewing as …* control at the bottom of every app screen switches personas. It sits outside the product's own menus because a real user would never switch roles.

![Demo switcher open over the PM dashboard, listing six personas](/docs/walkthrough/51-demo-switcher-open-over-the-pm.png#2880x1800)

## 10. Known limits of the demo

- **Per-visitor demo data.** The portfolio, ledger, ratings and imports are stored on the server, in Cloudflare D1. Each visitor gets a private copy, kept by a cookie. It is wiped at midnight Pacific time, and the next visit starts fresh.
- **Simulated money.** The trust-account ledger is a simulation. No money moves, the bank link is fake, and ACH clears in about eight seconds instead of 1–2 business days.
- **Simulated messaging.** The app sends nothing. SMS, WhatsApp, email, voice messages and invites land in each persona's in-app inbox or are only logged.
- **Demo-only sign-in.** Sign-in, sign-up and password reset are screens only. No accounts exist, and the app sends nothing.
- **CSV/TSV import only.** Files can be up to 2 MB, with one row per tenancy. Save Excel files as CSV first. The app marks a property as commercial if its name sounds like retail, office or a plaza, or if its units are named “Suite”; all others are multifamily. Owners with no name become “Owner to invite”. The app flags rows already in the portfolio instead of importing them twice.
- **Photos are text.** The app records job photos as captions. The vision model reads only invoice documents.
- **Live AI varies.** A live model produces the decisions, confidence and wording, so they can change between runs. Three things guard money decisions: the rule-based policy check, the app's own figures in assistant answers, and human approval.
- **Approximate rate limit.** AI routes allow about 20 requests a minute per IP address. Cloudflare's limiter is approximate. In a live test, it started refusing requests at about 40 a minute.
