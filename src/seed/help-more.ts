import type { HelpArticle } from "./help";

// More product help articles requested by the module lanes (help_articles rows).
export const MORE_HELP_ARTICLES: HelpArticle[] = [
  {
    id: "properties",
    title: "Properties: what each column means",
    body: `Properties list shows live occupancy, financial and compliance signals, drawn from the record's current data.

1. Open **Portfolio → Properties** to see every property with its **Occupancy**, **NOI**, **Delinquency**, **Open WOs** and **Data issues** columns.
2. **Occupancy** is physical occupancy, calculated live from unit status (occupied + notice ÷ rentable units), not a stored snapshot.
3. **NOI** shows the latest closed month: collected income minus operating expenses, the same figure the owner statement uses.
4. **Delinquency** totals open balances past the grace period; click it to open **Receivables → Charges** filtered to that property.
5. Open a property record to see its tabs: **Overview** (photos), **Unit stack**, **Floor plans**, **Financials** (T12) and **Compliance**.

Good to know: NOI and delinquency are both computed from the same underlying ledger the Financials tab shows, so a number here never disagrees with its detail page. Data issues shown on the list roll up every open issue on that property's records, not just the property row itself, so a clean-looking property can still carry a flag from one of its units or leases.`,
    tags: ["properties", "occupancy", "noi", "portfolio"],
    entity_type: "properties",
    route: "/app/properties",
  },
  {
    id: "units",
    title: "Units, unit status and the unit stack",
    body: `The unit stack shows every unit's status, rent and lease expiry so you can see a property's inventory at a glance.

1. Open **Portfolio → Units** or a property's **Unit stack** tab.
2. Each unit shows a status: **Occupied**, **Notice**, **Vacant**, **Make-ready**, **Down** or **Model**, colour-coded so the stack reads like a floor map.
3. **Current rent** and **market rent** sit side by side; a gap between them is loss to lease.
4. **Lease expiry** shows when the current lease ends, so upcoming vacancies are visible before they happen.
5. Open a unit to see its photos, lease history, past turnovers, and the market-vs-current rent trend.

Good to know: **Down** means the unit can't be shown or leased (major repair, casualty), which is different from **Vacant** (ready to show) or **Make-ready** (mid-turnover). Only Vacant, Notice and Make-ready units get an auto-generated listing; a Down unit never appears on the public site. Rent figures are stored in cents internally but always shown as dollars.`,
    tags: ["units", "unit stack", "status", "leasing"],
    entity_type: "units",
    route: "/app/units",
  },
  {
    id: "occupancy",
    title: "Physical vs economic occupancy",
    body: `Physical occupancy counts occupied units; economic occupancy counts the rent you're actually collecting on them — they move independently.

1. Open **Portfolio** to see both occupancy KPIs side by side.
2. **Physical occupancy** = occupied + notice units ÷ total rentable units. It only cares whether a unit has a resident in it.
3. **Economic occupancy** = rent actually billed, net of concessions ÷ gross potential rent (every unit at market rent). It captures loss to lease and concessions that physical occupancy misses.
4. A property can be 98% physically occupied but only 91% economic, if several leases are well under market or carrying a concession.
5. Click either KPI's **Explain this number** to see the rows behind it, split by property and driver, with an AI-written summary.

Good to know: economic occupancy is the better early signal of NOI trouble, because a property can look full while under-earning. Both figures are computed from the same unit and charge data every time the page loads, so there's no separate occupancy table to fall out of sync with the unit stack.`,
    tags: ["occupancy", "kpi", "noi", "portfolio"],
    entity_type: null,
    route: "/app/portfolio",
  },
  {
    id: "noi",
    title: "How NOI is calculated",
    body: `NOI is collected income minus operating expenses for the month, closed once the period is locked.

1. Open **Portfolio** or a property's **Financials** tab to see **NOI** for the latest closed month.
2. **Income** is rent and fees actually collected that month, from the charges and payments ledger, not scheduled rent.
3. **Operating expenses** are bills posted to operating GL accounts for that property and month; capital spend (capex) is excluded.
4. The **budget** column shows the variance in dollars and percent against the property's planned NOI for that month.
5. Click **Explain this number** to see the change split by property and by driver (vacancy, a large bill, a rent increase), with an AI-written narrative built from the same figures.

Good to know: NOI only reflects a month once its owner statement period is closed; the current, still-open month is shown separately and will move as more bills post. Capex spend never lowers NOI directly — it shows on the capex project instead, which is why a big roof replacement doesn't tank a single month's number.`,
    tags: ["noi", "financials", "budget", "portfolio"],
    entity_type: null,
    route: "/app/portfolio",
  },
  {
    id: "delinquency",
    title: "Delinquency and aging buckets",
    body: `Delinquency groups every open charge by how late it is, in four buckets: 0–30, 31–60, 61–90 and 90+ days.

1. Open **Receivables → Charges** and filter to **Overdue** to see every unpaid charge past its due date.
2. Each charge's age places it in a bucket: **0–30**, **31–60**, **61–90** or **90+ days**, shown as a column and on the aging chart.
3. The aging chart on the receivables dashboard totals balance by bucket and by property, so a property with a growing 90+ bucket stands out.
4. Open a lease's **Ledger** tab to see which specific charges are driving its balance and bucket.
5. Residents 90+ days delinquent are the Collections agent's priority queue; see "Work the Collections agent's queue" for how it follows up.

Good to know: a charge's bucket is computed from today's date each time the page loads, not stored, so it always reflects the current age even if nothing else about the charge changed. A payment plan doesn't remove a balance from its bucket until the installment is actually paid; a missed installment still ages normally.`,
    tags: ["delinquency", "aging", "receivables", "collections"],
    entity_type: "charges",
    route: "/app/receivables/charges",
  },
  {
    id: "regions-and-portfolios",
    title: "Regions, portfolios and scope",
    body: `A region is a regional manager's territory; a portfolio is the set of properties one owner entity holds — they're different ways of grouping the same properties.

1. Open **Portfolio → Regions** to see each region (for example Texas, Southeast, Southwest) with its properties and rolled-up KPIs.
2. A **region** defines a regional manager's scope: everything they see in lists, dashboards and the assistant is filtered to their region's properties.
3. A **portfolio**, by contrast, groups properties by **owner entity** — the LLC or investor that owns them — regardless of which region they're in.
4. One property belongs to exactly one region and one owner entity, but a region can span several owner entities, and an owner entity's properties can span regions.
5. Use the region view for operational rollups (occupancy, NOI by territory) and the owner entity view for ownership and statement-related questions.

Good to know: scope enforcement happens on both — a regional manager scoped to Texas never sees a Phoenix property's data, in lists, exports or the assistant, even if that property shares an owner entity with one they do manage.`,
    tags: ["regions", "portfolios", "scope", "owners"],
    entity_type: "regions",
    route: "/app/regions",
  },
  {
    id: "rent-and-market",
    title: "Market rent, lease rent and loss to lease",
    body: `Market rent is what a unit type should rent for today; lease rent is what a specific lease actually charges — the gap between them is loss to lease.

1. Open **Portfolio → Floor plans** to see each unit type's **market rent**, set from comparable units and recent leases.
2. A unit's **lease rent** (or **current rent**) is the rent on its active lease, which may be below market if it was signed earlier or carries a concession.
3. **Loss to lease** is market rent minus lease rent, summed across a property or portfolio, showing the upside available at renewal or turnover.
4. Renewal offers and new leases reference the unit type's market rent as their starting point, adjusted for the resident's tenure and payment history.
5. Floor plan rows roll up to the leasing dashboard's loss-to-lease chart, so a property manager can see where the gap is largest.

Good to know: market rent is a managed figure, not an automatic average — it updates when someone reviews comparables, so it can lag a fast-moving submarket for a few weeks. Loss to lease isn't a loss on the books; it only becomes real income once a unit turns or renews at the new rate.`,
    tags: ["market rent", "loss to lease", "floor plans", "leasing"],
    entity_type: "unit_types",
    route: "/app/floor-plans",
  },
  {
    id: "explain-a-number",
    title: "Explain any number with AI",
    body: `Every KPI has an "Explain this number" button that shows the rows behind the figure, plus an AI-written explanation of what changed and why.

1. Next to any KPI (NOI, occupancy, delinquency and more), choose **Explain this number**.
2. Propniti computes the month-over-month change in code first, split by **property** and by **driver** (a vacancy, a large bill, a rent change) — this part is always exact, not AI-generated.
3. The model then writes a short narrative over those computed facts, so the wording is readable but every figure it mentions is traceable to a row.
4. A **source badge** shows whether the explanation came from the live model or the **rules fallback** (used if the model call fails or returns something that doesn't validate).
5. Choose **View run** to open the full AI run trace: inputs, the facts it was given, and the exact text it produced.

Good to know: the AI is never the source of a number, only its narrator — if you disagree with an explanation, check the underlying rows first, since the computed facts are what actually drove the figure. This same pattern (compute first, explain second, label the source) is used everywhere in Propniti that AI touches a reported number.`,
    tags: ["explain this number", "ai", "kpi", "variance"],
    entity_type: null,
    route: "/app",
  },
  {
    id: "what-if-scenarios",
    title: "Run a what-if scenario",
    body: `The what-if simulator changes rent and occupancy assumptions for one or more properties and shows the NOI impact before you commit to anything.

1. Open **Portfolio → What-if** and choose the property or properties to model.
2. Set the levers: **rent %** change, an **occupancy target** (in points or a number of units), and **opex %** change.
3. Propniti recalculates NOI per property against the T12 baseline (Nov 2025–Oct 2026) and shows the **break-even occupancy** — the lowest occupancy that still covers costs.
4. Review the AI narrative, which explains the result in plain language built from the same computed figures shown on the chart.
5. Nothing here writes to a real record; it's a projection. Use the figures to inform a decision elsewhere (a renewal rent, a budget line), made separately.

Good to know: the simulator uses the same NOI formula as the real financials (income minus operating expenses), so a scenario's "current" column should match the live number for that property. Running a scenario never changes budgets, rents or leases — it's read-only modeling, so you can try aggressive assumptions without any risk of it leaking into real data.`,
    tags: ["what-if", "noi", "simulation", "portfolio"],
    entity_type: null,
    route: "/app/portfolio/what-if",
  },
  {
    id: "residents",
    title: "Residents and households",
    body: `A household groups the residents on one lease together; most actions (ledger, messages, insurance) happen at the household or lease level, not the individual resident.

1. Open **Residents → Residents** to see every resident, with their household, unit, lease status and balance.
2. Open **Residents → Households** to see leases grouped by household — useful when a lease has co-residents.
3. A resident's record shows contact details, lease history, and quick links to their household's ledger and open service requests.
4. Use the status tabs (**Current**, **Notice**, **Eviction**, **Past**) to filter by lease stage.
5. From a resident, open the **resident 360 view** for the combined picture: balance, risk score, open requests and recent messages in one place.

Good to know: a resident can appear in more than one household over time (a past lease and a current one), but each lease only has one household. Editing a resident's contact info updates it everywhere that resident is referenced, since it's the same record, not a copy per lease.`,
    tags: ["residents", "households", "leases"],
    entity_type: "residents",
    route: "/app/residents",
  },
  {
    id: "resident-360",
    title: "The resident 360 view",
    body: `The resident 360 view puts everything about one resident — balance, risk, requests, messages and lease — on a single page.

1. Open a resident record; the header strip shows **balance**, **risk score**, **lease status** and **unit** at a glance.
2. The **Ledger** tab shows every charge, payment and credit with a running balance.
3. The **Requests** section lists open service requests and work orders tied to their unit.
4. The **Messages** panel shows the resident's thread from the unified inbox, so you don't have to leave the record to reply.
5. The **Activity** tab logs every change and approval touching this resident, by a person or an AI agent.

Good to know: everything shown here reads from the same tables as the dedicated pages (Receivables, Communications, Maintenance) — the 360 view is a convenience layout, not a separate data source, so a balance here always matches the Ledger tab and the Receivables list. It's scoped the same way as everything else: a user only sees residents in their assigned properties.`,
    tags: ["resident 360", "residents", "overview"],
    entity_type: "residents",
    route: "/app/residents",
  },
  {
    id: "delinquency-risk",
    title: "How the delinquency risk score works",
    body: `The risk score (0–100) estimates how likely a resident is to fall behind, from their NSF history, late months and balance trend — higher means riskier.

1. Open a resident record to see their **risk score** in the header strip, or filter **Residents** by the **risk flag** facet.
2. The score weighs **NSF payments**, **months paid late**, and the **trend** of their balance (growing, flat or shrinking) over recent months.
3. A score of 70 or higher shows a risk flag on the resident and on their lease, visible to property managers and the Collections agent.
4. The Collections agent uses the score to prioritize its outreach queue, so higher-risk residents are followed up sooner, not just the most overdue ones.
5. The score updates as new payment history comes in; it isn't a one-time snapshot.

Good to know: the score only comes from this resident's own payment behavior — it never uses protected characteristics, consistent with fair-housing practice, and it isn't visible to the resident. It's a prioritization tool for staff and the Collections agent, not a decision by itself; whether to offer a payment plan or escalate is still a person's call.`,
    tags: ["risk score", "delinquency", "collections", "residents"],
    entity_type: "residents",
    route: "/app/residents",
  },
  {
    id: "leases",
    title: "Leases: terms, rent schedule and renewals",
    body: `A lease holds the term, rent and schedule for one household's tenancy, from signing through renewal or move-out.

1. Open **Leases** to see every lease with its **status** (Active, Notice, Expired), **rent**, **term** and **end date**.
2. Open a lease to see its **Overview** (parties, unit, term), **Ledger** (charges and payments) and **Documents** tabs.
3. **Recurring charges** (rent, parking, pet fees) are set on the lease and generate a charge automatically each period.
4. Leases expiring within 60 days show on the **Expiring in 60 days** filter, where renewal offers are sent from.
5. A renewal creates a new lease version linked to the original, so the full rent and term history stays visible.

Good to know: changing the rent on an active lease is a distinct action from a renewal (see "Changing rent on a lease") — a renewal always creates a new lease term, while a rent change can apply mid-term for cases like an added roommate or a corrected amount. Every past offer, its outcome and the lease's full term history stay on the record, so nothing about how a resident got to their current rent is hidden.`,
    tags: ["leases", "rent", "renewals", "terms"],
    entity_type: "leases",
    route: "/app/leases",
  },
  {
    id: "lease-abstraction",
    title: "Lease abstraction: check a lease document against the record",
    body: `Lease abstraction compares the signed lease document's text against the lease record's fields, and flags anything that doesn't match.

1. Open the lease and choose the **Abstraction** tab (/app/leases/<id>?tab=abstraction).
2. Propniti reads the signed lease document attached to the record and extracts the term, rent, dates and key clauses.
3. Each extracted value is shown next to the record's current value; a mismatch is highlighted rather than silently accepted.
4. Mismatches create a **data issue** (leases.abstract_mismatch) so it surfaces on the lease's Data Health badge, not just here.
5. Review each flagged field and correct the record if the document is right, or note why the record is the source of truth if it isn't.

Good to know: abstraction never changes the lease record on its own — rent and term are financial and legal details, so a person always confirms the fix, the same rule that applies to every other money or legal data issue. The abstraction tab renders the lease text directly; no separate PDF viewer is needed to do the comparison.`,
    tags: ["lease abstraction", "leases", "data health"],
    entity_type: "leases",
    route: "/app/leases",
  },
  {
    id: "rent-changes",
    title: "Changing rent on a lease",
    body: `Change rent mid-term for cases like a corrected amount or an added roommate, separate from a renewal, which resets the whole term.

1. Open the lease and choose **Change rent** from its Overview tab.
2. Enter the new rent amount and the date it takes effect.
3. Propniti shows the next charge it will affect before you confirm, so you can see exactly which period picks up the new amount.
4. Confirm. The lease's rent updates and the change is recorded in its history, alongside the reason you entered.
5. Future recurring rent charges generate at the new amount from the effective date forward; past charges aren't altered.

Good to know: a rent change doesn't extend or restart the lease term — for that, use a renewal instead. Because this affects the ledger, it's logged to the audit log with who made the change and when, and it shows on the lease's rent history so an owner or resident can see exactly when and why rent moved.`,
    tags: ["rent change", "leases", "ledger"],
    entity_type: "leases",
    route: "/app/leases",
  },
  {
    id: "resident-ledger",
    title: "Reading a resident's ledger",
    body: `The ledger lists every charge, payment and credit for a lease or household, with a running balance, so you can see exactly how a balance built up.

1. Open a lease or resident record and choose the **Ledger** tab.
2. Each row is a charge (rent, fee), a payment, or a credit, in date order, with the running balance shown after each one.
3. Click any row to see the detail behind it — for a charge, its type and period; for a payment, its method and the charges it was applied to.
4. Use **Record payment** directly from an open charge if a payment needs recording.
5. The balance shown here matches the balance shown on the Receivables list and the resident 360 view, since it's the same underlying ledger.

Good to know: payments apply oldest-charge-first by default, so the ledger shows a payment clearing old rent before a newer late fee, even if the resident meant it for this month. A written-off charge still shows in the ledger history, marked as written off, so the ledger stays a complete record, not just the still-open balance.`,
    tags: ["ledger", "residents", "balance", "receivables"],
    entity_type: "charges",
    route: "/app/receivables/ledger",
  },
  {
    id: "unified-inbox",
    title: "The unified inbox and AI-suggested replies",
    body: `The unified inbox collects every message thread with a resident, vendor or owner in one place, with AI-suggested replies you can edit before sending.

1. Open **Communications → Messages** to see every thread, filterable by **party** (resident, vendor, owner), **channel** (Email, SMS, Portal, Phone) and **status** (Open, Waiting, Closed).
2. Open a thread to see the full conversation and reply inline; the channel shown matches the resident's preferred channel.
3. For common situations, the **AI rail** suggests a reply, drawn from a message template where one fits; review and edit it before sending.
4. Some outbound messages are drafted by an agent (Collections, Renewals) — these show a **drafted by agent** label so it's clear the suggestion came from automation, not a teammate.
5. Mark a thread **Closed** once it's resolved; it reopens automatically if the same party replies again.

Good to know: the inbox never sends anything on its own — every AI-suggested reply is a draft a person reviews and sends, the same rule that applies to any text the AI writes to a resident. Conversations waiting on your reply also appear in your personal **Inbox** (/app/inbox), next to approvals and alerts; its sidebar badge counts what needs you.`,
    tags: ["inbox", "messages", "ai", "communications"],
    entity_type: "message_threads",
    route: "/app/communications/inbox",
  },
  {
    id: "message-templates",
    title: "Message templates and merge fields",
    body: `Templates are reusable message bodies with merge fields that fill in from the record you're sending to, so common messages don't get retyped.

1. Open **Communications → Templates** to see templates grouped by category (Collections, Renewals, Maintenance, Leasing, Notices).
2. Open a template to edit its body; insert a merge field like {{first_name}}, {{unit}}, {{property}}, {{balance}}, {{due_date}}, {{lease_end}} or {{rent}} wherever it should fill in automatically.
3. Templates with both **EN** and **ES** versions let you pick the resident's preferred language when sending.
4. When replying in the inbox or sending an announcement, choose **Use template** to start from one instead of a blank message.
5. Merge fields fill in from the specific resident or lease you're sending to; a field with no value for that record is left blank rather than showing a placeholder.

Good to know: editing a template only changes future messages sent from it — it never rewrites a message that already went out, so a resident's message history stays accurate to what they actually received. Templates are shared across your organization, so renaming or deleting one affects everyone who uses it.`,
    tags: ["templates", "merge fields", "communications"],
    entity_type: "templates",
    route: "/app/communications/templates",
  },
  {
    id: "announcements",
    title: "Sending an announcement to a property",
    body: `An announcement goes to every resident matching an audience you choose — a property, a kind of resident, or both — over the channels you pick.

1. Open **Communications → Announcements** and choose **New announcement**.
2. Set the **audience**: one or more properties, and optionally a resident kind (for example, only current residents).
3. Pick the **channels** to send over, such as Email and SMS.
4. Write the body, or start from a **template** (Notices category has water shutoff, pest treatment, parking lot resurfacing and similar examples).
5. Choose **Send now** or **Schedule** for a later time; a **Draft** stays editable until you're ready.

Good to know: an announcement's recipient list is fixed at send time, from occupied units matching the audience at that moment — it doesn't pick up someone who moves in afterward. Sent announcements keep a record of who received them, so a resident disputing "I never got that notice" can be checked against the actual send log, not just the draft that was prepared.`,
    tags: ["announcements", "communications", "notices"],
    entity_type: "announcements",
    route: "/app/communications/announcements",
  },
  {
    id: "merge-duplicate-residents",
    title: "Merging duplicate residents",
    body: `Merge two resident records when they're really the same person, usually from a spelling variant or a resubmitted contact — Propniti flags likely duplicates for you.

1. Open **Data Health** and filter to the rule **residents.possible_duplicate**, or open a flagged resident directly — it shows a **possible duplicate** badge.
2. Review the evidence: both records' names, phone and contact details side by side, and which one is older.
3. Choose **Merge**, confirming which record is kept (normally the older id) and which is merged into it.
4. Propniti moves the newer record's history (messages, requests, lease ties) onto the kept record and marks the other merged.
5. The merge is logged to the audit log and the fix history, with both original ids kept for reference.

Good to know: a merge is permanent — the two records become one, so review the evidence carefully before confirming, especially if the "duplicate" is actually two different residents with similar names. Because this changes resident-identifying data, it's always a person's decision; the AI only detects and suggests the match.`,
    tags: ["duplicate residents", "merge", "data health"],
    entity_type: "residents",
    route: "/app/residents",
  },
  {
    id: "contact-normalization",
    title: "Fixing contact details (phone in the email field and similar)",
    body: `A few resident records end up with a phone number typed into the email field, or similar swapped contact details — Data Health finds and fixes these safely.

1. Open **Data Health** and filter to the rule **residents.phone_in_email** (or a similar contact-formatting rule).
2. Open a flagged resident to see the **before/after** comparison: the field as it is now, and what Propniti proposes to move it to.
3. Choose **Apply fix** to accept the correction, or edit the resident's contact fields yourself if the suggestion needs adjusting.
4. Once applied, the fix is logged to the **fix history** and the issue closes.
5. These are formatting fixes, not identity changes, so they can be applied in bulk once you've spot-checked a few.

Good to know: contact normalization only reformats or relocates a value — it never guesses a new phone number or email that wasn't already in the record somewhere. A record's Data Health badge shows this on the resident's own page too, so it's visible without a trip to the central Data Health list.`,
    tags: ["contact details", "data health", "residents"],
    entity_type: "residents",
    route: "/app/data-health",
  },
  {
    id: "renters-insurance",
    title: "Tracking renters insurance",
    body: `Propniti tracks each lease's renters insurance policy and its expiry, so a lapsed policy doesn't go unnoticed until there's a claim.

1. Open **Residents → Insurance** to see every policy with its **carrier**, **liability amount**, **term** and **status**.
2. Status is one of **Active**, **Expiring** (within 30 days) or **Lapsed** — Expiring and Lapsed policies show a warning badge.
3. Open a resident's record to see their policy on the Overview tab alongside their lease.
4. If a resident's policy lapses, a reminder can be sent from the record's message panel, or from a template under Communications.
5. When a new policy is provided, update the record with the new carrier, policy number and expiry so the status recalculates.

Good to know: a lapsed or missing policy doesn't block anything automatically — it's a visibility tool, not an enforcement one, so acting on it (a notice, a lease condition) is still a person's decision based on your lease terms. Liability amounts are shown in whole dollars even though they're stored as cents internally, same as every other money field.`,
    tags: ["renters insurance", "residents", "compliance"],
    entity_type: "renters_insurance",
    route: "/app/residents/insurance",
  },
  {
    id: "parking-storage",
    title: "Parking spaces and storage units",
    body: `Parking spaces and storage units are rentable items you can assign to a lease and charge for, separately from the unit's base rent.

1. Open **Parking & storage** to see every space or unit, its **property**, **assignment** and **monthly rate**.
2. Choose **Assign** to tie a space to a specific lease; this adds a recurring charge for its rate to that lease going forward.
3. To release a space, choose **Unassign** — this stops future charges but doesn't retroactively remove past ones.
4. Unassigned spaces show as **Available**, so you can see at a glance what's left to offer new or renewing residents.
5. A space's rate can be changed independently of the lease's base rent, so adjusting parking pricing doesn't touch the main rent line.

Good to know: parking and storage income shows separately in reporting from base rent, so a property's effective rent isn't inflated by ancillary fees. Assigning a space to a lease is immediate — the next recurring charge run picks up the new rate without any extra step.`,
    tags: ["parking", "storage", "rentable items"],
    entity_type: "rentable_items",
    route: "/app/parking-storage",
  },
  {
    id: "service-requests",
    title: "Service requests from residents",
    body: `A service request is what a resident submits describing a problem; staff triage it into a work order once it's understood.

1. Open **Maintenance → Requests** to see every resident-submitted request, with its status: **New**, **Triaged**, **Converted** or **Closed**.
2. Open a request to read the resident's own description and any photos they attached.
3. Choose **Convert to work order** to triage it: pick the trade and urgency, and the Maintenance Triage agent suggests both from the description.
4. Once converted, the request links to its work order, so the resident's original wording stays attached to the job that came from it.
5. Close a request directly if it didn't need a work order (a question, something already resolved).

Good to know: a request isn't the same record as the work order it becomes — triage is a deliberate step, not automatic, because the trade, urgency and vendor assignment are judgment calls even when the AI suggests a starting point. Residents can track their request's status from the resident portal.`,
    tags: ["service requests", "maintenance", "residents"],
    entity_type: "service_requests",
    route: "/app/maintenance/requests",
  },
  {
    id: "today-page",
    title: "Your Today page",
    body: `The Today page is a property manager's daily queue: what needs a decision, what's scheduled, and what the AI agents have already handled.

1. Open **/app/today**, or it's the property manager's home page by default.
2. The top section lists items **needing you**: approvals, overdue tasks, flagged data issues.
3. A **scheduled** section shows today's showings, work orders and renewal deadlines across your properties.
4. An **auto-handled** section shows what agents completed on their own within policy, so you can spot-check without having to act on each one.
5. Quick actions (Record payment, Post late fees, and similar) are one click away from the same page.

Good to know: queue placement (needs you / auto-handled / waiting) reflects each item's actual approval requirement, not a guess — an item only appears as auto-handled if policy genuinely allowed the agent to act alone. The page is scoped to your properties the same way every other list is, so two property managers see different queues even on the same day.`,
    tags: ["today page", "property manager", "home"],
    entity_type: null,
    route: "/app/today",
  },
  {
    id: "owner-statements",
    title: "Owner statements and distributions",
    body: `Owner statements summarize a period's income, expenses, the management fee and the net distribution; everything after the last closed period is still open.

1. Open **Owner statements** and select the owner entity and period.
2. The statement shows **income collected**, **expenses paid**, the **management fee** (8% of collected rent by default) and the resulting **net distribution**.
3. Choose **Close period** to lock the statement, then **Create distribution** to schedule the payout from the available trust balance.
4. Every line links back to its source transactions, so a number can always be clicked through to what produced it.
5. The owner sees the finalized statement and distribution in their portal once it's closed.

Good to know: everything after the last payout is still open — an owner statement only reflects a closed period, so the current month-to-date activity shows separately and will keep moving until it's closed. A distribution only draws from what's actually available in trust; it never goes negative, even if the statement math implies a larger number.`,
    tags: ["owner statements", "distributions", "management fee"],
    entity_type: "owner_distributions",
    route: "/app/owner-statements",
  },
  {
    id: "owner-entities",
    title: "Owner entities and management agreements",
    body: `An owner entity is the LLC or legal entity that holds title to one or more properties and receives statements and distributions.

1. Open **Owner entities** to see each entity with its **owner**, **properties**, and the bank accounts tied to it.
2. Open an entity's record to see its **management agreement**, approval policy overrides, and document history.
3. An owner (a person or company) can hold more than one owner entity — for example, separate LLCs per metro.
4. Approval policy overrides (spending limits, owner-approval thresholds) are set per owner entity, not per owner, so two entities under the same owner can have different limits.
5. Every property belongs to exactly one owner entity.

Good to know: owner-facing documents (the management agreement, 1099s, insurance certificates, capex reports) are filed to the owner entity's record, not the owner's, since that's the legal party they pertain to. Statements, distributions and portfolio-level reporting are always scoped to the owner entity, which is why a property manager working across entities for the same owner sees them as separate groups.`,
    tags: ["owner entities", "management agreement", "owners"],
    entity_type: "owner_entities",
    route: "/app/owner-entities",
  },
  {
    id: "explain-statement-line",
    title: "How 'Explain this line' works",
    body: `Any line on an owner statement can be clicked to see the transactions behind it, plus an AI-written explanation of what it means.

1. Open an owner statement and click any line — rent collected, a bill, the management fee, or the net distribution.
2. Propniti shows the **transactions** that sum to that line: the actual charges, payments or bills, not a summary.
3. Choose **Explain this line** for a short AI narrative built from those same transactions — what drove the number, and whether it's typical for this property and period.
4. A **source badge** shows whether the explanation came from the model or the rules fallback.
5. This works the same way whether you're staff reviewing the draft or an owner reviewing their finalized statement in the portal.

Good to know: the explanation is generated from the exact transactions shown, so it can never state a figure that disagrees with what you're looking at — the AI narrates, it doesn't calculate. This is the same "Explain this number" pattern used on portfolio KPIs, applied to statement lines specifically.`,
    tags: ["owner statement", "explain", "ai"],
    entity_type: "owner_distributions",
    route: "/app/owner-statements/explain",
  },
  {
    id: "owner-portal",
    title: "The owner portal",
    body: `The owner portal is what an owner sees when they sign in: their properties' statements, open approvals, and documents, scoped to what they own.

1. An owner signs in and lands on their portal home, showing recent statements and anything awaiting their approval.
2. The **Approvals** tab lists work orders or expenses over their approval limit, waiting on their decision.
3. **Statements** shows every closed period with the distribution amount; each line can be clicked through the same way staff can.
4. **Documents** holds items filed to their owner entity: the management agreement, 1099s, insurance certificates and capex reports.
5. Owners only see their own owner entities' data — never another owner's properties, statements or approvals.

Good to know: an owner's approval decision in the portal is the same action staff would otherwise take on their behalf — it's not a separate review layer, so once an owner approves or declines, the work order or expense moves forward exactly as if a staff member had done it. Scope is enforced the same way as every other role: on the server, not just hidden in the menu.`,
    tags: ["owner portal", "owners", "approvals"],
    entity_type: "owners",
    route: "/portal/owner",
  },
  {
    id: "resident-portal",
    title: "The resident portal",
    body: `The resident portal is where residents pay rent, message the property, see their lease and track requests — self-service, without calling the office.

1. A resident signs in and sees their **balance**, **due date** and a **Pay rent** action on their portal home.
2. **Messages** shows their thread with the property, the same unified inbox staff use on their side.
3. **Lease** shows their current term, rent and renewal offers, if any are pending.
4. **Requests** lets them submit a new service request, with status visible as it moves through triage.
5. **Documents** shows anything filed to their lease: the lease itself, move-in inspection, community rules.

Good to know: everything a resident sees here reads from the same records staff work from, so a payment, message or renewal response is reflected immediately on both sides — there's no separate portal database to sync. A resident never sees their own delinquency risk score or the internal applicant score; those stay staff-only by design.`,
    tags: ["resident portal", "residents", "self-service"],
    entity_type: "residents",
    route: "/portal/resident",
  },
  {
    id: "vendor-portal",
    title: "The vendor portal",
    body: `The vendor portal is where a vendor sees their assigned jobs, submits invoices, and keeps their insurance certificate current.

1. A vendor signs in and sees their open jobs by status: **Assigned**, **Scheduled**, **In progress** and **Completed**.
2. Opening a job shows the work order's details and lets the vendor update status or upload photos.
3. **Submit invoice** attaches the bill for a completed job, which lands as a pending-approval bill on the staff side.
4. The **Insurance** tab shows their current certificate of insurance (COI) and its expiry, with a prompt to upload a new one before it lapses.
5. If their bank details change, the vendor updates them here, which holds any pending payments until staff verify the change.

Good to know: a vendor only ever sees their own jobs and invoices, never another vendor's or a resident's data. Submitting an invoice doesn't pay it — approval and payment still follow the normal bill-approval flow on the staff side, so a vendor can't move money just by submitting a number.`,
    tags: ["vendor portal", "vendors", "invoices"],
    entity_type: "vendors",
    route: "/portal/vendor",
  },
  {
    id: "applicant-portal",
    title: "The applicant portal",
    body: `The applicant portal lets a prospective resident track their application status and upload documents, without seeing their internal score.

1. An applicant signs in (from the link sent after applying) and sees their application's **stage**: Submitted, Screening, Approved, Conditional or Denied.
2. **Documents** lets them upload what's requested, such as a photo ID or a pay stub.
3. Status updates automatically as staff or the Leasing agent move the application through the pipeline.
4. If approved with conditions (a higher deposit, a co-signer), the portal shows what's needed next.
5. Once approved, the portal links to next steps for signing the lease.

Good to know: applicants see their application's stage, but never the internal applicant score or the broker's reasoning — the score is a decision aid for staff, not something shared with the applicant, consistent with fair-housing practice. A declined application still shows a status here, though the detailed reason stays internal unless staff choose to share it directly.`,
    tags: ["applicant portal", "applications", "leasing"],
    entity_type: "applicants",
    route: "/portal/applicant",
  },
  {
    id: "prepare-1099s",
    title: "Prepare 1099s",
    body: `Propniti drafts a 1099 for every 1099-eligible vendor paid $600 or more by an owner entity in the year, and flags anything that needs attention before filing.

1. Open **Finance → 1099s** to see draft and filed 1099s by vendor and year.
2. Each draft totals payments from owner entities for that vendor across the year, pulled directly from paid bills.
3. Vendors missing a **W-9 on file** while flagged as 1099 vendors and paid over $600 are highlighted — you need the W-9 before filing.
4. Review each draft's amount against the vendor's paid-bill history if anything looks off, then mark it ready.
5. Filed 1099s from prior years stay on the vendor's record for reference, with their filed date.

Good to know: a vendor paid just under $600 won't get a draft automatically, since the threshold is a hard cutoff, not a rounding judgment — check manually if you believe a vendor is close. Filing itself happens outside Propniti (through your tax software or provider); this page prepares and checks the numbers, it doesn't submit to the IRS.`,
    tags: ["1099s", "vendors", "tax", "finance"],
    entity_type: "vendor_1099s",
    route: "/app/finance/1099",
  },
  {
    id: "capex-projects",
    title: "Track capex projects",
    body: `A capex project tracks a capital improvement — a roof, HVAC replacement, parking lot — separately from operating expenses, with its own budget and milestones.

1. Open **Accounting → Capex** to see every project with its **property**, **budget**, **spent** and **status**.
2. Open a project to see its **milestones**: named steps with a due date, completion date and percent complete.
3. Bills coded to the capex GL account link to the project automatically, so **spent** updates as invoices post, without manual entry.
4. A project over budget (spent exceeding budget) or with a past-due milestone shows a warning so it doesn't go unnoticed until the final bill.
5. Mark a project **Complete** once all milestones are done and spend is finalized.

Good to know: capex spend never counts against operating NOI the way a regular bill does — it's tracked here specifically so a major project doesn't distort a single month's financials. An over-budget project doesn't block further bills from posting; it's a visibility flag for the accountant or owner to review, not a spending limit enforced automatically.`,
    tags: ["capex", "budget", "projects", "finance"],
    entity_type: "capex_projects",
    route: "/app/accounting/capex",
  },
  {
    id: "gl-recode-miscoded-bills",
    title: "Recode a miscoded bill",
    body: `When a bill line is coded to the wrong GL account, Data Health flags it and suggests the right one, based on the vendor's usual coding.

1. Open **Data Health** and filter to the rule flagging miscoded GL lines, or open a flagged bill directly.
2. The bill's **Lines** tab shows the line in question, its current GL account, and the suggested correction with the AI's confidence and reasoning.
3. Choose **Apply fix** to recode the line to the suggested account, or pick a different account yourself if the suggestion isn't right.
4. The change updates the bill's line coding and is logged to the fix history and the audit log.
5. Recoding doesn't change the bill's amount or vendor — only which expense category it posts to.

Good to know: GL coding affects both the property's financial reports and the owner statement's expense breakdown, so a miscoded line can make a budget variance look wrong even though the total amount paid is correct. Recoding an already-paid bill doesn't reopen it for approval; it's a correction to historical categorization, not a reversal.`,
    tags: ["gl coding", "bills", "data health", "finance"],
    entity_type: "bills",
    route: "/app/payables/bills",
  },
  {
    id: "nl-report-builder",
    title: "Build a report by asking",
    body: `Instead of configuring filters and columns, describe the report you want in plain language and the AI builds the query for you.

1. Open **Reports** and choose **Build with AI** (or ask from the assistant's chat mode).
2. Type what you want, for example "delinquency by property for Texas over 60 days."
3. Propniti turns the question into a scoped query over your data and shows the result as a table or chart, with the filters it used shown alongside.
4. Adjust the result by asking a follow-up ("now split by region") or by editing the filters directly, the same as any other report.
5. Save the result as a **saved view** if you'll want to run it again.

Good to know: the AI only ever builds queries against your scoped data — a request outside your role's scope returns nothing, the same rule that applies everywhere else in the product. Every figure in the result is computed the normal way, from the same tables the equivalent manual report would use, so it can be trusted the same way.`,
    tags: ["reports", "ai", "natural language", "finance"],
    entity_type: null,
    route: "/app/reports",
  },
  {
    id: "cash-forecast-90-day",
    title: "Read the 90-day cash forecast",
    body: `The 90-day cash forecast projects trust account balances forward using scheduled rent, known bills and recurring charges, so you can see a cash crunch coming.

1. Open **Finance** (the accountant's home) to see the **90-day cash forecast** chart.
2. The projection combines **expected rent** (from recurring charges and lease schedules), **scheduled bills** (approved and pending), and **recurring expenses**, day by day.
3. A dip below a set threshold is highlighted, so a thin week is visible weeks ahead rather than discovered the day it happens.
4. Click any point on the chart to see what's driving it — which bills or expected payments fall on that day.
5. The forecast updates automatically as new bills, payments and charges post; it isn't a static snapshot.

Good to know: the forecast assumes scheduled rent is collected on time — it doesn't discount for expected delinquency, so treat a tight projection as a worst-reasonable-case floor, not a guarantee. It projects trust balances, not the management company's own operating cash, since those are separate accounts.`,
    tags: ["cash forecast", "finance", "trust accounts"],
    entity_type: null,
    route: "/app/finance",
  },
  {
    id: "utility-billing-rubs",
    title: "Utility bills and RUBS",
    body: `RUBS (ratio utility billing) splits a property's master utility bill across residents by a formula, instead of each unit having its own meter.

1. Open **Accounting → Utilities** to see **meters** (where sub-metered) and **utility bills** (the master bills from the provider).
2. For properties on RUBS, enter the master bill's total; Propniti allocates it across occupied units by the property's chosen ratio (square footage, occupant count, or an even split).
3. Each resident's allocated share posts as a charge on their lease, the same as rent or a fee.
4. For sub-metered units, the meter's own reading drives that unit's charge instead of a ratio.
5. Review the allocation breakdown before it posts if a unit's occupancy changed mid-period, since that affects the ratio.

Good to know: RUBS allocations are a pass-through of the actual master bill, not an estimate — the total charged across all units should match what the utility provider billed, within rounding. A mid-month move-in or move-out is prorated in the ratio, so a resident isn't charged for days they weren't occupying the unit.`,
    tags: ["utilities", "rubs", "billing", "finance"],
    entity_type: "utility_bills",
    route: "/app/accounting/utilities/bills",
  },
  {
    id: "ap-inbox",
    title: "Turn an invoice into a bill in the AP inbox",
    body: `The AP inbox is where incoming vendor invoices land to be scanned and turned into bills, before they enter the normal approval flow.

1. Open **Finance → AP inbox** to see invoices waiting to be turned into bills.
2. Open one and choose **Scan invoice**; the AI reads the vendor, amount, line items and suggests GL coding for each line based on that vendor's past bills.
3. Review the draft, paying attention to any **low-confidence** field the AI highlights for a closer look.
4. Choose **Create bill** to save it as pending approval, which then follows the normal bill-approval flow.
5. Anomalies (a duplicate invoice number, an amount far above the vendor's typical bill) are flagged on the AI rail before you create the bill.

Good to know: nothing in the AP inbox posts a bill on its own — every scanned invoice lands as a draft a person reviews, because coding and amounts are financial decisions. If the AI can't read an invoice confidently, it falls back to a blank draft rather than guessing.`,
    tags: ["ap inbox", "bills", "invoices", "ai"],
    entity_type: "bills",
    route: "/app/finance/ap-inbox",
  },
  {
    id: "delinquency-aging",
    title: "Read the delinquency aging report",
    body: `The aging report totals every open balance by how late it is — 0–30, 31–60, 61–90 and 90+ days — so you can see where delinquency is concentrated.

1. Open **Receivables → Delinquency** to see the aging report, broken out by property and bucket.
2. Each bucket's total is the sum of open charge balances whose age falls in that range, computed from today's date, not stored.
3. Click a bucket's total to open the underlying charges, filtered to that property and age range.
4. The report rolls up to the portfolio-wide delinquency KPI shown on the receivables dashboard and the principal's home page.
5. Use it alongside the resident's own risk score to decide who the Collections agent, or you directly, should follow up with first.

Good to know: a charge's bucket shifts automatically as days pass — there's no manual re-bucketing step, so the report always reflects the current date. A payment plan's scheduled installments still age normally if they're missed; the plan doesn't pause the aging clock.`,
    tags: ["delinquency", "aging", "receivables"],
    entity_type: "charges",
    route: "/app/receivables/delinquency",
  },
  {
    id: "collections-agent",
    title: "Work the Collections agent's queue",
    body: `The Collections agent proposes reminders, payment plans and escalations for delinquent residents; you review and approve what it suggests.

1. Open **/app/agents** and find **Collections**, or open **Receivables → Collections** to work its queue directly.
2. The queue lists residents it's flagged, each with its suggested action: a reminder message, a payment plan offer, or an escalation note.
3. Open an item to see its reasoning: balance, age, risk score and payment history behind the suggestion.
4. Choose **Approve** to send the suggested message or create the suggested plan, or edit it first if the wording or terms need adjusting.
5. The agent's autonomy level (Suggest, Act with approval, or Auto within policy) decides how much it can do without you; anything that moves money, like a write-off, always needs a person regardless of autonomy.

Good to know: every action the agent takes, approved or automatic, is logged with its full reasoning in the agent's run trace, so "why did it suggest this" always has a concrete answer. Raising its autonomy speeds up routine reminders; it never grants it the ability to write off a balance or waive a fee on its own.`,
    tags: ["collections", "ai agent", "delinquency", "receivables"],
    entity_type: "ai_proposals",
    route: "/app/receivables/collections",
  },
  {
    id: "property-insurance",
    title: "Track property insurance renewals",
    body: `Property insurance policies are tracked per property with their expiry, so a lapse or an upcoming renewal doesn't surprise you.

1. Open **Compliance → Insurance** to see every policy with its **property**, **carrier**, **coverage** and **expires on** date.
2. Status is **Valid**, **Expiring** (within 30 days) or **Expired**, shown as a badge on the policy and on the property's Compliance tab.
3. Open a policy to see its attached certificate document and coverage limits.
4. When a policy is renewed, update the record with the new expiry and upload the new certificate to clear the Expiring or Expired flag.
5. The Compliance agent surfaces expiring policies ahead of time, so a renewal request goes out before the gap, not after.

Good to know: a lapsed property policy is a real liability exposure, so it's shown prominently on the property's own Compliance tab, not just buried in a central list. Coverage amounts and carrier details here are for tracking and renewal timing; the actual policy documents and claims process stay with your insurance broker or carrier.`,
    tags: ["property insurance", "compliance", "risk"],
    entity_type: "insurance_policies",
    route: "/app/compliance/insurance",
  },
  {
    id: "compliance-items",
    title: "Track permits, inspections and certificates",
    body: `Compliance items are the recurring permits, inspections and certificates a property needs — fire inspection, elevator certificate, pool license and similar — tracked per property with due dates.

1. Open **Compliance → Items** to see every item by property, with its **type**, **due date** and **status**: Open, Due soon, Overdue or Done.
2. Items recur on a schedule (most are annual); completing one creates the next cycle automatically.
3. Open an item to see its history — prior completed cycles and any attached certificate or inspection report document.
4. Mark an item **Done** once it's completed, with the completion date and, where relevant, the document attached.
5. Overdue and Due soon items show on the property's Compliance tab and on the maintenance supervisor's home queue.

Good to know: which items apply to a property depends on its type and age — a pool license only applies where there's a pool, an elevator certificate only where there's an elevator, a lead-based-paint disclosure audit only for buildings built before 1978. An overdue item doesn't block operations automatically; it's a visibility flag so staff act on it before an actual inspection catches it.`,
    tags: ["compliance", "inspections", "permits", "risk"],
    entity_type: "compliance_items",
    route: "/app/compliance/items",
  },
  {
    id: "legal-cases",
    title: "Manage evictions and legal cases",
    body: `Legal cases track evictions, small claims and fair-housing complaints through their stages, with the attorney, court and key dates in one place.

1. Open **Compliance → Legal** to see every case with its **type** (Eviction, Small claims, Fair housing complaint), **stage** and **next date**.
2. An eviction case links to the lease it's tied to, with the balance at the time it was opened.
3. Stages move from **Notice served** through **Filed**, **Hearing set**, **Judgment**, **Writ** to **Closed**; update the stage as the case progresses.
4. Each open case tracks its **attorney**, **court** and **next date**, so nothing with a deadline gets missed.
5. An eviction case commonly has a related AI proposal (from the Compliance or Collections agent) and a task for the property manager to follow up on.

Good to know: legal and safety matters always need a person's decision — no AI agent files, settles or closes a case on its own, regardless of autonomy settings. A closed case keeps its full history (every stage and date it passed through), which matters if the same resident or property comes up again later.`,
    tags: ["legal cases", "evictions", "compliance", "risk"],
    entity_type: "legal_cases",
    route: "/app/compliance/legal",
  },
  {
    id: "approval-policies",
    title: "Reading an approval policy",
    body: `An approval policy sets how much an agent or staff role may approve alone, who approves above that, and whether a step must always go to a person.

1. Open **Settings → Approval policies** to see one row per **category** (Maintenance spend, Bill payment, Concession, Write-off, Owner distribution, Legal, Safety), as an org default or an owner-entity override.
2. **Auto-approve up to** is the dollar limit under which the role or policy can proceed without escalation.
3. **Approver above limit** names the role that must sign off once a bill, work order or action exceeds that limit.
4. **Owner approves above** sets a second, higher threshold where the owner themselves must approve, after your internal approver.
5. **Always a person** marks categories, like Legal and Safety, that can never be automated regardless of the dollar amount.

Good to know: a policy set on a specific owner entity overrides the org default for that owner entity only; leaving a field blank falls back to the org default. Changing a limit here only affects new bills, work orders and agent runs going forward — anything already in the approval queue keeps the rule it was created under.`,
    tags: ["approval policy", "limits", "settings"],
    entity_type: "approval_policies",
    route: "/app/settings/approvals",
  },
  {
    id: "audit-log",
    title: "Reading the audit log",
    body: `The audit log is an append-only record of every change and approval — who did it, when, and what changed — by a person or an AI agent.

1. Open **Settings → Audit** to see every entry, newest first, filterable by entity, actor and action.
2. Each entry shows the **action** (<entity>.<verb>, such as bills.approve or leases.renew), **who** did it (a person's name, or an agent and the model it used), and **when**.
3. For a field change, the entry shows a **before/after** comparison of exactly what changed.
4. Open an entry to jump to the record it's about.
5. Filter to a single record from that record's own **Activity** tab, which shows its audit history alongside notes and tasks.

Good to know: nothing in the audit log can be edited or deleted, including by an administrator — that's what makes it usable as a record for owners or auditors. Agent entries always show the model used and link back to the full run trace, so an automated change is never a dead end if you need to see the reasoning behind it.`,
    tags: ["audit log", "compliance", "settings"],
    entity_type: "audit",
    route: "/app/settings/audit",
  },
  {
    id: "automation-rules",
    title: "Agent schedules, events and run history",
    body: `Agents run on a schedule, when an event they listen for happens, or when someone presses **Run now**. Every run is recorded.

1. Open **Automations** to see each agent's schedule, the events that start it, its last run and when it is next due.
2. The **Event triggers** table shows what raises each event (for example, marking a payment returned raises *Payment returned* for the Collections agent) and how many are waiting.
3. A sweep runs every 15 minutes and starts one piece of work: the scheduled agent that has waited longest, or one agent's queued events.
4. Open **AI activity** to see every run: what started it, its steps, the proposals it made and whether it failed.
5. To turn an agent off, or change its autonomy or schedule, use the **Agents** page or the autonomy control on **Automations**. Only principals, regional managers and admins can, because these settings apply to the whole organization.

Good to know: agents never move money on their own. They propose, and money, legal and safety actions wait for a person unless an approval policy allows them.`,
    tags: ["automation", "agents", "runs", "schedule"],
    entity_type: null,
    route: "/app/automations",
  },
  {
    id: "data-health",
    title: "Use Data Health across the app",
    body: `Data Health finds records with a detectable problem, scores each property and module, and tracks every fix to a resolved issue.

1. Open **Data Health** to see a score per property and module, with the open issues driving each score.
2. Filter by **module**, **severity** or **rule** to focus on a specific kind of problem, such as duplicate residents or miscoded bills.
3. Where the AI can propose a fix, a **before/after** comparison shows exactly what would change, with its confidence and reasoning.
4. Choose **Apply fix** for safe, non-financial fixes (formatting, duplicate contacts, address normalization); anything involving money or legal exposure is reviewed and applied by a person instead.
5. Every fix, whether applied by a person or by policy, is logged to the fix history and the audit log.

Good to know: a record's Data Health badge shows right on its own detail page, not only on the central list, so problems surface where you're already working. Money and legal fixes — a rent amount, a lease term, a GL recode — always need a person; no autonomy setting changes that.`,
    tags: ["data health", "ai fix", "data quality"],
    entity_type: "data_issues",
    route: "/app/data-health",
  },
  {
    id: "document-filing",
    title: "How documents get filed automatically",
    body: `Uploaded documents are filed to the right record and type automatically by the document classifier agent, which shows its confidence so low-confidence filings get a second look.

1. Open **Documents** to see every file with its **type**, **filed to** record, and **filed by** (a person's name, or the document classifier agent).
2. The classifier reads an uploaded file and assigns a **doc_type** (Lease, Invoice, COI, and similar) and the record it belongs to, based on its content.
3. A filing with **confidence** below 80% is marked **Needs review**, so it's not quietly mis-filed.
4. Open a flagged document and confirm or correct its type and the record it's attached to.
5. Once confirmed, the document's filing is treated the same as one a person filed directly.

Good to know: automatic filing never deletes or hides a document that doesn't fit a confident category — it lands as unclassified or low-confidence rather than being discarded, so nothing uploaded goes missing. Filing a document to the wrong record is easy to fix: just reassign it, which doesn't require deleting and re-uploading the file.`,
    tags: ["documents", "ai", "filing", "classifier"],
    entity_type: "documents",
    route: "/app/documents",
  },
  {
    id: "documents",
    title: "Finding and filing documents",
    body: `Documents attach to the record they belong to — a lease, a bill, a vendor, an owner entity — and are also searchable from one central list.

1. Open **Documents** to see every file across your scoped properties, filterable by **type** and **property**.
2. Each document shows what it's **filed to** (for example "Lease L-10329 › Documents"), so you can jump straight to the record it belongs to.
3. To attach a new document to a record, upload it from that record's own **Documents** tab rather than from the central list.
4. Use the search box to find a document by name or filed-to text across every property you have access to.
5. A document's **Needs review** flag means the automatic filer wasn't confident; confirm or correct it from here.

Good to know: a document only shows in this list if your scope includes the property it's filed under, the same rule as any other list. Deleting a document from here removes it from the record it was attached to as well — there's one copy, not a separate central archive.`,
    tags: ["documents", "filing", "search"],
    entity_type: "documents",
    route: "/app/documents",
  },
  {
    id: "fair-housing-applicant-scoring",
    title: "How applicant scores stay fair-housing safe",
    body: `The Leasing agent scores applications only on income to rent, credit band, prior evictions and income verification — never on anything else, and it never sees anything else.

1. Open an application and look at its **applicant score**, built only from **income to rent** (gross monthly income of all applicants divided by the rent — the guideline is 3×), **credit band**, **prior evictions** and **income verification**.
2. The score never uses race, color, religion, sex, national origin, familial status, disability, age, marital status or source of income, and the model never sees those fields.
3. A **criminal record** is never scored directly: it routes the application to an **individualized review** by a person instead of affecting the score.
4. The broker reviews the application and the score, then chooses **Approve**, **Deny**, or **Approve with conditions**.
5. The decision, who made it, and the AI's recommendation are all kept in the audit log.

Good to know: the score is a decision aid, not a decision — the broker always makes the final call, and that approval or denial is theirs, audited as such, not the AI's. Excluding protected characteristics is deliberate and by design, consistent with fair-housing law, not an incidental side effect of what data happens to be available.`,
    tags: ["fair housing", "applicant score", "leasing", "compliance"],
    entity_type: "applications",
    route: "/app/leasing/applications",
  },
  {
    id: "leasing-pipeline-board",
    title: "Move prospects through the leasing pipeline",
    body: `The pipeline board shows every active lead in six columns — Lead, Tour, Applied, Screening, Approved and Leased — so you can see where each prospect stands.

1. Open **Leasing → Pipeline** to see the board, one card per active lead, grouped into its current column.
2. Drag a card to move it to the next column; each move is saved as an action, recorded with your name in the record's activity.
3. **Approved** is the broker's decision, so a card can only reach that column from the application page, never by dragging it on the board.
4. Use **Mark lost** on a card for leads that went elsewhere, so they stop showing as active without deleting the record.
5. An open lead nobody has contacted in 3 to 30 days is flagged on the board; older untouched leads are likely lost and worth marking as such.

Good to know: the board reflects the real pipeline state — moving a card is the same action as updating the prospect's stage anywhere else in the app, not a separate visual layer. A card's full move history stays on the prospect's own activity tab, so you can see exactly how and when it progressed.`,
    tags: ["leasing pipeline", "prospects", "board"],
    entity_type: "prospects",
    route: "/app/leasing/pipeline",
  },
  {
    id: "listing-editor-ai-description",
    title: "Write a listing with the AI draft",
    body: `The listing editor lets you pick photos and draft a description with AI, written only from real unit, property and amenity facts.

1. Open a listing and choose **Editor**.
2. Pick photos and choose the **cover** photo.
3. Choose **Draft with AI**: the Leasing agent writes a description from the unit, property and amenity facts only — nothing invented.
4. Edit the draft as needed, then check the **fair-housing panel**, which flags phrases such as "perfect for young professionals" or "no children" before you save.
5. Save the listing. The draft links back to the agent run that wrote it, so you can see exactly what facts it used.

Good to know: the AI never publishes a listing on its own — a drafted description is always reviewed and saved by a person, same as any other AI-written text a prospect or resident will see. About 10% of listings start with an empty description on purpose in this demo, so "Draft with AI" always has real work to do.`,
    tags: ["listing editor", "ai", "fair housing", "leasing"],
    entity_type: "listings",
    route: "/app/leasing/listings",
  },
  {
    id: "owners",
    title: "Owners: the investors you manage for",
    body: `An owner is the investor or company you manage property for; each owner can hold one or more owner entities (LLCs) that actually own the properties.

1. Open **Owners** to see every owner, with the owner entities and properties tied to them.
2. Open an owner's record to see their contact details and every owner entity they hold.
3. Statements, distributions and approval-policy overrides are set at the **owner entity** level, not the owner level, since the entity is the legal party on title.
4. An owner's portal access is tied to their owner entities — they see every property under those entities, nothing else.
5. Use the owner record as the single place to see everything tied to one investor across all their entities and metros.

Good to know: splitting an owner's holdings into separate LLCs (owner entities) is common for liability reasons, and Propniti mirrors that split exactly — statements and distributions never pool across entities, even for the same owner. Changing an owner's contact details updates it once, wherever that owner is referenced.`,
    tags: ["owners", "owner entities", "portfolio"],
    entity_type: "owners",
    route: "/app/owners",
  },
  {
    id: "parts-and-keys",
    title: "Parts inventory and key tracking",
    body: `Parts inventory tracks what each property's maintenance shop keeps on hand; key tracking shows where every key, fob or code currently is.

1. Open **Maintenance → Parts** to see each property's inventory, with **on hand**, **reorder at**, and a **Reorder now** flag when stock is at or below that point.
2. Open a part to see its SKU, category and unit cost; **stock value** totals quantity times cost.
3. Open **Maintenance → Keys** to see every key, fob or code, its **state** (In key box, Checked out or Lost) and who's holding it.
4. Checking a key out or back in updates its state and log immediately, so "who has the key to unit 412" always has a current answer.
5. A key marked **Lost** stays visible in history rather than being deleted, since access control history matters even after a rekey.

Good to know: parts inventory is per property (a "shop"), so stock levels don't pool across properties even within the same portfolio. A key's log keeps every check-out and check-in, not just its current state, which matters if access needs to be reviewed after an incident.`,
    tags: ["parts inventory", "keys", "maintenance"],
    entity_type: "inventory_items",
    route: "/app/maintenance/inventory",
  },
  {
    id: "photo-checks",
    title: "How the AI photo check works",
    body: `The photo check reviews photos attached to a work order and flags whether each one actually shows what the job describes, before a resident can dispute it.

1. Open a work order's photos to see each one's **check result**: **Matches**, **Unclear** or **Mismatch**.
2. The AI compares each photo against the work order's description and trade — a plumbing repair photo that shows an empty hallway, for example, comes back **Mismatch**.
3. The work order's overall **Photo check** status shows its worst result, so one bad photo surfaces even among several good ones.
4. Review a flagged photo and either replace it with a better one or confirm it's fine as-is; the flag doesn't block anything by itself.
5. Move-out inspection photos go through the same check, which matters when photos back up a deposit disposition.

Good to know: a flagged photo is a prompt for a person to double check, not an automatic rejection — the AI can be wrong about what a photo shows, especially for unusual angles or lighting. Catching a missing or mismatched shot before closeout saves a dispute later, when the resident's own memory of the work may differ from the record.`,
    tags: ["photo check", "ai", "work orders", "maintenance"],
    entity_type: "work_orders",
    route: "/app/maintenance/work-orders",
  },
  {
    id: "roles-and-permissions",
    title: "How roles and permission scope work",
    body: `A role decides what a user can see and do; their scope decides which properties that applies to — the two work together on every request.

1. Open **Settings → Roles** to see the role × module permission matrix: which modules each role can read, write, or approve in.
2. A user's **scope** (set when they're invited) narrows their role's access to specific properties, a region, or the whole org.
3. Scope is enforced on the server for every request, not just hidden in the sidebar — a narrower scope can't be bypassed by guessing a URL or an API call.
4. Roles with **approve** access (Principal, Regional Manager, Broker, Accountant, Maintenance Supervisor) can act on AI proposals and approvals; roles without it can only view or propose.
5. Changing a role or scope on a user applies the next time they load a page — no separate re-provisioning step.

Good to know: a role's module access (read, write, approve or none) is the same for everyone with that role; only scope varies per user. A named action can still be refused even when a module shows "read" or "write" access, if that specific action's allowed roles don't include the user's role.`,
    tags: ["roles", "permissions", "scope", "settings"],
    entity_type: "staff",
    route: "/app/settings/roles",
  },
  {
    id: "state-rules",
    title: "State rules: late fees, deposits and notices",
    body: `State rules hold the late-fee cap, grace period, deposit limit, deposit-return deadline and notice period for each state you operate in, enforced automatically where they apply.

1. Open **Settings → State rules** to see Texas, Georgia and Arizona's rules for **late-fee cap**, **grace period**, **deposit limit**, **deposit return days** and **nonpayment notice days**.
2. Each rule shows a plain-language **note** with the statute it's based on; always confirm with counsel before relying on the note for a specific case.
3. Posting a late fee or finalizing a deposit disposition checks the relevant state rule automatically — you can't post a fee above the cap or return a deposit outside the allowed window without the system flagging it.
4. A rule's **history** shows prior versions and when they changed, with who made the change.
5. Choose **Add a version** to record a new effective rule from a date you choose; earlier versions stay in history and still apply before that date.

Good to know: Texas caps late fees at 10% of rent for properties with more than four units (12% for four or fewer); Georgia and Arizona require the fee be reasonable and stated in the lease, with no statutory percentage cap. These notes are a starting point, not legal advice — state law changes, and your lease terms matter too.`,
    tags: ["state rules", "late fees", "deposits", "compliance"],
    entity_type: "state_rules",
    route: "/app/settings/state-rules",
  },
  {
    id: "users-and-invites",
    title: "Users and invites",
    body: `Every user who signs in has a role, a scope, and a status showing whether they've accepted their invite and signed in yet.

1. Open **Settings → Users** to see every user with their **role**, **scope**, and **status**: Active, Invited or Deactivated.
2. **Invited** means they haven't signed in yet; **Deactivated** means their access is off but their history is kept.
3. Choose **Invite a user** to send a new invite, setting their role and scope at the same time.
4. Use the **Pending invites** saved view to see who hasn't accepted yet, in case a reminder is needed.
5. Deactivate a user instead of deleting them when they leave, so their past actions and audit history stay attached to a real name.

Good to know: a deactivated user's role and scope stay on record, so re-activating them (if they return) doesn't require re-entering their access setup. Only admins can change a user's role, scope or active status; everyone else sees the list read-only, scoped to what their own role permits viewing.`,
    tags: ["users", "invites", "settings"],
    entity_type: "staff",
    route: "/app/settings/users",
  },
  {
    id: "renewal-workflow",
    title: "Send renewal offers",
    body: `Leasing → Renewals lists leases ending in the next 120 days, with an AI-proposed rent for each one.

1. Open **Leasing → Renewals** to see every lease ending in the next 120 days.
2. The Renewals agent proposes a rent from the unit type's market rent, the resident's tenure and their payment history, capped at 5% (3% for long, on-time residents).
3. Accept the proposed rent or edit it yourself before moving forward.
4. Choose **Draft with AI** to write the offer message, edit it, then **Send**.
5. The offer, the message and the audit entry are all saved together, so the full record of what was offered and communicated stays in one place.

Good to know: the rent cap is a starting guardrail, not a hard rule the agent can't be overridden on — you can still offer a rent above the suggested cap if the situation calls for it, but it won't be the AI's own suggestion. A resident's response (accepted, countered, declined) becomes part of the lease's renewal history, never overwriting the original offer.`,
    tags: ["renewals", "leasing", "ai agent"],
    entity_type: "renewal_offers",
    route: "/app/leasing/renewals",
  },
  {
    id: "fair-housing-advertising",
    title: "Fair-housing language in listings and messages",
    body: `Propniti checks listings and leasing messages for phrases that state a preference about who may live somewhere, and suggests wording that describes the home instead.

1. When a listing or leasing message is drafted, Propniti scans it for phrases tied to **familial status, age, religion, origin, disability, sex** or **source of income** — things like "perfect for young professionals" or "no children."
2. A flagged phrase is highlighted with a suggested replacement that describes the unit or amenity instead of the kind of person who should live there.
3. Review the suggestion and edit the text before saving or sending; the flag never blocks publishing by itself.
4. Brokers see every open flag across their listings and messages on their home page, so patterns across multiple leasing agents are visible in one place.
5. The same check runs on both public listing descriptions and leasing messages sent to prospects.

Good to know: the check looks for the pattern, not a fixed blocklist of words, so a wording that implies a preference without stating a banned word can still be flagged — and the opposite, a word used in a harmless context, might not be. It's a catch and a suggestion, not a legal judgment; a broker's review is still the last check before anything goes out.`,
    tags: ["fair housing", "listings", "compliance", "leasing"],
    entity_type: "listings",
    route: "/app/leasing/listings",
  },
];
