import { z } from "zod";

// The NL report builder's query spec. The model (or the rules parser) only fills this object;
// validateSpec() keeps what the registry allows and reports the rest. SQL is built from the
// registry in run.ts, never from model text. Pure: no database, no server imports.

export const FIRST_MONTH = "2025-05";
export const METROS = ["Austin", "Dallas", "Atlanta", "Phoenix"] as const;

export type GroupBy = "property" | "metro" | "gl" | "month" | "vendor";
export type Compare = "none" | "budget" | "prior_year";
export type ChartKind = "bar" | "line" | "hbar" | "table";
export type Source = "journal" | "metrics" | "transfers";

export type Measure = {
  key: string;
  label: string;
  source: Source;
  // journal: GL types or numbers; metrics: the metrics_monthly column; transfers: vendor payouts.
  types?: ("Income" | "Expense")[];
  gls?: string[];
  column?: string;
  stock?: boolean;                       // a month-end balance: summed per month, never across months
  groupBy: GroupBy[];
  compare: Compare[];
  goodWhen: "up" | "down";
  keywords: RegExp;
};

// Order matters for the rules parser: specific measures before general ones.
export const MEASURES: Measure[] = [
  { key: "utilities", label: "Utilities expense", source: "journal", gls: ["6200", "6210", "6220", "6230"], groupBy: ["property", "metro", "gl", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "down", keywords: /\butilit|\bwater\b|\belectric|\bgas\b|\btrash\b/i },
  { key: "repairs", label: "Repairs and turnover", source: "journal", gls: ["6000", "6050"], groupBy: ["property", "metro", "gl", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "down", keywords: /\brepair|\bmaintenance\b|\bmake.?ready|\bturnover/i },
  { key: "landscaping", label: "Landscaping", source: "journal", gls: ["6100"], groupBy: ["property", "metro", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "down", keywords: /\blandscap|\bgrounds\b/i },
  { key: "bills_paid", label: "Paid to vendors", source: "transfers", groupBy: ["property", "metro", "month", "vendor"], compare: ["none", "prior_year"], goodWhen: "down", keywords: /\bbills? paid|\bvendor (spend|payments?)|\bpaid to vendors|\bpayments? to vendors|\bby vendor\b|\bvendors?\b/i },
  { key: "noi", label: "Net operating income", source: "journal", types: ["Income", "Expense"], groupBy: ["property", "metro", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "up", keywords: /\bnoi\b|\bnet operating/i },
  { key: "collections", label: "Rent collected", source: "metrics", column: "collected_cents", groupBy: ["property", "metro", "month"], compare: ["none", "prior_year"], goodWhen: "up", keywords: /\bcollect/i },
  { key: "delinquency", label: "Delinquent balances", source: "metrics", column: "aging_0_30_cents + aging_31_60_cents + aging_61_90_cents + aging_90p_cents", stock: true, groupBy: ["property", "metro", "month"], compare: ["none", "prior_year"], goodWhen: "down", keywords: /\bdelinquen|\bpast due\b|\barrears|\baging\b/i },
  { key: "vacancy_loss", label: "Vacancy loss", source: "metrics", column: "vacancy_loss_cents", groupBy: ["property", "metro", "month"], compare: ["none", "prior_year"], goodWhen: "down", keywords: /\bvacancy/i },
  { key: "rent", label: "Rental income", source: "journal", gls: ["4000", "4010"], groupBy: ["property", "metro", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "up", keywords: /\brent(al)? (income|revenue)\b|\brents?\b/i },
  { key: "income", label: "Total income", source: "journal", types: ["Income"], groupBy: ["property", "metro", "gl", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "up", keywords: /\bincome\b|\brevenue\b/i },
  { key: "expense", label: "Operating expense", source: "journal", types: ["Expense"], groupBy: ["property", "metro", "gl", "month"], compare: ["none", "budget", "prior_year"], goodWhen: "down", keywords: /\bexpense|\bopex\b|\bspend|\bcosts?\b/i },
];
export const measureOf = (key: string) => MEASURES.find((m) => m.key === key);

export const GROUP_LABEL: Record<GroupBy, string> = { property: "Property", metro: "Metro", gl: "GL account", month: "Month", vendor: "Vendor" };
export const COMPARE_LABEL: Record<Compare, string> = { none: "", budget: "Budget", prior_year: "Prior year" };

// The period as a type, never as dates: resolvePeriod() turns it into months from the demo
// clock's last closed month, so "last 12 months" or "Q3" can't drift with the model.
export const PERIOD_KINDS = ["last_month", "last_quarter", "quarter", "ytd", "trailing", "year", "range"] as const;
export const PeriodSchema = z.object({
  kind: z.enum(PERIOD_KINDS).nullable(),
  quarter: z.number().int().nullable(),          // quarter: 1–4
  year: z.number().int().nullable(),             // quarter, year, range: only when the person names a year
  months: z.number().int().nullable(),           // trailing: how many months (12 for "last 12 months", "T12")
  startMonth: z.number().int().nullable(),       // range: 1–12
  endMonth: z.number().int().nullable(),         // range: 1–12
});
export type Period = z.infer<typeof PeriodSchema>;
export const NO_PERIOD: Period = { kind: null, quarter: null, year: null, months: null, startMonth: null, endMonth: null };

const mm = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

// Months for a period type. A quarter or month range with no year means the latest one that has
// closed; anything without a type is the trailing 12 closed months.
export function resolvePeriod(p: Period, lastClosed: string): { from: string; to: string; note?: string } {
  const ly = Number(lastClosed.slice(0, 4));
  const lm = Number(lastClosed.slice(5));
  const clampN = (n: number | null, d: number) => Math.max(1, Math.min(24, n ?? d));
  switch (p.kind) {
    case "last_month": return { from: lastClosed, to: lastClosed };
    case "last_quarter": {
      const q = Math.floor(lm / 3);
      const to = q === 0 ? mm(ly - 1, 12) : mm(ly, q * 3);
      return { from: addMonths(to, -2), to };
    }
    case "quarter": {
      const q = Math.min(4, Math.max(1, p.quarter ?? 1));
      let y = p.year ?? ly;
      if (!p.year && mm(y, q * 3) > lastClosed) y -= 1;
      return { from: mm(y, q * 3 - 2), to: mm(y, q * 3) };
    }
    case "ytd": return { from: mm(ly, 1), to: lastClosed };
    case "trailing": { const n = clampN(p.months, 12); return { from: addMonths(lastClosed, -(n - 1)), to: lastClosed }; }
    case "year": { const y = p.year ?? ly; return { from: mm(y, 1), to: mm(y, 12) }; }
    case "range": {
      const a = Math.min(12, Math.max(1, p.startMonth ?? 1));
      const b = Math.min(12, Math.max(1, p.endMonth ?? a));
      let y = p.year ?? ly;
      if (!p.year && mm(y, b) > lastClosed) y -= 1;
      return a <= b ? { from: mm(y, a), to: mm(y, b) } : { from: mm(y - 1, a), to: mm(y, b) };
    }
    default: return { from: addMonths(lastClosed, -11), to: lastClosed };
  }
}

// What the model returns. Loose on purpose: validateSpec() decides what survives.
export const RawSpecSchema = z.object({
  measure: z.string(),
  groupBy: z.string().nullable(),
  period: PeriodSchema.nullable(),
  compareTo: z.string().nullable(),
  properties: z.array(z.string()).nullable(),
  metros: z.array(z.string()).nullable(),
  chart: z.string().nullable(),
  title: z.string().nullable(),
});
export type RawSpec = z.infer<typeof RawSpecSchema>;

export type QuerySpec = { measure: string; groupBy: GroupBy; from: string; to: string; compareTo: Compare; properties: string[]; metros: string[]; chart: ChartKind; title: string };
export type ScopeProperty = { id: string; name: string; metro: string };

export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
export const monthsBetween = (from: string, to: string) => {
  const [a, b] = [from, to].map((s) => s.split("-").map(Number));
  return (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1;
};
const monthLabel = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
export const periodLabel = (from: string, to: string) => (from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`);

export function describeSpec(s: QuerySpec, props: ScopeProperty[] = []): string {
  const m = measureOf(s.measure)!;
  const where = [
    s.properties.length ? props.filter((p) => s.properties.includes(p.id)).map((p) => p.name).join(", ") || `${s.properties.length} properties` : "",
    s.metros.length ? s.metros.join(", ") : "",
  ].filter(Boolean).join("; ");
  return `${m.label} by ${GROUP_LABEL[s.groupBy].toLowerCase()}, ${periodLabel(s.from, s.to)}${where ? `, ${where}` : ""}${s.compareTo !== "none" ? `, vs ${COMPARE_LABEL[s.compareTo].toLowerCase()}` : ""}`;
}

// Keeps only what the registry and the person's scope allow; returns the spec and what was dropped.
// lastClosed: the last closed month (the month before meta.as_of), passed in by the caller.
export function validateSpec(raw: RawSpec, scope: ScopeProperty[], lastClosed: string): { spec: QuerySpec; dropped: string[] } {
  const dropped: string[] = [];
  let m = measureOf(raw.measure);
  if (!m) {
    dropped.push(`"${raw.measure}" isn't a report measure; showing operating expense`);
    m = measureOf("expense")!;
  }
  let groupBy = (raw.groupBy ?? m.groupBy[0]) as GroupBy;
  if (!m.groupBy.includes(groupBy)) {
    if (raw.groupBy) dropped.push(`${m.label} can't be grouped by ${raw.groupBy}`);
    groupBy = m.groupBy[0];
  }
  let compareTo = (raw.compareTo ?? "none") as Compare;
  if (!m.compare.includes(compareTo)) {
    dropped.push(`${m.label} has no ${String(raw.compareTo).replace("_", " ")} to compare with`);
    compareTo = "none";
  }
  let { from, to } = resolvePeriod(raw.period ?? NO_PERIOD, lastClosed);
  if (to > lastClosed) { to = lastClosed; dropped.push(`Books are closed through ${monthLabel(lastClosed)}`); }
  if (from < FIRST_MONTH) { from = FIRST_MONTH; dropped.push(`History starts ${monthLabel(FIRST_MONTH)}`); }
  if (from > to) from = to;
  if (monthsBetween(from, to) > 24) { from = addMonths(to, -23); dropped.push("Limited to 24 months"); }
  if (compareTo === "prior_year" && addMonths(from, -12) < FIRST_MONTH) dropped.push(`Prior-year figures before ${monthLabel(FIRST_MONTH)} aren't available, so some months compare with nothing`);
  const ids = new Set(scope.map((p) => p.id));
  const properties = (raw.properties ?? []).filter((id) => ids.has(id));
  for (const id of raw.properties ?? []) if (!ids.has(id)) dropped.push(`Property ${id} is outside your scope`);
  const metros = (raw.metros ?? []).map((x) => METROS.find((mm) => mm.toLowerCase() === x.toLowerCase())).filter((x): x is (typeof METROS)[number] => !!x);
  for (const x of raw.metros ?? []) if (!METROS.some((mm) => mm.toLowerCase() === x.toLowerCase())) dropped.push(`No metro called "${x}"`);
  const chartRaw = raw.chart as ChartKind | null;
  const chart: ChartKind = chartRaw && ["bar", "line", "hbar", "table"].includes(chartRaw) ? (groupBy === "month" && chartRaw === "hbar" ? "line" : chartRaw) : groupBy === "month" ? "line" : groupBy === "property" || groupBy === "vendor" || groupBy === "gl" ? "hbar" : "bar";
  const spec: QuerySpec = { measure: m.key, groupBy, from, to, compareTo, properties, metros, chart, title: "" };
  spec.title = (raw.title ?? "").trim().slice(0, 120) || describeSpec(spec, scope);
  return { spec, dropped };
}

// Rules fallback: keywords for the measure, grouping, period, comparison, metros and property names.
export function rulesSpec(text: string, scope: ScopeProperty[], lastClosed: string): RawSpec {
  const t = text.toLowerCase();
  const measure = MEASURES.find((m) => m.keywords.test(text))?.key ?? "expense";
  const groupBy: GroupBy | null =
    /\bby (property|properties|building|community)|\bper property|\beach property/.test(t) ? "property"
    : /\bby (metro|market|city|region)|\bper metro/.test(t) ? "metro"
    : /\bby (gl|account|category|line item)/.test(t) ? "gl"
    : /\bby vendor|\bper vendor|\btop vendors/.test(t) ? "vendor"
    : /\bby month|\bmonthly\b|\btrend|\bover time|\bt12\b|\btrailing/.test(t) ? "month"
    : null;

  const yearM = t.match(/\b(20\d{2})\b/);
  const year = yearM ? Number(yearM[1]) : null;
  const q = t.match(/\bq([1-4])\b/);
  const n = t.match(/\b(?:last|trailing|past) (\d{1,2}|three|six|twelve) months\b/);
  const words: Record<string, number> = { three: 3, six: 6, twelve: 12 };
  const period: Period = { ...NO_PERIOD };
  if (q) Object.assign(period, { kind: "quarter", quarter: Number(q[1]), year });
  else if (/\blast month\b/.test(t)) period.kind = "last_month";
  else if (/\blast quarter\b/.test(t)) period.kind = "last_quarter";
  else if (/\bytd\b|\byear to date\b|\bthis year\b/.test(t)) period.kind = "ytd";
  else if (/\bt12\b|\btrailing (12|twelve)\b/.test(t)) Object.assign(period, { kind: "trailing", months: 12 });
  else if (n) Object.assign(period, { kind: "trailing", months: words[n[1]] ?? Number(n[1]) });
  else if (year) Object.assign(period, { kind: "year", year });

  const compareTo = /\b(vs\.?|versus|against|compared? (to|with)) (the )?budget|\bbudget(ed)?\b/.test(t) ? "budget"
    : /\b(vs\.?|versus|against|compared? (to|with)) (last|prior|previous) year|\byoy\b|\byear over year|\bprior year/.test(t) ? "prior_year"
    : "none";
  const metros = METROS.filter((m) => new RegExp(`\\b${m}\\b`, "i").test(text) || (m === "Dallas" && /\bdfw\b/i.test(text)));
  const properties = scope.filter((p) => {
    const n = p.name.toLowerCase();
    return t.includes(n) || (n.startsWith("the ") && t.includes(n.slice(4)));
  }).map((p) => p.id);
  const chart = /\btable\b/.test(t) ? "table" : null;
  return { measure, groupBy, period, compareTo, properties, metros, chart, title: null };
}
