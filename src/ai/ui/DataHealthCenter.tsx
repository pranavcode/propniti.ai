"use client";

import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCheck, Info, Lock, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FixPreview } from "@/components/app/ai";
import { Meter } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { pickFilter, ResultsSummary } from "@/components/app/ResultsSummary";
import { resultsSummary } from "@/components/app/results";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IssueFilters } from "@/ai/filters";
import { cn } from "@/lib/utils";
import { api } from "./client";
import { actOnIssue, fixPreviewProps, type Issue } from "./IssueFix";

type Health = {
  score: number; open: number; formula: string;
  properties: { id: string; name: string; metro: string; open: number; critical: number; score: number }[];
  modules: { module: string; open: number; entities: string[]; score: number }[];
  rules: { id: string; name: string; severity: string; entity_type: string; open: number; fixed: number }[];
};
type Mode = "safe" | "send";
type Preview = { count: number; more: boolean; cap: number };
const PILL: { key: keyof IssueFilters; label: string }[] = [
  { key: "rule", label: "Rule" }, { key: "property", label: "Property" }, { key: "entity", label: "Record type" }, { key: "entity_id", label: "Record" }, { key: "issue", label: "Issue" },
];

const SEVERITY: Record<string, string> = { critical: "critical", warn: "warning", info: "info" };
const words = (s: string) => s.replace(/_/g, " ");

// "Showing 64 open issues in Accounting at Preston Hollow Plaza" for the current filters.
function summary(health: Health, filters: IssueFilters, total: number) {
  const sev = filters.severity ? `${SEVERITY[filters.severity] ?? filters.severity} ` : "";
  const scope: string[] = [];
  if (filters.entity) {
    const m = health.modules.find((x) => x.entities.includes(filters.entity!));
    const name = m ? words(m.module).replace(/^./, (c) => c.toUpperCase()) : null;
    scope.push(name && m!.entities.length === 1 ? `in ${name}` : name ? `in ${name}: ${words(filters.entity)}` : `in ${words(filters.entity)}`);
  }
  if (filters.property) scope.push(`at ${health.properties.find((p) => p.id === filters.property)?.name ?? filters.property}`);
  if (filters.rule) scope.push(`from “${health.rules.find((r) => r.id === filters.rule)?.name ?? filters.rule}”`);
  if (filters.entity_id) scope.push(`on ${filters.entity_id}`);
  if (filters.issue) scope.push("for the linked issue");
  return resultsSummary(total, { one: `${sev}open issue`, many: `${sev}open issues` }, scope.join(" ") || undefined);
}

const tone = (score: number) => (score >= 95 ? "success" : score >= 85 ? "warning" : "danger") as "success" | "warning" | "danger";
const TEXT = { success: "text-tone-success", warning: "text-tone-warning", danger: "text-tone-danger" } as const;

