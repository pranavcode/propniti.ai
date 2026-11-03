import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { AS_OF } from "@/seed/constants";
import { formatMoney, formatNumber } from "@/lib/format";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { ChartCard, DashboardGrid, GridItem, KpiCard, KpiRow } from "@/components/app/dashboard";
import { EmptyState } from "@/components/app/states";
import { getAgent } from "@/ai/agents";
import { usage } from "@/extensions/platform/console";
import { PlatformOnly } from "../gate";

export const metadata: Metadata = { title: "AI usage · Propniti" };

const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-1.5 text-right tabular-nums";

export default async function UsagePage() {
  const session = await currentSession();
  if (session.actor.role !== "platform_admin") return <PlatformOnly />;
  const u = await usage(getPlatform().db, AS_OF);
  const agents = u.byAgent.map((a) => ({ ...a, label: getAgent(a.agent as Parameters<typeof getAgent>[0])?.name ?? (a.agent === "copilot" ? "Assistant" : a.agent) }));
  return (
    <>
      <PageHeader icon={<Activity />} title="AI usage" description="Agent runs, tokens and model cost across every workspace on the platform." meta={<span>Last 30 days · {u.since} to {AS_OF}</span>} />
      <PageBody>
        <KpiRow>
          <KpiCard label="Agent runs" value={u.runs} footnote={`${formatNumber(u.failed)} failed · ${formatNumber(u.workspaces)} workspaces`} href="/app/ai/activity" />
          <KpiCard label="Tokens in" value={u.tokensIn} footnote="Prompts, tool results and context" />
          <KpiCard label="Tokens out" value={u.tokensOut} footnote="Model replies and tool calls" />
          <KpiCard label="Model cost" value={u.cost} format="money" footnote="Rule-only runs cost nothing" />
        </KpiRow>
        {u.runs === 0 ? (
          <EmptyState kind="chart" title="No agent runs in the last 30 days" description="Runs appear here when the scheduled sweep fires, an event triggers an agent, someone presses Run now, or the assistant answers a question." action={{ label: "Open agents", href: "/app/agents" }} />
        ) : (
          <DashboardGrid>
            <GridItem span={8}>
              <ChartCard title="Runs per day" description="All agents" kind="bar" data={u.byDay} x="day" series={[{ key: "runs", label: "Runs", format: "count" }]} drill="/app/ai/activity?day={date}" height={220} />
            </GridItem>
            <GridItem span={4}>
              <ChartCard title="Runs by agent" kind="hbar" data={agents} x="label" series={[{ key: "runs", label: "Runs", format: "count" }]} drill="/app/ai/activity?agent={agent}" height={220} />
            </GridItem>
          </DashboardGrid>
        )}
        {u.byModel.length > 0 && (
          <Section title="By model" description="Which provider served the runs. Rules means the deterministic fallback, no model call.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-muted-foreground"><tr><th className={th}>Model</th><th className={`${th} text-right`}>Runs</th><th className={`${th} text-right`}>Tokens in</th><th className={`${th} text-right`}>Tokens out</th><th className={`${th} text-right`}>Cost</th></tr></thead>
                <tbody>{u.byModel.map((m) => <tr key={m.model} className="border-t"><td className="px-3 py-1.5 font-mono text-[12px]">{m.model}</td><td className={td}>{formatNumber(m.runs)}</td><td className={td}>{formatNumber(m.tokensIn)}</td><td className={td}>{formatNumber(m.tokensOut)}</td><td className={td}>{formatMoney(m.cost)}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
        )}
        <Section title="By organization" description={u.orgs ? "Trailing 12 months from each org's monthly usage report." : undefined}>
          {u.orgs?.length ? (
            <div className="flex flex-col gap-3">
              {u.orgMonths.length > 1 && <ChartCard title="Agent runs per month, all orgs" kind="bar" data={u.orgMonths} x="month" series={[{ key: "runs", label: "Runs", format: "count" }]} height={200} />}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/50 text-muted-foreground"><tr><th className={th}>Organization</th><th className={`${th} text-right`}>Runs</th><th className={`${th} text-right`}>Tokens</th><th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>Peak users</th></tr></thead>
                  <tbody>{u.orgs.map((o) => <tr key={o.org_id} className="border-t"><td className="px-3 py-1.5"><a className="hover:text-primary hover:underline" href={`/app/settings/platform/orgs/${o.org_id}`}>{o.name}</a></td><td className={td}>{formatNumber(o.runs)}</td><td className={td}>{formatNumber(o.tokens, { compact: true })}</td><td className={td}>{formatMoney(o.cost)}</td><td className={td}>{formatNumber(o.users)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-3 text-[12.5px] text-muted-foreground">Per-organization reports aren&apos;t loaded in this environment, so the figures above are Summit Residential Partners&apos; own runs (the demo org), read live from the run log.</p>
          )}
        </Section>
      </PageBody>
    </>
  );
}
