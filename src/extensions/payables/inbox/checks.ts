// Payables checks for a bill being entered or reviewed. Pure functions, used by the AP inbox (in
// the browser) and the bill's Review and Lines tabs (on the server), so both show the same result.
// Thresholds match the Payables Agent (src/ai/agents/payables.ts): 2.4× the vendor's median paid
// bill, a duplicate invoice number, and a bank change in the last 60 days that nobody verified.

export const ANOMALY_MULTIPLE = 2.4;
export const BANK_WINDOW_DAYS = 60;

export type VendorFacts = {
  id: string;
  company: string;
  trade: string;
  status: string;
  medianCents: number | null;        // median paid bill; null under 3 paid bills
  paidCount: number;
  usualGl: string | null;            // the GL account most of its bill lines post to
  usualGlShare: number;              // share of its lines on usualGl, 0–1
  bankLast4: string;
  bankChangedDays: number | null;    // days since bank details changed
  bankVerified: boolean;             // someone confirmed the change by phone after it happened
};

export type GlOption = { id: string; number: string; name: string; type: string };
export type DraftLine = { description: string; gl_account_id: string; amount_cents: number };
export type Check = { key: string; level: "ok" | "warn" | "stop"; label: string; detail: string };

// Trade → expected GL account number. Used when a vendor has little history.
const TRADE_GL: Record<string, string> = {
  Plumbing: "6000", HVAC: "6000", Electrical: "6000", Appliance: "6000", Locksmith: "6000", Roofing: "6000", Elevator: "6000",
  "Pest control": "6000", General: "6000", "General contractor": "6000", Supplies: "6000",
  Landscaping: "6100", Turn: "6050", Flooring: "6050", Pool: "6150", Trash: "6230", Insurance: "6400",
  "Property tax": "6500", Marketing: "6600", Payroll: "6700",
};

const glId = (number: string) => `gl-${number}`;
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function utilityGl(description: string): string {
  if (/electric|power|kwh/i.test(description)) return "6210";
  if (/\bgas\b|therm/i.test(description)) return "6220";
  if (/trash|waste|refuse/i.test(description)) return "6230";
  return "6200";
}

// Expected GL accounts for this vendor and line: its usual account from history, then its trade.
export function expectedGl(vendor: Pick<VendorFacts, "trade" | "usualGl" | "usualGlShare">, description = ""): string | null {
  if (vendor.trade === "Utilities") return glId(utilityGl(description));
  if (/\b(replace(ment)?|install(ation)?) (of )?(the )?(roof|hvac system|boiler|chiller|elevator)\b/i.test(description)) return glId("1500");
  if (vendor.usualGl && vendor.usualGlShare >= 0.6) return vendor.usualGl;
  const t = TRADE_GL[vendor.trade];
  return t ? glId(t) : vendor.usualGl;
}

export type GlProposal = { gl_account_id: string; why: string[]; confidence: number };

// Proposed coding for one line, with the reasons. Rules only, so the source is always "rules".
export function proposeGl(vendor: VendorFacts, description: string, gls: GlOption[]): GlProposal | null {
  const id = expectedGl(vendor, description);
  const gl = gls.find((g) => g.id === id);
  if (!id || !gl) return null;
  const why: string[] = [];
  let confidence = 0.6;
  if (vendor.trade === "Utilities") {
    why.push(`${vendor.company} is a utility; "${description}" reads as ${gl.name.toLowerCase()}`);
    confidence = 0.88;
  } else if (gl.number === "1500") {
    why.push(`"${description}" describes a replacement, which is capitalised as a building improvement`);
    confidence = 0.7;
  } else if (vendor.usualGl === id && vendor.usualGlShare >= 0.6) {
    why.push(`${Math.round(vendor.usualGlShare * 100)}% of ${vendor.company}'s past bill lines post to ${gl.number} ${gl.name}`);
    confidence = Math.min(0.97, 0.7 + vendor.usualGlShare * 0.25);
  }
  if (TRADE_GL[vendor.trade] === gl.number) {
    why.push(`${vendor.trade} work usually codes to ${gl.number} ${gl.name}`);
    confidence = Math.max(confidence, 0.78);
  }
  return { gl_account_id: id, why, confidence: Math.round(confidence * 100) / 100 };
}