export function DataHealthCenter({ health, issues, filters }: { health: Health; issues: { rows: Issue[]; total: number; page: number; size: number }; filters: IssueFilters }) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, "applied" | "dismissed" | "sent for approval">>({});
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ ...filters, ...o }).filter(([, v]) => v).map(([k, v]) => [k, v!])).toString();

  const act = async (id: string, action: "apply" | "dismiss") => {
    try {
      const r = await actOnIssue(id, action);
      setDone((d) => ({ ...d, [id]: r.queued ? "sent for approval" : action === "apply" ? "applied" : "dismissed" }));
      if (r.queued) toast.info(r.message, { action: { label: "Open approvals", onClick: () => router.push(`/app/ai/approvals?proposal=${r.proposalId}`) } });
      else toast.success(r.message);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  // Bulk buttons count every page that matches the filters, on the server: safe fixes this role may
  // apply, and (with a rule picked) fixes that need a person, to send to the approvals inbox at once.
  const match = JSON.stringify(filters);
  const [counts, setCounts] = useState<Partial<Record<Mode, Preview>>>({});
  const [confirm, setConfirm] = useState<{ mode: Mode; p: Preview } | null>(null);
  useEffect(() => {
    let live = true;
    const modes: Mode[] = filters.rule ? ["safe", "send"] : ["safe"];
    void Promise.all(modes.map((mode) => api<Preview>("/api/ai/data-health/bulk", "POST", { match: JSON.parse(match), mode, preview: true }).then((p) => [mode, p] as const)))
      .then((r) => { if (live) setCounts(Object.fromEntries(r)); }, () => {});
    return () => { live = false; };
  }, [match, filters.rule, issues]);
  const bulk = async (mode: Mode) => {
    setConfirm(null);
    try {
      const r = await api<{ applied: number; queued: number; runId: string; more: boolean }>("/api/ai/data-health/bulk", "POST", { match: filters, mode });
      const fixes = (n: number, kind = "") => `${n} ${kind}${n === 1 ? "fix" : "fixes"}`;
      const msg = mode === "safe" ? `Applied ${fixes(r.applied, "safe ")}${r.queued ? `; ${r.queued} sent to the approvals inbox` : ""}` : `Sent ${fixes(r.queued)} to the approvals inbox${r.applied ? `; applied ${r.applied}` : ""}`;
      toast.success(`${msg}${r.more ? ". More match: run it again for the rest." : ""}`, { action: { label: "See run", onClick: () => router.push(`/app/ai/runs/${r.runId}`) } });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const label = (p: Preview) => `${p.count}${p.more ? "+" : ""}`;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-5 px-4 pb-10 md:px-6">
      <section className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-[12px] text-muted-foreground">Portfolio data health</div>
          <div className={cn("mt-1 text-[34px] leading-none font-semibold tabular-nums", TEXT[tone(health.score)])}>{health.score}</div>
          <Meter value={health.score / 100} tone={tone(health.score)} className="mt-3" />
          <p className="mt-2 text-[12px] text-muted-foreground">
            {health.open.toLocaleString("en-US")} open issues.{" "}
            <Tooltip>
              <TooltipTrigger asChild><button className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"><Info className="size-3" /> How is this scored?</button></TooltipTrigger>
              <TooltipContent className="max-w-xs">{health.formula}</TooltipContent>
            </Tooltip>
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.modules.slice(0, 8).map((m) => {
            const on = !!filters.entity && m.entities.includes(filters.entity);
            return (
            <Link key={m.module} href={qs({ entity: on ? undefined : m.entities[0], page: undefined })} scroll={false} onClick={pickFilter} aria-current={on || undefined} className={cn("rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40", on && "border-primary bg-primary/[0.06] ring-1 ring-primary hover:bg-primary/[0.08]")}>
              <div className="flex items-center justify-between text-[12px]"><span className="font-medium capitalize">{m.module.replace(/_/g, " ")}</span><span className={cn("font-semibold tabular-nums", TEXT[tone(m.score)])}>{m.score}</span></div>
              <Meter value={m.score / 100} tone={tone(m.score)} className="mt-2" />
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">{m.open} open · {m.entities.map((e) => e.replace(/_/g, " ")).join(", ")}</div>
            </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <ResultsSummary text={filtered ? summary(health, filters, issues.total) : undefined} clear={qs(Object.fromEntries([...PILL.map((x) => [x.key, undefined]), ["severity", undefined], ["page", undefined]]))} />
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {["", "critical", "warn", "info"].map((s) => <Link key={s} href={qs({ severity: s || undefined, page: undefined })} scroll={false} onClick={pickFilter} aria-current={(filters.severity ?? "") === s || undefined} className={cn("rounded-full border px-2.5 py-0.5 capitalize", (filters.severity ?? "") === s ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>{s || "All severities"}</Link>)}
            {PILL.filter((x) => filters[x.key]).map((x) => (
              <span key={x.key} className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 py-0.5 pr-1 pl-2.5 text-primary">
                {x.label}: {x.key === "rule" ? health.rules.find((r) => r.id === filters.rule)?.name ?? filters.rule : x.key === "property" ? health.properties.find((p) => p.id === filters.property)?.name ?? filters.property : String(filters[x.key]).replace(/_/g, " ")}
                <Link href={qs({ [x.key]: undefined, page: undefined })} scroll={false} onClick={pickFilter} aria-label={`Remove ${x.label.toLowerCase()} filter`} className="rounded-full p-0.5 hover:bg-primary/15"><X className="size-3" /></Link>
              </span>
            ))}
            {PILL.filter((x) => filters[x.key]).length > 1 && <Link href={qs(Object.fromEntries(PILL.map((x) => [x.key, undefined])))} scroll={false} onClick={pickFilter} className="text-primary hover:underline">Clear filters</Link>}
            <span className="ml-auto flex gap-1.5">
              {!!counts.send?.count && <Button size="sm" variant="outline" onClick={() => setConfirm({ mode: "send", p: counts.send! })}><Lock /> Send all {label(counts.send)} for approval</Button>}
              {!!counts.safe?.count && <Button size="sm" variant="outline" onClick={() => setConfirm({ mode: "safe", p: counts.safe! })}><CheckCheck /> Apply {label(counts.safe)} safe fixes</Button>}
            </span>
          </div>
          {issues.rows.length ? issues.rows.map((i) => done[i.id] ? (
            <div key={i.id} className="rounded-lg border border-dashed p-3 text-[12.5px] text-muted-foreground">{i.rule_name ?? i.rule_id} on {i.entity_type.replace(/_/g, " ")} {i.entity_id}: {done[i.id]}.</div>
          ) : (
            <FixPreview key={i.id} {...fixPreviewProps(i, (a) => act(i.id, a))} />
          )) : <EmptyState kind="filtered" title="No open issues here" description="Every rule passes for this filter. The Data Health Agent re-checks the rules every morning." />}
          <div className="flex items-center justify-end gap-3 text-[12px] text-muted-foreground">
            <span>{issues.total} issues · page {issues.page} of {Math.max(1, Math.ceil(issues.total / issues.size))}</span>
            {issues.page > 1 && <Link className="text-primary hover:underline" href={qs({ page: String(issues.page - 1) })} scroll={false} onClick={pickFilter}>Previous</Link>}
            {issues.page * issues.size < issues.total && <Link className="text-primary hover:underline" href={qs({ page: String(issues.page + 1) })} scroll={false} onClick={pickFilter}>Next</Link>}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-lg border bg-card">
            <h2 className="border-b px-3 py-2 text-[13px] font-semibold">By property</h2>
            <ul className="max-h-[420px] overflow-y-auto">
              {[...health.properties].sort((a, b) => a.score - b.score).map((p) => (
                <li key={p.id}><Link href={qs({ property: p.id, page: undefined })} scroll={false} onClick={pickFilter} aria-current={filters.property === p.id || undefined} className={cn("flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-muted/40", filters.property === p.id && "bg-primary/[0.08] font-medium text-primary")}><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-[11px] text-muted-foreground">{p.open}</span><span className={cn("w-8 text-right font-semibold tabular-nums", TEXT[tone(p.score)])}>{p.score}</span></Link></li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-card">
            <h2 className="border-b px-3 py-2 text-[13px] font-semibold">Rules</h2>
            <ul>
              {health.rules.map((r) => (
                <li key={r.id}><Link href={qs({ rule: r.id, page: undefined })} scroll={false} onClick={pickFilter} aria-current={filters.rule === r.id || undefined} className={cn("flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-muted/40", filters.rule === r.id && "bg-primary/[0.08] font-medium text-primary")}><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="text-[11px] text-muted-foreground">{r.fixed} fixed</span><span className="w-6 text-right font-medium tabular-nums">{r.open}</span></Link></li>
              ))}
            </ul>
          </div>
        </aside>
      </section>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent data-surface="app">
          <DialogHeader>
            <DialogTitle>{confirm?.mode === "send" ? `Send ${confirm.p.count} fixes for approval?` : `Apply ${confirm?.p.count} safe fixes?`}</DialogTitle>
            <DialogDescription>
              {confirm?.mode === "send"
                ? "Every matching fix that needs a person goes to the approvals inbox, with its reasons and evidence. Nothing changes until someone with the right role approves it. Fixes already waiting there are skipped."
                : "Every matching fix your role may apply directly: field corrections only, no money, fraud, legal or critical fixes. Each one is logged with before and after values."}
              {confirm?.p.more ? ` At most ${confirm.p.cap} per click; more match, so run it again for the rest.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm && <Button onClick={() => void bulk(confirm.mode)}>{confirm.mode === "send" ? <><Lock /> Send {confirm.p.count}</> : <><CheckCheck /> Apply {confirm.p.count}</>}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
