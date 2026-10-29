import type { AskResult, DemoState, ExtractedInvoice, ValidationResult, WorkOrder } from "./types";

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });

// Rule-based checks that stand in for the LLM. The same checks double as the
// evidence the policy engine would verify on a real model's answer.
export function mockValidate(wo: WorkOrder): Omit<ValidationResult, "source" | "note"> {
  const sub = wo.submission;
  if (!sub) {
    return { decision: "review", confidence: 0.1, matched: [], issues: ["No invoice submitted yet"], summary: "Nothing to validate." };
  }
  const matched: string[] = [];
  const issues: string[] = [];

  // Totals within 2% of the PO count as a match (rounding, small consumables).
  const diff = sub.total - wo.po.total;
  if (Math.abs(diff) <= wo.po.total * 0.02) {
    matched.push(`Invoice total ${money(sub.total)} matches PO total ${money(wo.po.total)}`);
  } else if (diff > 0) {
    const pct = wo.po.total ? Math.round((diff / wo.po.total) * 100) : 100;
    issues.push(`Invoice total ${money(sub.total)} is ${money(diff)} (${pct}%) over PO total ${money(wo.po.total)}`);
  } else {
    matched.push(`Invoice total ${money(sub.total)} is under PO total ${money(wo.po.total)}`);
  }

  // Lines are grouped by the text before the first comma, ignoring case ("Labor, 4 h @ $90" -> "labor"),
  // and each group is compared with the PO group of the same name, so one invoice line can't
  // stand in for several PO lines and a changed quantity shows as a price mismatch.
  const key = (d: string) => d.split(",")[0].trim().toLowerCase();
  const group = (items: { description: string; amount: number }[]) => {
    const m = new Map<string, { label: string; amount: number }>();
    for (const i of items) {
      const k = key(i.description);
      const g = m.get(k);
      m.set(k, { label: g?.label ?? i.description, amount: (g?.amount ?? 0) + i.amount });
    }
    return m;
  };
  const poGroups = group(wo.po.items);
  const subGroups = group(sub.items);
  for (const [k, g] of subGroups) {
    const po = poGroups.get(k);
    if (!po) issues.push(`Not on PO: ${g.label} (${money(g.amount)})`);
    else if (Math.abs(po.amount - g.amount) > 0.005) issues.push(`${g.label}: ${money(g.amount)} billed vs ${money(po.amount)} on PO`);
    else matched.push(`${g.label}: ${money(g.amount)} matches PO`);
  }
  for (const [k, g] of poGroups) if (!subGroups.has(k)) issues.push(`PO item not on invoice: ${g.label}`);

  // Money invariants: lines present, nothing negative, and lines add up to the stated total to the cent.
  if (sub.items.length === 0) issues.push("Invoice has no line items");
  if (sub.total < 0 || sub.items.some((i) => i.amount < 0)) issues.push("Invoice contains negative amounts");
  const sum = sub.items.reduce((a, i) => a + i.amount, 0);
  if (sub.items.length && Math.abs(sum - sub.total) > 0.005) issues.push(`Line items add up to ${money(sum)}, not the stated total ${money(sub.total)}`);

  if (sub.photos.length >= wo.po.photosRequired) {
    matched.push(`${sub.photos.length} of ${wo.po.photosRequired} required photos provided`);
  } else {
    issues.push(`Only ${sub.photos.length} of ${wo.po.photosRequired} required photos provided`);
  }

  // No issues = high confidence (one-tap approve at >= 0.85); each issue drops it 0.2, floor 0.2.
  const confidence = issues.length === 0 ? 0.97 : Math.max(0.2, 0.85 - 0.2 * issues.length);
  return {
    decision: issues.length === 0 ? "approve" : "review",
    confidence: Number(confidence.toFixed(2)),
    matched,
    issues,
    summary:
      issues.length === 0
        ? "Invoice, line items and photos all match the purchase order. Safe to approve."
        : `${issues.length} issue${issues.length > 1 ? "s" : ""} found against the purchase order. Review before paying.`,
  };
}

// The question types the computed facts answer. mockAsk, isFactQuestion and expectedMentions
// share them, so every question routed to computed figures gets an answer built from them.
const OVERDUE_Q = /(late|overdue|owe|arrear|unpaid)/i;
const LEASE_Q = /(lease|renew|expir)/i;
const WORK_Q = /(work order|vendor|repair|invoice|po\b|maintenance)/i;

