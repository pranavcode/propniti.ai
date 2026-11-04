import { formatDate, formatDays, formatMoney, formatNumber, formatPct } from "@/lib/format";
import type { ValueFormat } from "./types";

// Full value for tooltips and KPI values; compact form for axis ticks.
export function formatValue(v: number | null | undefined, format: ValueFormat = "count", compact = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  switch (format) {
    case "money": return formatMoney(v, compact ? "compact" : "whole");
    case "pct": return formatPct(v, compact ? 0 : 1);
    case "days": return compact ? `${formatNumber(v)}d` : formatDays(v);
    default: return formatNumber(v, { compact });
  }
}

// Axis ticks: compact, but percent ticks keep one decimal (trimmed when whole) so a narrow range
// such as 95.0–95.5% doesn't print "95%" twice.
export const formatTick = (v: number, format?: ValueFormat) => (format === "pct" ? formatPct(v, 1) : formatValue(v, format, true));

// Series colours follow the chart tokens, so light/dark and the brand accent stay consistent.
export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
// Fixed order, never cycled: a sixth series and beyond share the neutral "Other" ink.
export const seriesColor = (i: number, override?: string) => override ?? SERIES_COLORS[i] ?? "var(--muted-foreground)";

// Month on a chart axis: "2025-12" → "Dec ’25". Every month chart uses this one form.
export const monthTick = (ym: string) => new Date(`${ym.slice(0, 7)}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " ’");

// Category labels on chart axes and tooltips: "2025-12" → "Dec ’25", "2026-11-04" → "Nov 4, 2026".
export function categoryLabel(v: unknown): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}$/.test(s)) return monthTick(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s, "always");
  return s;
}
