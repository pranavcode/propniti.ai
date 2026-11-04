// Pure maintenance rules: invoice-vs-PO validation (port of v1 mockValidate), photo checks,
// preventive-schedule dates, vendor ranking and the approval-policy check. No I/O, so they are
// unit-tested directly and shared by actions, tabs and pages.

export type Line = { description: string; amount_cents: number };
export type Validation = { decision: "approve" | "review"; confidence: number; matched: string[]; issues: string[]; summary: string };

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 });

// Lines group by their first word ("Labor: AC not cooling" and "Labor, 4 h" are both "labor"), so a
// vendor's wording can differ from the PO, but one invoice line can't stand in for several PO lines.
const groupKey = (d: string) => d.trim().toLowerCase().split(/[\s,:;(-]+/)[0] ?? "";

function group(lines: Line[]) {
  const m = new Map<string, { label: string; amount: number }>();
  for (const l of lines) {
    const k = groupKey(l.description);
    const g = m.get(k);
    m.set(k, { label: g?.label ?? l.description.split(/[,:]/)[0].trim(), amount: (g?.amount ?? 0) + l.amount_cents });
  }
  return m;
}

export function validateInvoice(po: { lines: Line[]; total_cents: number } | null, inv: { lines: Line[]; total_cents: number; photos: number }, photosRequired = 1): Validation {
  const matched: string[] = [];
  const issues: string[] = [];
  if (!po) {
    issues.push("No purchase order on this work order to compare against");
  } else {
    // Totals within 2% of the PO count as a match (rounding, small consumables).
    const diff = inv.total_cents - po.total_cents;
    if (Math.abs(diff) <= po.total_cents * 0.02) matched.push(`Invoice total ${usd(inv.total_cents)} matches PO total ${usd(po.total_cents)}`);
    else if (diff > 0) issues.push(`Invoice total ${usd(inv.total_cents)} is ${usd(diff)} (${po.total_cents ? Math.round((diff / po.total_cents) * 100) : 100}%) over PO total ${usd(po.total_cents)}`);
    else matched.push(`Invoice total ${usd(inv.total_cents)} is under PO total ${usd(po.total_cents)}`);
    const pg = group(po.lines);
    const ig = group(inv.lines);
    for (const [k, g] of ig) {
      const p = pg.get(k);
      if (!p) issues.push(`Not on PO: ${g.label} (${usd(g.amount)})`);
      else if (g.amount > p.amount * 1.02) issues.push(`${g.label}: ${usd(g.amount)} billed vs ${usd(p.amount)} on PO`);
      else matched.push(`${g.label}: ${usd(g.amount)} within PO (${usd(p.amount)})`);
    }
    for (const [k, g] of pg) if (!ig.has(k)) matched.push(`PO line not billed: ${g.label}`);
  }
  if (!inv.lines.length) issues.push("Invoice has no line items");
  if (inv.total_cents <= 0 || inv.lines.some((l) => l.amount_cents < 0)) issues.push("Invoice contains zero or negative amounts");
  const sum = inv.lines.reduce((a, l) => a + l.amount_cents, 0);
  if (inv.lines.length && sum !== inv.total_cents) issues.push(`Line items add up to ${usd(sum)}, not the stated total ${usd(inv.total_cents)}`);
  if (inv.photos >= photosRequired) matched.push(`${inv.photos} photo${inv.photos === 1 ? "" : "s"} on file before the invoice (${photosRequired} required)`);
  else issues.push(`Only ${inv.photos} of ${photosRequired} required photos were on file before the invoice`);
  // No issues = high confidence; each issue drops it 0.2, floor 0.2.
  const confidence = issues.length === 0 ? 0.97 : Math.max(0.2, Math.round((0.85 - 0.2 * issues.length) * 100) / 100);
  return {
    decision: issues.length ? "review" : "approve",
    confidence,
    matched,
    issues,
    summary: issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""} against the purchase order. Review before paying.` : "Invoice, lines and photos match the purchase order.",
  };
}

// Seeded "before" photos are /img/wo/wo-<tag>.webp; the tag says what the photo shows.
export const PHOTO_TAGS: Record<string, { label: string; categories: string[] }> = {
  leak: { label: "Water leak", categories: ["Plumbing", "Roofing"] },
  toilet: { label: "Toilet", categories: ["Plumbing"] },
  disposal: { label: "Garbage disposal", categories: ["Plumbing", "Appliance"] },
  "water-heater": { label: "Water heater", categories: ["Plumbing"] },
  hvac: { label: "HVAC unit", categories: ["HVAC"] },
  electrical: { label: "Electrical panel or outlet", categories: ["Electrical"] },
  appliance: { label: "Appliance", categories: ["Appliance"] },
  door: { label: "Door and lock", categories: ["General", "Locksmith", "Access"] },
  window: { label: "Window", categories: ["General"] },
  mold: { label: "Mold", categories: ["General", "Plumbing"] },
  carpet: { label: "Carpet", categories: ["General", "Flooring", "Turn"] },
  fence: { label: "Fence", categories: ["Grounds", "General"] },
  parking: { label: "Parking lot", categories: ["Grounds", "General", "Electrical"] },
  gate: { label: "Vehicle gate", categories: ["Access", "General"] },
  roof: { label: "Roof", categories: ["Roofing"] },
  "pool-pump": { label: "Pool equipment", categories: ["Pool"] },
};
export const photoTag = (url: string) => url.match(/\/wo-([a-z-]+?)(?:-400)?\.webp$/)?.[1] ?? null;

export type PhotoCheck = { result: "Matches" | "Mismatch" | "Unclear"; confidence: number; note: string };

// Does the photo show what the work order describes? Rules over the photo's known subject; a
// mismatch goes to a person rather than blocking anything.
export function checkPhoto(url: string, category: string, title = ""): PhotoCheck {
  const tag = photoTag(url);
  const t = tag ? PHOTO_TAGS[tag] : undefined;
  if (!t) return { result: "Unclear", confidence: 0.55, note: "The photo's subject isn't one the check recognises. A person should look at it." };
  if (t.categories.includes(category)) return { result: "Matches", confidence: t.categories[0] === category ? 0.93 : 0.84, note: `${t.label} fits a ${category.toLowerCase()} job.` };
  const words = title.toLowerCase();
  if (words.includes(tag!.split("-")[0])) return { result: "Matches", confidence: 0.78, note: `${t.label} matches the title, though the trade is ${category.toLowerCase()}.` };
  return { result: "Mismatch", confidence: 0.81, note: `Shows a ${t.label.toLowerCase()}, but this is a ${category.toLowerCase()} job. Check it's the right photo.` };
}

// Preventive schedules: the next n due dates from next_due_on.
const STEP_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Semiannual: 6, Annual: 12 };
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
export const nextDue = (date: string, frequency: string) => addMonths(date, STEP_MONTHS[frequency] ?? 12);
export function upcoming(from: string, frequency: string, n: number) {
  const out = [from];
  while (out.length < n) out.push(nextDue(out[out.length - 1], frequency));
  return out;
}

