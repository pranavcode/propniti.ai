// Deterministic value cleanup. Every function returns the cleaned value or null; callers turn
// nulls into row issues. No guessing: anything ambiguous stays as an issue for a person.

export function money(v: string | undefined): number | null {
  if (!v?.trim()) return null;
  let s = v.trim().replace(/^usd\s*/i, "").replace(/\s*usd$/i, "");
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^\$/, "")) || /-$/.test(s);
  s = s.replace(/[()$\s-]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$|^\.\d{1,4}$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return neg ? -n : n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2100 ? dt.toISOString().slice(0, 10) : null;
};
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) - (Number(y) > 60 ? 100 : 0) : Number(y));

// US exports write month first; ISO and spelled-out months are unambiguous. Excel serials too.
export function date(v: string | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) return iso(year(m[3]!), Number(m[1]), Number(m[2]));
  if ((m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) return MONTHS.includes(m[1]!.toLowerCase()) ? iso(Number(m[3]), MONTHS.indexOf(m[1]!.toLowerCase()) + 1, Number(m[2])) : null;
  if ((m = s.match(/^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s](\d{2}|\d{4})$/i))) return MONTHS.includes(m[2]!.toLowerCase()) ? iso(year(m[3]!), MONTHS.indexOf(m[2]!.toLowerCase()) + 1, Number(m[1])) : null;
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000).toISOString().slice(0, 10);
  return null;
}

// First phone in the cell ("Mobile: (512) 555-0141, Home: …"), formatted (512) 555-0141.
export function phone(v: string | undefined): string | null {
  if (!v?.trim()) return null;
  const first = v.split(/[,;/]|\s{2,}|\bhome\b|\bwork\b|\boffice\b/i).map((x) => x.replace(/\b(ext|x)\.?\s*\d+$/i, "")).find((x) => /\d/.test(x)) ?? "";
  let d = first.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}

