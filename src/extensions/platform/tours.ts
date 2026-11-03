import { registerTour } from "@/components/app/tour/registry";
import type { TourStep } from "@/components/app/tour/types";

// One product tour per internal persona (id persona-<role>), relaunched from Help and /app/setup.
// Steps navigate to that persona's real pages; targets are the shell's data-tour anchors.

const ask = (prompt: string): TourStep => ({ target: "ask", title: "Ask instead of searching", body: `Press ⌘J and ask in plain words. The answer lists every record it looked up, and the figures come from your data, not the model. Try: "${prompt}"`, placement: "bottom" });
const approvals: TourStep = { href: "/app/ai/approvals", title: "Approve what the agents propose", body: "Agents draft the work: reminders, bill coding, vendor picks. Each item shows why, the evidence and a confidence score. Anything that moves money or touches legal or safety waits for a person." };
const bell: TourStep = { target: "notifications", title: "Notifications", body: "Approvals waiting on you, @mentions, SLA breaches and expiring insurance arrive here. Each one links to the record.", placement: "bottom" };
const relaunch: TourStep = { target: "profile", title: "Switch role any time", body: "This is a demo: switch to another role from your avatar to see the same portfolio through their eyes. Restart this tour from Help → Product tours.", placement: "bottom" };

registerTour({
  id: "persona-property_manager", title: "Your day as a property manager", roles: ["property_manager"],
  steps: [
    { href: "/app", title: "Start with your briefing", body: "Home shows what the agents handled overnight, what needs your decision and the risks across your three Austin properties." },
    { href: "/app/receivables/delinquency", title: "Delinquency, oldest first", body: "Balances by age for your residents. The Collections agent drafts reminders and payment plans; you approve before anything is sent." },
    { href: "/app/maintenance/work-orders?view=open", title: "Open work orders against SLA", body: "Emergency SLAs are 4 hours, urgent 24, normal 72. Past-SLA jobs sort to the top." },
    { href: "/app/leases?view=expiring-60", title: "Renewals coming up", body: "Leases ending in the next 60 days. The Renewals agent suggests an offer from market rent and payment history." },
    approvals,
    ask("Who is late on rent?"),
    bell,
  ],
});

registerTour({
  id: "persona-principal", title: "Your portfolio as a principal", roles: ["principal"],
  steps: [
    { href: "/app", title: "The portfolio briefing", body: "All 30 properties across Austin, Dallas, Atlanta and Phoenix: what changed, what needs you, and the risks worth a look." },
    { href: "/app/properties", title: "Compare properties", body: "Occupancy, NOI and delinquency side by side. Click any figure to see the records behind it." },
    { href: "/app/reports?r=noi", title: "NOI against budget", body: "Trailing twelve months by property, with variance explained from the ledger." },
    { href: "/app/ai/approvals?f.risk=High", title: "Decisions over the limit", body: "High-risk proposals and spend above an owner's approval limit come to you. Each shows the policy that routed it." },
    { href: "/app/agents", title: "See what the agents do", body: "Every agent's runs, success rate, and how much it may do on its own. Open a run to see each step and tool call." },
    ask("Which properties are below budget NOI this quarter?"),
  ],
});

registerTour({
  id: "persona-regional_manager", title: "Running the Texas region", roles: ["regional_manager"],
  steps: [
    { href: "/app", title: "Your region's briefing", body: "The 14 Texas properties: overnight agent work, approvals waiting on you, and properties drifting from plan." },
    { href: "/app/properties", title: "Rank your properties", body: "Sort by occupancy, delinquency or open work orders to see where to spend your week." },
    { href: "/app/leasing/concessions?f.status=Proposed", title: "Concessions to approve", body: "Concessions above the policy limit wait for a regional manager. The limit is set in Settings → Approval policies." },
    { href: "/app/maintenance/work-orders?view=past-sla", title: "Work orders past SLA", body: "Jobs that missed their response time, by property and vendor." },
    { href: "/app/compliance", title: "Compliance and expiries", body: "Insurance, vendor certificates, inspections and legal cases due in the coming weeks." },
    ask("Rank my properties by economic occupancy"),
  ],
});

