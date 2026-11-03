import { registerTour } from "@/components/app/tour/registry";

// Receivables tour for the people who work collections: the accountant and property managers.
registerTour({
  id: "receivables",
  title: "Receivables in five minutes",
  roles: ["accountant", "property_manager", "regional_manager", "principal"],
  steps: [
    { href: "/app/receivables", title: "Receivables at a glance", body: "Scheduled vs collected, live delinquency aging, deposits in transit and returned payments. Every number opens the rows behind it." },
    { href: "/app/receivables/delinquency", title: "Delinquency aging by property", body: "Each cell is the past-due balance for one property and age bucket. Click it to see the residents in it, then open a resident's ledger." },
    { href: "/app/receivables/collections", title: "The Collections agent", body: "Delinquent residents ranked by risk, with the reasons. The agent drafts reminders and payment-plan offers in English or Spanish; you approve the safe ones in bulk. Legal referrals always wait for a person." },
    { href: "/app/receivables/charges?view=overdue", title: "Record a payment", body: "Open any overdue charge or a resident's ledger and choose Record payment. A double click records it once; the management fee and trust deposit post on their own." },
    { href: "/app/receivables/late-fees", title: "Late fees within state limits", body: "Run a late-fee policy for the month. Each lease gets at most one fee, and never more than the state cap." },
    { href: "/app/receivables/deposits?view=due", title: "Deposit dispositions", body: "After move-out, itemise deductions before the state deadline. Deductions settle open charges and the rest is refunded." },
  ],
});
