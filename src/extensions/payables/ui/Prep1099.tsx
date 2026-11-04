"use client";

import { useMemo, useState } from "react";
import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";

export type PrepRow = {
  vendor_id: string; company: string; owner_entity_id: string; payer: string; paid: number; payments: number;
  w9: boolean; form_id: string | null; form_status: string | null; state: "Reportable" | "Near threshold" | "Below threshold"; flags: string[];
};

const STATE_TONE = { Reportable: "info", "Near threshold": "warning", "Below threshold": "neutral" } as const;
const FILTERS = ["All", "Reportable", "Near threshold", "Needs attention", "Below threshold"] as const;
const keyOf = (r: PrepRow) => `${r.vendor_id}|${r.owner_entity_id}`;

// 1099 preparation table: select reportable vendor × payer pairs with no form yet and create
// Draft 1099-NEC forms through the generic API (one POST each, so each is scoped and audited).
export function Prep1099({ rows, year }: { rows: PrepRow[]; year: number }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const creatable = rows.filter((r) => r.state === "Reportable" && !r.form_id);
  const shown = useMemo(() => rows.filter((r) => filter === "All" || (filter === "Needs attention" ? r.flags.length > 0 : r.state === filter)), [rows, filter]);
  const toggle = (k: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const create = async () => {
    const todo = creatable.filter((r) => picked.has(keyOf(r)));
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of todo) {
      const res = await fetch("/api/e/vendor_1099s", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor_id: r.vendor_id, owner_entity_id: r.owner_entity_id, year, amount: Math.round(r.paid * 100) / 100, status: "Draft" }) }).catch(() => null);
      if (res?.ok) ok++;
      else failed.push(r.company);
    }
    setBusy(false);
    setPicked(new Set());
    if (ok) toast.success(`Created ${ok} draft 1099-NEC ${ok === 1 ? "form" : "forms"} for ${year}`, { action: { label: "View forms", onClick: () => router.push(`/app/payables/1099s?f.year=${year}`) } });
    if (failed.length) toast.error(`Couldn't create forms for ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` and ${failed.length - 3} more` : ""}`);
    router.refresh();
  };

  if (!rows.length) return <EmptyState kind="table" title={`No 1099 vendor payments in ${year}`} description="Vendor payouts from trust to vendors marked as 1099 vendors appear here, totalled per payer." />;

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <ToggleGroup type="single" size="sm" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v as (typeof FILTERS)[number])} aria-label="Filter vendors">
          {FILTERS.map((f) => {
            const n = f === "All" ? rows.length : f === "Needs attention" ? rows.filter((r) => r.flags.length).length : rows.filter((r) => r.state === f).length;
            return <ToggleGroupItem key={f} value={f} className="gap-1.5 px-2.5">{f}<span className="tabular-nums text-muted-foreground">{n}</span></ToggleGroupItem>;
          })}
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          {creatable.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setPicked(picked.size === creatable.length ? new Set() : new Set(creatable.map(keyOf)))}>
              {picked.size === creatable.length ? "Clear selection" : `Select all ${creatable.length} without a form`}
            </Button>
          )}
          <Button size="sm" disabled={!picked.size || busy} onClick={create}><FilePlus2 />{busy ? "Creating…" : `Create ${picked.size || ""} draft ${picked.size === 1 ? "form" : "forms"}`.replace("  ", " ")}</Button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-muted/80 text-[12px] text-muted-foreground backdrop-blur">
            <tr className="border-b">
              <th className="w-8 px-3 py-2"><span className="sr-only">Select</span></th>
              <th className="px-3 py-2 text-left font-medium">Vendor</th>
              <th className="px-3 py-2 text-left font-medium">Payer (owner entity)</th>
              <th className="px-3 py-2 text-right font-medium">Paid in {year}</th>
              <th className="px-3 py-2 text-right font-medium">Payments</th>
              <th className="px-3 py-2 text-left font-medium">Threshold</th>
              <th className="px-3 py-2 text-left font-medium">W-9</th>
              <th className="px-3 py-2 text-left font-medium">Form</th>
              <th className="px-3 py-2 text-left font-medium">Needs attention</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = keyOf(r);
              const can = r.state === "Reportable" && !r.form_id;
              return (
                <tr key={k} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-1.5">{can && <Checkbox checked={picked.has(k)} onCheckedChange={() => toggle(k)} aria-label={`Select ${r.company}, ${r.payer}`} />}</td>
                  <td className="max-w-[220px] px-3 py-1.5"><Link href={`/app/maintenance/vendors/${r.vendor_id}?tab=vendor_finance`} className="block truncate font-medium hover:text-primary hover:underline" title={r.company}>{r.company}</Link></td>
                  <td className="max-w-[260px] truncate px-3 py-1.5 text-muted-foreground" title={r.payer}>{r.payer}</td>
                  <td className="px-3 py-1.5 text-right"><Money value={r.paid} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.payments}</td>
                  <td className="px-3 py-1.5"><StatusBadge value={r.state} tone={STATE_TONE[r.state]} /></td>
                  <td className="px-3 py-1.5">{r.w9 ? <span className="text-muted-foreground">On file</span> : <StatusBadge value="Missing" tone="danger" />}</td>
                  <td className="px-3 py-1.5">{r.form_id ? <Link href={`/app/payables/1099s/${r.form_id}`} className="hover:underline"><StatusBadge value={r.form_status} /></Link> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-1.5 text-[12.5px]">
                    {r.flags.length ? <span className="flex max-w-[320px] items-center gap-1.5 text-tone-warning" title={r.flags.join("\n")}><TriangleAlert className="size-3.5 shrink-0" /><span className="truncate">{r.flags[0]}</span>{r.flags.length > 1 && <span className="shrink-0">+{r.flags.length - 1}</span>}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <EmptyState compact kind="filtered" title="Nothing in this filter" description="Pick another filter above." />}
      </div>
    </div>
  );
}
