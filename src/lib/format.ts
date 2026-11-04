import { demoNow } from "./clock";

// One set of number, money and date formatters for the app (brief §5.1). Money is dollars in the
// browser; the API converts cents. US English, USD, tabular numbers come from the app CSS.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const MINUS = "−";

export type MoneyStyle = "full" | "whole" | "compact" | "accounting";

// $12,450.00 · −$1,240.00 · $1.24M · ($1,240.00)
export function formatMoney(value: number | null | undefined, style: MoneyStyle = "full"): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const body = style === "compact" ? (abs < 10_000 ? usd0.format(abs) : usdCompact.format(abs)) : style === "whole" ? usd0.format(abs) : usd.format(abs);
  if (value < 0) return style === "accounting" ? `(${body})` : `${MINUS}${body}`;
  return body;
}

export function formatNumber(value: number | null | undefined, opts: { compact?: boolean; decimals?: boolean } = {}): string {
  if (value == null || Number.isNaN(value)) return "—";
  const s = opts.compact && Math.abs(value) >= 10_000 ? compact.format(Math.abs(value)) : (opts.decimals ? dec : int).format(Math.abs(value));
  return value < 0 ? `${MINUS}${s}` : s;
}

// Ratio in (0.953 → "95.3%"). Values above 1.5 are treated as already-percent (95.3 → "95.3%").
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = Math.abs(value) <= 1.5 ? value * 100 : value;
  return `${pct.toFixed(digits).replace(/\.0+$/, "")}%`;
}

// Change between periods: "+4.2%" / "−1.3%". Returns null when there is no base.
export function formatDelta(current: number, previous: number | null | undefined, digits = 1): string | null {
  if (previous == null || previous === 0) return null;
  const d = ((current - previous) / Math.abs(previous)) * 100;
  const s = Math.abs(d).toFixed(digits).replace(/\.0+$/, "");
  return `${d >= 0 ? "+" : MINUS}${s}%`;
}

export function formatDays(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${int.format(value)} ${Math.abs(value) === 1 ? "day" : "days"}`;
}

// ---------------------------------------------------------------------------------------------
// Dates. Inputs are ISO strings ("2026-11-04" or full timestamps), Dates or epoch ms.
// ---------------------------------------------------------------------------------------------

export type DateInput = string | number | Date | null | undefined;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toDate(v: DateInput): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  // Bare dates are calendar days: parse as local midnight, not UTC, so "Nov 4" never shows as Nov 3.
  const d = typeof v === "string" && BARE_DATE.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const mdy = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const my = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const full = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// "Nov 4" within the current year, "Nov 4, 2025" otherwise. "always" forces the year (tables).
export function formatDate(v: DateInput, year: "auto" | "always" = "auto", now = demoNow()): string {
  const d = toDate(v);
  if (!d) return "—";
  return year === "always" || d.getFullYear() !== now.getFullYear() ? mdy.format(d) : md.format(d);
}

export const formatMonth = (v: DateInput) => { const d = toDate(v); return d ? my.format(d) : "—"; };
export const formatTime = (v: DateInput) => { const d = toDate(v); return d ? time.format(d) : "—"; };
export const formatDateTime = (v: DateInput) => { const d = toDate(v); return d ? `${formatDate(d)}, ${time.format(d)}` : "—"; };
// Tooltip text for relative dates: "Wed, Nov 4, 2026, 9:41 AM".
export const formatFull = (v: DateInput) => { const d = toDate(v); return d ? full.format(d) : "—"; };

// "just now", "5m ago", "3h ago", "yesterday", "3 days ago", "in 2 days", then the date.
export function formatRelative(v: DateInput, now = demoNow()): string {
  const d = demoInstant(v);
  if (!d) return "—";
  const diff = d.getTime() - now.getTime();
  const past = diff < 0;
  const s = Math.abs(diff) / 1000;
  if (s < 45) return "just now";
  const m = s / 60, h = m / 60;
  if (m < 60) return past ? `${Math.round(m)}m ago` : `in ${Math.round(m)}m`;
  if (h < 24 && sameDay(d, now)) return past ? `${Math.round(h)}h ago` : `in ${Math.round(h)}h`;
  const days = calendarDays(d, now);
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (Math.abs(days) < 7) return past ? `${-days} days ago` : `in ${days} days`;
  return formatDate(v, "auto", now);
}

// Due-date wording: "Due today", "Due in 3 days", "Late by 2 days" (red in the UI when late).
export function formatDue(v: DateInput, now = demoNow()): { text: string; late: boolean; soon: boolean } {
  const d = demoInstant(v);
  if (!d) return { text: "—", late: false, soon: false };
  const days = calendarDays(d, now);
  if (days < 0) return { text: `Late by ${-days} ${days === -1 ? "day" : "days"}`, late: true, soon: false };
  if (days === 0) return { text: "Due today", late: false, soon: true };
  if (days <= 7) return { text: `Due in ${days} ${days === 1 ? "day" : "days"}`, late: false, soon: true };
  return { text: formatDate(v, "auto", now), late: false, soon: false };
}

// Relative wording counts calendar days in the demo's frame, never the viewer's time zone: the demo
// clock and stored timestamps are demo wall time written as UTC (clock.ts), so their UTC date is the
// demo date, and a bare date is that day. Kolkata and Los Angeles read the same "Due today".
const demoInstant = (v: DateInput) => (typeof v === "string" && BARE_DATE.test(v) ? new Date(`${v}T00:00:00Z`) : toDate(v));
const dayNumber = (d: Date) => Math.floor(d.getTime() / 86_400_000);
const sameDay = (a: Date, b: Date) => dayNumber(a) === dayNumber(b);
const calendarDays = (d: Date, now: Date) => dayNumber(d) - dayNumber(now);

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

// Greetings follow the persona's local time, not the server clock. A persona's metro is read from
// its scope or title ("3 Austin properties", "Texas · 14 properties"); org-wide personas use HQ.
export const METRO_TIME_ZONES: Record<string, string> = { Austin: "America/Chicago", Dallas: "America/Chicago", Atlanta: "America/New_York", Phoenix: "America/Phoenix" };
export const HQ_METRO = "Austin";

export function personaTimeZone(p: { scope: { label: string }; title?: string }): string {
  const text = `${p.scope.label} ${p.title ?? ""}`;
  const metro = Object.keys(METRO_TIME_ZONES).find((m) => text.includes(m)) ?? (/\bTexas\b/.test(text) ? "Austin" : /\b(Georgia|Southeast)\b/.test(text) ? "Atlanta" : /\b(Arizona|Southwest)\b/.test(text) ? "Phoenix" : HQ_METRO);
  return METRO_TIME_ZONES[metro]!;
}

// "Good morning, Daniel" (before noon), "Good afternoon" (to 5 pm), "Good evening" after, in the given zone.
// Only the time of day matters here, so this reads the real clock.
export function greeting(name: string, timeZone: string, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, ${name.split(" ")[0]}`;
}

export const personaGreeting = (p: { name: string; scope: { label: string }; title?: string }, now = new Date()) => greeting(p.name, personaTimeZone(p), now);