export function runChecks(input: {
  vendor: VendorFacts | null;
  amountCents: number;
  lines: DraftLine[];
  duplicateOf?: { id: string; status: string } | null;  // existing bill with the same vendor + invoice number
  scannedTotalCents?: number | null;
  remitLast4?: string | null;                           // account the invoice asks to be paid into
  gls: GlOption[];
}): Check[] {
  const { vendor, amountCents, lines } = input;
  const out: Check[] = [];
  if (!vendor) return [{ key: "vendor", level: "warn", label: "Vendor not matched", detail: "Pick the vendor so its history and bank details can be checked." }];

  const changed = vendor.bankChangedDays != null && vendor.bankChangedDays <= BANK_WINDOW_DAYS && !vendor.bankVerified;
  const remitMismatch = !!input.remitLast4 && !!vendor.bankLast4 && input.remitLast4 !== vendor.bankLast4;
  if (changed || remitMismatch) {
    out.push({
      key: "bank", level: "stop", label: "Bank details changed — payment on hold",
      detail: changed
        ? `${vendor.company} changed bank details ${vendor.bankChangedDays} days ago and nobody has verified the change. Call the vendor on the phone number on file before approving.`
        : `The invoice asks for payment to an account ending ${input.remitLast4}; the account on file ends ${vendor.bankLast4}. Treat this as a bank change: verify by phone on the number on file, never the one on the invoice.`,
    });
  } else out.push({ key: "bank", level: "ok", label: "Bank details unchanged", detail: vendor.bankLast4 ? `Pays to the account on file ending ${vendor.bankLast4}.` : "No bank change on record." });

  if (vendor.status === "Do not use") out.push({ key: "status", level: "stop", label: "Vendor marked do not use", detail: `${vendor.company} is marked "Do not use".` });

  if (input.duplicateOf) {
    out.push({ key: "duplicate", level: "warn", label: "Possible duplicate invoice", detail: `${vendor.company} already billed this invoice number on ${input.duplicateOf.id} (${input.duplicateOf.status.toLowerCase()}). Void this one if it's a resend.` });
  } else out.push({ key: "duplicate", level: "ok", label: "No duplicate invoice number", detail: "No other bill from this vendor uses this invoice number." });

  if (vendor.medianCents && amountCents > vendor.medianCents * ANOMALY_MULTIPLE) {
    out.push({ key: "amount", level: "warn", label: `Amount is ${(amountCents / vendor.medianCents).toFixed(1)}× the usual`, detail: `${money(amountCents)} against a median of ${money(vendor.medianCents)} over ${vendor.paidCount} paid bills. Check the scope with whoever ordered the work.` });
  } else if (vendor.medianCents) {
    out.push({ key: "amount", level: "ok", label: "Amount in line with history", detail: `Median paid bill ${money(vendor.medianCents)} over ${vendor.paidCount} bills.` });
  } else out.push({ key: "amount", level: "ok", label: "Little history for this vendor", detail: "Fewer than 3 paid bills, so there's no median to compare against." });

  const linesTotal = lines.reduce((s, l) => s + l.amount_cents, 0);
  if (input.scannedTotalCents != null && Math.abs(input.scannedTotalCents - linesTotal) > 1) {
    out.push({ key: "total", level: "warn", label: "Lines don't add up to the invoice total", detail: `Invoice total ${money(input.scannedTotalCents)}, lines ${money(linesTotal)}.` });
  } else if (input.scannedTotalCents != null) out.push({ key: "total", level: "ok", label: "Lines match the invoice total", detail: `${money(linesTotal)}.` });

  const off = lines.filter((l) => {
    const exp = expectedGl(vendor, l.description);
    return exp && l.gl_account_id && l.gl_account_id !== exp && !(exp === "gl-1500" || l.gl_account_id === "gl-1500");
  });
  if (off.length) {
    const name = (id: string) => { const g = input.gls.find((x) => x.id === id); return g ? `${g.number} ${g.name}` : id; };
    out.push({ key: "gl", level: "warn", label: "GL coding looks off", detail: off.map((l) => `"${l.description}" is coded to ${name(l.gl_account_id)}; ${vendor.trade.toLowerCase()} work usually goes to ${name(expectedGl(vendor, l.description)!)}`).join(". ") + "." });
  } else if (lines.length) out.push({ key: "gl", level: "ok", label: "GL coding matches the vendor", detail: `Coded the way ${vendor.company}'s bills usually are.` });

  return out;
}

export const hardStop = (checks: Check[]) => checks.find((c) => c.level === "stop") ?? null;

export function median(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Scans the demo can show inline: bundled samples and images. Other stored paths (seeded
// /docs/invoices/*.pdf) have extracted fields but no file in this build.
export const viewableScan = (url: unknown): url is string => typeof url === "string" && /^\/(samples|img)\/[\w./-]+$/.test(url) && !url.includes("..");

// Extracted invoice fields as stored on documents.extracted, in either shape the app writes.
export function scannedTotalCents(extracted: unknown): number | null {
  if (!extracted || typeof extracted !== "object") return null;
  const e = extracted as { total?: unknown; total_cents?: unknown };
  if (typeof e.total === "number") return Math.round(e.total * 100);
  if (typeof e.total_cents === "number") return Math.round(e.total_cents);
  return null;
}