export function mockAsk(question: string, s: DemoState): Omit<AskResult, "source" | "note"> {
  const q = question.toLowerCase();
  const name = (id: string) => s.users.find((u) => u.id === id)?.name ?? id;
  const prop = (id: string) => s.properties.find((p) => p.id === id)?.name ?? id;

  if (OVERDUE_Q.test(q)) {
    const rows = s.invoices
      .filter((i) => i.status === "Overdue")
      .flatMap((i) => {
        const t = s.tenancies.find((x) => x.id === i.tenancyId);
        return t ? [`${name(t.tenantId)} (${prop(t.propertyId)} ${t.unit}): ${money(i.amount)} due ${i.due}`] : [];
      });
    return {
      answer: rows.length ? `${rows.length} overdue invoice${rows.length > 1 ? "s" : ""}:\n- ${rows.join("\n- ")}` : "No overdue invoices.",
      suggestedActions: rows.length ? ["Send a reminder to each tenant on their preferred channel", "Offer a payment plan if 15+ days late"] : [],
    };
  }
  if (LEASE_Q.test(q)) {
    const rows = s.tenancies
      .filter((t) => t.status === "Renewal due")
      .map((t) => `${name(t.tenantId)} (${prop(t.propertyId)} ${t.unit}): lease ends ${t.leaseEnd}, rent ${money(t.rent)}`);
    return {
      answer: rows.length ? `${rows.length} lease${rows.length > 1 ? "s" : ""} ending within 45 days:\n- ${rows.join("\n- ")}` : "No leases ending within 45 days.",
      suggestedActions: rows.length ? ["Send renewal offers at current rent", "Schedule a voice-call follow-up in 7 days if no reply"] : [],
    };
  }
  if (WORK_Q.test(q)) {
    const rows = s.workOrders
      .filter((w) => !["Payment pending", "Paid", "Completed"].includes(w.status))
      .map((w) => `${w.id} ${w.title} (${prop(w.propertyId)}): ${w.status}`);
    return {
      answer: `${rows.length} open work orders:\n- ${rows.join("\n- ")}`,
      suggestedActions: ["Validate submitted invoices against their POs", "Nudge vendors on jobs in progress for over 3 days"],
    };
  }
  const occupied = s.properties.reduce((a, p) => a + p.occupied, 0);
  const units = s.properties.reduce((a, p) => a + p.units, 0);
  return {
    answer: `Portfolio: ${s.properties.length} properties, ${occupied}/${units} units occupied (${units ? Math.round((occupied / units) * 100) : 0}%). Try asking "who is late on rent?", "which leases are up for renewal?" or "what work orders are open?"`,
    suggestedActions: [],
  };
}

// Internal consistency of an invoice read from a document, before it is compared with any PO.
export function checkInvoice(inv: ExtractedInvoice): { label: string; ok: boolean }[] {
  const sum = inv.lineItems.reduce((a, i) => a + i.amount, 0);
  return [
    { label: "Document is an invoice or bill", ok: inv.isInvoice },
    { label: "Vendor and invoice number present", ok: !!inv.vendor.trim() && !!inv.invoiceNumber.trim() },
    { label: "Line items add up to the stated total", ok: inv.lineItems.length > 0 && Math.abs(sum - inv.total) <= Math.max(1, inv.total * 0.01) },
    { label: "Amounts in US dollars", ok: /^(usd|\$)?$/i.test(inv.currency.trim()) },
    { label: "Legible enough to trust (confidence 70%+)", ok: inv.confidence >= 0.7 },
  ];
}

// Facts computed from the data, given to the model so it doesn't have to find them itself.
export function portfolioFacts(s: DemoState) {
  const name = (id: string) => s.users.find((u) => u.id === id)?.name ?? id;
  const prop = (id: string) => s.properties.find((p) => p.id === id)?.name ?? id;
  return {
    overdueRent: s.invoices
      .filter((i) => i.status === "Overdue")
      .flatMap((i) => {
        const t = s.tenancies.find((x) => x.id === i.tenancyId);
        return t ? [{ tenant: name(t.tenantId), home: `${prop(t.propertyId)} ${t.unit}`, amount: i.amount, due: i.due, invoice: i.id }] : [];
      }),
    leasesUpForRenewal: s.tenancies
      .filter((t) => t.status === "Renewal due")
      .map((t) => ({ tenant: name(t.tenantId), home: `${prop(t.propertyId)} ${t.unit}`, leaseEnds: t.leaseEnd, rent: t.rent })),
    openWorkOrders: s.workOrders.filter((w) => !["Payment pending", "Paid", "Completed"].includes(w.status)).map((w) => ({ id: w.id, job: w.title, property: prop(w.propertyId), status: w.status })),
  };
}

// Questions the computed facts answer; their figures never come from model text.
export const isFactQuestion = (question: string) => [OVERDUE_Q, LEASE_Q, WORK_Q].some((r) => r.test(question));

// What a complete answer must mention for the question types the facts cover.
export function expectedMentions(question: string, s: DemoState): string[] {
  const q = question.toLowerCase();
  const f = portfolioFacts(s);
  // Names and the figures that go with them: an answer with the right names but wrong amounts or dates fails.
  const amt = (n: number) => n.toLocaleString("en-US");
  if (OVERDUE_Q.test(q)) return f.overdueRent.flatMap((r) => [r.tenant, amt(r.amount)]);
  if (LEASE_Q.test(q)) return f.leasesUpForRenewal.flatMap((r) => [r.tenant, r.leaseEnds]);
  if (WORK_Q.test(q)) return f.openWorkOrders.map((w) => w.id);
  return [];
}
