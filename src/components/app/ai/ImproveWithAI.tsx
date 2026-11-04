"use client";

import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Bot, Cpu, ExternalLink, Loader2, ShieldCheck, Sparkles, UserRound, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDelta } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorBanner } from "@/components/app/states";
import { useShellMaybe } from "@/components/app/shell/context";
import { KpiCard, type KpiCardProps } from "@/components/app/dashboard/KpiCard";
import { formatValue } from "@/components/app/dashboard/fmt";
import type { ValueFormat } from "@/components/app/dashboard/types";
import { canImprove, improveKeyFor, isRed, type ExecuteResult, type ImproveKey, type PlanStep, type PlanSummary, type Preview, type Routing } from "@/ai/improve/meta";

// "Improve with AI" on a red KPI: a strip under the card opens a side panel with why the number is
// red (drivers computed from the records), what the agents can do (each step a real agent action,
// with its expected effect and the history behind it), "Have agents do this" (proposals through
// the normal agent runtime and approvals) and the plan's progress since it started.

type Kpi = { metric: string; property?: string; label: string; value: number | null; previous?: number | null; goodWhen?: "up" | "down"; format?: ValueFormat; deltaLabel?: string; red?: boolean };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

const qs = (key: ImproveKey, property?: string, full = false) => `/api/ai/improve?metric=${key}${property ? `&property=${property}` : ""}${full ? "&view=full" : ""}`;
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const dayOnly = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

// Whether this persona may use it on this card, whether the card is red, and the running plan's
// progress (fetched once per card, so a green card can still show what its plan did).
export function useImprove(k: Kpi) {
  const shell = useShellMaybe();
  const persona = shell?.data.persona;
  const key = improveKeyFor(k.metric);
  const allowed = !!key && !!persona && canImprove(persona.role, key, !!persona.portal);
  const red = !!key && (k.red ?? isRed(key, k));
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [open, setOpen] = useState(false);
  // A fresh panel (no earlier result) each time it opens.
  const [session, setSession] = useState(0);

  const loadPlan = useCallback(() => {
    if (!allowed || !key) return;
    void call<{ plan: PlanSummary | null }>(qs(key, k.property)).then((r) => setPlan(r.plan)).catch(() => undefined);
  }, [allowed, key, k.property]);
  useEffect(loadPlan, [loadPlan]);

  const shown = allowed && (red || !!plan);
  const strip = shown && key ? (
    <>
      <ImproveStrip red={red} plan={plan} label={k.label} onOpen={() => { setSession((n) => n + 1); setOpen(true); }} />
      <ImproveSheet key={session} open={open} onOpenChange={(o) => { setOpen(o); if (!o) loadPlan(); }} improve={key} kpi={k} />
    </>
  ) : null;
  return { shown, strip };
}

function ImproveStrip({ red, plan, label, onOpen }: { red: boolean; plan: PlanSummary | null; label: string; onOpen: () => void }) {
  const progress = plan?.outcome[0];
  return (
    <button type="button" onClick={onOpen} data-tour="improve-with-ai" aria-label={`Improve ${label} with AI`}
      className="group/imp flex w-full min-w-0 items-center gap-1.5 rounded-b-lg border border-t-0 bg-tone-ai/[0.04] px-3 py-1.5 text-left text-[11.5px] transition-colors hover:bg-tone-ai/[0.08] focus-visible:ring-2 focus-visible:ring-ring/60 outline-none">
      <Sparkles className="size-3 shrink-0 text-tone-ai" aria-hidden />
      {plan && progress ? (
        <span className="min-w-0 truncate text-muted-foreground"><span className="font-medium text-foreground">Plan since {dayOnly(plan.since)}:</span> {progress}</span>
      ) : (
        <span className="font-medium text-tone-ai">{red ? "Improve with AI" : "Plan with AI"}</span>
      )}
      <ArrowRight className="ml-auto size-3 shrink-0 text-muted-foreground transition-transform group-hover/imp:translate-x-0.5" aria-hidden />
    </button>
  );
}

