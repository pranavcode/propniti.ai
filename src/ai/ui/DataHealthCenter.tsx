"use client";

import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCheck, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FixPreview } from "@/components/app/ai";
import { Meter } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "./client";

type Health = {
  score: number; open: number; formula: string;
  properties: { id: string; name: string; metro: string; open: number; critical: number; score: number }[];
  modules: { module: string; open: number; entities: string[]; score: number }[];
  rules: { id: string; name: string; severity: string; entity_type: string; open: number; fixed: number }[];
};
type Issue = {
  id: string; rule_id: string; rule_name: string | null; rule_description: string | null; entity_type: string; entity_id: string; property: string | null; severity: string; detected_at: string;
  suggested_fix: { why?: string[]; confidence?: number; source?: string; merge_into?: string } | null; before: Record<string, unknown> | null; after: Record<string, unknown>; needsPerson: string | null; href?: string; evidence: Record<string, unknown>;
};

const tone = (score: number) => (score >= 95 ? "success" : score >= 85 ? "warning" : "danger") as "success" | "warning" | "danger";
const TEXT = { success: "text-tone-success", warning: "text-tone-warning", danger: "text-tone-danger" } as const;

export function DataHealthCenter({ health, issues, filters }: { health: Health; issues: { rows: Issue[]; total: number; page: number; size: number }; filters: Record<string, string | undefined> }) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, "applied" | "dismissed" | "sent for approval">>({});
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ ...filters, ...o }).filter(([, v]) => v).map(([k, v]) => [k, v!])).toString();

  const act = async (id: string, action: "apply" | "dismiss") => {
    try {
      const r = await api<{ message: string; queued?: boolean; proposalId?: string }>(`/api/ai/data-health/issues/${id}`, "POST", { action });
      setDone((d) => ({ ...d, [id]: r.queued ? "sent for approval" : action === "apply" ? "applied" : "dismissed" }));
      if (r.queued) toast.info(r.message, { action: { label: "Open approvals", onClick: () => router.push(`/app/ai/approvals?proposal=${r.proposalId}`) } });
      else toast.success(r.message);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  const noFix = (i: Issue) => !Object.keys(i.after ?? {}).length && !i.suggested_fix?.merge_into;
  const safe = issues.rows.filter((i) => !i.needsPerson && !done[i.id] && Object.keys(i.after ?? {}).length);
  const bulk = async () => {
    try {
      const r = await api<{ applied: number; queued: number; runId: string }>("/api/ai/data-health/bulk", "POST", { ids: safe.map((i) => i.id) });
      toast.success(`Applied ${r.applied} safe fixes${r.queued ? `; ${r.queued} sent to the approvals inbox` : ""}`, { action: { label: "See run", onClick: () => router.push(`/app/ai/runs/${r.runId}`) } });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

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
          {health.modules.slice(0, 8).map((m) => (
            <Link key={m.module} href={qs({ entity: m.entities[0], page: undefined })} className="rounded-lg border bg-card p-3 hover:bg-muted/40">
              <div className="flex items-center justify-between text-[12px]"><span className="font-medium capitalize">{m.module.replace(/_/g, " ")}</span><span className={cn("font-semibold tabular-nums", TEXT[tone(m.score)])}>{m.score}</span></div>
              <Meter value={m.score / 100} tone={tone(m.score)} className="mt-2" />
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">{m.open} open · {m.entities.map((e) => e.replace(/_/g, " ")).join(", ")}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {["", "critical", "warn", "info"].map((s) => <Link key={s} href={qs({ severity: s || undefined, page: undefined })} className={cn("rounded-full border px-2.5 py-0.5 capitalize", (filters.severity ?? "") === s ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>{s || "All severities"}</Link>)}
            {(filters.rule || filters.property || filters.entity) && <Link href={qs({ rule: undefined, property: undefined, entity: undefined })} className="text-primary hover:underline">Clear filters</Link>}
            {safe.length > 0 && <Button size="sm" variant="outline" className="ml-auto" onClick={() => void bulk()}><CheckCheck /> Apply {safe.length} safe fixes</Button>}
          </div>
          {issues.rows.length ? issues.rows.map((i) => done[i.id] ? (
            <div key={i.id} className="rounded-lg border border-dashed p-3 text-[12.5px] text-muted-foreground">{i.rule_name ?? i.rule_id} on {i.entity_type.replace(/_/g, " ")} {i.entity_id}: {done[i.id]}.</div>
          ) : (
            <FixPreview
              key={i.id}
              title={`${i.rule_name ?? i.rule_id} · ${i.entity_type.replace(/_/g, " ")} ${i.entity_id}${i.property ? ` · ${i.property}` : ""}`}
              rule={i.rule_id}
              changes={Object.entries(i.after ?? {}).map(([field, after]) => ({ field, label: field.replace(/_/g, " "), before: i.before?.[field] ?? i.evidence?.[field] ?? null, after }))}
              why={i.suggested_fix?.why ?? [i.rule_description ?? "Flagged by a data rule"]}
              confidence={i.suggested_fix?.confidence ?? 0.7}
              source={i.suggested_fix?.source === "rule" || !i.suggested_fix?.source ? "rule" : "Data Health Agent"}
              needsPerson={noFix(i) ? "No automatic fix: open the record to correct it" : i.needsPerson}
              onApply={noFix(i) ? undefined : () => act(i.id, "apply")}
              onDismiss={() => act(i.id, "dismiss")}
            />
          )) : <EmptyState kind="filtered" title="No open issues here" description="Every rule passes for this filter. The Data Health Agent re-checks the rules every morning." />}
          <div className="flex items-center justify-end gap-3 text-[12px] text-muted-foreground">
            <span>{issues.total} issues · page {issues.page} of {Math.max(1, Math.ceil(issues.total / issues.size))}</span>
            {issues.page > 1 && <Link className="text-primary hover:underline" href={qs({ page: String(issues.page - 1) })}>Previous</Link>}
            {issues.page * issues.size < issues.total && <Link className="text-primary hover:underline" href={qs({ page: String(issues.page + 1) })}>Next</Link>}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-lg border bg-card">
            <h2 className="border-b px-3 py-2 text-[13px] font-semibold">By property</h2>
            <ul className="max-h-[420px] overflow-y-auto">
              {[...health.properties].sort((a, b) => a.score - b.score).map((p) => (
                <li key={p.id}><Link href={qs({ property: p.id, page: undefined })} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-muted/40"><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-[11px] text-muted-foreground">{p.open}</span><span className={cn("w-8 text-right font-semibold tabular-nums", TEXT[tone(p.score)])}>{p.score}</span></Link></li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-card">
            <h2 className="border-b px-3 py-2 text-[13px] font-semibold">Rules</h2>
            <ul>
              {health.rules.map((r) => (
                <li key={r.id}><Link href={qs({ rule: r.id, page: undefined })} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-muted/40"><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="text-[11px] text-muted-foreground">{r.fixed} fixed</span><span className="w-6 text-right font-medium tabular-nums">{r.open}</span></Link></li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}
