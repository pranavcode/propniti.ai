import { registerTour } from "@/components/app/tour/registry";

// Finance month-end tour for the accountant (relaunched from Help → Product tours). The platform
// lane's persona-accountant tour covers the first visit; this one walks the finance workflows.
registerTour({
  id: "finance-month-end", title: "Month-end close walkthrough", roles: ["accountant", "principal"],
  steps: [
    { href: "/app/finance", title: "Your finance briefing", body: "What needs you in payables and banking, what to watch in cash and budget, and the approvals the Payables agent has queued." },
    { href: "/app/finance/ap-inbox", title: "Invoices become bills", body: "Drop an invoice: the Payables agent reads it, proposes GL coding and checks amount, duplicates and vendor bank changes. A bank change nobody has verified stops payment." },
    { href: "/app/payables/bills?view=to-approve", title: "Approve and pay", body: "Approve one bill or many. Paying goes out of the property's trust account by ACH, and each bill can only be paid once." },
    { href: "/app/banking/reconciliations?f.status=Open", title: "Reconcile the trust accounts", body: "Bank lines against ledger transfers, with suggested matches and a confidence. Unexplained deposits become Data Health issues." },
    { href: "/app/finance/budget-vs-actual", title: "Budget vs actual", body: "Property × GL × month with variance shading. Select Explain for the reasons behind a variance, built from the bills that drove it." },
    { href: "/app/reports", title: "Reports, or ask for one", body: "P&L, rent roll, AR aging, NOI and the 90-day cash forecast, each with CSV export. Or type a question such as \"utilities by property for Q3 vs budget\"." },
    { href: "/app/finance/1099", title: "1099s", body: "Payments per vendor and payer against the year's threshold, with missing W-9s flagged. Create the draft forms in one step." },
  ],
});
