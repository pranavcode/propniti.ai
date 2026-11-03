import { registerTour } from "@/components/app/tour/registry";

// Product tour for the property manager (Marcus): the Today page, the inbox, a resident and a lease.
registerTour({
  id: "pm-today",
  title: "Your day as a property manager",
  roles: ["property_manager", "regional_manager"],
  steps: [
    { href: "/app/today", title: "Today", body: "Your morning briefing: what the agents did overnight, what needs you, and the numbers that move: delinquency, expirations and open work orders." },
    { href: "/app/today", target: "briefing", title: "The AI briefing", body: "Written from your properties' data. Every figure links to the rows behind it, and the badge says whether a model or fixed rules wrote it.", placement: "bottom" },
    { href: "/app/today", target: "queue", title: "Needs you, handled, waiting", body: "Agents propose; you approve. Low-risk items they handled on their own are listed so you can check them. Anything that moves money waits for a person.", placement: "top" },
    { href: "/app/communications/inbox", target: "inbox", title: "One inbox for every conversation", body: "Residents, vendors and owners across email, SMS, portal and phone. Open a conversation for an AI-suggested reply you can edit before sending.", placement: "right" },
    { href: "/app/residents", title: "Residents", body: "Open any resident for the 360 view: balance and risk, lease, household, messages, requests and documents, plus data-health fixes like merging duplicates." },
    { href: "/app/leases", title: "Leases and abstraction", body: "Each lease has a terms and schedule tab and an abstraction tab that reads the signed document, cites the page for every term and flags differences from the record." },
  ],
});
