import { registerTour } from "@/components/app/tour/registry";

// Product tour for the maintenance supervisor (Tom Alvarez). Targets are data-tour attributes on
// the maintenance pages; steps whose target isn't on screen show as a centred card.
registerTour({
  id: "maintenance-supervisor",
  title: "Running maintenance in Propniti",
  roles: ["maintenance_supervisor"],
  steps: [
    { href: "/app/maintenance", title: "Your maintenance home", body: "What the agents did in the last day, what needs you, and how the region is tracking against SLA. Every number opens the work orders behind it." },
    { href: "/app/maintenance", target: "mx-triage", title: "The triage queue", body: "New requests, worst first. The Maintenance Triage agent has already suggested a trade, urgency, estimate and vendor for most of them.", placement: "top" },
    { href: "/app/maintenance", target: "mx-approvals", title: "Approvals waiting on you", body: "Agent proposals in your module. Money, safety and anything over the owner's limit always wait for a person.", placement: "left" },
    { href: "/app/maintenance/intake", target: "mx-intake", title: "Log a request in plain words", body: "Describe the problem and add a photo. The agent returns trade, urgency, an estimate and ranked vendors with insurance checked. Under your auto-approve limit it assigns the vendor itself; you can still change it.", placement: "bottom" },
    { href: "/app/maintenance/board", target: "mx-board", title: "The work-order board", body: "Every open job by status, with SLA flags. Switch to the calendar to see what's scheduled each day.", placement: "top" },
    { href: "/app/maintenance/my-jobs", target: "mx-tech", title: "The technician view", body: "What a technician sees on their phone: today's jobs, start and finish, photos and time.", placement: "bottom" },
    { href: "/app/maintenance/work-orders?view=awaiting-approval", title: "Invoices to approve", body: "Open a submitted job's Invoice and PO tab. The invoice is checked line by line against the purchase order before you pay, and it can only be paid once." },
  ],
});