// A KPI card with the strip under it, for server pages that render KpiCard directly.
export function ImprovableKpi({ metric, property, red, ...kpi }: KpiCardProps & { metric: string; property?: string; red?: boolean }) {
  const imp = useImprove({ metric, property, red, label: kpi.label, value: kpi.value, previous: kpi.previous, goodWhen: kpi.goodWhen, format: kpi.format, deltaLabel: kpi.deltaLabel });
  return (
    <div className="flex min-w-0 flex-col">
      <KpiCard {...kpi} className={cn("flex-1", imp.shown && "rounded-b-none", kpi.className)} />
      {imp.strip}
    </div>
  );
}

type Load = { status: "loading" | "done" | "error"; data?: Preview; error?: string };
const LOADING_STEPS = ["Reading the records behind this number", "Finding what drives it", "Matching each driver to an agent action"];

const ROUTING: Record<Routing, { label: string; tip: string; icon: typeof ShieldCheck; tone: string }> = {
  approvals: { label: "Goes to Approvals", tip: "Each proposal waits in Approvals until someone with approve access decides.", icon: ShieldCheck, tone: "bg-muted text-muted-foreground" },
  always_person: { label: "Always a person", tip: "Legal and safety actions never run on their own, whatever the agent's autonomy setting.", icon: UserRound, tone: "bg-tone-warning/10 text-tone-warning" },
  auto: { label: "Runs within policy", tip: "This agent is set to act within policy, and these are low-risk: they run and are logged, and you can review them in Approvals under Handled.", icon: Zap, tone: "bg-tone-ai/10 text-tone-ai" },
  auto_some: { label: "Within policy, rest to Approvals", tip: "Low-risk items inside the spend limit run on their own; anything over the limit, safety-related or higher risk waits in Approvals.", icon: Zap, tone: "bg-tone-ai/10 text-tone-ai" },
  person: { label: "You decide", tip: "No agent action exists for this; it's a step for a person.", icon: UserRound, tone: "bg-muted text-muted-foreground" },
};

