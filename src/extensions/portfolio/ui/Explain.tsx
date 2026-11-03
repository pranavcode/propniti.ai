"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ExternalLink, Loader2, MessageCircleQuestion, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AIBadge } from "@/components/app/ai";
import { ErrorBanner } from "@/components/app/states";
import { useShellMaybe } from "@/components/app/shell/context";
import { KpiCard, type KpiCardProps } from "@/components/app/dashboard";

// "Explain this number": a sparkle button on any KPI opens a side sheet with the month-over-month
// change, the properties and drivers behind it, and the AI wording, labelled with its source and
// linked to the agent run that produced it.

type Kind = "money" | "pct" | "count";
type Mover = { property_id: string; property: string; value: number | null; prior: number | null; change: number; impact: number };
type Detail = {
  label: string; kind: Kind; goodWhen: "up" | "down"; scope: string; month: string; prior_month: string; value: number | null; prior: number | null; change: number | null;
  movers: Mover[]; drivers?: { label: string; delta_cents: number }[]; budget?: number | null;
};
type Result = { text: string; bullets: string[]; source: "live" | "rules"; model: string; runId: string; note?: string; detail: Detail };

const fmt = (kind: Kind, v: number | null) => (v == null ? "—" : kind === "money" ? formatMoney(v, "whole") : kind === "pct" ? formatPct(v, 1) : Math.round(v).toLocaleString("en-US"));
const fmtChange = (kind: Kind, d: number) => (kind === "pct" ? `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pts` : `${d >= 0 ? "+" : "−"}${fmt(kind, Math.abs(d))}`);
const monthName = (ym: string) => (ym ? new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
// Lower-case a label for mid-sentence use, but keep acronyms like NOI and SLA.
const lower = (s: string) => s.replace(/\b([A-Z])([a-z])/g, (_, a: string, b: string) => a.toLowerCase() + b);
const STEPS = ["Reading monthly metrics in your scope", "Splitting the change by property and driver", "Writing the explanation from those figures"];

type State = { status: "loading" | "done" | "error"; data?: Result; error?: string };

async function fetchExplain(metric: string, property?: string): Promise<State> {
  try {
    const res = await fetch("/app/portfolio/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ metric, property }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return { status: "done", data: body as Result };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

function ExplainSheet({ label, state, run, open, onOpenChange }: { label: string; state: State; run: () => void; open: boolean; onOpenChange: (o: boolean) => void }) {
  const shell = useShellMaybe();
  const d = state.data?.detail;
  const good = d?.change != null && d.change !== 0 ? (d.change > 0) === (d.goodWhen === "up") : null;
  const maxImpact = Math.max(1e-9, ...(d?.movers ?? []).map((m) => Math.abs(m.impact)));
  const maxDriver = Math.max(1, ...(d?.drivers ?? []).map((x) => Math.abs(x.delta_cents)));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-[15px]"><Sparkles className="size-4 text-tone-ai" />Why did {lower(label)} change?</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {d ? `${d.scope} · ${monthName(d.month)} vs ${monthName(d.prior_month)}` : "Month over month, from computed figures. The model only words them."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-5 py-4" aria-live="polite" aria-busy={state.status === "loading"}>
          {state.status === "loading" && (
            <>
              <ol className="flex flex-col gap-2 text-[12.5px] text-muted-foreground">
                <li className="flex items-center gap-2 font-medium text-foreground"><Loader2 className="size-3.5 animate-spin text-tone-ai motion-reduce:animate-none" />Working on it</li>
                {STEPS.map((s) => <li key={s} className="flex items-center gap-2 pl-[22px]"><span className="size-1 rounded-full bg-muted-foreground/50" />{s}</li>)}
              </ol>
              <div className="flex flex-col gap-2">{[95, 88, 76, 60].map((w) => <Skeleton key={w} className="h-3 bg-tone-ai/10" style={{ width: `${w}%` }} />)}</div>
            </>
          )}
          {state.status === "error" && <ErrorBanner title="Couldn't explain this number" message={state.error ?? ""} onRetry={() => void run()} />}
          {state.status === "done" && d && (
            <>
              <div className="flex items-end justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <div>
                  <div className="text-[11.5px] text-muted-foreground">{d.label} · {monthName(d.month)}</div>
                  <div className="text-[22px] leading-7 font-semibold tracking-tight tabular-nums">{fmt(d.kind, d.value)}</div>
                </div>
                {d.change != null && (
                  <div className="text-right">
                    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[12px] font-medium tabular-nums", good == null ? "bg-muted text-muted-foreground" : good ? "bg-tone-success/10 text-tone-success" : "bg-tone-danger/10 text-tone-danger")}>{fmtChange(d.kind, d.change)}</span>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">from {fmt(d.kind, d.prior)}</div>
                  </div>
                )}
              </div>

              <section className="rounded-lg border border-tone-ai/20 bg-tone-ai/[0.035] p-3.5">
                <p className="text-[13.5px] leading-relaxed font-medium">{state.data!.text}</p>
                {state.data!.bullets.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px] leading-snug">
                    {state.data!.bullets.map((b) => <li key={b} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-tone-ai/60" />{b}</li>)}
                  </ul>
                )}
                {state.data!.note && <p className="mt-2 text-[11.5px] text-muted-foreground">{state.data!.note}</p>}
              </section>

              {!!d.drivers?.length && (
                <section>
                  <h3 className="mb-2 text-[12px] font-semibold text-muted-foreground">NOI drivers</h3>
                  <ul className="flex flex-col gap-1.5">
                    {d.drivers.map((x) => (
                      <li key={x.label} className="grid grid-cols-[130px_1fr_84px] items-center gap-2 text-[12.5px]">
                        <span className="truncate">{x.label}</span>
                        <DivergingBar value={x.delta_cents} max={maxDriver} />
                        <span className={cn("text-right tabular-nums", x.delta_cents < 0 ? "text-tone-danger" : "text-tone-success")}>{x.delta_cents < 0 ? "−" : "+"}{formatMoney(Math.abs(x.delta_cents) / 100, "compact")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {d.movers.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[12px] font-semibold text-muted-foreground">Properties that moved it most</h3>
                  <ul className="flex flex-col divide-y rounded-lg border">
                    {d.movers.map((m) => {
                      const up = m.change > 0;
                      const ok = up === (d.goodWhen === "up");
                      return (
                        <li key={m.property_id}>
                          <Link href={`/app/properties/${m.property_id}?tab=financials`} className="grid grid-cols-[1fr_88px_82px] items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-muted/50">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{m.property}</span>
                              <span className="block text-[11.5px] text-muted-foreground tabular-nums">{fmt(d.kind, m.prior)} → {fmt(d.kind, m.value)}</span>
                            </span>
                            <DivergingBar value={m.impact} max={maxImpact} good={ok} />
                            <span className={cn("text-right font-medium tabular-nums", ok ? "text-tone-success" : "text-tone-danger")}>{fmtChange(d.kind, m.change)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <footer className="flex flex-wrap items-center gap-2 border-t pt-3 text-[12px] text-muted-foreground">
                <AIBadge source={state.data!.source} model={state.data!.source === "live" ? state.data!.model : undefined} />
                <Link href={`/app/ai/runs/${state.data!.runId}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">View run <ExternalLink className="size-3" /></Link>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => void run()}>Regenerate</Button>
                  {shell && (
                    <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); shell.assistant.ask(`Why did ${lower(d.label)} change in ${monthName(d.month)} for ${d.scope}?`, { path: "/app" }); }}>
                      <MessageCircleQuestion className="size-3.5" /> Ask a follow-up
                    </Button>
                  )}
                </span>
              </footer>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Centre-anchored bar: negative grows left, positive right, neutral axis in the middle.
function DivergingBar({ value, max, good }: { value: number; max: number; good?: boolean }) {
  const w = Math.max(2, (Math.abs(value) / max) * 50);
  const ok = good ?? value >= 0;
  return (
    <span className="relative h-2 rounded-full bg-muted" aria-hidden>
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
      <span className={cn("absolute inset-y-0 rounded-full", ok ? "bg-tone-success/70" : "bg-tone-danger/70")} style={value >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </span>
  );
}

export function ExplainButton({ metric, property, label, className, children }: { metric: string; property?: string; label: string; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "loading" });
  const run = () => {
    setState({ status: "loading" });
    void fetchExplain(metric, property).then(setState);
  };
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); run(); }} aria-label={`Explain ${label}`} title={`Explain ${label}`}
        className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-tone-ai transition-colors hover:bg-tone-ai/10 focus-visible:ring-2 focus-visible:ring-ring/60 outline-none", className)}>
        <Sparkles className="size-3" />{children ?? "Explain"}
      </button>
      <ExplainSheet label={label} state={state} run={run} open={open} onOpenChange={setOpen} />
    </>
  );
}

// A KPI card with "Explain" beside its title. The card itself still drills to the rows behind it.
export function ExplainableKpi({ metric, property, ...kpi }: KpiCardProps & { metric: string; property?: string }) {
  return (
    <div className="relative min-w-0">
      <KpiCard {...kpi} />
      <ExplainButton metric={metric} property={property} label={kpi.label} className="absolute top-2.5 right-8" />
    </div>
  );
}

export function ExplainLink({ metric, property, label }: { metric: string; property?: string; label: string }) {
  return <ExplainButton metric={metric} property={property} label={label}>Explain <ArrowRight className="size-3" /></ExplainButton>;
}
