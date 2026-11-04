"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Filter row for the budget vs actual page: property (scoped list), year and income/expense.
// State lives in the URL so the view can be shared and the back button works.

const ALL = "all";

export function BvaFilters({ properties, years, property, year, type }: { properties: { id: string; name: string }[]; years: number[]; property: string; year: number; type: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    q.delete("explain");
    router.push(`?${q}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={property || ALL} onValueChange={(v) => set("property", v === ALL ? "" : v)}>
        <SelectTrigger size="sm" className="min-w-56" aria-label="Property"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL}>All properties ({properties.length})</SelectItem>
            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={(v) => set("year", v)}>
        <SelectTrigger size="sm" aria-label="Year"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectGroup>
        </SelectContent>
      </Select>
      <ToggleGroup type="single" size="sm" variant="outline" value={type} onValueChange={(v) => v && set("type", v === "Expense" ? "" : v)} aria-label="Income or expense">
        <ToggleGroupItem value="Expense">Expense</ToggleGroupItem>
        <ToggleGroupItem value="Income">Income</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