function ImproveSheet({ open, onOpenChange, improve, kpi }: { open: boolean; onOpenChange: (o: boolean) => void; improve: ImproveKey; kpi: Kpi }) {
  const router = useRouter();
  const [state, setState] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const fetchPreview = useCallback(() => call<Preview>(qs(improve, kpi.property, true)).then((data): Load => ({ status: "done", data }), (e: Error): Load => ({ status: "error", error: e.message })), [improve, kpi.property]);
  const load = () => {
    setState({ status: "loading" });
    void fetchPreview().then(setState);
  };
  useEffect(() => {
    if (open) void fetchPreview().then(setState);
  }, [open, fetchPreview]);

  const d = state.data;
  const agentSteps = d?.steps.filter((s) => s.agent && s.records > 0) ?? [];
  const proposing = agentSteps.reduce((a, s) => a + s.records, 0);

  const run = async () => {
    setBusy(true);
    try {
      const steps = agentSteps.map((st) => ({ action: st.action, ids: st.ids }));
      const r = await call<ExecuteResult>("/api/ai/improve", { metric: improve, property: kpi.property, steps });
      setResult(r);
      toast.success(r.message, { action: { label: r.waiting ? "Open approvals" : "View run", onClick: () => router.push(r.waiting ? r.approvalsHref : r.runHref) } });
      load();
    } catch (e) {
      toast.error((e as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  };

  const wrongWay = kpi.value != null && kpi.previous != null && kpi.value !== kpi.previous && (kpi.value > kpi.previous) === ((kpi.goodWhen ?? "up") === "down");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-tour="improve-with-ai-panel" onOpenAutoFocus={(e) => e.preventDefault()} className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[540px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 pr-8 text-[15px]"><Sparkles className="size-4 shrink-0 text-tone-ai" />{kpi.label}: improve with AI</SheetTitle>
          <SheetDescription className="text-[12.5px]">{d ? `${d.scope} · from your records as of ${formatDate(d.asOf, "always")}` : "Why it's red, and what agents can do about it."}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4" aria-live="polite" aria-busy={state.status === "loading"}>
          <div className="flex items-end justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[11.5px] text-muted-foreground">{kpi.label}</div>
              <div className="text-[22px] leading-7 font-semibold tracking-tight tabular-nums">{formatValue(kpi.value, kpi.format)}</div>
            </div>
            {wrongWay && (
              <div className="text-right">
                <span className="inline-flex rounded bg-tone-danger/10 px-1.5 py-0.5 text-[12px] font-medium text-tone-danger tabular-nums">{kpi.value! > kpi.previous! ? "▲" : "▼"} {(formatDelta(kpi.value!, kpi.previous!) ?? "").replace(/^[+−]/, "")}</span>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">from {formatValue(kpi.previous, kpi.format)} {kpi.deltaLabel || "last month"}</div>
              </div>
            )}
          </div>

          {state.status === "loading" && (
            <>
              <ol className="flex flex-col gap-2 text-[12.5px] text-muted-foreground">
                <li className="flex items-center gap-2 font-medium text-foreground"><Loader2 className="size-3.5 animate-spin text-tone-ai motion-reduce:animate-none" />Working on it</li>
                {LOADING_STEPS.map((s) => <li key={s} className="flex items-center gap-2 pl-[22px]"><span className="size-1 rounded-full bg-muted-foreground/50" />{s}</li>)}
              </ol>
              <div className="flex flex-col gap-2">{[92, 84, 70, 58].map((w) => <Skeleton key={w} className="h-3 bg-tone-ai/10" style={{ width: `${w}%` }} />)}</div>
            </>
          )}
          {state.status === "error" && <ErrorBanner title="Couldn't build a plan" message={state.error ?? ""} onRetry={load} />}

          {state.status === "done" && d && (
            <>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold text-muted-foreground">Why it&rsquo;s red</h3>
                <p className="text-[13.5px] leading-relaxed font-medium">{d.headline}</p>
                {d.reasons.map((r) => <p key={r} className="mt-1 text-[12px] text-muted-foreground">{r}</p>)}
                {d.drivers.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {d.drivers.map((x) => (
                      <li key={x.text} className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 text-[12.5px] leading-snug">
                        <span>{x.text}</span>
                        {x.href ? <Link href={x.href} className="text-[11.5px] whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">View <ArrowRight className="inline size-3" /></Link> : <span />}
                        {x.share != null && (
                          <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <span className="block h-full rounded-full bg-tone-danger/60" style={{ width: `${Math.max(2, Math.min(100, x.share * 100))}%` }} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {d.plan && <PlanProgress plan={d.plan} />}

              <section>
                <h3 className="mb-2 text-[12px] font-semibold text-muted-foreground">What agents can do</h3>
                {d.steps.length ? (
                  <ol className="flex flex-col gap-2.5">{d.steps.map((s, i) => <StepCard key={s.key} step={s} n={i + 1} />)}</ol>
                ) : <p className="text-[12.5px] text-muted-foreground">Nothing for agents to do in this scope right now.</p>}
              </section>

              {result && (
                <div className="rounded-lg border border-tone-success/30 bg-tone-success/[0.06] px-3.5 py-2.5 text-[12.5px]" role="status">
                  <p className="font-medium">{result.message}</p>
                  <p className="mt-1 flex flex-wrap gap-3 text-[12px]">
                    {result.waiting > 0 && <Link href={result.approvalsHref} className="text-primary hover:underline">Open approvals <ArrowRight className="inline size-3" /></Link>}
                    <Link href={result.runHref} className="text-muted-foreground hover:text-foreground hover:underline">View run <ExternalLink className="inline size-3" /></Link>
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t bg-background px-5 py-3 sm:flex-row sm:items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded bg-muted px-1.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border ring-inset outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                <Cpu className="size-3" aria-hidden />Computed from your records
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">Drivers, plan and estimates come from your records by fixed rules. No model wrote these figures. Agents propose; money, legal and safety actions wait for a person.</TooltipContent>
          </Tooltip>
          <Button className="sm:ml-auto" disabled={busy || state.status !== "done" || !proposing} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Bot />}
            {busy ? "Agents are working…" : proposing ? `Have agents do this (${proposing})` : "Nothing new for agents"}
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function StepCard({ step: s, n }: { step: PlanStep; n: number }) {
  const r = ROUTING[s.routing];
  // Every eligible record already has this proposal open: nothing new for the agent here.
  const done = !!s.agent && s.records === 0;
  return (
    <li className={cn("rounded-lg border bg-card px-3.5 py-3", done && "bg-muted/30")}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">{n}</span>
        <span className={cn("min-w-0 flex-1 text-[13px] leading-snug font-medium", done && "text-muted-foreground")}>{done ? `${s.actionLabel}: all ${s.waiting} already proposed` : s.title}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60", r.tone)}><r.icon className="size-3" aria-hidden />{r.label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{r.tip}</TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 pl-7 text-[12px] leading-snug text-muted-foreground">{s.detail}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-[11.5px] text-muted-foreground">
        {s.agentName ? <span className="inline-flex items-center gap-1 text-foreground"><Bot className="size-3 text-tone-ai" aria-hidden />{s.agentName} · {s.actionLabel}</span> : <span className="inline-flex items-center gap-1 text-foreground"><UserRound className="size-3" aria-hidden />A person</span>}
        {s.agent && <span className="tabular-nums">{s.records} of {s.eligible} eligible</span>}
        {s.waiting > 0 && <Link href={`/app/ai/approvals?agent=${s.agent}`} className="tabular-nums hover:text-foreground hover:underline">{s.waiting} already waiting</Link>}
        {s.href && <Link href={s.href} className="ml-auto hover:text-foreground hover:underline">{s.agent ? "View records" : s.href.includes("what-if") ? "Open What-if" : "Open list"} <ArrowRight className="inline size-3" /></Link>}
      </div>
      {s.agent && !done && (
        <div className="mt-2 ml-7 rounded-md bg-muted/40 px-2.5 py-2 text-[12px]">
          {s.estimate ? (
            <>
              <p className="flex flex-wrap items-center gap-x-2"><span className="font-medium">Expected: {s.estimate.text}</span><span className={cn("rounded px-1 text-[10.5px] font-medium", s.estimate.confidence === "Low" ? "bg-tone-warning/10 text-tone-warning" : "bg-tone-ai/10 text-tone-ai")}>{s.estimate.confidence} confidence</span></p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{s.estimate.basis}</p>
            </>
          ) : (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{s.records} {s.records === 1 ? "record" : "records"}</span>{s.atStakeCents ? <>, <span className="tabular-nums">{usd(s.atStakeCents)}</span> at stake</> : null}. No estimate: there isn&rsquo;t enough history to back one.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function PlanProgress({ plan }: { plan: PlanSummary }) {
  const p = plan.proposals;
  return (
    <section className="rounded-lg border border-tone-ai/20 bg-tone-ai/[0.035] p-3.5">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="size-3.5 text-tone-ai" />Plan running since {dayTime(plan.since)}</h3>
      <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px]">
        {plan.outcome.map((o) => <li key={o} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-tone-ai/60" />{o}</li>)}
      </ul>
      <p className="mt-2 text-[11.5px] text-muted-foreground tabular-nums">
        {p.created} proposed · {p.waiting} waiting · {p.approved} approved{p.auto ? ` · ${p.auto} done within policy` : ""}{p.rejected ? ` · ${p.rejected} rejected` : ""}{plan.plans > 1 ? ` · ${plan.plans} plans` : ""}
      </p>
      <p className="mt-1.5 flex flex-wrap gap-3 text-[12px]">
        {p.waiting > 0 && <Link href={`/app/ai/approvals${new Set(plan.runs.map((r) => r.agent)).size === 1 ? `?agent=${plan.runs[0].agent}` : ""}`} className="text-primary hover:underline">Open approvals <ArrowRight className="inline size-3" /></Link>}
        <Link href={`/app/ai/runs/${plan.id}`} className="text-muted-foreground hover:text-foreground hover:underline">View run <ExternalLink className="inline size-3" /></Link>
      </p>
    </section>
  );
}
