"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// Filter row for the budget vs actual page: property (scoped list), year and income/expense.
// State lives in the URL so the view can be shared and the back button works.

export function BvaFilters({ properties, years, property, year, type }: { properties: { id: string; name: string }[]; years: number[]; property: string; year: number; type: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    q.delete("explain");
    router.push(`?${q}`, { scroll: false });
  };
  const select = "h-8 rounded-md border bg-card px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="bva-property">Property</label>
      <select id="bva-property" className={cn(select, "min-w-56")} value={property} onChange={(e) => set("property", e.target.value)}>
        <option value="">All properties ({properties.length})</option>
        {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="bva-year">Year</label>
      <select id="bva-year" className={select} value={String(year)} onChange={(e) => set("year", e.target.value)}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <div role="radiogroup" aria-label="Income or expense" className="flex rounded-md border p-0.5 text-[12.5px]">
        {["Expense", "Income"].map((t) => (
          <button key={t} role="radio" aria-checked={type === t} onClick={() => set("type", t === "Expense" ? "" : t)}
            className={cn("rounded px-2.5 py-1", type === t ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
      </div>
    </div>
  );
}
