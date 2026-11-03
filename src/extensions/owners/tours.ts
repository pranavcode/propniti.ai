import { registerTour } from "@/components/app/tour/registry";

// Product tours for owner statements (staff) and the four portals. Targets are data-tour attributes.

registerTour({
  id: "owner-statements",
  title: "Owner statements",
  roles: ["accountant", "principal"],
  steps: [
    { href: "/app/owner-statements", title: "Owner statements", body: "One statement per owner entity per month, built from the operating trust ledger. A month closes when its distribution is sent." },
    { target: "statement-entities", title: "Pick an entity", body: "Each LLC has its own trust account, reserve and statement.", placement: "right" },
    { target: "explain-line", title: "Explain any line", body: "AI explains the line from the transfers behind it and lists what it looked up. Dollar amounts come straight from the ledger; AI writes only the explanation.", placement: "left" },
    { target: "distribute", title: "Send the distribution", body: "Pays the open balance by ACH. It is refused if anything posted since you opened the page, and a double click pays once.", placement: "top" },
  ],
});

registerTour({
  id: "owner-portal",
  title: "Your owner portal",
  roles: ["owner"],
  steps: [
    { href: "/portal/owner", target: "owner-briefing", title: "Your monthly briefing", body: "What you were paid and why it changed, worked out from your statements.", placement: "bottom" },
    { target: "portal-nav", title: "Statements, approvals and documents", body: "Statements print as PDFs. Repairs over your approval limit wait for you under Approvals.", placement: "bottom" },
    { target: "portal-ask", title: "Ask about your statements", body: "Ask why a distribution changed or how occupancy is trending. Every answer shows the records it used.", placement: "top" },
  ],
});

registerTour({
  id: "resident-portal",
  title: "Your resident portal",
  roles: ["resident"],
  steps: [
    { href: "/portal/resident", title: "Your resident portal", body: "Pay rent, request repairs, see your lease and message the office." },
    { target: "portal-nav", title: "Your pages", body: "Pay, Requests, Lease and Messages.", placement: "bottom" },
    { target: "portal-ask", title: "Ask for help", body: "Ask when rent is due or whether a repair is scheduled. Answers come from your own account.", placement: "top" },
  ],
});

registerTour({
  id: "vendor-portal",
  title: "Your vendor portal",
  roles: ["vendor"],
  steps: [
    { href: "/portal/vendor", title: "Your jobs and payments", body: "Accept new jobs, send invoices and follow payments." },
    { target: "portal-nav", title: "Invoices read by AI", body: "Upload an invoice photo or PDF and AI fills in the lines for you to check.", placement: "bottom" },
    { target: "portal-ask", title: "Ask for help", body: "Ask which invoices are unpaid or what's due this week.", placement: "top" },
  ],
});

registerTour({
  id: "applicant-portal",
  title: "Your application",
  roles: ["applicant"],
  steps: [
    { href: "/portal/applicant", title: "Track your application", body: "See where your application is and what happens next." },
    { target: "portal-nav", title: "Documents and messages", body: "Upload what's still needed and message the leasing team.", placement: "bottom" },
    { target: "portal-ask", title: "Ask for help", body: "Ask what's left to do or when you'll hear back.", placement: "top" },
  ],
});
