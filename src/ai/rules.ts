import type { Facts, Row } from "@/entities/types";
import type { Delinquent, NoiExplanation } from "./facts";

// Pure rules the agents use and other modules reuse (scoring, triage, drafts, fixes, wording). This
// module imports types only, so importing it never loads the agent runtime (no import cycles).

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

export type Factor = { factor: string; direction: "+" | "-"; weight: number; detail: string };

// Score from income, credit, rental history and verification. Criminal history is never scored:
// it routes to an individualized review by a person (fair housing).
export function scoreApplicant(a: { monthly_income_cents: number | null; rent_cents: number; credit_band: string | null; eviction_found: number; criminal_flag: number; income_verified: number }) {
  const factors: Factor[] = [];
  const ratio = a.monthly_income_cents && a.rent_cents ? a.monthly_income_cents / a.rent_cents : 0;
  if (ratio >= 3) factors.push({ factor: "Income", direction: "+", weight: 30, detail: `Income is ${ratio.toFixed(1)}× the rent (3× required)` });
  else if (ratio >= 2.5) factors.push({ factor: "Income", direction: "+", weight: 15, detail: `Income is ${ratio.toFixed(1)}× the rent, a little under the 3× guideline` });
  else factors.push({ factor: "Income", direction: "-", weight: 15, detail: ratio ? `Income is only ${ratio.toFixed(1)}× the rent` : "No income reported" });
  const credit: Record<string, [number, string]> = { Excellent: [30, "Excellent credit"], Good: [22, "Good credit"], Fair: [10, "Fair credit"], "Thin file": [8, "Thin credit file (little history, not bad history)"], Poor: [-20, "Poor credit"] };
  const [w, label] = credit[a.credit_band ?? ""] ?? [0, "No credit result yet"];
  factors.push({ factor: "Credit", direction: w >= 0 ? "+" : "-", weight: Math.abs(w), detail: label });
  if (a.eviction_found) factors.push({ factor: "Rental history", direction: "-", weight: 30, detail: "Prior eviction on record" });
  else factors.push({ factor: "Rental history", direction: "+", weight: 15, detail: "No evictions found" });
  if (a.income_verified) factors.push({ factor: "Verification", direction: "+", weight: 10, detail: "Income verified with documents" });
  else factors.push({ factor: "Verification", direction: "-", weight: 10, detail: "Income not verified yet" });
  const score = Math.max(0, Math.min(100, 25 + factors.reduce((s, f) => s + (f.direction === "+" ? f.weight : -f.weight), 0)));
  const review = !!a.criminal_flag;
  const recommendation = review ? "Conditional" : score >= 75 ? "Approve" : score >= 55 ? "Conditional" : "Deny";
  return { score, factors, recommendation, review, ratio };
}

// Most specific first: a roof leak is roofing and a washer leak is the appliance, not plumbing.
const TRADES: [string, RegExp][] = [
  ["Roofing", /\b(roof\w*|shingle\w*|gutter\w*)\b/i],
  ["Appliance", /\b(fridge|refrigerator|dishwasher|oven|stove|range|washer|dryer|microwave)\b/i],
  ["Plumbing", /\b(leak\w*|drip\w*|toilet|faucet|drain|clog\w*|pipe|water heater|disposal|sewer|flood\w*)\b/i],
  ["HVAC", /\b(a\/?c|hvac|heat\w*|furnace|thermostat|cool\w*|condenser|air condition\w*)\b/i],
  ["Electrical", /\b(outlet|breaker|spark\w*|wiring|light\w*|power|electric\w*|gfci)\b/i],
  ["Pest control", /\b(roach\w*|mice|mouse|rodent\w*|ants|bed ?bugs?|pest\w*|termite\w*)\b/i],
  ["Locksmith", /\b(lock\w*|key\w*|deadbolt)\b/i],
];
const SAFETY = /\b(gas smell|smell\w* gas|gas leak|smoke|spark\w*|fire|carbon monoxide|co alarm|sewage|flood\w*|no heat)\b/i;
const URGENT = /\b(leak\w*|no (a\/?c|air|cool\w*|hot water|water)|not cooling|broken lock|won'?t lock|overflow\w*)\b/i;

export function triage(text: string, month: number) {
  const trade = TRADES.find(([, re]) => re.test(text))?.[0] ?? "General";
  const safety = SAFETY.test(text);
  const summerNoAc = trade === "HVAC" && month >= 5 && month <= 9 && /\b(no|not|isn'?t|won'?t)\b/i.test(text);
  const priority = safety ? "Emergency" : URGENT.test(text) || summerNoAc ? "Urgent" : "Normal";
  return { trade, priority, safety };
}

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// "2026-11-01" → "Nov 1" / "1 de noviembre", the way a person writes a date in a letter.
export function dateLabel(iso: string, language = "en") {
  const [, m, d] = iso.split("-").map(Number);
  return language === "es" ? `${d} de ${MONTHS_ES[m - 1]}` : `${new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d}`;
}

// Model drafts often write dates the way the data stores them; residents get letter-style dates.
// Applied to every draft before it is checked or sent: "2026-11-07" → "Nov 7, 2026".
export function letterDates(text: string, language = "en") {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso, y: string) => `${dateLabel(iso, language)}${language === "es" ? " de" : ","} ${y}`);
}

