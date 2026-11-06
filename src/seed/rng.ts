// Deterministic randomness and date helpers for the seed generator. Every entity draws from its
// own stream (rng("unit:u-p01-412")), so adding a property never reshuffles the others.

export function hash32(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Rng = {
  (): number;
  int(min: number, max: number): number;           // inclusive
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
  weighted<T>(xs: readonly (readonly [T, number])[]): T;
  normal(mean: number, sd: number): number;
};

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  next.pick = (xs) => xs[Math.floor(next() * xs.length)];
  next.chance = (p) => next() < p;
  next.weighted = (xs) => {
    const total = xs.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [x, w] of xs) if ((r -= w) < 0) return x;
    return xs[xs.length - 1][0];
  };
  next.normal = (mean, sd) => mean + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return next;
}

export const rng = (key: string) => mulberry32(hash32(`propniti-v2:${key}`));

// Days are integers (days since 1970-01-01, UTC) inside the generator; rows get 'YYYY-MM-DD'.
const DAY = 86_400_000;
const isoCache = new Map<number, string>();
export const day = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
export function iso(d: number) {
  let s = isoCache.get(d);
  if (!s) isoCache.set(d, (s = new Date(d * DAY).toISOString().slice(0, 10)));
  return s;
}
// Timestamp text: 'YYYY-MM-DDTHH:MM:00Z' from a day and minutes after midnight.
export const ts = (d: number, minutes = 9 * 60) => `${iso(d)}T${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`;
export const ym = (d: number) => iso(d).slice(0, 7);
export const monthStart = (period: string) => day(`${period}-01`);
export const daysInMonth = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const monthEnd = (period: string) => monthStart(period) + daysInMonth(period) - 1;
export function addMonths(period: string, n: number) {
  const [y, m] = period.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const addMonthsDay = (d: number, n: number) => {
  const s = iso(d);
  const p = addMonths(s.slice(0, 7), n);
  return monthStart(p) + Math.min(Number(s.slice(8, 10)), daysInMonth(p)) - 1;
};
export const weekday = (d: number) => (d + 4) % 7; // 0 = Sunday

// Stored reasons read as people write them: "Oct 1, 2026" and "$9,270.58".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const usDate = (isoDate: string) => {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
export const dollars = (cents: number, decimals = true) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 })}`;

// Integer-cent rounding, half up. SQL uses CAST((x * pct + 50) / 100 AS INTEGER) for whole percents.
export const pctOf = (cents: number, pct: number) => Math.floor((cents * pct + 50) / 100);
export const round = (cents: number, to = 100) => Math.round(cents / to) * to;