export function email(v: string | undefined): string | null {
  const first = v?.split(/[,;\s]+/).find((x) => x.includes("@"))?.trim().toLowerCase();
  return first && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(first) ? first : null;
}

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));
export function state(v: string | undefined): string | null {
  const s = v?.trim().replace(/\.$/, "");
  if (!s) return null;
  if (CODES.has(s.toUpperCase()) && s.length === 2) return s.toUpperCase();
  return STATES[s.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

// Excel drops leading zeros from ZIPs (02134 → 2134); ZIP+4 keeps the first five digits.
export function zip(v: string | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  const m = s.match(/^(\d{3,5})(?:-\d{4})?$/);
  return m ? m[1]!.padStart(5, "0") : null;
}

// "Unit 4B", "#4b", "Apt. 4B" → "4B". Anything else is kept as written (upper-cased letters).
export function unit(v: string | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  const out = s.replace(/^(unit|apt\.?|apartment|ste\.?|suite|no\.?|number)\s*#?\s*/i, "").replace(/^#\s*/, "").trim().toUpperCase();
  return out || null;
}

export function int(v: string | undefined): number | null {
  const n = money(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
}

// "8%", "8", "0.08" → 0.08
export function pct(v: string | undefined): number | null {
  const s = v?.trim().replace(/%$/, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n > 1 ? Math.round(n * 100) / 10000 : n;
}

export function bool(v: string | undefined): boolean | null {
  const s = v?.trim().toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1|x|✓)$/.test(s)) return true;
  if (/^(n|no|false|0)$/.test(s)) return false;
  return null;
}

// Only the last four digits of a tax id are ever kept.
export const taxLast4 = (v: string | undefined) => {
  const d = v?.replace(/\D/g, "") ?? "";
  return d.length >= 4 ? d.slice(-4) : null;
};

export type Person = { first: string; last: string };
const SUFFIX = /^(jr|sr|ii|iii|iv|md|phd|esq)\.?$/i;

// One cell can name several people: "Smith, John; Smith, Jane", "John & Jane Smith", "Ana Ruiz / Leo Ruiz".
export function people(v: string | undefined): Person[] {
  const s = v?.trim().replace(/\s+/g, " ");
  if (!s || /^(vacant|vacant[- ]\w+|n\/a|none|model|down|admin)$/i.test(s)) return [];
  const parts = s.split(/\s*(?:;|\/|\s&\s|\sand\s|\|)\s*/i).filter(Boolean);
  const out = parts.map(person).filter((p): p is Person => !!p);
  // "John & Jane Smith": the first part has no last name of its own.
  if (out.length > 1 && !out[0]!.last && out.at(-1)!.last) out[0]!.last = out.at(-1)!.last;
  return out.filter((p) => p.first || p.last);
}

export function person(s: string): Person | null {
  const t = s.trim();
  if (!t) return null;
  if (t.includes(",")) {
    const [last, first] = t.split(",", 2).map((x) => x.trim());
    if (first && !SUFFIX.test(first)) return { first, last: last ?? "" };
  }
  const words = t.split(" ").filter(Boolean);
  if (words.length > 2 && SUFFIX.test(words.at(-1)!)) words.splice(-2, 2, `${words.at(-2)} ${words.at(-1)}`);
  if (words.length === 1) return { first: words[0]!, last: "" };
  return { first: words.slice(0, -1).join(" "), last: words.at(-1)! };
}

// "JOHN SMITH" → "John Smith"; mixed case is left alone (McDonald, DeShawn).
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
export const oddCase = (s: string) => /\p{L}{2}/u.test(s) && (s === s.toUpperCase() || s === s.toLowerCase());

export type LeaseStatus = "Future" | "Active" | "Notice" | "Month-to-month" | "Expired" | "Terminated" | "Eviction";
export type ResidentStatus = "Current" | "Notice" | "Past" | "Future" | "Eviction";

// Free-text tenant status from an export → our resident status; "vacant" means no tenant.
export function residentStatus(v: string | undefined): ResidentStatus | "vacant" | null {
  const s = v?.trim().toLowerCase();
  if (!s) return null;
  if (/evict/.test(s)) return "Eviction";
  if (/notice|ntv|moving/.test(s)) return "Notice";
  if (/vacant|unrented|^model|^down/.test(s)) return "vacant";
  if (/past|former|moved|inactive|closed|terminated/.test(s)) return "Past";
  if (/future|applicant|pending|approved|pre-?lease/.test(s)) return "Future";
  if (/current|active|occupied|month|mtm|renewed|^on|lease/.test(s)) return "Current";
  return null;
}

export function leaseStatus(text: string | undefined, start: string, end: string | null, today: string): LeaseStatus {
  const r = residentStatus(text);
  if (r === "Eviction") return "Eviction";
  if (r === "Past") return "Expired";
  if (r === "Notice") return "Notice";
  if (start > today) return "Future";
  if (/month|mtm/i.test(text ?? "") || !end || end < today) return "Month-to-month";
  return "Active";
}

export function unitStatus(v: string | undefined): "Occupied" | "Vacant" | "Notice" | "Make-ready" | "Down" | "Model" | null {
  const s = v?.trim().toLowerCase();
  if (!s) return null;
  if (/notice/.test(s)) return "Notice";
  if (/make|ready|turn/.test(s)) return "Make-ready";
  if (/down|offline|non-?rev/.test(s)) return "Down";
  if (/model/.test(s)) return "Model";
  if (/vacant|unrented|available/.test(s)) return "Vacant";
  if (/occupied|rented|current/.test(s)) return "Occupied";
  return null;
}

// "55 Maple Ct, Austin, TX 78701" (state may be spelled out; ZIP optional).
export function address(v: string | undefined): { street: string; city: string; state: string; zip: string } | null {
  const m = v?.trim().replace(/\s+/g, " ").match(/^(.+?),\s*([^,]+?),?\s+([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)\.?(?:\s+(\d{5})(?:-\d{4})?)?$/);
  if (!m) return null;
  const st = state(m[3]);
  return st ? { street: m[1]!, city: m[2]!, state: st, zip: m[4] ?? "" } : null;
}

// Comparison keys: case, punctuation and company suffixes don't make two records different.
export const key = (s: string | undefined) => (s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|llc|inc|co|corp|company|lp|ltd)\b/g, " ").replace(/\s+/g, " ").trim();

const RENT = /^(base\s*)?rent(\s*charge)?$|^rnt$|^resrent$|^rentres$|^rent[-_ ]?res(idential)?$/i;
export const isRentCode = (code: string | undefined) => RENT.test(code?.trim() ?? "");

// Recurring charge label → GL account (src/seed/catalog.ts numbers).
export function glFor(label: string): string {
  const l = label.toLowerCase();
  if (/park|garage|storage|carport/.test(l)) return "gl-4300";
  if (/pet/.test(l)) return "gl-4310";
  if (/water|sewer|trash|util|rubs|electric|gas|valet/.test(l)) return "gl-4200";
  if (/cam|common area/.test(l)) return "gl-4400";
  if (/tax/.test(l)) return "gl-4410";
  if (/insur/.test(l)) return "gl-4420";
  if (/admin|fee|amenit/.test(l)) return "gl-4500";
  if (/concession|discount/.test(l)) return "gl-4900";
  return "gl-4000";
}
