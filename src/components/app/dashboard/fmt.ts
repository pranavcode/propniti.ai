import { formatDays, formatMoney, formatNumber, formatPct } from "@/lib/format";
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

// Series colours follow the chart tokens, so light/dark and the brand accent stay consistent.
export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
// Fixed order, never cycled: a sixth series and beyond share the neutral "Other" ink.
export const seriesColor = (i: number, override?: string) => override ?? SERIES_COLORS[i] ?? "var(--muted-foreground)";