// Three payments that add up to the balance to the cent: two equal ones and a final one that takes
// the remainder.
export function planSplit(balance: number) {
  const each = Math.floor(balance / 3);
  return { installment_cents: each, final_installment_cents: balance - 2 * each };
}

const signOff = (d: Delinquent) =>
  d.language === "es"
    ? `\n\nAtentamente,\n${d.manager ? `${d.manager}, administración de ${d.property}` : `El equipo de ${d.property}`}`
    : `\n\nThanks,\n${d.manager ? `${d.manager}, Property Manager, ${d.property}` : `The ${d.property} team`}`;

export function reminder(d: Delinquent) {
  const first = d.resident.split(" ")[0];
  if (d.language === "es") {
    return {
      subject: `Recordatorio de pago, ${d.property} #${d.unit}`,
      body: `Hola ${first}, su cuenta en ${d.property} #${d.unit} tiene un saldo de ${money(d.balance_cents)}, vencido desde el ${dateLabel(d.oldest_due_on, "es")}. Puede pagar en el portal de residentes. Si ya pagó, ignore este mensaje. Si necesita hablar de un plan de pago, responda a este correo.${signOff(d)}`,
    };
  }
  return {
    subject: `Rent reminder, ${d.property} #${d.unit}`,
    body: `Hi ${first}, your account at ${d.property} #${d.unit} shows a balance of ${money(d.balance_cents)}, past due since ${dateLabel(d.oldest_due_on)}. You can pay in the resident portal. If you've already paid, please ignore this. If you'd like to talk about a payment plan, just reply.${signOff(d)}`,
  };
}

export function planMessage(d: Delinquent) {
  const first = d.resident.split(" ")[0];
  const { installment_cents: each, final_installment_cents: last } = planSplit(d.balance_cents);
  const en = each === last ? `three monthly payments of ${money(each)}` : `three monthly payments: two of ${money(each)} and a final one of ${money(last)}`;
  const es = each === last ? `tres pagos mensuales de ${money(each)}` : `tres pagos mensuales: dos de ${money(each)} y uno final de ${money(last)}`;
  if (d.language === "es") {
    return { subject: `Un plan de pagos para su saldo en ${d.property}`, body: `Hola ${first}, su saldo en ${d.property} #${d.unit} es de ${money(d.balance_cents)}. Podemos dividirlo en ${es}. Responda para organizarlo, o pague en el portal de residentes.${signOff(d)}` };
  }
  return { subject: `A payment plan for your balance at ${d.property}`, body: `Hi ${first}, your balance at ${d.property} #${d.unit} is ${money(d.balance_cents)}. We can split it into ${en}. Reply to set it up, or pay in the resident portal.${signOff(d)}` };
}

export function renewalRent(current: number, market: number | null) {
  if (!market || market <= current) return { rent: current, reason: market ? `Market rent ${money(market)} is at or below current rent; hold rent flat` : "No market rent on file; hold rent flat" };
  const capped = Math.min(market, Math.round((current * 1.05) / 500) * 500);
  return { rent: Math.max(current, capped), reason: `Market rent is ${money(market)}; move toward it, capped at +5%` };
}

const TRADE_GL: Record<string, RegExp> = {
  Plumbing: /repair|maintenance|plumb/i, HVAC: /repair|maintenance|hvac/i, Electrical: /repair|maintenance|electric/i,
  Landscaping: /landscap|grounds/i, Turn: /turn|make.?ready|repair/i, "Pest control": /pest|repair|maintenance/i,
};