registerTour({
  id: "persona-leasing_agent", title: "Leasing with Propniti", roles: ["leasing_agent"],
  steps: [
    { href: "/app/leasing/prospects", title: "Your prospects", body: "Every lead with its source, last contact and next step. Stale leads are flagged after three days without a reply." },
    { href: "/app/leasing/showings?view=today", title: "Today's tours", body: "Scheduled showings with the unit, the prospect and what they asked about." },
    { href: "/app/units?f.status=Vacant", title: "What you can lease", body: "Vacant units with rent, floor plan and the date they're ready." },
    { target: "search", title: "Find anyone fast", body: "⌘K searches prospects, units and residents by name, phone or unit number.", placement: "bottom" },
    ask("Which prospects haven't heard from us in 3 days?"),
    bell,
  ],
});

registerTour({
  id: "persona-broker", title: "Broker review", roles: ["broker"],
  steps: [
    { href: "/app/leasing/applications", title: "Applications to decide", body: "Each application shows a screening summary with reasons for and against. You make the decision; the AI only summarises." },
    { href: "/app/leases?f.status=Future", title: "Leases to sign", body: "Approved applications become future leases waiting for signatures." },
    { href: "/app/owner-entities", title: "Owner agreements", body: "Management agreements by owner entity, with renewal dates." },
    approvals,
    ask("Which applications are waiting on my decision?"),
  ],
});

registerTour({
  id: "persona-accountant", title: "Month-end as an accountant", roles: ["accountant"],
  steps: [
    { href: "/app/payables/bills", title: "Bills, coded and checked", body: "The Payables agent reads invoices, suggests GL codes and flags duplicates, outliers and recent vendor bank changes." },
    { href: "/app/payables/bills?f.status=Pending%20approval", title: "Approve within policy", body: "Bills over the approval limit route to the owner. Money moves only after a person approves." },
    { href: "/app/banking/reconciliations", title: "Reconcile the trust accounts", body: "Bank lines matched to ledger entries, with suggested matches for unexplained deposits." },
    { href: "/app/owner-statements", title: "Owner statements", body: "Draft statements per owner entity. Ask why any line changed from last month." },
    ask("Which bills look unusual this month?"),
    bell,
  ],
});

registerTour({
  id: "persona-maintenance_supervisor", title: "Maintenance across Texas", roles: ["maintenance_supervisor"],
  steps: [
    { href: "/app/maintenance/work-orders", title: "The work-order board", body: "Every open job with priority, trade, vendor and SLA due time. New requests are triaged by the Maintenance agent." },
    { href: "/app/maintenance/work-orders?f.status=New", title: "Assign the new ones", body: "The agent suggests a trade, urgency and ranked vendors. Jobs above the owner's limit need approval before dispatch." },
    { href: "/app/maintenance/turnovers", title: "Make-ready", body: "Units between residents and the steps left before they're rent-ready." },
    { href: "/app/compliance", title: "Vendor insurance", body: "Vendors with an expired certificate shouldn't be dispatched. Expiring ones are listed with their open jobs." },
    ask("Which work orders will breach SLA today?"),
    bell,
  ],
});

registerTour({
  id: "persona-admin", title: "Administering Propniti", roles: ["admin"],
  steps: [
    { href: "/app/settings/users", title: "Users", body: "Everyone with access, their role and scope, and pending invites." },
    { href: "/app/settings/roles", title: "Roles and permissions", body: "Generated from the same definitions the API enforces, so this table always matches what each role can do." },
    { href: "/app/settings/approvals", title: "Approval policies", body: "Spend limits per owner and the categories that always need a person. Every change is kept in the history." },
    { href: "/app/settings/state-rules", title: "State rules", body: "Late-fee caps, grace periods and deposit limits for Texas, Georgia and Arizona, with effective dates." },
    { href: "/app/settings/audit", title: "Audit log", body: "Every change by a person or an agent, with before and after values." },
    { href: "/app/setup", title: "Finish setup", body: "The checklist tracks company profile, bank, import, team, roles and payment settings." },
  ],
});

registerTour({
  id: "persona-platform_admin", title: "Operating the platform", roles: ["platform_admin"],
  steps: [
    { href: "/app/settings/platform", title: "Customer organizations", body: "Every org on the platform with plan, status, seats and portfolio size." },
    { href: "/app/settings/platform/usage", title: "AI usage and cost", body: "Agent runs, tokens and model cost by agent and by month." },
    { href: "/app/settings/platform/health", title: "System health", body: "Which model is serving, when the scheduled sweep last ran, queue depth and database size." },
    { href: "/app/data-health", title: "Data health", body: "Open data issues by property and module, with suggested fixes." },
    relaunch,
  ],
});
