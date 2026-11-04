// Product help articles (help_articles rows). Used by the tour and the assistant's help mode.
export type HelpArticle = { id: string; title: string; body: string; tags: string[]; entity_type: string | null; route: string | null };
export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "getting-started-checklist",
    title: "Complete the setup checklist",
    body: `New organizations finish setup through a short checklist before the portfolio goes live.

1. Open **Settings → Organization** and confirm the company name, time zone and management-fee rate.
2. Add your first **bank account** under Settings → Banking so rent and bills have somewhere to post.
3. Import or add **properties** (see "Import a portfolio with the AI wizard" if you have a spreadsheet).
4. **Invite users** and assign roles under Settings → Users, scoped to the regions or properties they manage.
5. Review **approval policies** under Settings → Policies so bill and work-order limits match your org.
6. Mark the checklist complete from the sidebar progress card; it stays available from the Help menu if you need to revisit a step.

Good to know: the checklist tracks progress per organization, not per user, so any admin can pick up where a teammate left off. You can reorder steps, but properties must exist before you invite leasing or maintenance staff, since their scope is assigned to specific properties. Nothing is locked once setup is "complete" — every setting here can be changed later from the same pages.`,
    tags: ["setup", "onboarding", "checklist"],
    entity_type: null,
    route: "/app/settings/users",
  },
  {
    id: "import-portfolio-ai-wizard",
    title: "Import a portfolio with the AI wizard",
    body: `The import wizard reads a pasted spreadsheet or CSV of properties and units and maps it to Propniti's fields automatically.

1. From **Settings → Import** (or the setup checklist), choose **Import portfolio**.
2. Paste your data or upload a file. The AI wizard detects columns such as address, unit count, rent and lease dates, even when headers are swapped or renamed.
3. Review the **mapping preview**: each source column is shown next to the field Propniti will fill. Fix any mapping the AI guessed wrong.
4. Check the **issues panel** for rows it flagged, for example a missing unit type or a rent value that looks like a typo.
5. Choose **Import** to create the properties, units and leases, or **Save as draft** to finish later.

Good to know: the wizard never silently drops a row. Rows with unresolved problems are imported with a flag and a matching entry on the **Data Health** page, so you can fix them there with the same before/after review used for other data fixes. Re-running an import with the same source file updates existing records instead of duplicating them, matched by address and unit number.`,
    tags: ["import", "onboarding", "ai wizard"],
    entity_type: "properties",
    route: "/app/properties",
  },
  {
    id: "invite-users-roles-scope",
    title: "Invite a user and set their role and scope",
    body: `Every user gets a role, which decides what they can see, and a scope, which decides which properties they can see it for.

1. Open **Settings → Users** and choose **Invite a user**.
2. Enter their name and email, then pick a **role** such as Property Manager, Leasing Agent or Accountant. The role sets default module access (read, write or approve) shown in Settings → Roles.
3. Set their **scope**: all properties, a region, or specific properties. A Leasing Agent scoped to three Austin properties never sees Dallas data, even through search or the assistant.
4. Send the invite. New users sign in and land on the home page their role defines, for example Leasing lands on Prospects, Accounting lands on Bills.
5. To change access later, edit the user and adjust role or scope; changes apply the next time they load a page.

Good to know: scope is enforced on the server for every request, not just hidden in the menu, so a narrower scope can't be bypassed by guessing a URL. Roles with "approve" access (Principal, Regional Manager, Broker, Accountant, Maintenance Supervisor) can also act on proposals the AI agents raise, subject to the approval policy limits.`,
    tags: ["users", "roles", "permissions"],
    entity_type: "staff",
    route: "/app/settings/users",
  },
  {
    id: "switch-roles-demo",
    title: "Switch roles in the demo",
    body: `This environment lets you preview the product as any persona without signing out.

1. Open the **avatar menu** in the top right and choose **Switch role (demo)**.
2. Pick a persona, for example Marcus Bell (Property Manager, 3 Austin properties) or Grace Kim (Senior Accountant, all owner entities).
3. The app reloads showing that persona's home page, sidebar access and scope. A **"Viewing as … · Exit"** banner stays visible while you're switched.
4. Choose **Exit** in the banner, or pick another persona from the avatar menu, to switch again.

Good to know: switching roles here only changes which demo persona you're viewing as; it does not change real permissions in a live organization. Each persona has a fixed scope (for example, Priya Shah sees all 14 Texas properties, Lena Ortiz sees 3 Austin properties), so lists, dashboards and the assistant's answers will differ by persona even on identical data.`,
    tags: ["demo", "roles", "persona switching"],
    entity_type: null,
    route: "/app/settings/users",
  },
  {
    id: "record-a-payment",
    title: "Record a rent payment",
    body: `Use Record payment when a resident pays by check, cash or card outside the portal.

1. Open **Receivables → Payments** and choose **Record payment**.
2. Search for the resident or lease, then enter the amount, payment method and date received.
3. Propniti applies the payment to the oldest open charges first (rent, then fees), unless you choose **Apply manually** to pick specific charges.
4. Confirm. The payment posts to the trust account and the resident's ledger updates immediately.

Good to know: every payment write is idempotent — recording the same payment twice (for example from a double click) creates only one transfer, not two. Payments post to the property's trust account, not directly to the owner, and settle on the normal disbursement schedule. If a payment later bounces, use **Mark as NSF** on that payment rather than deleting it, so the ledger keeps an accurate history.`,
    tags: ["payments", "receivables", "rent"],
    entity_type: "payments",
    route: "/app/receivables/charges",
  },
  {
    id: "resident-pay-rent-portal",
    title: "Help a resident pay rent in the portal",
    body: `Residents pay rent themselves from the resident portal; this article is what to tell them or check on their behalf.

1. The resident signs in and opens **Pay rent** on their portal home.
2. They see their current balance, due date and any past-due charges listed separately.
3. They choose an amount (full balance, partial, or a specific charge) and a payment method, then confirm.
4. The payment appears on their ledger immediately and on your **Receivables → Payments** list within the same cycle.

Good to know: partial payments still apply oldest-charge-first, so a partial payment clears old rent before it touches a newer late fee. If a resident says a payment didn't go through, check **Receivables → Payments** for a failed or NSF status before assuming it's missing — the portal shows the same record staff see, so there's one source of truth. Residents on a payment plan see their scheduled installments here instead of the full balance.`,
    tags: ["portal", "resident", "rent payment"],
    entity_type: "payments",
    route: "/portal/resident",
  },
  {
    id: "post-late-fees",
    title: "Post late fees",
    body: `Post late fees after the grace period ends for charges that are still unpaid.

1. Open **Receivables → Charges** and filter to **Overdue**.
2. Select the overdue charges you want to assess a fee on.
3. Choose **Post late fees**. Propniti calculates each fee from the property's late-fee policy and shows the amount before you confirm.
4. Confirm to post the fees as new charges on each lease.

Good to know: fees are capped by state rules, enforced automatically so you can't post a fee that would exceed the cap. Texas caps late fees at 12% of monthly rent for properties with four units or fewer, and 10% for larger properties. Georgia has no statutory percentage cap, but the fee must be specified in the lease to be enforceable. Arizona requires the fee be stated in the lease and be a reasonable estimate of actual damages — a punitive flat fee can be challenged. All three states also require the lease's grace period to have fully elapsed before a fee is valid; Propniti blocks posting until that grace period, taken from the lease's late-fee policy, has passed.`,
    tags: ["late fees", "receivables", "state rules"],
    entity_type: "charges",
    route: "/app/receivables/charges",
  },
  {
    id: "set-up-payment-plans",
    title: "Set up a payment plan",
    body: `A payment plan splits a resident's past-due balance into scheduled installments instead of one lump sum.

1. Open the resident's **lease** and go to the **Ledger** tab, or start from **Receivables → Delinquency**.
2. Choose **Set up payment plan**.
3. Enter the balance to cover, the number of installments and the due date for each. Propniti shows the schedule before you save it.
4. Save the plan. The resident's portal now shows the scheduled installments instead of a single balance due.
5. As each installment comes due, it appears like a normal charge; record or reconcile payments against it the usual way.

Good to know: a missed installment doesn't automatically cancel the plan — it shows as overdue like any other charge, and the Collections agent flags it for follow-up. Payment plans don't waive late fees already posted unless you remove them separately. Check your state and lease terms before offering a plan on a balance that includes an eviction filing; some jurisdictions restrict payment arrangements once a case is filed.`,
    tags: ["payment plan", "delinquency", "receivables"],
    entity_type: "charges",
    route: "/app/receivables/delinquency",
  },
  {
    id: "handle-nsf-returned-payment",
    title: "Handle an NSF or returned payment",
    body: `Mark a payment NSF (non-sufficient funds) as soon as the bank reports the return, so the resident's balance and the trust account stay accurate.

1. Open **Receivables → Payments** and find the returned payment.
2. Choose **Mark as NSF**.
3. Propniti reverses the payment's effect on the resident's balance, so the original charges reopen as unpaid.
4. If your policy charges an NSF fee, post it the same way you post a late fee, from **Receivables → Charges**.
5. Notify the resident; a suggested message is available from the record's AI rail.

Good to know: marking a payment NSF never deletes the original payment record — it keeps the full history so you can show a resident exactly what happened. Because the reversal reopens the original charges, any late fee that had been waived when the payment first posted is not automatically reinstated; review the ledger before re-posting one. Check your lease and state limits on NSF fee amounts before posting.`,
    tags: ["nsf", "returned payment", "receivables"],
    entity_type: "payments",
    route: "/app/receivables/payments",
  },
  {
    id: "write-off-a-balance",
    title: "Write off a balance",
    body: `Write off a balance when a charge is uncollectable, for example after a move-out with no forwarding address or a resolved dispute.

1. Open the lease's **Ledger** tab and select the charge or charges to write off.
2. Choose **Write off balance**.
3. Enter a reason. This is required and appears in the audit log and on the owner statement.
4. Confirm. The charge is marked written off and no longer counts toward delinquency totals.

Good to know: a write-off is a financial decision, not a correction of a data error — if the charge itself is wrong (wrong amount, wrong lease), fix the charge instead of writing it off. Write-offs flow through to the owner's statement as a line item, so owners can see exactly what was forgiven and why. Because this moves money off the ledger, it is always a person's decision; no AI agent can write off a balance on its own, even at the highest autonomy level.`,
    tags: ["write-off", "delinquency", "ledger"],
    entity_type: "charges",
    route: "/app/receivables/delinquency",
  },
  {
    id: "approve-a-bill",
    title: "Approve a bill",
    body: `Bills route to an approver once they're coded to a GL account and property.

1. Open **Payables → Bills** and filter to **Pending approval**.
2. Open a bill to review the vendor, amount, GL coding and attached invoice image.
3. Check the **AI rail** for anomaly flags, for example a duplicate invoice number or an amount far above the vendor's typical bill.
4. Choose **Approve**, or **Reject** with a note if something needs correcting first.
5. Approved bills move to the payment queue on their scheduled run.

Good to know: bills above your approval policy's limit route to a higher role automatically — an Accountant's limit is set in Settings → Policies, and a bill over that limit shows as waiting on a Principal or Regional Manager instead. Every approval is written to the audit log with who approved it, when, and the bill's state at that moment, so a later dispute has a clear record.`,
    tags: ["bills", "payables", "approval"],
    entity_type: "bills",
    route: "/app/payables/bills",
  },
  {
    id: "scan-invoice-into-bill",
    title: "Scan an invoice into a bill",
    body: `The AI reads an uploaded invoice and drafts a bill; you check the coding before it posts.

1. From **Payables → Bills**, choose **Scan invoice**.
2. Upload the invoice image or PDF.
3. The AI extracts the vendor, invoice number, amount and line items, and suggests a GL account and property for each line based on past coding for that vendor.
4. Review the draft. Fix any line the AI coded wrong — it shows its confidence per field, and low-confidence fields are highlighted for a closer look.
5. Choose **Create bill** to save it as a pending-approval bill, following the normal approval flow.

Good to know: the AI never posts a bill on its own; a scanned invoice always lands as a draft a person reviews, because coding and amounts are financial decisions. If the model can't read the invoice confidently (for example, a blurry scan), it falls back to a blank draft and says so rather than guessing silently. The extraction is validated against a schema; anything it can't map safely is left for you to fill in by hand.`,
    tags: ["invoice", "ai", "payables"],
    entity_type: "bills",
    route: "/app/payables/bills",
  },
  {
    id: "vendor-bank-change-fraud-hold",
    title: "Handle a vendor bank-detail change",
    body: `A vendor changing their bank details is one of the most common fraud patterns in property management, so Propniti holds payments until the change is verified.

1. When a vendor updates their bank account (from their portal or a request to your team), the vendor record shows a **Bank details changed** flag and any pending payments to them are held automatically.
2. Open the vendor record and review the **Data Health** panel, which shows the old and new account details side by side.
3. Verify the change through a trusted channel — call the vendor at the number on file, not a number from the change request.
4. If legitimate, choose **Verify bank change** to release held payments. If not, choose **Reject change** and keep paying the prior account; report the attempt.

Good to know: the hold applies to every pending payment to that vendor, not just the one tied to the change, until someone verifies it. This is a money and fraud decision, so it always needs a person — no agent can clear the hold automatically, even one running at "auto within policy". Verified changes are logged with who verified them and how.`,
    tags: ["vendor", "fraud", "bank details"],
    entity_type: "vendors",
    route: "/app/payables/bills",
  },
  {
    id: "approve-pay-work-order",
    title: "Approve and pay a work order",
    body: `Work orders above an owner's pre-set spending limit need the owner's approval before a vendor is paid.

1. Open **Maintenance → Work orders** and find the completed job.
2. Review the vendor's invoice and photos attached to the work order.
3. If the cost is within the owner's approval limit (set per owner entity in Settings → Policies), choose **Approve and pay** directly.
4. If it's over the limit, choose **Send for owner approval**; the owner sees it in their portal's Approvals tab and approves or declines there.
5. Once approved, choose **Pay vendor** to release payment from the trust account.

Good to know: the owner approval limit is set per owner entity, not globally, so two owners in the same property can have different thresholds. A work order that starts under the limit but grows after additional repairs are found is re-checked against the limit before payment, not just at creation. Emergency repairs (life, safety or active property damage) can bypass the owner-approval step, but still require a person's approval before payment.`,
    tags: ["work order", "maintenance", "approval"],
    entity_type: "work_orders",
    route: "/app/maintenance/work-orders",
  },
  {
    id: "maintenance-triage-agent",
    title: "Use the maintenance triage agent",
    body: `The Maintenance Triage agent reads a new work order and suggests trade, urgency, likely cost and a ranked vendor list.

1. When a work order is created (by staff, a resident request, or the public portal), the agent runs automatically and posts a proposal to the work order's AI rail.
2. Open the work order to see its suggested **trade** (plumbing, electrical, HVAC, etc.), **urgency**, an **estimated cost range**, and **ranked vendors** based on past performance, response time and whether the job is within the owner's approval limit.
3. Accept the suggested vendor and urgency, or adjust them yourself — the agent's suggestion is a starting point, not a requirement.
4. Assigning the work order notifies the vendor through their portal.

Good to know: the agent proposes; it does not assign a vendor or move money on its own unless your automation policy explicitly allows "act with approval" or "auto within policy" for routine, low-cost jobs. Every suggestion shows its reasoning and confidence, and every run is logged with a full step trace, visible from the work order's Activity tab or the agents command center.`,
    tags: ["maintenance", "ai agent", "triage"],
    entity_type: "work_orders",
    route: "/app/maintenance/work-orders",
  },
  {
    id: "preventive-maintenance-schedules",
    title: "Set up preventive maintenance schedules",
    body: `Preventive schedules create work orders automatically on a recurring basis, for example HVAC filter changes or fire-extinguisher inspections.

1. Open **Maintenance → Preventive** and choose **New schedule**.
2. Pick the property or unit, the task, and the recurrence (monthly, quarterly, annually, or a custom interval).
3. Assign a default vendor or leave it unassigned so Maintenance Triage suggests one when each work order is created.
4. Save. Propniti generates the first work order on the schedule's start date and the next one automatically after each completion.

Good to know: a preventive work order follows the same approval rules as any other — if its vendor's invoice exceeds the owner's limit, it still routes for approval. Schedules due this week show on the Maintenance Supervisor's home queue so nothing recurring gets missed. Pausing a schedule stops future work orders but doesn't cancel one already created.`,
    tags: ["preventive maintenance", "schedules", "maintenance"],
    entity_type: "pm_schedules",
    route: "/app/maintenance/preventive",
  },
  {
    id: "make-ready-turnovers",
    title: "Run a make-ready turnover",
    body: `A turnover tracks everything that has to happen between a move-out and the unit being rent-ready.

1. Open **Maintenance → Turnovers**; a new turnover is created automatically when a move-out is recorded.
2. The board shows each unit's stage: inspection, cleaning, repairs, make-ready, and listed.
3. Assign tasks to vendors or staff from the turnover's **Tasks** tab; each task shows who it's assigned to and its due date.
4. As tasks complete, move the turnover to the next stage. Marking it **Rent-ready** updates the unit's status, which makes it eligible for new showings and listing.

Good to know: a turnover won't show as rent-ready while open work orders or inspection items are still unresolved — the status reflects the real state of the unit, not a manual override. The turnover's total cost and days-vacant are shown on the make-ready board and roll up into the vacancy-loss chart on the leasing dashboard.`,
    tags: ["turnover", "make-ready", "maintenance"],
    entity_type: "turnovers",
    route: "/app/maintenance/turnovers",
  },
  {
    id: "run-an-inspection",
    title: "Run an inspection",
    body: `Inspections use a checklist and photos to document a unit's condition at move-in, move-out, or on a routine schedule.

1. Open **Maintenance → Inspections** and choose **New inspection**.
2. Pick the unit and inspection type (move-in, move-out, routine, or turnover).
3. Work through the checklist, marking each item's condition and attaching photos where needed.
4. Complete the inspection. Move-in and move-out inspections attach to the lease record and are referenced automatically when calculating a deposit disposition.

Good to know: move-out inspection findings feed directly into the deposit disposition, so completing the inspection before starting the disposition saves re-entering damage items. Photos attached to an inspection go through the AI photo check, which flags low-confidence or missing shots so you catch gaps before the resident disputes a charge.`,
    tags: ["inspection", "checklist", "maintenance"],
    entity_type: "inspections",
    route: "/app/maintenance/work-orders",
  },
  {
    id: "vendor-insurance-certificates",
    title: "Track vendor insurance certificates (COIs)",
    body: `A certificate of insurance (COI) proves a vendor carries active coverage; Propniti tracks expiry so you're not caught with a lapsed vendor on a job.

1. Open the vendor record and go to the **Insurance** tab.
2. Upload the current COI; Propniti reads the expiration date and coverage type from the document.
3. Vendors with a COI expiring within 30 days show a warning badge on their record and on any work order assigned to them.
4. Once a lapsed vendor renews, upload the new certificate to clear the flag.

Good to know: you can set your organization's policy to block assigning new work orders to a vendor whose COI has expired, under Settings → Policies. The Compliance agent surfaces expiring COIs ahead of time on the maintenance supervisor's home queue, so renewal requests go out before the gap, not after.`,
    tags: ["vendor", "insurance", "compliance"],
    entity_type: "vendor_cois",
    route: "/app/maintenance/work-orders",
  },
  {
    id: "list-unit-syndication",
    title: "List a unit and syndicate it",
    body: `A listing publishes a vacant or soon-to-be-vacant unit to the public listings site and to syndicated feeds.

1. Open the vacant **unit** and choose **Create listing**.
2. Set the asking rent, available date, photos and description; the AI can draft a description from the unit's features, which you can edit before publishing.
3. Choose which feeds to syndicate to, if your organization has syndication configured.
4. Publish. The listing appears at **/listings** immediately and on syndicated feeds on their normal refresh schedule.

Good to know: price changes and status changes (available, pending, leased) are tracked in the listing's price history, visible on the listing record, which the Leasing dashboard uses for days-on-market reporting. Pulling a listing down (for example, after an application is approved) also removes it from syndicated feeds on their next refresh; it doesn't happen instantly everywhere.`,
    tags: ["listing", "syndication", "leasing"],
    entity_type: "listings",
    route: "/app/leasing/prospects",
  },
  {
    id: "schedule-a-tour",
    title: "Schedule a showing",
    body: `Schedule a showing to walk a prospect through an available unit, whether they came from the public listings site or a direct inquiry.

1. Open the prospect record under **Leasing → Prospects**, or start from the listing itself.
2. Choose **Schedule showing** and pick the unit, date and time, and whether it's self-guided or agent-led.
3. The prospect receives a confirmation; a reminder goes out automatically before the showing.
4. After the showing, log the outcome (interested, applied, passed) on the prospect record — this feeds the leasing funnel chart.

Good to know: showings scheduled for a unit that goes under application are not cancelled automatically; cancel or reschedule them yourself so prospects aren't shown a unit that's no longer available. The assistant's "Today's tours" quick action (shown to leasing agents) lists every showing scheduled for the current day across their scoped properties.`,
    tags: ["showing", "tour", "leasing"],
    entity_type: "showings",
    route: "/app/leasing/showings",
  },
  {
    id: "screening-applicant-scores",
    title: "Understand screening and applicant scores",
    body: `Screening returns a pass/fail-style outcome from the screening provider; the applicant score is Propniti's own ranking to help a broker decide faster — the broker always makes the final call.

1. Open **Leasing → Applications** and select an application with screening complete.
2. The **Screening** tab shows the provider's summary outcome. Full credit and background detail stays with the screening provider, not duplicated in Propniti.
3. The **applicant score** on the application combines only income (relative to the rent), rental history, and the screening outcome.
4. A broker reviews the application and score, then chooses **Approve**, **Decline**, or **Approve with conditions** (for example, a higher deposit or a co-signer).

Good to know: the score is built only from income, rental history and screening outcome by design — it deliberately excludes any protected-class characteristic, consistent with fair-housing law, and the AI never decides an application on its own. The score is a decision aid, not a decision; every approval or decline is a broker's action and is audited as such. Applicants can see their application status, but not their internal score, from the applicant portal.`,
    tags: ["screening", "applicant score", "fair housing"],
    entity_type: "applications",
    route: "/app/leasing/applications",
  },
  {
    id: "renewal-offers",
    title: "Send a renewal offer",
    body: `Renewal offers go out ahead of lease expiration with a proposed rent and term.

1. Open **Leases** and filter to **Expiring in 60 days**, or open the Renewals agent's proposals on the relevant lease.
2. The Renewals agent suggests a rent based on market comparables and the resident's payment history; review and adjust it if needed.
3. Choose **Send renewal offer**, pick the term length, and confirm. The resident sees the offer in their portal.
4. Track the offer's status (sent, accepted, countered, declined) on the lease record; accepting generates the renewal lease automatically.

Good to know: a renewal offer's history is kept on the lease, so you can see every prior offer and its outcome, not just the current one. If a resident counters, that becomes a new offer version rather than overwriting the original, so the audit trail stays intact. Offers sent but not accepted before the lease's expiration show on the regional manager's dashboard as at-risk renewals.`,
    tags: ["renewal", "leases", "leasing"],
    entity_type: "renewal_offers",
    route: "/app/leases",
  },
  {
    id: "approve-concessions",
    title: "Approve a leasing concession",
    body: `A concession (a free week, reduced deposit, or similar incentive) needs approval before it's offered to a prospect or applied to a lease.

1. Open **Leasing → Concessions** and filter to **Proposed**.
2. Review the concession's type, value and the unit or lease it applies to, along with the leasing agent's reason.
3. Choose **Approve** or **Decline**. Approval authority for concessions follows the approval policy, typically a Regional Manager or Broker.
4. Approved concessions apply automatically to the lease's charges or the application's terms.

Good to know: concessions are tracked separately from base rent on the lease, so reporting (NOI, effective rent) reflects the real economics, not just the sticker rent. A concession approved for one unit doesn't carry over automatically to a renewal — review and re-approve it at renewal time if it should continue.`,
    tags: ["concessions", "leasing", "approval"],
    entity_type: "concessions",
    route: "/app/leasing/concessions",
  },
  {
    id: "move-out-deposit-disposition",
    title: "Process a move-out and deposit disposition",
    body: `A deposit disposition itemizes what's returned to the resident and what's withheld for damage or unpaid charges, within the state's required deadline.

1. Record the **move-out** on the lease, including the move-out date and a move-out inspection.
2. Open the lease's **Deposit** tab and choose **Start disposition**.
3. Review any unpaid charges and inspection-flagged damage; itemize each deduction with an amount and description. The AI rail can suggest line items from the move-out inspection's findings.
4. Finalize the disposition. Propniti calculates the refund amount and generates the itemized statement to send the resident.

Good to know: the return deadline is set by state and enforced as a due-by date on the disposition: Texas and Georgia both require the deposit (or an itemized list of deductions) within 30 days of move-out; Arizona requires it within 14 business days. Missing the deadline can forfeit your right to withhold deductions in some states, so the disposition shows a countdown and flags itself if it's at risk of running late. Every deduction needs a reason on file — a disposition with unexplained withholdings is a common resident dispute.`,
    tags: ["move-out", "security deposit", "disposition"],
    entity_type: "deposits",
    route: "/app/residents",
  },
  {
    id: "bank-reconciliation-ai-matches",
    title: "Reconcile a bank account with AI-suggested matches",
    body: `Bank reconciliation matches your bank's transaction feed against Propniti's ledger, with the AI suggesting likely matches for anything not already linked.

1. Open **Banking → Reconciliations** and select the account and statement period.
2. Propniti auto-matches transactions that line up exactly with recorded payments, bills or transfers.
3. For unmatched transactions, the AI rail suggests likely matches (for example, a deposit that's slightly off from a recorded payment due to a processor fee), ranked by confidence.
4. Accept a suggested match, or **Mark as unexplained** if nothing fits — unexplained items show up on the Data Health page until resolved.
5. Once every transaction is matched or explained, choose **Close period** to finalize the reconciliation.

Good to know: an AI-suggested match is never applied automatically — accepting it is a person's action, because it affects the trust ledger. A closed period is locked from further edits; if you find an error afterward, it's corrected with a new adjusting entry, not by reopening the closed period.`,
    tags: ["bank reconciliation", "ai", "banking"],
    entity_type: "bank_reconciliations",
    route: "/app/banking/reconciliations",
  },
  {
    id: "owner-statements-distributions",
    title: "Close the period and send owner statements",
    body: `Owner statements summarize income, expenses, the management fee and the net distribution for a period, and must be closed before money goes out.

1. Open **Owner statements** and select the owner entity and period.
2. Review the statement draft: rent collected, bills paid, the management fee, and any owner-approved work-order costs.
3. The management fee is calculated automatically at your organization's rate (8% of collected rent by default) — click the fee line to see the calculation behind it.
4. Choose **Close period** to lock the statement, then **Create distribution** to schedule the owner's payout from the available trust balance.
5. The owner sees the finalized statement and distribution in their portal.

Good to know: closing a period locks its charges and bills from further edits for that owner entity — corrections after closing go through a new adjusting entry in the following period, not a reopened statement. A distribution only draws from what's actually available in trust; if bills are still pending payment, the distribution amount reflects that, it doesn't go negative. Every statement line links back to its underlying transactions, so an owner (or you) can click any number to see what produced it.`,
    tags: ["owner statement", "distribution", "management fee"],
    entity_type: "owner_distributions",
    route: "/app/owner-statements",
  },
  {
    id: "budgets-vs-actuals",
    title: "Compare budgets to actuals",
    body: `Budgets are set per property, per GL account and month, and compared automatically against actual activity as it posts.

1. Open **Reports → Budgets** (or a property's Financials tab) and select the property and year.
2. Enter or import the budgeted amount for each GL account and month.
3. As bills, charges and journal entries post through the year, the **actual** column fills in automatically next to each budget line.
4. Variance (actual vs. budget, in dollars and percent) is shown per line and rolls up to NOI; large variances are flagged for review.

Good to know: budgets are a planning tool, not a spending limit — posting a bill that exceeds its budget line doesn't block the bill, it shows as a variance for the accountant or owner to understand. The AI variance explanation on a flagged line pulls from the same computed facts as the report, so its explanation always matches the numbers shown, not a separate estimate.`,
    tags: ["budget", "actuals", "variance"],
    entity_type: "budgets",
    route: "/app/reports",
  },
  {
    id: "data-health-fix-issues",
    title: "Use Data Health to find and fix issues",
    body: `Data Health finds records with a detectable problem — a swapped column from an import, an inconsistent lease date, an unverified vendor bank change — and tracks the fix.

1. Open **Data Health** to see a score per property and module, with the open issues behind each score.
2. Filter issues by module, severity or rule, and open one to see the affected record and the specific problem.
3. Where the AI can propose a fix, you'll see a **before/after** comparison with its confidence and reasoning.
4. Choose **Apply fix** for a safe fix (for example, normalizing an address), or review it manually for anything involving money or legal exposure, such as a rent amount or a lease term.
5. Every fix, applied by a person or by policy, is logged to the fix history and the audit log.

Good to know: money and legal fixes always need a person — the AI can suggest a corrected rent amount or lease date, but it cannot apply either one on its own, no matter the autonomy setting. Safe, non-financial fixes (formatting, duplicate contact info, normalizing an address) can be applied in bulk once you've spot-checked a few. A record's Data Health badge is visible right on its detail page, not just on the central Data Health list, so problems surface where you're already working.`,
    tags: ["data health", "ai fix", "data quality"],
    entity_type: "data_issues",
    route: "/app/data-health",
  },
  {
    id: "ai-agents-command-center",
    title: "Use the AI agents command center",
    body: `The agents command center is where you see what every AI agent has done, is doing, and is allowed to do.

1. Open **/app/agents** to see a card per agent (Collections, Leasing, Renewals, Maintenance Triage, Payables, Data Health, Owner Reporting, Compliance) with its status, last and next run, success rate, and counts of proposed, approved and auto-applied actions.
2. Each agent has an **autonomy level**: **Suggest** (proposes only), **Act with approval** (proposes, executes once approved), or **Auto within policy** (executes directly for actions inside the approval policy's limits).
3. Choose **Run now** on an agent to trigger it immediately and stream its live step trace.
4. Open any past run to inspect its full trace: each tool call, input, output, and the model used.

Good to know: raising an agent's autonomy never removes the underlying guardrails — a Collections agent set to "auto within policy" still can't write off a balance or move money outside its policy's limits; those stay a person's decision. Every run, regardless of autonomy level, is logged with a full step trace, so "what did the AI actually do" always has a concrete answer, not just a summary.`,
    tags: ["ai agents", "automation", "autonomy"],
    entity_type: "ai_proposals",
    route: "/app/agents",
  },
  {
    id: "approvals-inbox-audit-log",
    title: "Use the approvals inbox and audit log",
    body: `The approvals inbox collects everything waiting on a person — bills, work orders, concessions, AI proposals — in one place; the audit log shows what already happened.

1. Open **/app/ai/approvals** to see items needing your decision, grouped by type and sorted by how long they've waited.
2. Open an item to see its full context (the record, the reason it needs approval, and any AI reasoning behind it) without leaving the inbox.
3. Approve, decline, or send it back for changes directly from the item.
4. Open **/app/ai/activity** (the Audit tab) to see a complete history of approvals, AI actions, and manual changes, each with who or what did it and when.

Good to know: an item only reaches the approvals inbox when a policy or role requires a person's sign-off — items an agent is allowed to auto-apply never appear here, by design, so the inbox stays focused on real decisions. The audit log is append-only; nothing in it can be edited or deleted, including by an administrator, which is what makes it usable as a record for owners or auditors.`,
    tags: ["approvals", "audit log", "ai"],
    entity_type: "ai_proposals",
    route: "/app/ai/approvals",
  },
  {
    id: "approval-policies-limits",
    title: "Set approval policies and limits",
    body: `Approval policies set the dollar limits and role requirements that decide when a bill, work order, or AI action needs a person's sign-off.

1. Open **Settings → Policies**.
2. For bills and work orders, set the dollar limit each role can approve without escalation, and separately, the limit an owner entity allows before an owner must approve.
3. For AI agents, set the autonomy level per agent and, for "auto within policy", the dollar and scope limits within which it may act without a person.
4. Save. Changes apply to new bills, work orders and agent runs going forward; anything already in the approval queue keeps the rule it was created under.

Good to know: policy changes are tracked with history — Settings → Policies shows who changed a limit and when, since a mis-set limit has real financial consequences. A property-level limit, when set, overrides the organization default for that property only; leaving it blank falls back to the org default.`,
    tags: ["approval policy", "limits", "settings"],
    entity_type: "approval_policies",
    route: "/app/settings/policies",
  },
  {
    id: "automations-trigger-condition-action",
    title: "See what runs automatically",
    body: `**Automations** lists everything that runs without someone pressing a button: the eight agents, the 15-minute sweep that starts them, the events that trigger them, and the approval rules they follow.

1. Open **Automations** from the Intelligence menu.
2. Read each agent's **trigger**: its schedule (for example "Daily at 14:00") and the events it listens for (for example "Rent overdue").
3. Check **Autonomy**. *Approve first* sends every action to the approvals inbox. *Auto within policy* lets low-risk actions under the approval-policy limits apply on their own.
4. Open an agent's name to see its runs, and the last-run time to open that run's trace.
5. Under **Approval rules**, see how much each kind of decision may apply alone and who approves above that.

Good to know: legal and safety actions, and anything high risk, always wait for a person. Agents check the approval policies before anything applies, and approving is refused if the record changed after the agent looked at it.`,
    tags: ["automation", "agents", "schedule", "approval"],
    entity_type: null,
    route: "/app/automations",
  },
  {
    id: "assistant-chat-actions-help",
    title: "Use the assistant (⌘J)",
    body: `The assistant panel opens with **⌘J** and works in three modes: chat, actions, and help.

1. Open the assistant with **⌘J** from anywhere in the app.
2. **Chat**: ask a question about your data, such as "who is late on rent in Austin?" The assistant turns your question into a query against your scoped data and answers with the actual figures, showing what it looked up.
3. **Actions**: describe something to do, such as "send reminders to residents 90+ days delinquent in Austin." The assistant proposes a specific list of actions; review and approve before anything executes.
4. **Help**: ask "how do I post a late fee?" and the assistant answers from the help articles, with a deep link to the right page and a **"Show me"** button that starts the matching tour step.

Good to know: the assistant only ever sees and acts within your current role's scope — a Leasing Agent asking about Dallas delinquency gets no data back, because their scope doesn't include it. Any text you paste into the assistant (an email, a question, a pasted record) is treated as data to reason about, never as an instruction to the assistant itself, so it can't be redirected by text you give it.`,
    tags: ["assistant", "copilot", "chat"],
    entity_type: null,
    route: "/app/copilot",
  },
  {
    id: "keyboard-shortcuts",
    title: "Use keyboard shortcuts and the command palette",
    body: `Keyboard shortcuts speed up navigation without reaching for the mouse.

1. Press **⌘K** (or Ctrl+K) anywhere in the app to open the command palette; type to jump to any page, record, or action you have permission for.
2. Press **?** to open the full shortcuts list for your current page.
3. Use **g** then a letter for quick navigation, for example **g p** jumps to Properties, **g w** jumps to Work orders.
4. Press **⌘J** to open the assistant from any page.

Good to know: the command palette only shows pages and actions your role and scope allow, so it never becomes a way to discover something you couldn't otherwise reach. Shortcuts are the same across light and dark mode and don't change based on persona, only the results they return do.`,
    tags: ["shortcuts", "command palette", "navigation"],
    entity_type: null,
    route: "/app",
  },
  {
    id: "saved-views-export-csv",
    title: "Save a view and export to CSV",
    body: `A saved view remembers a list's filters, sort and visible columns so you don't rebuild it every time.

1. On any list page, set the filters, sort order and columns you want.
2. Choose **Save view**, give it a name, and choose whether it's visible only to you or to your whole team (where that's allowed).
3. Switch between saved views from the view dropdown at the top of the list.
4. Choose **Export CSV** at any point to download exactly what's currently shown — the same filters and columns, not the full unfiltered table.

Good to know: exports respect your role's scope the same way the screen does, so a CSV export can never contain rows outside what you'd otherwise see. Saved views are stored per list, so a view saved on Work orders doesn't appear on Bills, even if the filters would make sense there too.`,
    tags: ["saved views", "csv export", "lists"],
    entity_type: null,
    route: "/app/properties",
  },
  {
    id: "notifications-center",
    title: "Manage notifications",
    body: `The notifications center collects alerts relevant to your role — approvals waiting, SLA breaches, expiring documents — in one place.

1. Open the **bell icon** in the top bar to see recent notifications.
2. Choose a notification to jump directly to the record it's about.
3. Mark individual notifications read, or **Mark all as read** to clear the badge.
4. Adjust which notification types you receive from **Settings → Notifications** (for example, muting routine task reminders while keeping approval alerts).

Good to know: notifications are generated from the same events the AI agents and automations watch, so what you see here lines up with what's driving agent activity — nothing shows up in notifications that isn't traceable to a real record or run. Muting a notification type stops new alerts of that type but doesn't dismiss ones already sitting in your list.`,
    tags: ["notifications", "alerts", "settings"],
    entity_type: null,
    route: "/app/inbox",
  },
];