export function billChecks(b: { amount_cents: number; median_cents: number | null; duplicates: number; bank_changed_days: number | null; gl_names: string[]; trade: string; extracted_total_cents: number | null }) {
  const issues: string[] = [];
  let fraud = false;
  if (b.bank_changed_days != null && b.bank_changed_days <= 60) {
    fraud = true;
    issues.push(`Vendor's bank details changed ${b.bank_changed_days} days ago with no verification on file`);
  }
  if (b.median_cents && b.amount_cents > b.median_cents * 2.4) issues.push(`Amount is ${(b.amount_cents / b.median_cents).toFixed(1)}× this vendor's median bill (${money(b.median_cents)})`);
  if (b.duplicates > 0) issues.push("Same invoice number already billed by this vendor");
  if (b.extracted_total_cents != null && Math.abs(b.extracted_total_cents - b.amount_cents) > 1) issues.push(`Scanned invoice total ${money(b.extracted_total_cents)} doesn't match the bill amount`);
  const re = TRADE_GL[b.trade];
  const miscoded = re ? b.gl_names.filter((g) => !re.test(g)) : [];
  if (miscoded.length) issues.push(`Coded to ${miscoded.join(", ")}, unusual for a ${b.trade.toLowerCase()} vendor`);
  return { issues, fraud, miscoded };
}

const SUFFIX: Record<string, string> = { STREET: "St", ST: "St", AVENUE: "Ave", AVE: "Ave", BOULEVARD: "Blvd", BLVD: "Blvd", DRIVE: "Dr", DR: "Dr", ROAD: "Rd", RD: "Rd", LANE: "Ln", LN: "Ln", PARKWAY: "Pkwy", PKWY: "Pkwy", COURT: "Ct", CT: "Ct", PLACE: "Pl", PL: "Pl", HIGHWAY: "Hwy", HWY: "Hwy", TRAIL: "Trl", CIRCLE: "Cir" };
const DIR: Record<string, string> = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", N: "N", S: "S", E: "E", W: "W" };

// USPS-style street line: title case, standard suffix and direction abbreviations, no trailing period.
export function normalizeStreet(s: string) {
  return s
    .replace(/[.,]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w, i, all) => {
      const u = w.toUpperCase();
      if (i === all.length - 1 && SUFFIX[u]) return SUFFIX[u];
      if (DIR[u] && (i === 1 || i === all.length - 1)) return DIR[u];
      if (/^\d/.test(w)) return u;
      return u.charAt(0) + u.slice(1).toLowerCase();
    })
    .join(" ");
}

const PHONE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;
export function phoneInEmail(email: string) {
  const m = email.trim().match(PHONE);
  return m ? { phone: `(${m[1]}) ${m[2]}-${m[3]}`, email: "" } : null;
}

const METRO_STATE: Record<string, string> = { Austin: "TX", Dallas: "TX", Atlanta: "GA", Phoenix: "AZ" };

