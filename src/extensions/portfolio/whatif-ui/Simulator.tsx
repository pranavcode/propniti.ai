"use client";

import Link from "@/components/Link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Calculator, ExternalLink, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AIBadge } from "@/components/app/ai";
import { ErrorBanner, EmptyState } from "@/components/app/states";
import { NO_CHANGE, simulateAll, type Baseline, type Levers, type Result } from "../whatif";
import { seededPhoto } from "@/entities/common";
import { Thumb } from "@/components/app/display";

export type Scope = { kind: "portfolio" } | { kind: "metro"; metro: string } | { kind: "property"; property: string };
type Narrative = { text: string; bullets: string[]; source: "live" | "rules"; model: string; runId: string; note?: string };
type SortKey = "name" | "noi_cents" | "scenario_noi_cents" | "delta_cents" | "delta_pct";

const PRESETS: { label: string; levers: Levers }[] = [
  { label: "Rent +3%", levers: { ...NO_CHANGE, rentPct: 3 } },
  { label: "Occupancy −2 pts", levers: { ...NO_CHANGE, occDeltaPts: -2 } },
  { label: "Opex +5% (insurance and tax)", levers: { ...NO_CHANGE, opexPct: 5 } },
];

const scopeKey = (s: Scope) => (s.kind === "portfolio" ? "all" : s.kind === "metro" ? `m:${s.metro}` : `p:${s.property}`);
const keyScope = (k: string): Scope => (k.startsWith("m:") ? { kind: "metro", metro: k.slice(2) } : k.startsWith("p:") ? { kind: "property", property: k.slice(2) } : { kind: "portfolio" });
const usd = (cents: number, style: "whole" | "compact" = "whole") => formatMoney(cents / 100, style);
const signed = (cents: number, style: "whole" | "compact" = "whole") => (cents > 0 ? "+" : "") + usd(cents, style);
const signedPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);

