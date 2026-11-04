import { CalendarDays, Gauge, KanbanSquare, RefreshCw, Stamp } from "lucide-react";
import { OPS, STAFF } from "@/entities/common";
import { registerPage } from "@/entities/registry";
import { registerTour } from "@/components/app/tour/registry";

// Leasing's custom pages in the sidebar, and the product tours for its two personas.

const LEASING_STAFF = [...OPS, "leasing_agent", "broker"] as const;
registerPage({ key: "leasing.today", label: "My leasing day", href: "/app/leasing/today", icon: CalendarDays, section: "home", order: 4, roles: ["leasing_agent"] });
registerPage({ key: "leasing.broker", label: "Broker desk", href: "/app/leasing/broker", icon: Stamp, section: "home", order: 4, roles: ["broker"] });
registerPage({ key: "leasing.overview", label: "Leasing overview", href: "/app/leasing", icon: Gauge, section: "operations", group: "Leasing", order: 10, roles: STAFF.filter((r) => r !== "accountant" && r !== "maintenance_supervisor") });
registerPage({ key: "leasing.pipeline", label: "Pipeline board", href: "/app/leasing/pipeline", icon: KanbanSquare, section: "operations", group: "Leasing", order: 11, roles: [...LEASING_STAFF] });
registerPage({ key: "leasing.renewals", label: "Renewals", href: "/app/leasing/renewals", icon: RefreshCw, section: "operations", group: "Leasing", order: 16, roles: [...LEASING_STAFF] });

registerTour({
  id: "leasing-agent",
  title: "Your leasing day",
  roles: ["leasing_agent"],
  steps: [
    { href: "/app/leasing/today", title: "Your day, briefed", body: "What came in overnight, today's tours and the leads waiting on a reply. The briefing is computed from your records; every AI suggestion shows its reasons and links to the agent run." },
    { href: "/app/leasing/today", target: "leasing-tours", title: "Today's tours", body: "Mark each tour done or a no-show right here. Feedback you type is saved on the tour.", placement: "bottom" },
    { href: "/app/leasing/today", target: "leasing-followups", title: "Follow-ups due", body: "Leads nobody has contacted in 3 days. The Leasing agent drafts follow-ups for you to approve.", placement: "top" },
    { href: "/app/leasing/pipeline", target: "pipeline-board", title: "Pipeline board", body: "Drag a card one column to move the lead. Approved is the broker's decision, so that column only fills from the application page.", placement: "top" },
    { href: "/app/leasing/listings", title: "Listings", body: "Open a listing and choose Editor to pick photos and let the AI draft the description. The fair-housing check flags risky phrases as you type." },
    { href: "/app/leasing/renewals", target: "renewals-table", title: "Renewals", body: "The Renewals agent proposes a rent from market rent, tenure and payment history. Accept or edit it, then send an AI-drafted message.", placement: "top" },
  ],
});

registerTour({
  id: "broker",
  title: "The broker desk",
  roles: ["broker"],
  steps: [
    { href: "/app/leasing/broker", title: "Your desk", body: "Applications waiting on you, what the agents proposed, how each leasing agent is doing and any fair-housing flags." },
    { href: "/app/leasing/broker", target: "broker-approvals", title: "Decide applications", body: "Each one shows the Leasing agent's score with reasons for and against. Open it to approve, add conditions or deny; your decision is logged with the AI recommendation.", placement: "bottom" },
    { href: "/app/leasing/broker", target: "broker-compliance", title: "Fair-housing flags", body: "Listings with phrases that state a preference about who may live there. Open one to fix the wording before it goes live.", placement: "top" },
    { href: "/app/leasing/broker", target: "broker-agents", title: "Agent performance", body: "Leads, tours, applications and leases per agent for the last 30 days, with leads going stale.", placement: "top" },
  ],
});
