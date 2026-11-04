"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableProps } from "../data-table";
import type { AiFilterResult } from "../data-table/types";

// Kit demo wrapper: adds the client-only callbacks (AI filter, bulk actions) a real page gets from
// lane E and the actions API. The AI filter here is a small keyword parser standing in for it.
function demoAiFilter(text: string): Promise<AiFilterResult> {
  const t = text.toLowerCase();
  const filters: Record<string, string | string[]> = {};
  const metro = ["austin", "dallas", "atlanta", "phoenix"].find((m) => t.includes(m));
  if (metro) filters.metro = metro[0]!.toUpperCase() + metro.slice(1);
  const beds = t.match(/(\d)\s*-?\s*bed/);
  if (beds) filters.beds = beds[1]!;
  if (/studio/.test(t)) filters.beds = "0";
  const status = ["vacant", "notice", "down", "occupied"].find((s) => t.includes(s));
  if (status) filters.status = status[0]!.toUpperCase() + status.slice(1);
  if (/(late|owe|balance|delinquen)/.test(t)) filters["balance.min"] = "0.01";
  const parts = [status && `${filters.status} units`, filters.beds && `${filters.beds === "0" ? "studios" : `${filters.beds}-bed`}`, metro && `in ${filters.metro}`, filters["balance.min"] && "with a balance"].filter(Boolean);
  return new Promise((resolve, reject) => setTimeout(() => (Object.keys(filters).length ? resolve({ filters, sort: filters["balance.min"] ? ["balance", "desc"] : undefined, explanation: parts.join(" ") || text }) : reject(new Error("Try naming a status, metro or bedroom count"))), 650));
}

export function KitTable(props: Omit<DataTableProps, "onAiFilter" | "onBulkAction" | "toolbar">) {
  return (
    <DataTable
      {...props}
      onAiFilter={demoAiFilter}
      onBulkAction={() => new Promise((r) => setTimeout(r, 700))}
      toolbar={<Button size="sm"><Plus /> New unit</Button>}
    />
  );
}
