import { formatDate, formatMoney, formatNumber, formatTime } from "./format";

// Stored keys and values (extracted document fields, data-health evidence and fixes) as people read
// them: labels from the record's field defs, money from cents, dates as "Nov 4, 2026".

export type FieldHint = { label: string; type?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DOLLAR_KEYS = /^(total|amount|subtotal|tax)$|_amount$/;

// Field defs keyed by both field key and stored column, so raw rows ("rent_cents") find their label.
export function hintsFor(def: { fields: Record<string, { label: string; type: string; column?: string }> } | null | undefined): Record<string, FieldHint> {
  const out: Record<string, FieldHint> = {};
  for (const [key, f] of Object.entries(def?.fields ?? {})) {
    out[key] = { label: f.label, type: f.type };
    if (f.column) out[f.column] = { label: f.label, type: f.type };
  }
  return out;
}

// "term_months" → "Term months", "rent_cents" → "Rent", "due_on" → "Due".
export function humanizeKey(key: string): string {
  const s = key.replace(/_(cents|on|at|id)$/, "").replace(/_/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : key;
}

const dateText = (v: string) => (ISO_DATETIME.test(v) ? `${formatDate(v, "always")}, ${formatTime(v)}` : formatDate(v, "always"));

// One stored value as text; null when empty.
export function valueText(key: string, v: unknown, hint?: FieldHint): string | null {
  if (v == null || v === "") return null;
  if (hint?.type === "bool" || typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (key.endsWith("_cents")) return formatMoney(v / 100);
    if (hint?.type === "money" || DOLLAR_KEYS.test(key)) return formatMoney(v);
    return formatNumber(v, { decimals: true });
  }
  if (typeof v === "string") return ISO_DATE.test(v) || ISO_DATETIME.test(v) ? dateText(v) : v;
  if (Array.isArray(v)) return v.map((x) => (x != null && typeof x === "object" ? objectText(x as Record<string, unknown>) : valueText(key, x))).filter(Boolean).join(typeof v[0] === "object" ? "; " : ", ") || null;
  return objectText(v as Record<string, unknown>) || null;
}

const objectText = (o: Record<string, unknown>) => Object.entries(o).map(([k, x]) => valueText(k, x)).filter(Boolean).join(" · ");

export function fieldRows(obj: Record<string, unknown>, hints: Record<string, FieldHint> = {}): { key: string; label: string; text: string }[] {
  return Object.entries(obj).flatMap(([key, v]) => {
    const text = valueText(key, v, hints[key]);
    return text == null ? [] : [{ key, label: hints[key]?.label ?? humanizeKey(key), text }];
  });
}

// Free text written by rules and agents: ISO dates, bare "for 9270.58" amounts and snake_case
// field names read as people write them.
export function readableText(s: string): string {
  return s
    .replace(/\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?\b/g, (m) => dateText(m))
    .replace(/\bfor (\d+\.\d{2})\b/g, (_, n: string) => `for ${formatMoney(Number(n))}`)
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (m) => m.replace(/_/g, " "));
}