// Keeps the scenario in the URL so it can be shared, without a server round trip per slider move.
function writeUrl(scope: Scope, l: Levers) {
  const p = new URLSearchParams();
  if (scope.kind === "metro") p.set("metro", scope.metro);
  if (scope.kind === "property") p.set("property", scope.property);
  if (l.rentPct) p.set("rent", String(l.rentPct));
  if (l.opexPct) p.set("opex", String(l.opexPct));
  if (l.occTarget != null) p.set("occ", String(l.occTarget));
  else if (l.occDeltaPts) p.set("occd", String(l.occDeltaPts));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export function Simulator({ baselines, initialScope, initialLevers, period }: { baselines: Baseline[]; initialScope: Scope; initialLevers: Levers; period: string }) {
  const [scope, setScopeState] = useState<Scope>(initialScope);
  const [levers, setLeversState] = useState<Levers>(initialLevers);
  const [sort, setSort] = useState<[SortKey, "asc" | "desc"]>(["delta_cents", "desc"]);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setScope = (s: Scope) => { setScopeState(s); setNarrative(null); writeUrl(s, levers); };
  const setLevers = (l: Levers) => { setLeversState(l); setNarrative(null); writeUrl(scope, l); };

  const metros = useMemo(() => [...new Set(baselines.map((b) => b.metro))].sort(), [baselines]);
  const inScope = useMemo(() => baselines.filter((b) => scope.kind === "portfolio" || (scope.kind === "metro" ? b.metro === scope.metro : b.property_id === scope.property)), [baselines, scope]);
  const { rows, totals } = useMemo(() => simulateAll(inScope, levers), [inScope, levers]);
  const sorted = useMemo(() => {
    const [k, dir] = sort;
    return [...rows].sort((a, b) => {
      const av = a[k] ?? -Infinity, bv = b[k] ?? -Infinity;
      const c = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return dir === "asc" ? c : -c;
    });
  }, [rows, sort]);
  const changed = levers.rentPct !== 0 || levers.opexPct !== 0 || levers.occDeltaPts !== 0 || levers.occTarget != null;
  const scopeLabel = scope.kind === "portfolio" ? "All properties in your scope" : scope.kind === "metro" ? scope.metro : inScope[0]?.name ?? "Property";

  const explain = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/app/portfolio/what-if/narrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, levers }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setNarrative(data as Narrative);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!baselines.length) return <EmptyState kind="chart" title="No properties in your scope" description="The simulator needs at least one property with 12 months of history." action={{ label: "Go to your home", href: "/app" }} />;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 rounded-lg border bg-card p-4 xl:sticky xl:top-4" data-tour="whatif-levers">
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-muted-foreground" htmlFor="whatif-scope">Scope</label>
          <Select value={scopeKey(scope)} onValueChange={(v) => setScope(keyScope(v))}>
            <SelectTrigger id="whatif-scope" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties in your scope ({baselines.length})</SelectItem>
              {metros.length > 1 && <><SelectSeparator /><SelectGroup><SelectLabel>Metro</SelectLabel>{metros.map((m) => <SelectItem key={m} value={`m:${m}`}>{m} ({baselines.filter((b) => b.metro === m).length})</SelectItem>)}</SelectGroup></>}
              <SelectSeparator />
              <SelectGroup><SelectLabel>Property</SelectLabel>{baselines.map((b) => <SelectItem key={b.property_id} value={`p:${b.property_id}`}>{b.name}</SelectItem>)}</SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">Presets</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => setLevers(p.levers)}
                className={cn("rounded-full border px-2.5 py-1 text-[12px] transition-colors hover:border-primary/40 hover:bg-primary/5", JSON.stringify(p.levers) === JSON.stringify(levers) && "border-primary/50 bg-primary/10 text-foreground")}>
                {p.label}
              </button>
            ))}
            <button type="button" onClick={() => setLevers(NO_CHANGE)} disabled={!changed} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40">
              <RotateCcw className="size-3" /> Reset
            </button>
          </div>
        </div>

        <Lever id="rent" label="Rent change" unit="%" value={levers.rentPct} min={-10} max={10} inputMin={-20} inputMax={20} step={0.5}
          hint="Applied to in-place rent across the year." onChange={(rentPct) => setLevers({ ...levers, rentPct })} />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-muted-foreground">Occupancy</span>
            <ToggleGroup type="single" size="sm" variant="outline" value={levers.occTarget != null ? "target" : "change"}
              onValueChange={(v) => v && setLevers(v === "target" ? { ...levers, occTarget: Math.round(totals.occupancy * 1000) / 10, occDeltaPts: 0 } : { ...levers, occTarget: null })}>
              <ToggleGroupItem value="change" className="h-6 px-2 text-[11.5px]">Change</ToggleGroupItem>
              <ToggleGroupItem value="target" className="h-6 px-2 text-[11.5px]">Target</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {levers.occTarget != null
            ? <Lever id="occ" label="Target occupancy" unit="%" value={levers.occTarget} min={80} max={100} inputMin={50} inputMax={100} step={0.5}
                hint="Every property in scope moves to this physical occupancy." onChange={(occTarget) => setLevers({ ...levers, occTarget })} />
            : <Lever id="occd" label="Occupancy change" unit="pts" value={levers.occDeltaPts} min={-10} max={5} inputMin={-20} inputMax={20} step={0.5}
                hint={`From each property's T12 average (${formatPct(totals.occupancy)} across scope). Capped at 100%.`} onChange={(occDeltaPts) => setLevers({ ...levers, occDeltaPts })} />}
        </div>

        <Lever id="opex" label="Operating expense change" unit="%" value={levers.opexPct} min={-15} max={15} inputMin={-30} inputMax={30} step={0.5}
          hint="Payroll, repairs, utilities, insurance and taxes." onChange={(opexPct) => setLevers({ ...levers, opexPct })} />

        <details className="group rounded-md border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground"><Calculator className="size-3.5" />How this is calculated</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 leading-snug">
            <li>Baseline is the trailing 12 closed months ({period}) from monthly property metrics.</li>
            <li>Revenue = rent collected × (1 + rent change) × scenario occupancy ÷ baseline occupancy, so each property keeps its own collection rate, fees and concessions.</li>
            <li>Operating expenses = T12 expenses × (1 + expense change).</li>
            <li>NOI = revenue − expenses, plus any other income already in the baseline.</li>
            <li>Break-even occupancy is where scenario NOI reaches zero.</li>
          </ul>
        </details>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-5">
          <Tile label="T12 NOI (baseline)" value={usd(totals.noi_cents, "compact")} sub={`${totals.properties} ${totals.properties === 1 ? "property" : "properties"}`} />
          <Tile label="Scenario NOI" value={usd(totals.scenario_noi_cents, "compact")} sub="Annualized" strong />
          <Tile label="Change" value={signed(totals.delta_cents, "compact")} sub={signedPct(totals.delta_pct)} tone={totals.delta_cents} />
          <Tile label="NOI margin" value={formatPct(totals.margin)} sub={`was ${formatPct(totals.revenue_cents ? totals.noi_cents / totals.revenue_cents : null)}`} />
          <Tile label="Break-even occupancy" value={formatPct(totals.break_even_occupancy)} sub={`scenario ${formatPct(totals.scenario_occupancy)}`} />
        </div>

        <section className="rounded-lg border border-tone-ai/20 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--tone-ai)_5%,var(--card)),var(--card)_60%)]" aria-busy={busy} data-tour="whatif-explain">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <Sparkles className="size-3.5 text-tone-ai" />
            <h2 className="flex-1 text-[13px] font-semibold">Scenario explanation</h2>
            {narrative && <AIBadge source={narrative.source} model={narrative.source === "live" ? narrative.model : undefined} size="xs" />}
            {narrative && <Link href={`/app/ai/runs/${narrative.runId}`} className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">View run <ExternalLink className="size-3" /></Link>}
            <Button size="sm" variant={narrative ? "outline" : "default"} onClick={() => void explain()} disabled={busy}>
              <Sparkles /> {narrative ? "Explain again" : "Explain this scenario"}
            </Button>
          </div>
          <div className="px-4 pt-2 pb-3.5">
            {busy ? (
              <div className="flex flex-col gap-2 py-1">{[88, 72, 64].map((w) => <Skeleton key={w} className="h-3 bg-tone-ai/10" style={{ width: `${w}%` }} />)}</div>
            ) : error ? (
              <ErrorBanner title="The explanation couldn't run" message={error} onRetry={() => void explain()} />
            ) : narrative ? (
              <div className="flex flex-col gap-2">
                <p className="text-[13.5px] leading-relaxed font-medium">{narrative.text}</p>
                <ul className="flex flex-col gap-1 text-[12.5px] leading-snug">
                  {narrative.bullets.map((b) => <li key={b} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-tone-ai/60" />{b}</li>)}
                </ul>
                {narrative.note && <p className="text-[11.5px] text-muted-foreground">{narrative.note}</p>}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">The Owner Reporting Agent recomputes this scenario on the server and explains what drives the change, which properties move most and where the risk is. Every figure comes from the calculation, and the run is saved.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card">
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <h2 className="flex-1 text-[13px] font-semibold">NOI change by property</h2>
            <span className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-4)]" />Lower</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-1)]" />Higher</span>
            </span>
          </header>
          <Diverging rows={rows} />
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <h2 className="flex-1 text-[13px] font-semibold">{scopeLabel}</h2>
            <span className="text-[12px] text-muted-foreground">Annual figures · T12 {period}</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-[12px] whitespace-nowrap text-muted-foreground">
                <tr className="border-b">
                  <Th k="name" sort={sort} setSort={setSort}>Property</Th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Occupancy</th>
                  <Th k="noi_cents" sort={sort} setSort={setSort} right>Baseline NOI</Th>
                  <Th k="scenario_noi_cents" sort={sort} setSort={setSort} right>Scenario NOI</Th>
                  <Th k="delta_cents" sort={sort} setSort={setSort} right>Change</Th>
                  <Th k="delta_pct" sort={sort} setSort={setSort} right>Change %</Th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Break-even</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.property_id} className="h-[var(--row-h,36px)] border-b last:border-0 hover:bg-muted/40">
                    <td className="w-[34%] max-w-0 px-3 py-1.5">
                      <Link href={`/app/properties/${r.property_id}`} className="group flex min-w-0 items-center gap-2.5">
                        {seededPhoto(r.property_id)
                          // eslint-disable-next-line @next/next/no-img-element -- static 400px thumb; the Workers build has no image optimizer
                          ? <img src={seededPhoto(r.property_id)} alt="" loading="lazy" className="h-7 w-10 shrink-0 rounded object-cover ring-1 ring-border" />
                          : <Thumb size={28} />}
                        <span className="min-w-0">
                          <span className="block truncate font-medium group-hover:text-primary">{r.name}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">{r.metro}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                      {formatPct(r.scenario_occupancy)}
                      {Math.abs(r.scenario_occupancy - r.occupancy) > 0.0005 && <span className="ml-1 text-[11.5px] text-muted-foreground">from {formatPct(r.occupancy)}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.noi_cents)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{usd(r.scenario_noi_cents)}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", r.delta_cents < 0 ? "text-tone-danger" : r.delta_cents > 0 && "text-tone-success")}>{r.delta_cents ? signed(r.delta_cents) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.delta_cents ? signedPct(r.delta_pct) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatPct(r.break_even_occupancy)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 font-medium">
                <tr>
                  <td className="px-3 py-2">Total · {totals.properties} {totals.properties === 1 ? "property" : "properties"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPct(totals.scenario_occupancy)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(totals.noi_cents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(totals.scenario_noi_cents)}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", totals.delta_cents < 0 ? "text-tone-danger" : totals.delta_cents > 0 && "text-tone-success")}>{totals.delta_cents ? signed(totals.delta_cents) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{totals.delta_cents ? signedPct(totals.delta_pct) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPct(totals.break_even_occupancy)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Lever({ id, label, unit, value, min, max, inputMin, inputMax, step, hint, onChange }: {
  id: string; label: string; unit: string; value: number; min: number; max: number; inputMin: number; inputMax: number; step: number; hint: string; onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(inputMax, Math.max(inputMin, v));
  const pos = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`lever-${id}`} className="text-[12px] font-medium text-muted-foreground">{label}</label>
        <span className="flex items-center gap-1">
          <Input type="number" inputMode="decimal" aria-label={`${label} (${unit})`} value={value} min={inputMin} max={inputMax} step={step}
            onChange={(e) => e.target.value !== "" && Number.isFinite(Number(e.target.value)) && onChange(clamp(Number(e.target.value)))}
            className="h-7 w-[72px] text-right tabular-nums md:text-[13px]" />
          <span className="w-6 text-[12px] text-muted-foreground">{unit}</span>
        </span>
      </div>
      <input id={`lever-${id}`} type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-primary"
        style={{ background: `linear-gradient(to right, var(--primary) ${pos}%, var(--muted) ${pos}%)` }} />
      <div className="flex justify-between text-[10.5px] text-muted-foreground tabular-nums"><span>{min > 0 ? min : min}{unit === "%" ? "%" : ""}</span><span>{max}{unit === "%" ? "%" : ""}</span></div>
      <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

function Tile({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: number }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="truncate text-[12px] font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-[20px] leading-7 tracking-[-0.015em] tabular-nums", strong ? "font-semibold" : "font-medium", tone != null && tone < 0 && "text-tone-danger", tone != null && tone > 0 && "text-tone-success")}>{value}</div>
      {sub && <div className="truncate text-[11.5px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function Th({ k, sort, setSort, right, children }: { k: SortKey; sort: [SortKey, "asc" | "desc"]; setSort: (s: [SortKey, "asc" | "desc"]) => void; right?: boolean; children: React.ReactNode }) {
  const active = sort[0] === k;
  const Icon = sort[1] === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort[1] === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2 font-medium", right ? "text-right" : "text-left")}>
      <button type="button" onClick={() => setSort([k, active && sort[1] === "desc" ? "asc" : "desc"])} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {children}{active && <Icon className="size-3" />}
      </button>
    </th>
  );
}