// Fills a fix the rule didn't supply, from the record itself. Returns null when a person must decide.
export function computeFix(rule: string, row: Row): { changes: Record<string, unknown>; why: string[]; confidence: number } | null {
  if (rule === "properties.address_format" && typeof row.street === "string") {
    const street = normalizeStreet(row.street);
    return street !== row.street ? { changes: { street }, why: [`"${row.street}" → "${street}" (USPS style)`], confidence: 0.95 } : null;
  }
  if (rule === "residents.phone_in_email" && typeof row.email === "string") {
    const f = phoneInEmail(row.email);
    return f ? { changes: { phone: row.phone || f.phone, email: f.email }, why: [`The email field holds a phone number (${row.email}); move it to phone and ask the resident for an email`], confidence: 0.93 } : null;
  }
  if (rule === "properties.missing_zip_state" && !row.state && typeof row.metro === "string" && METRO_STATE[row.metro]) {
    return { changes: { state: METRO_STATE[row.metro] }, why: [`${row.metro} properties are in ${METRO_STATE[row.metro]}`], confidence: 0.9 };
  }
  if (rule === "leases.end_before_start" && typeof row.start_on === "string" && typeof row.end_on === "string" && row.end_on < row.start_on) {
    const months = Number(row.term_months ?? 12);
    const d = new Date(row.start_on + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(d.getUTCDate() - 1);
    return { changes: { end_on: d.toISOString().slice(0, 10) }, why: [`End date ${row.end_on} is before the start ${row.start_on}; set it to start + ${months} months`], confidence: 0.85 };
  }
  return null;
}

export function explainText(x: NoiExplanation) {
  const dir = x.noi_cents < x.prior_noi_cents ? "fell" : "rose";
  const top = x.drivers.filter((d) => d.delta_cents !== 0).slice(0, 3);
  const lines = top.map((d) => `${d.label} ${d.delta_cents < 0 ? "lowered" : "raised"} NOI by ${money(Math.abs(d.delta_cents))}`);
  const prop = x.by_property[0];
  const gl = x.expense_lines[0];
  return (
    `NOI ${dir} ${Math.abs(x.change_pct)}% in ${x.month}, from ${money(x.prior_noi_cents)} to ${money(x.noi_cents)}. ` +
    (lines.length ? `${lines.join("; ")}. ` : "") +
    (prop && prop.change_cents < 0 ? `${prop.property} moved most (${money(prop.change_cents)}). ` : "") +
    (gl && gl.delta_cents > 0 ? `The largest expense increase was ${gl.gl} (+${money(gl.delta_cents)}).` : "")
  ).trim();
}

// Dollar amounts in a draft, in cents: "$1,725" → 172500, "$12.50" → 1250.
export const amountsIn = (text: string) => [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "") + (m[2] ?? "")) * 100));
const APPROX = /\b(about|approximately|around|roughly|aproximadamente|alrededor de|unos)\s+\$/i;
const PROMISE = /\b(waiv\w*|forgiv\w*|no late fees?|won'?t (be )?charged?|guarantee\w*|cancel (your|the) (debt|balance))\b/i;

// Grader shared by the tool and the evals: figures in a draft must be figures from the facts, and a
// draft never promises a waiver.
export function checkDraft(body: string, facts: Record<string, unknown> | undefined): string[] {
  const problems: string[] = [];
  if (PROMISE.test(body)) problems.push("Drafts can't promise waivers, forgiveness or guarantees; a person decides those.");
  if (APPROX.test(body)) problems.push("Use the exact amount from the ledger, not an approximate one.");
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(body)) problems.push('Write dates the way a letter does ("Nov 1"), not as 2026-11-01.');
  const money = new Set(Object.entries(facts ?? {}).filter(([k]) => k.endsWith("_cents")).map(([, v]) => Number(v)));
  for (const a of amountsIn(body)) if (!money.has(a)) problems.push(`$${(a / 100).toFixed(2)} isn't in the record's figures (${[...money].map((m) => `$${(m / 100).toFixed(2)}`).join(", ") || "none"}).`);
  return problems;
}

// Numbers a summary may state: every number in the facts, as written and as dollars/cents.
export function unknownNumbers(text: string, facts: Facts): string[] {
  const allowed = new Set<number>();
  for (const v of Object.values(facts)) {
    if (typeof v === "number") [v, v / 100, v * 100, Math.round(v), Math.round(v * 10) / 10, Math.round(v * 100)].forEach((x) => allowed.add(Math.round(x * 100) / 100));
    if (typeof v === "string") for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(Number(m[0]));
  }
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const n = Number(m[0].replace(/[$,%]/g, ""));
    if (!Number.isFinite(n) || n < 10) continue; // small counts ("2 open work orders") are checked by the eval grader, not here
    if (![n, Math.round(n * 100) / 100].some((x) => allowed.has(x)) && !/^(19|20)\d\d$/.test(String(n))) out.push(m[0]);
  }
  return out;
}

// Where an AI proposal's content came from, for the AI badge: "live" = a model call made by a run,
// "rules" = no model, "precomputed" = written ahead of time (the seeded history). Runs record the
// source on the proposal (payload._source); older rows fall back to their model column.
export type AiSource = "live" | "precomputed" | "rules";
export function proposalSource(p: unknown): AiSource {
  if (p && typeof p === "object") {
    const o = p as { source?: unknown; payload?: unknown; model?: unknown };
    if (o.source === "live" || o.source === "rules" || o.source === "precomputed") return o.source;
    let payload = o.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    const s = (payload as { _source?: unknown } | null)?._source;
    if (s === "live" || s === "rules") return s;
    return proposalSource(o.model ?? null);
  }
  return !p || p === "rules" ? "rules" : "precomputed";
}
