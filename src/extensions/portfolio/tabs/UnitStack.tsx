"use client";

import Link from "@/components/Link";
import { useMemo, useState } from "react";
import type { Tone } from "@/entities/types";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatPct } from "@/lib/format";
import { TONE_DOT } from "@/components/app/status";

export type StackUnit = { id: string; number: string; floor: number; building: string; status: string; plan: string; market: number; rent: number | null; resident: string | null; leaseEnd: string | null };
type Mode = "status" | "rent" | "expiry";

const STATUS_TONE: Record<string, Tone> = { Occupied: "success", Notice: "warning", Vacant: "neutral", "Make-ready": "info", Down: "danger", Model: "ai" };
const STATUS_ORDER = ["Occupied", "Notice", "Vacant", "Make-ready", "Down", "Model"];

// Cell fill per tone; literal class strings so Tailwind generates them.
const CELL: Record<Tone, string> = {
  success: "bg-tone-success/20 text-tone-success hover:bg-tone-success/35",
  warning: "bg-tone-warning/25 text-tone-warning hover:bg-tone-warning/40",
  neutral: "bg-muted text-muted-foreground hover:bg-muted-foreground/20",
  info: "bg-tone-info/20 text-tone-info hover:bg-tone-info/35",
  danger: "bg-tone-danger/20 text-tone-danger hover:bg-tone-danger/35",
  ai: "bg-card text-tone-ai ring-1 ring-inset ring-tone-ai/50 hover:bg-tone-ai/10",
};

function classify(u: StackUnit, mode: Mode, today: string): { tone: Tone; label: string } {
  if (mode === "status") return { tone: STATUS_TONE[u.status] ?? "neutral", label: u.status };
  if (mode === "rent") {
    if (u.rent == null || !u.market) return { tone: "neutral", label: "No lease" };
    const r = u.rent / u.market;
    return r >= 1 ? { tone: "success", label: "At or above market" } : r >= 0.95 ? { tone: "warning", label: "Up to 5% below" } : { tone: "danger", label: "More than 5% below" };
  }
  if (!u.leaseEnd) return { tone: "neutral", label: "No lease" };
  const d = (Date.parse(u.leaseEnd) - Date.parse(today)) / 86_400_000;
  return d <= 60 ? { tone: "danger", label: "Ends within 60 days" } : d <= 120 ? { tone: "warning", label: "Ends in 61–120 days" } : { tone: "success", label: "Ends after 120 days" };
}