// Same scoring the Maintenance Triage Agent uses (rating × 20 − 5 per open job), so the ranked
// list and the agent's pick agree. Vendors without a valid COI are never dispatchable.
export const vendorScore = (rating: number | null, openJobs: number) => Number(rating ?? 3) * 20 - openJobs * 5;

export type Policy = { limit_cents: number | null; owner_approval_over_cents: number | null; approver_role: string };
export type PolicyCheck = { level: "auto" | "approver" | "owner"; text: string };
export function policyCheck(amount: number, p: Policy | null): PolicyCheck {
  if (!p) return { level: "approver", text: "No maintenance spend policy is set, so a person approves this." };
  if (p.owner_approval_over_cents != null && amount > p.owner_approval_over_cents) return { level: "owner", text: `${usd(amount)} is over the owner's ${usd(p.owner_approval_over_cents)} approval limit. The owner approves before work starts.` };
  if (p.limit_cents != null && amount <= p.limit_cents) return { level: "auto", text: `${usd(amount)} is within the ${usd(p.limit_cents)} auto-approve limit.` };
  return { level: "approver", text: `${usd(amount)} is over the ${usd(p.limit_cents ?? 0)} auto-approve limit. A ${p.approver_role.replace(/_/g, " ")} approves.` };
}

export const AGE_BUCKETS = ["0–2 days", "3–7 days", "8–14 days", "15–30 days", "30+ days"] as const;
export const ageBucket = (days: number) => (days <= 2 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 3 : 4);
