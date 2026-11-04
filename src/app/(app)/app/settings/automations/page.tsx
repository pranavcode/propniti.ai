import Link from "next/link";
import { Sparkles, Workflow } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { list } from "@/server/query";
import { cn } from "@/lib/utils";
import { AGENT_LABEL } from "@/ai/ui/client";
import { NoAccess, settingsSession } from "@/extensions/settings/pages";
import { canEditSettings, canSettings } from "@/extensions/settings/nav";
import { AutomationSwitch } from "@/extensions/settings/ui/forms";

export const metadata = { title: "Automations · Propniti" };

type A = { id: string; name: string; kind: string; enabled: boolean; agent: string | null; trigger_spec: { event?: string; schedule?: string } | null; action: { action?: string } | null; runs_30d: number; failed_30d: number; last_run_at: string | null };
type Run = { id: string; summary: string; status: string; started_at: string; rule_id: string; rule_id__label?: string };

const trigger = (t: A["trigger_spec"]) => (t?.event ? `When ${t.event.replace(/[._]/g, " ")}` : t?.schedule ? `On schedule (${t.schedule})` : "Manual");

export default async function AutomationsPage() {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const canEdit = canEditSettings(session.actor.role);
  const [rules, runs] = await Promise.all([
    list(ctx, "automation_rules", { size: 100, sort: ["name", "asc"] }),
    list(ctx, "automation_runs", { size: 12, sort: ["started_at", "desc"], rowsOnly: true }),
  ]);
  const all = rules.rows as unknown as A[];
  const recent = runs.rows as unknown as Run[];
  const on = all.filter((a) => a.enabled).length;
  const runs30 = all.reduce((s, a) => s + Number(a.runs_30d ?? 0), 0);
  const failed30 = all.reduce((s, a) => s + Number(a.failed_30d ?? 0), 0);
  return (
    <>
      <PageHeader icon={<Workflow />} title="Automations" description="Rules and workflows that run on events or a schedule. They can send messages and create tasks on their own; anything that moves money or changes a lease becomes an approval."
        meta={all.length ? <><span>{on} of {all.length} on</span><span>{runs30.toLocaleString("en-US")} runs in 30 days</span><span className={failed30 ? "text-tone-danger" : undefined}>{failed30} failed</span></> : undefined}
        actions={<Link href="/app/settings/automations/runs" className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] hover:bg-muted">Run log</Link>} />
      <PageBody>
        {!all.length ? (
          <EmptyState kind="table" title="No automations yet" description="Automations run reminders, late fees, renewal offers and COI requests for you. They appear here once created." />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr><th className="w-14 px-3 py-2 font-medium">On</th><th className="px-3 py-2 font-medium">Automation</th><th className="px-3 py-2 font-medium">Trigger</th><th className="px-3 py-2 text-right font-medium">Runs (30 days)</th><th className="px-3 py-2 text-right font-medium">Failed</th><th className="px-3 py-2 font-medium">Last run</th></tr>
              </thead>
              <tbody>
                {all.map((a) => (
                  <tr key={a.id} className={cn("border-t", a.enabled ? "" : "text-muted-foreground")}>
                    <td className="px-3 py-2"><AutomationSwitch id={a.id} name={a.name} enabled={a.enabled} canEdit={canEdit} /></td>
                    <td className="px-3 py-2">
                      <Link href={`/app/settings/automations/${encodeURIComponent(a.id)}`} className="font-medium text-foreground hover:text-primary hover:underline">{a.name}</Link>
                      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                        <span>{a.kind}</span>
                        {a.agent && <span className="inline-flex items-center gap-0.5 text-tone-ai"><Sparkles className="size-3" />{AGENT_LABEL[a.agent] ?? a.agent.replace(/_/g, " ")}</span>}
                        {a.action?.action && <span className="font-mono text-[11px]">{a.action.action}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[12.5px]">{trigger(a.trigger_spec)}</td>
                    <td className="px-3 py-2 text-right tabular-nums"><Link href={`/app/settings/automations/runs?f.rule_id=${encodeURIComponent(a.id)}`} className="hover:text-primary hover:underline">{Number(a.runs_30d).toLocaleString("en-US")}</Link></td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.failed_30d ? <Link href={`/app/settings/automations/runs?f.rule_id=${encodeURIComponent(a.id)}&f.status=Failed`} className="text-tone-danger hover:underline">{a.failed_30d}</Link> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="px-3 py-2 text-[12.5px]">{a.last_run_at ? <RelativeDate value={a.last_run_at} /> : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Section title="Latest runs" actions={<Link href="/app/settings/automations/runs" className="text-[12.5px] text-primary hover:underline">All runs</Link>}>
          {!recent.length ? <EmptyState compact kind="table" title="No runs yet" description="Each time an automation fires, the record it acted on and the result appear here." /> : (
            <ol className="divide-y rounded-lg border bg-card">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <StatusBadge value={r.status} enumDef={[{ value: "Succeeded", tone: "success" }, { value: "Needs approval", tone: "warning" }, { value: "Skipped", tone: "neutral" }, { value: "Failed", tone: "danger" }]} />
                  <Link href={`/app/settings/automations/runs/${encodeURIComponent(r.id)}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{r.summary}</Link>
                  <span className="text-[12px] text-muted-foreground">{r.rule_id__label ?? r.rule_id}</span>
                  <RelativeDate value={r.started_at} className="text-[12px] text-muted-foreground" />
                </li>
              ))}
            </ol>
          )}
        </Section>
      </PageBody>
    </>
  );
}
