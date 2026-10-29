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

  const key = (d: string) => d.split(",")[0].trim().toLowerCase();
  // Line items match on the text before the first comma, ignoring case ("Labor, 4 h @ $90" -> "labor"),
  // so a changed quantity shows up as a price mismatch rather than an extra item.
  for (const item of sub.items) {
    const onPo = wo.po.items.find((p) => key(p.description) === key(item.description));
    if (!onPo) issues.push(`Not on PO: ${item.description} (${money(item.amount)})`);
    else if (onPo.amount !== item.amount) issues.push(`${item.description}: ${money(item.amount)} billed vs ${money(onPo.amount)} on PO`);
    else matched.push(`${item.description}: ${money(item.amount)} matches PO`);
  }

  // Money invariants: an invoice must have lines, no negative amounts, and add up to its total.
  if (sub.items.length === 0) issues.push("Invoice has no line items");
  if (sub.total < 0 || sub.items.some((i) => i.amount < 0)) issues.push("Invoice contains negative amounts");
  const sum = sub.items.reduce((a, i) => a + i.amount, 0);
  if (sub.items.length && Math.abs(sum - sub.total) > Math.max(1, Math.abs(sub.total) * 0.01)) {
    issues.push(`Line items add up to ${money(sum)}, not the stated total ${money(sub.total)}`);
  }
  // Every PO item should be billed; a missing one usually means the wrong job or partial work.
  for (const p of wo.po.items) {
    if (!sub.items.some((i) => key(i.description) === key(p.description))) issues.push(`PO item not on invoice: ${p.description}`);
  }

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

export function mockAsk(question: string, s: DemoState): Omit<AskResult, "source" | "note"> {
  const q = question.toLowerCase();
  const name = (id: string) => s.users.find((u) => u.id === id)?.name ?? id;
  const prop = (id: string) => s.properties.find((p) => p.id === id)?.name ?? id;

  if (/(late|overdue|owe|arrear|unpaid)/.test(q)) {
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
  if (/(lease|renew|expir)/.test(q)) {
    const rows = s.tenancies
      .filter((t) => t.status === "Renewal due")
      .map((t) => `${name(t.tenantId)} (${prop(t.propertyId)} ${t.unit}): lease ends ${t.leaseEnd}, rent ${money(t.rent)}`);
    return {
      answer: rows.length ? `${rows.length} lease${rows.length > 1 ? "s" : ""} ending within 45 days:\n- ${rows.join("\n- ")}` : "No leases ending within 45 days.",
      suggestedActions: rows.length ? ["Send renewal offers at current rent", "Schedule a voice-call follow-up in 7 days if no reply"] : [],
    };
  }
  if (/(work order|vendor|repair|invoice|po\b|maintenance)/.test(q)) {
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

// What a complete answer must mention for the question types the facts cover.
export function expectedMentions(question: string, s: DemoState): string[] {
  const q = question.toLowerCase();
  const f = portfolioFacts(s);
  // Names and the figures that go with them: an answer with the right names but wrong amounts or dates fails.
  const amt = (n: number) => n.toLocaleString("en-US");
  if (/(late|overdue|owe|arrear|unpaid)/.test(q)) return f.overdueRent.flatMap((r) => [r.tenant, amt(r.amount)]);
  if (/(lease|renew|expir)/.test(q)) return f.leasesUpForRenewal.flatMap((r) => [r.tenant, r.leaseEnds]);
  if (/(work order|repair|maintenance)/.test(q)) return f.openWorkOrders.map((w) => w.id);
  return [];
}
