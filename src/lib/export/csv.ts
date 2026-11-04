import { cellText, looksLikeFormula } from "./cells";
import type { ExportDoc } from "./types";

// CSV is plain data in every case: the header row and the values, never branding.
export function toCsv(doc: Pick<ExportDoc, "columns" | "rows">): string {
  const cell = (v: unknown) => {
    let s = cellText(v as never);
    if (looksLikeFormula(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [doc.columns.map((c) => c.label), ...doc.rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