export function UnitStack({ units, today }: { units: StackUnit[]; today: string }) {
  const [mode, setMode] = useState<Mode>("status");
  const [hover, setHover] = useState<StackUnit | null>(null);

  const buildings = useMemo(() => {
    const byB = new Map<string, Map<number, StackUnit[]>>();
    for (const u of units) {
      const floors = byB.get(u.building) ?? byB.set(u.building, new Map()).get(u.building)!;
      (floors.get(u.floor) ?? floors.set(u.floor, []).get(u.floor)!).push(u);
    }
    return [...byB.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([name, floors]) => ({
      name,
      floors: [...floors.entries()].sort(([a], [b]) => b - a).map(([floor, list]) => ({ floor, units: list.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })) })),
    }));
  }, [units]);

  const legend = useMemo(() => {
    const counts = new Map<string, { tone: Tone; n: number }>();
    for (const u of units) {
      const c = classify(u, mode, today);
      counts.set(c.label, { tone: c.tone, n: (counts.get(c.label)?.n ?? 0) + 1 });
    }
    const entries = [...counts.entries()];
    return mode === "status" ? entries.sort(([a], [b]) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b)) : entries.sort(([, a], [, b]) => b.n - a.n);
  }, [units, mode, today]);

  const singleStorey = buildings.every((b) => b.floors.length === 1);
  const MODES: [Mode, string][] = [["status", "Status"], ["rent", "Rent vs market"], ["expiry", "Lease expiry"]];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Colour units by" className="inline-flex rounded-md border bg-muted/40 p-0.5 text-[12px]">
          <span className="px-2 py-1 text-muted-foreground">Colour by</span>
          {MODES.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
              className={cn("rounded px-2.5 py-1 font-medium transition-colors", mode === k ? "bg-background text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {legend.map(([label, { tone, n }]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", tone === "ai" ? "ring-1 ring-tone-ai" : TONE_DOT[tone])} />
              {label} <span className="font-medium text-foreground tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex min-w-0 flex-col gap-3">
          {buildings.map((b) => (
            <section key={b.name} className="rounded-lg border bg-card">
              <h3 className="flex items-center justify-between border-b px-3 py-1.5 text-[12px] font-semibold">
                {b.name}
                <span className="font-normal text-muted-foreground tabular-nums">{b.floors.reduce((s, f) => s + f.units.length, 0)} units · {singleStorey ? "1 storey" : `${b.floors.length} floors`}</span>
              </h3>
              <div className="flex flex-col gap-1 overflow-x-auto p-2">
                {b.floors.map((f) => (
                  <div key={f.floor} className="flex items-center gap-1">
                    <span className="w-7 shrink-0 text-right text-[10.5px] text-muted-foreground tabular-nums" title={`Floor ${f.floor}`}>{singleStorey ? "" : `F${f.floor}`}</span>
                    <div className="flex flex-wrap gap-1">
                      {f.units.map((u) => {
                        const c = classify(u, mode, today);
                        return (
                          <Link key={u.id} href={`/app/units/${encodeURIComponent(u.id)}`}
                            onMouseEnter={() => setHover(u)} onFocus={() => setHover(u)}
                            aria-label={`Unit ${u.number}: ${u.status}, ${u.plan}${u.resident ? `, ${u.resident}` : ""}`}
                            className={cn("flex h-6 min-w-[38px] items-center justify-center rounded-[4px] px-1 text-[10.5px] font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", CELL[c.tone], hover?.id === u.id && "ring-2 ring-foreground/40")}>
                            {u.number}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="h-fit rounded-lg border bg-card p-3 text-[12.5px] lg:sticky lg:top-3" aria-live="polite">
          {hover ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-semibold tabular-nums">Unit {hover.number}</span>
                <span className="text-[11.5px] text-muted-foreground">{hover.building}{singleStorey ? "" : ` · Floor ${hover.floor}`}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[88px_1fr] gap-y-1">
                <dt className="text-muted-foreground">Status</dt><dd className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", TONE_DOT[STATUS_TONE[hover.status] ?? "neutral"])} />{hover.status}</dd>
                <dt className="text-muted-foreground">Floor plan</dt><dd className="truncate">{hover.plan}</dd>
                <dt className="text-muted-foreground">Resident</dt><dd className="truncate">{hover.resident ?? "—"}</dd>
                <dt className="text-muted-foreground">Lease rent</dt><dd className="tabular-nums">{hover.rent == null ? "—" : formatMoney(hover.rent, "whole")}</dd>
                <dt className="text-muted-foreground">Market rent</dt><dd className="tabular-nums">{formatMoney(hover.market, "whole")}{hover.rent != null && hover.market ? <span className="ml-1 text-muted-foreground">({formatPct(hover.rent / hover.market - 1)})</span> : null}</dd>
                <dt className="text-muted-foreground">Lease ends</dt><dd className="tabular-nums">{hover.leaseEnd ? formatDate(hover.leaseEnd, "always") : "—"}</dd>
              </dl>
              <Link href={`/app/units/${encodeURIComponent(hover.id)}`} className="mt-2.5 inline-block text-[12px] font-medium text-primary hover:underline">Open unit →</Link>
            </>
          ) : (
            <p className="text-muted-foreground">Point at a unit to see its resident, rent and lease end. Click to open it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
