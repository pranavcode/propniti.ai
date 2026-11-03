// Pure rules for the residents lane: contact normalisation, duplicate merge, the signed lease
// text and its rule-based abstraction, and comparing abstracted terms with the lease record.
// No database or model calls here, so it is unit-tested directly (lib.test.ts).

export type Contact = { first_name: string; last_name: string; email: string; phone: string };

const PHONE = /^\+?1?[\s.-]*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const formatPhone = (raw: string) => {
  const m = raw.trim().match(PHONE);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null;
};

const titleCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s);

export type ContactChange = { field: keyof Contact; before: string; after: string; why: string };

// Fixes the contact mistakes imports and hand entry make: a phone in the email field, phones in
// mixed formats, upper-case emails, ALL-CAPS or all-lower names, stray spaces.
export function normalizeContact(c: Contact): ContactChange[] {
  const out: ContactChange[] = [];
  const add = (field: keyof Contact, after: string, why: string) => {
    if (after !== c[field]) out.push({ field, before: c[field], after, why });
  };
  const emailAsPhone = formatPhone(c.email);
  const phone = formatPhone(c.phone);
  if (emailAsPhone) {
    add("email", "", "The email field holds a phone number, not an address.");
    if (!phone) add("phone", emailAsPhone, "Moved the number from the email field into phone.");
    else if (phone !== emailAsPhone) out.push({ field: "phone", before: c.phone, after: phone, why: `Kept the phone on file; the email field had a different number (${emailAsPhone}), so check with the resident.` });
  } else {
    const email = c.email.trim().toLowerCase();
    if (email && EMAIL.test(email)) add("email", email, "Emails are stored trimmed and lower-case.");
  }
  if (phone && !emailAsPhone) add("phone", phone, "Phones are stored as (555) 555-5555.");
  add("first_name", titleCase(c.first_name.trim().replace(/\s+/g, " ")), "Names are stored in title case without extra spaces.");
  add("last_name", titleCase(c.last_name.trim().replace(/\s+/g, " ")), "Names are stored in title case without extra spaces.");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Duplicate residents
// ---------------------------------------------------------------------------------------------

export const MERGE_FIELDS = ["first_name", "last_name", "email", "phone", "preferred_channel", "language", "autopay"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeChoice = Record<MergeField, "keep" | "duplicate">;

// Which side to keep per field: the kept record wins unless the duplicate has a value where it
// has none, or the kept value fails a basic format check that the duplicate's passes.
export function suggestMerge(keep: Record<string, unknown>, dup: Record<string, unknown>): { choice: MergeChoice; why: string[]; confidence: number } {
  const choice = Object.fromEntries(MERGE_FIELDS.map((f) => [f, "keep"])) as MergeChoice;
  const why: string[] = [];
  const empty = (v: unknown) => v == null || String(v).trim() === "";
  for (const f of MERGE_FIELDS) {
    if (empty(keep[f]) && !empty(dup[f])) {
      choice[f] = "duplicate";
      why.push(`${label(f)}: only the duplicate has one.`);
    }
  }
  if (!EMAIL.test(String(keep.email ?? "")) && EMAIL.test(String(dup.email ?? ""))) {
    choice.email = "duplicate";
    why.push("Email: the kept record's email isn't a valid address.");
  }
  for (const f of ["first_name", "last_name"] as const) {
    const k = String(keep[f] ?? ""), d = String(dup[f] ?? "");
    if (k === k.toUpperCase() && d !== d.toUpperCase() && k.toLowerCase() === d.toLowerCase()) {
      choice[f] = "duplicate";
      why.push(`${label(f)}: the duplicate has the proper capitalisation.`);
    }
  }
  const samePhone = !empty(keep.phone) && formatPhone(String(keep.phone)) === formatPhone(String(dup.phone ?? ""));
  const sameHousehold = keep.household_id != null && keep.household_id === dup.household_id;
  const nameDistance = editDistance(`${keep.first_name} ${keep.last_name}`.toLowerCase(), `${dup.first_name} ${dup.last_name}`.toLowerCase());
  const reasons = [samePhone && "same phone number", sameHousehold && "same household", nameDistance <= 3 && "names differ by at most 3 letters"].filter(Boolean) as string[];
  const confidence = Math.min(0.98, 0.4 + (samePhone ? 0.3 : 0) + (sameHousehold ? 0.2 : 0) + (nameDistance <= 3 ? 0.1 : 0));
  return { choice, why: [`Likely the same person: ${reasons.join(", ") || "few matching details"}.`, ...why, "Everything else keeps the older record's value."], confidence };
}

const label = (f: string) => f.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ---------------------------------------------------------------------------------------------
// Lease documents and abstraction
// ---------------------------------------------------------------------------------------------

export type LeaseRecord = {
  id: string; kind: string; property: string; address?: string | null; unit: string; tenant: string; residents: string[];
  start_on: string; end_on: string | null; term_months: number | null; rent_cents: number; deposit_cents: number; market_rent_cents: number | null;
  escalations: { on: string; pct?: number; amount_cents?: number }[]; nnn_share_pct: number | null; cam_cents: number | null; tax_cents: number | null; insurance_cents: number | null;
  signed_at?: string | null;
};

export const ABSTRACT_FIELDS = {
  tenant: "Tenant",
  premises: "Premises",
  start_on: "Commencement date",
  end_on: "Expiration date",
  term_months: "Term (months)",
  rent_cents: "Monthly base rent",
  deposit_cents: "Security deposit",
  late_fee: "Late fee",
  escalations: "Rent escalations",
  nnn_share_pct: "Pro-rata share",
  cam_cents: "CAM estimate (monthly)",
  renewal_option: "Renewal option",
} as const;
export type AbstractKey = keyof typeof ABSTRACT_FIELDS;
export type Extracted = { key: AbstractKey; value: string | number | null; page: number; quote: string };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// The lease as it was signed. Records with planted data-entry errors (rent keyed 10x, an end date
// before the start) differ from it, which is what abstraction is meant to catch.
export function signedTerms(l: LeaseRecord) {
  const typo = l.market_rent_cents && l.rent_cents > l.market_rent_cents * 5 && l.rent_cents % 10 === 0;
  const rent = typo ? l.rent_cents / 10 : l.rent_cents;
  const term = l.term_months ?? 12;
  if (l.end_on && l.end_on < l.start_on) {
    // Dates keyed in the wrong fields: swapped back, they span the lease term.
    const months = (Number(l.start_on.slice(0, 4)) - Number(l.end_on.slice(0, 4))) * 12 + Number(l.start_on.slice(5, 7)) - Number(l.end_on.slice(5, 7));
    if (Math.abs(months - term) <= 1) return { rent, start: l.end_on, end: l.start_on, term };
  }
  const end = !l.end_on || l.end_on < l.start_on ? addMonths(l.start_on, term) : l.end_on;
  return { rent, start: l.start_on, end, term };
}

export function leaseDocument(l: LeaseRecord): string[] {
  const t = signedTerms(l);
  const commercial = l.kind === "Commercial";
  const party = commercial ? "Tenant" : "Resident";
  const p1 = [
    `${commercial ? "COMMERCIAL LEASE AGREEMENT (TRIPLE NET)" : "RESIDENTIAL LEASE AGREEMENT"}`,
    `Lease No. ${l.id}`,
    ``,
    `1. PARTIES. This lease is made between ${l.property} Owner LLC ("Landlord") and the following ${party.toLowerCase()}(s):`,
    `Tenant: ${l.tenant}`,
    ...(l.residents.length > 1 ? [`Occupants: ${l.residents.join(", ")}`] : []),
    ``,
    `2. PREMISES. Landlord leases to ${party} the premises known as:`,
    `Premises: ${/^[A-Za-z]/.test(l.unit) ? l.unit : `${commercial ? "Suite" : "Unit"} ${l.unit}`}, ${l.property}${l.address ? `, ${l.address}` : ""}`,
    ``,
    `3. TERM. The term of this lease is ${t.term} months.`,
    `Term: ${t.term} months`,
    `Commencement Date: ${longDate(t.start)}`,
    `Expiration Date: ${longDate(t.end)}`,
  ];
  const p2 = [
    `4. RENT. ${party} shall pay monthly base rent in advance on the first day of each month.`,
    `Monthly Base Rent: ${usd(t.rent)}`,
    `Rent is late after the 3rd day of the month.`,
    `Late Fee: ${commercial ? "5% of the unpaid amount" : "$75.00 plus $10.00 per day, capped at 10% of monthly rent"}`,
    ``,
    `5. SECURITY DEPOSIT. ${party} has paid a security deposit, held in trust and returned within 30 days of move-out less lawful deductions.`,
    `Security Deposit: ${usd(l.deposit_cents)}`,
  ];
  if (l.escalations.length) {
    p2.push(``, `6. RENT ADJUSTMENTS. Base rent increases on each date below:`);
    for (const e of l.escalations) p2.push(`Escalation: ${longDate(e.on)}, ${e.pct != null ? `${e.pct}% increase` : `${usd(e.amount_cents ?? 0)} increase`}`);
  }
  const pages = [p1, p2];
  if (commercial) {
    pages.push([
      `7. OPERATING EXPENSES (NNN). ${party} pays its pro-rata share of common area maintenance, real estate taxes and insurance, billed monthly on estimates and reconciled after year end.`,
      `Pro-Rata Share: ${l.nnn_share_pct ?? 0}%`,
      `CAM Estimate (monthly): ${usd(l.cam_cents ?? 0)}`,
      `Tax Estimate (monthly): ${usd(l.tax_cents ?? 0)}`,
      `Insurance Estimate (monthly): ${usd(l.insurance_cents ?? 0)}`,
      ``,
      `8. RENEWAL OPTION. ${party} may renew for one additional term of 60 months on 180 days' written notice, at 95% of then-prevailing market rent.`,
      `Renewal Option: One 60-month option, 180 days' notice`,
    ]);
  } else {
    pages.push([
      `7. UTILITIES. Resident pays electricity and internet. Water, sewer and trash are billed monthly by ratio (RUBS).`,
      `8. PETS. No animals without a signed pet addendum.`,
      `9. RENEWAL. Landlord will offer renewal terms at least 60 days before the Expiration Date. Without a signed renewal the lease continues month-to-month at market rent plus a month-to-month premium.`,
      `Renewal Option: Renewal offer 60 days before expiration; otherwise month-to-month`,
    ]);
  }
  pages.push([
    `SIGNATURES`,
    `Landlord: ${l.property} Owner LLC, by its managing agent`,
    `${party}: ${l.tenant}`,
    `Signed: ${l.signed_at ? longDate(l.signed_at.slice(0, 10)) : longDate(t.start)}`,
  ]);
  return pages.map((p) => p.join("\n"));
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const isoOf = (s: string) => {
  const m = s.match(new RegExp(`(${MONTHS}) (\\d{1,2}), (\\d{4})`));
  if (!m) return null;
  const mo = MONTHS.split("|").indexOf(m[1]) + 1;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
const centsOf = (s: string) => {
  const m = s.match(/\$([\d,]+(?:\.\d{2})?)/);
  return m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null;
};

// Rule-based abstraction: reads the labelled lines of a lease ("Monthly Base Rent: $1,400.00").
// Used when no model is configured; the UI labels it as rules.
export function abstractByRules(pages: string[]): Extracted[] {
  const out: Extracted[] = [];
  const escalations: string[] = [];
  let escPage = 0, escQuote = "";
  pages.forEach((text, i) => {
    for (const line of text.split("\n")) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (!v) continue;
      const page = i + 1;
      const add = (key: AbstractKey, value: string | number | null) => !out.some((o) => o.key === key) && out.push({ key, value, page, quote: line.trim() });
      switch (k.trim().toLowerCase()) {
        case "tenant": add("tenant", v); break;
        case "premises": add("premises", v); break;
        case "term": add("term_months", Number(v.match(/\d+/)?.[0] ?? NaN) || null); break;
        case "commencement date": add("start_on", isoOf(v)); break;
        case "expiration date": add("end_on", isoOf(v)); break;
        case "monthly base rent": add("rent_cents", centsOf(v)); break;
        case "security deposit": add("deposit_cents", centsOf(v)); break;
        case "late fee": add("late_fee", v); break;
        case "pro-rata share": add("nnn_share_pct", Number(v.replace("%", "")) || null); break;
        case "cam estimate (monthly)": add("cam_cents", centsOf(v)); break;
        case "renewal option": add("renewal_option", v); break;
        case "escalation":
          if (!escalations.length) { escPage = page; escQuote = line.trim(); }
          escalations.push(v);
          break;
      }
    }
  });
  if (escalations.length) out.push({ key: "escalations", value: escalations.join("; "), page: escPage, quote: escQuote + (escalations.length > 1 ? ` (+${escalations.length - 1} more)` : "") });
  return out;
}

// Fields the record stores, compared with what the document says. Text fields (tenant, late fee,
// renewal option) are shown but not compared: the record doesn't hold them in the same form.
export type Comparison = { key: AbstractKey; label: string; document: string | number | null; record: string | number | null; column?: string; match: boolean | null; page: number; quote: string };

export function compareAbstract(ex: Extracted[], l: LeaseRecord): Comparison[] {
  const rec: Partial<Record<AbstractKey, [string | number | null, string]>> = {
    start_on: [l.start_on, "start_on"],
    end_on: [l.end_on, "end_on"],
    term_months: [l.term_months, "term_months"],
    rent_cents: [l.rent_cents, "rent_cents"],
    deposit_cents: [l.deposit_cents, "deposit_cents"],
  };
  if (l.kind === "Commercial") {
    rec.nnn_share_pct = [l.nnn_share_pct, "nnn_share_pct"];
    rec.cam_cents = [l.cam_cents, "cam_cents"];
  }
  return ex.map((e) => {
    const r = rec[e.key];
    const same = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Math.abs(Number(a) - Number(b)) < 0.005 : String(a ?? "") === String(b ?? ""));
    return { key: e.key, label: ABSTRACT_FIELDS[e.key], document: e.value, record: r ? r[0] : null, column: r?.[1], match: r ? e.value != null && same(e.value, r[0]) : null, page: e.page, quote: e.quote };
  });
}

// Merge fields in templates: {{first_name}}, {{balance}}… Unknown fields are left visible so a
// person sees what wasn't filled before sending.
export function fillTemplate(body: string, vars: Record<string, string | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}
