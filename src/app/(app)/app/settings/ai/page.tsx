import Link from "@/components/Link";
import { Cpu, ShieldCheck, Sparkles } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { Term } from "@/components/app/Term";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { agentCards, aiStatus } from "@/ai/views";
import { autonomyLevel } from "@/ai/automations";
import { pageData } from "@/ai/ui/server";
import { NoAccess } from "@/extensions/settings/pages";
import { canSettings } from "@/extensions/settings/nav";

export const metadata = { title: "AI settings · Propniti" };


export default async function AiSettingsPage() {
  const { data, persona } = await pageData();
  if (!canSettings(persona.role)) return <NoAccess />;
  const [status, agents] = await Promise.all([aiStatus(data), agentCards(data)]);
  const auto = agents.filter((a) => a.enabled && a.autonomy === "auto_within_policy").length;
  return (
    <>
      <PageHeader icon={<Sparkles />} title="AI settings" description="Which model the agents and the assistant use, how much each agent may do alone, and how your data is handled."
        actions={<Link href="/app/agents" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90">Manage agents</Link>} />
      <PageBody>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Cpu className="size-3.5" />Model in use</div>
            <div className="mt-1 text-[16px] font-semibold">{status.label}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">{status.live ? `Provider: ${status.provider}. Answers and drafts are generated live; every figure comes from your data, not the model.` : "No model is configured, so agents and the assistant run on deterministic rules. Every AI label in the app says “rules” while this is the case."}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><ShieldCheck className="size-3.5" /><Term>Autonomy</Term></div>
            <div className="mt-1 text-[16px] font-semibold tabular-nums">{auto} of {agents.length} agents act alone within policy</div>
            <div className="mt-1 text-[12px] text-muted-foreground">Money, legal and safety actions over a limit always wait for a person. <Link href="/app/settings/approvals" className="text-primary hover:underline">Approval policies</Link></div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[12px] text-muted-foreground">Scheduled sweep</div>
            <div className="mt-1 text-[16px] font-semibold">{status.lastSweepAt ? <>Last ran <RelativeDate value={status.lastSweepAt} /></> : "Not run yet"}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">Agents also run on events (a payment fails, a COI nears expiry) and when someone presses Run now.</div>
          </div>
        </div>

        <Section title="Agents" description="Defaults for each agent. Change autonomy, schedules and triggers on the Agents page.">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr className="whitespace-nowrap"><th className="px-3 py-2 font-medium">Agent</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium"><Term>Autonomy</Term></th><th className="px-3 py-2 text-right font-medium">Runs, 30 days</th><th className="px-3 py-2 text-right font-medium">Success</th><th className="px-3 py-2 text-right font-medium">Waiting</th><th className="px-3 py-2 font-medium">Last run</th></tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  // Two levels at runtime; a saved "suggest" behaves as Approve first.
                  const au = autonomyLevel(a.autonomy);
                  return (
                    <tr key={a.key} className="border-t">
                      <td className="px-3 py-2"><div className="font-medium">{a.name}</div><div className="max-w-[26rem] truncate text-[12px] text-muted-foreground" title={a.goal}>{a.goal}</div></td>
                      <td className="px-3 py-2"><StatusBadge value={a.enabled ? "On" : "Off"} tone={a.enabled ? "success" : "neutral"} /></td>
                      <td className="px-3 py-2"><StatusBadge value={au.label} tone={au.value === "auto_within_policy" ? "ai" : "info"} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.runs30}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.successRate == null ? "—" : `${a.successRate}%`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.pending ? <Link href={`/app/ai/approvals?agent=${a.key}`} className="text-primary hover:underline">{a.pending}</Link> : 0}</td>
                      <td className="px-3 py-2 text-[12.5px] whitespace-nowrap">{a.lastRun ? <Link href={`/app/ai/runs/${a.lastRun.id}`} className="hover:text-primary hover:underline"><RelativeDate value={a.lastRun.started_at} /></Link> : "Never"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="How your data is used">
          <ul className="grid gap-2 rounded-lg border bg-card p-4 text-[13px] md:grid-cols-2">
            <li><span className="font-medium">Labelled by source.</span> <span className="text-muted-foreground">Every AI result says whether it came from a live model, a saved result or rules, and links to its run.</span></li>
            <li><span className="font-medium">Minimum data per request.</span> <span className="text-muted-foreground">Agents send the records a step needs, not your database. Each run lists what it read.</span></li>
            <li><span className="font-medium">Treated as data, never instructions.</span> <span className="text-muted-foreground">Invoice text, messages and imports cannot change what an agent is allowed to do.</span></li>
            <li><span className="font-medium">Every action is audited.</span> <span className="text-muted-foreground">Who approved, which agent and model, and what changed. <Link href="/app/settings/audit?view=ai" className="text-primary hover:underline">AI actions in the audit log</Link></span></li>
          </ul>
        </Section>
      </PageBody>
    </>
  );
}