// Diverging bars: one hue for gains, one for losses, a neutral zero axis in the middle.
function Diverging({ rows }: { rows: Result[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta_cents)));
  const ordered = [...rows].sort((a, b) => b.delta_cents - a.delta_cents);
  if (rows.every((r) => r.delta_cents === 0)) {
    return <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">No change yet. Move a lever or pick a preset to see the effect on each property.</p>;
  }
  return (
    <ol className="flex flex-col gap-0.5 px-4 py-3">
      {ordered.map((r) => {
        const w = (Math.abs(r.delta_cents) / max) * 50;
        const neg = r.delta_cents < 0;
        return (
          <li key={r.property_id}>
            <Link href={`/app/properties/${r.property_id}`} title={`${r.name}: ${signed(r.delta_cents)} (${signedPct(r.delta_pct)})`}
              className="group grid grid-cols-[minmax(0,180px)_1fr_88px] items-center gap-3 rounded px-1 py-[3px] text-[12px] hover:bg-muted/50">
              <span className="truncate text-muted-foreground group-hover:text-foreground">{r.name}</span>
              <span className="relative h-3.5">
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-border" aria-hidden />
                {r.delta_cents !== 0 && (
                  <span className={cn("absolute inset-y-0 rounded-[3px]", neg ? "rounded-r-none" : "rounded-l-none")}
                    style={{ width: `${Math.max(0.4, w)}%`, [neg ? "right" : "left"]: "50%", background: neg ? "var(--chart-4)" : "var(--chart-1)" }} />
                )}
              </span>
              <span className={cn("flex items-center justify-end gap-0.5 tabular-nums", neg ? "text-tone-danger" : r.delta_cents > 0 ? "text-tone-success" : "text-muted-foreground")}>
                {r.delta_cents ? signed(r.delta_cents, "compact") : "—"}<ArrowUpRight className="size-3 opacity-0 group-hover:opacity-60" />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
