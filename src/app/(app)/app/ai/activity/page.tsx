import Link from "@/components/Link";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { AIBadge } from "@/components/app/ai";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { sql } from "@/ai/data";
import { baseOf } from "@/server/effective";
import { AGENT_LABEL, agentName, runStatusLabel } from "@/ai/ui/labels";
import { PERMISSIONS } from "@/auth/personas";
import { pageData } from "@/ai/ui/server";
import { runsPage } from "@/ai/views";

export const metadata = { title: "AI activity · Propniti" };

const TONE = { running: "ai", waiting_approval: "warning", done: "success", failed: "danger", queued: "info" } as const;
const TRIGGER: Record<string, string> = { schedule: "Schedule", event: "Event", manual: "Run now", chat: "Assistant" };

// AI activity: every agent run (schedule, event, Run now, assistant) and the audit log of AI
// actions and decisions. Each run opens to its step trace.
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { data } = await pageData();
  const tab = sp.tab === "audit" ? "audit" : "runs";
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (o: Record<string, string | number | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const runs = tab === "runs" ? await runsPage(data, { agent: sp.agent, status: sp.status, trigger: sp.trigger, page, size: 50 }) : null;
  // Property rows follow the persona's scope; org-level rows (no property) need settings access.
  const ids = data.actor.propertyIds;
  const orgRows = (PERMISSIONS[data.actor.role].settings ?? "none") !== "none" ? "audit.property_id IS NULL OR " : "";
  const auditScope = ids === "all" ? { sql: orgRows ? "1 = 1" : "audit.property_id IS NOT NULL", params: [] as unknown[] } : { sql: `(${orgRows}audit.property_id IN (SELECT value FROM json_each(?)))`, params: [JSON.stringify(ids)] as unknown[] };
  const audit = tab === "audit"
    ? await sql<Record<string, unknown>>(data, `SELECT at, actor, role, agent, model, action, entity_type, entity_id, detail FROM audit WHERE workspace_id IN (?, '${baseOf(data.ws)}') AND ${auditScope.sql} AND (agent IS NOT NULL OR action LIKE '%approved%' OR action LIKE '%rejected%' OR action LIKE 'agent.%' OR action LIKE 'data_issue.%' OR action LIKE 'approval_policy.%') ORDER BY at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, [data.ws, ...auditScope.params])
    : [];
  const filters = [["", "All agents"], ...Object.entries(AGENT_LABEL)];
  return (
    <div>
      <PageHeader icon={<Activity />} title="AI activity" description="Every agent run with what triggered it, the model, tokens and cost, and every AI decision in the audit log.">
        <div className="flex flex-wrap items-center gap-1 border-b">
          {(["runs", "audit"] as const).map((t) => <Link key={t} href={qs({ tab: t, page: undefined })} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", tab === t ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{t === "runs" ? "Runs" : "Audit log"}</Link>)}
        </div>
      </PageHeader>
      <div className="mt-3 space-y-3 px-4 pb-10 md:px-6">
        {tab === "runs" && runs && (
          <>
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              {filters.map(([k, label]) => <Link key={k} href={qs({ agent: k || undefined, page: undefined })} className={cn("rounded-full border px-2.5 py-0.5", (sp.agent ?? "") === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>{label}</Link>)}
            </div>
            {runs.rows.length ? (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-muted/50 text-left text-[11.5px] text-muted-foreground"><tr>{["Agent", "Status", "Trigger", "Started", "Steps", "Proposals", "Model", "Tokens", "Summary"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {runs.rows.map((r) => (
                      <tr key={String(r.id)} className="h-[var(--row-h)] border-t hover:bg-muted/40">
                        <td className="px-3"><Link className="font-medium hover:underline" href={`/app/ai/runs/${r.id}`}>{agentName(String(r.agent_key))}</Link></td>
                        <td className="px-3"><StatusBadge value={String(r.status)} label={runStatusLabel(String(r.status))} tone={TONE[r.status as keyof typeof TONE] ?? "neutral"} /></td>
                        <td className="px-3 text-muted-foreground">{TRIGGER[String(r.trigger_kind)] ?? String(r.trigger_kind)}</td>
                        <td className="px-3 whitespace-nowrap"><RelativeDate value={String(r.started_at)} /></td>
                        <td className="px-3 tabular-nums">{formatNumber(Number(r.steps))}</td>
                        <td className="px-3 tabular-nums">{formatNumber(Number(r.proposals))}</td>
                        <td className="px-3"><AIBadge size="xs" source={!r.model || r.model === "rules" ? "rules" : "precomputed"} model={String(r.model ?? "rules")} /></td>
                        <td className="px-3 text-muted-foreground tabular-nums">{formatNumber(Number(r.tokens_in) + Number(r.tokens_out) || null)}</td>
                        <td className="max-w-md truncate px-3 text-muted-foreground" title={String(r.summary ?? r.error ?? "")}>{String(r.summary ?? r.error ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState kind="table" title="No runs yet" description="Runs appear when a schedule fires, an event arrives, someone presses Run now, or the assistant answers." action={{ label: "Open agents", href: "/app/agents" }} />
            )}
            <div className="flex items-center justify-end gap-3 text-[12px] text-muted-foreground">
              <span>{runs.total} runs · page {page} of {Math.max(1, Math.ceil(runs.total / runs.size))}</span>
              {page > 1 && <Link className="text-primary hover:underline" href={qs({ page: page - 1 })}>Previous</Link>}
              {page * runs.size < runs.total && <Link className="text-primary hover:underline" href={qs({ page: page + 1 })}>Next</Link>}
            </div>
          </>
        )}
        {tab === "audit" && (
          audit.length ? (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[11.5px] text-muted-foreground"><tr>{["When", "Who", "Agent / model", "Action", "Record", "Detail"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {audit.map((a, i) => (
                    <tr key={i} className="h-[var(--row-h)] border-t">
                      <td className="px-3 whitespace-nowrap"><RelativeDate value={String(a.at)} /></td>
                      <td className="px-3">{String(a.actor)}<span className="ml-1 text-[11px] text-muted-foreground">{a.role ? String(a.role).replace(/_/g, " ") : ""}</span></td>
                      <td className="px-3 text-muted-foreground">{a.agent ? `${agentName(String(a.agent))}${a.model ? ` · ${a.model}` : ""}` : "—"}</td>
                      <td className="px-3">{String(a.action)}</td>
                      <td className="px-3 text-muted-foreground">{a.entity_type ? `${a.entity_type} ${a.entity_id}` : ""}</td>
                      <td className="max-w-md truncate px-3 text-muted-foreground" title={String(a.detail ?? "")}>{String(a.detail ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState kind="table" title="No AI decisions yet" description="Approvals, rejections, auto-applied actions and agent setting changes are logged here." />
        )}
      </div>
    </div>
  );
}
