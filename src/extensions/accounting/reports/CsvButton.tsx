"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Cell = string | number | null;

const esc = (v: Cell) => {
  if (v == null) return "";
  const s = String(v);
  // Cells starting with = + - @ would run as formulas in a spreadsheet; prefix them.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: Cell[][]) {
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

// Downloads the rows already on screen as CSV; nothing is fetched again.
export function CsvButton({ filename, header, rows, label = "Export CSV" }: { filename: string; header: string[]; rows: Cell[][]; label?: string }) {
  const download = () => {
    const blob = new Blob(["\uFEFF" + toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    a.click();
    // Revoking in the same tick can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <Button size="sm" variant="outline" onClick={download} disabled={!rows.length}><Download />{label}</Button>;
}
