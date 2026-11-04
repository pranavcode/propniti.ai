import { formatDate, formatMoney, formatNumber, formatTime } from "@/lib/format";
import type { Cell, Kind } from "./types";

// Text a spreadsheet would run as a formula: a leading = + - @ (or tab / CR), unless it is a plain number.
export const looksLikeFormula = (s: string) => /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s);

export const cellText = (v: Cell) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// A cell as the UI shows it (en-US money, dates and numbers), for PDF.
export function display(v: Cell, kind: Kind = "text"): string {
  if (v == null || v === "") return "";
  switch (kind) {
    case "money": return Number.isFinite(Number(v)) ? formatMoney(Number(v)) : cellText(v);
    case "number": return Number.isFinite(Number(v)) ? formatNumber(Number(v), { decimals: true }) : cellText(v);
    case "percent": return Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1).replace(/\.0$/, "")}%` : cellText(v);
    case "date": return formatDate(String(v), "always");
    case "datetime": return `${formatDate(String(v), "always")}, ${formatTime(String(v))}`;
    case "bool": return v === true || v === 1 || v === "true" ? "Yes" : "No";
    default: return cellText(v);
  }
}

// "Nov 4, 2026, 9:41 AM PT": demo-clock times are Pacific wall time written as UTC (src/lib/clock.ts).
export const generatedLabel = (iso: string) => `${display(iso, "datetime")} PT`;
