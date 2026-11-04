import "server-only";
import Link from "@/components/Link";
import { ArrowRight, Bot, Calculator, ChevronRight, CircleAlert, FlaskConical, Inbox, Sparkles } from "lucide-react";
import type { Session } from "@/auth/session";
import type { Row } from "@/entities/types";
import { getPlatform } from "@/lib/platform";
import { formatMoney, formatPct, personaGreeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { ChartCard, DashboardGrid, GridItem, KpiRow, type ChartPoint } from "@/components/app/dashboard";
import { ErrorBanner } from "@/components/app/states";
import { CollapseBody, CollapseButton, Collapsible, CollapsibleSection, WhenCollapsed, WhenExpanded } from "@/components/app/collapsible/Collapsible";
import type { ProposalJson } from "@/ai/ui/client";
import { getAgent } from "@/extensions/agents";
import { ExplainableKpi, ExplainLink } from "../ui/Explain";
import { ApprovalQueue, CompareTable, HomeAsk } from "./client";
import { briefing, compareRows, homeMetrics, LAST_CLOSED, type BriefingItem, type CompareRow, type HomeMetrics } from "./data";

// AI-first homes for the principal (org-wide) and the regional manager (one region). Briefing and
// approvals first, then explainable KPIs, then charts that drill to the rows behind them.

const label = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " ’");
const monthLong = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const pts = (rows: Row[]): ChartPoint[] => rows.map((r) => ({ ...(r as ChartPoint), label: label(String(r.month)) }));

const TONE: Record<BriefingItem["tone"], string> = { danger: "bg-tone-danger", warning: "bg-tone-warning", info: "bg-tone-info", success: "bg-tone-success", ai: "bg-tone-ai" };

function Briefing({ b, m, rows, scope }: { b: Awaited<ReturnType<typeof briefing>>; m: HomeMetrics; rows: CompareRow[]; scope: string }) {
  const noi = m.kpis.noi;
  const change = noi.value != null && noi.previous ? (noi.value - noi.previous) / Math.abs(noi.previous) : null;
  const best = [...rows].filter((r) => r.noi != null && r.noiPrev).sort((x, y) => (y.noi! - y.noiPrev!) - (x.noi! - x.noiPrev!))[0];
  const agentsRan = b.overnight.reduce((s, r) => s + Number(r.n), 0);
  const highRisk = b.queue.rows.filter((p) => p.risk === "High").length;
  return (
    <Collapsible id="briefing" label="Briefing" data-tour="briefing" className="flex h-full flex-col rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3 group-data-collapsed/collapse:border-b-0">
        <span className="flex size-6 items-center justify-center rounded-md bg-tone-ai/10 text-tone-ai"><Sparkles className="size-3.5" /></span>
        <h2 className="text-[13.5px] font-semibold">Briefing</h2>
        <WhenExpanded><span className="text-[12px] text-muted-foreground">{scope} · {monthLong(LAST_CLOSED)} close and the last 48 hours</span></WhenExpanded>
        <WhenCollapsed><span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{b.queue.total.toLocaleString("en-US")} need you · {b.risks.length} to watch</span></WhenCollapsed>
        <Link href="/app/ai/activity" className="ml-auto shrink-0 text-[12px] text-muted-foreground hover:text-foreground max-sm:group-data-collapsed/collapse:hidden">Agent activity <ChevronRight className="inline size-3" /></Link>
        <CollapseButton className="-mr-1.5 max-sm:group-data-collapsed/collapse:ml-auto" />
      </header>
      <CollapseBody className="flex-1">
      <div className="flex h-full flex-col">
      <div className="grid flex-1 gap-0 md:grid-cols-3 md:divide-x">
        <div className="flex flex-col gap-2 px-4 py-3">
          <h3 className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">What happened</h3>
          <p className="text-[13px] leading-relaxed">
            NOI {change == null ? "has no prior month yet" : <>{change >= 0 ? "rose" : "fell"} <b className={cn("font-semibold tabular-nums", change >= 0 ? "text-tone-success" : "text-tone-danger")}>{formatPct(Math.abs(change), 1)}</b> to <b className="font-semibold tabular-nums">{formatMoney(noi.value, "compact")}</b></>} in {monthLong(LAST_CLOSED)}
            {best && best.noi! > best.noiPrev! && <>; <Link href={`/app/properties/${best.id}?tab=financials`} className="font-medium hover:underline">{best.name}</Link> added the most</>}.
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            {agentsRan ? <><Bot className="mr-1 inline size-3.5" />{agentsRan} agent {agentsRan === 1 ? "run" : "runs"}: {b.overnight.slice(0, 3).map((r) => `${getAgent(r.agent_key as never)?.name ?? r.agent_key} ×${r.n}`).join(", ")}.</> : "No agent runs in the last 48 hours in this workspace."}
          </p>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <h3 className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">Needs you</h3>
          <Link href="/app/ai/approvals" className="group flex items-baseline gap-2">
            <span className="text-[28px] leading-8 font-semibold tracking-tight tabular-nums">{b.queue.total}</span>
            <span className="text-[12.5px] text-muted-foreground group-hover:text-foreground">{b.queue.total === 1 ? "proposal waits" : "proposals wait"} for a decision{highRisk ? `, ${highRisk} high risk` : ""} <ArrowRight className="inline size-3" /></span>
          </Link>
          <p className="text-[12.5px] text-muted-foreground">{Number(b.queue.counts.auto_handled ?? 0)} handled automatically inside policy · {Number(b.queue.counts.waiting ?? 0)} waiting on owners</p>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <h3 className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">Watch</h3>
          {b.risks.length ? (
            <ul className="flex flex-col gap-1.5">
              {b.risks.slice(0, 4).map((r) => (
                <li key={r.text}><Link href={r.href} className="flex gap-2 text-[12.5px] leading-snug hover:text-primary"><span className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", TONE[r.tone])} />{r.text}</Link></li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-muted-foreground">Nothing outside normal ranges this month.</p>}
        </div>
      </div>
      <footer className="border-t px-4 py-2 text-[11.5px] text-muted-foreground">Figures are computed from the ledger and monthly metrics; agent activity comes from logged runs. Use Explain on any number for the AI&rsquo;s reading of it.</footer>
      </div>
      </CollapseBody>
    </Collapsible>
  );
}

function QuickActions({ actions, extra }: { actions: { label: string; href: string }[]; extra: { label: string; href: string; icon: typeof Inbox }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {extra.map((a) => <Button key={a.href} asChild size="sm" variant="outline"><Link href={a.href}><a.icon />{a.label}</Link></Button>)}
      {actions.map((a) => <Button key={a.href} asChild size="sm" variant="ghost"><Link href={a.href}>{a.label}</Link></Button>)}
    </div>
  );
}

function Kpis({ m, regional }: { m: HomeMetrics; regional: boolean }) {
  const k = m.kpis;
  const foot = `${monthLong(LAST_CLOSED)}`;
  const noAi = !k.aiHours.spark.some((v) => v > 0);
  return (
    <KpiRow className="xl:grid-cols-5">
      <ExplainableKpi deltaLabel="" metric="portfolio.noi" label="NOI" format="money" value={k.noi.value} previous={k.noi.previous} spark={k.noi.spark} goodWhen="up" href="/app/properties?sort=-noi_month" footnote={foot} help="Net operating income: rent and other income collected, less operating expenses." />
      <ExplainableKpi deltaLabel="" metric="portfolio.occupancy" label="Occupancy" format="pct" value={k.occupancy.value} previous={k.occupancy.previous} spark={k.occupancy.spark} goodWhen="up" href="/app/units?f.status=Vacant" footnote={k.economic.value != null ? `Economic ${formatPct(k.economic.value, 1)}` : foot} help="Physical occupancy: occupied and on-notice units over rentable units." />
      <ExplainableKpi deltaLabel="" metric="receivables.collections_rate" label="Collections rate" format="pct" value={k.collections.value} previous={k.collections.previous} spark={k.collections.spark} goodWhen="up" href="/app/receivables/payments" footnote="Collected over charged" help="Share of the month's rent and fees paid so far. Payments go to the oldest charge first, so paying down an older balance counts for that older month." />
      {regional
        ? <ExplainableKpi deltaLabel="" metric="maintenance.sla" label="Within SLA" format="pct" value={k.sla.value} previous={k.sla.previous} spark={k.sla.spark} goodWhen="up" href="/app/maintenance/work-orders?view=past-sla" footnote="Of work orders due" help="Work orders completed by their SLA due time, over work orders due in the month. Open jobs past due count as missed." />
        : <ExplainableKpi deltaLabel="" metric="receivables.delinquency" label="Delinquent" format="money" value={k.delinquency.value} previous={k.delinquency.previous} spark={k.delinquency.spark} goodWhen="down" href="/app/receivables/charges?f.status=Overdue" footnote="All aging buckets" help="Resident balances past due at month end." />}
      {regional
        ? <ExplainableKpi deltaLabel="" metric="receivables.delinquency" label="Delinquent" format="money" value={k.delinquency.value} previous={k.delinquency.previous} spark={k.delinquency.spark} goodWhen="down" href="/app/receivables/charges?f.status=Overdue" footnote="All aging buckets" help="Resident balances past due at month end." />
        : <ExplainableKpi deltaLabel="" metric="intelligence.ai_minutes_saved" label="AI hours saved" format="count" value={k.aiHours.value} previous={k.aiHours.previous} spark={k.aiHours.spark} goodWhen="up" href="/app/ai/activity" footnote={noAi ? "No agent actions recorded yet" : "Staff time agents took on"} help="Estimated staff hours saved by agent actions people approved or that ran inside policy, using a fixed minutes-per-action table." />}
    </KpiRow>
  );
}

export async function PortfolioHome({ session, variant }: { session: Session; variant: "principal" | "regional" }) {
  const db = getPlatform().db;
  const q = { db, ws: session.ws, actor: session.actor };
  const m = await homeMetrics(q);
  const rows = compareRows(m);
  const b = await briefing({ db, ws: session.ws ?? "base", actor: session.actor }, rows, m);
  const { persona } = session;
  const regional = variant === "regional";
  const failed = Object.values(m.kpis).some((k) => k.error);

  const noiByProp = [...rows].filter((r) => r.noi != null).sort((a, b) => b.noi! - a.noi!).map((r) => ({ property_id: r.id, name: r.name, noi: r.noi, budget: r.budget }));
  const occByProp = [...rows].filter((r) => r.occupancy != null).sort((a, b) => a.occupancy! - b.occupancy!).map((r) => ({ property_id: r.id, name: r.name, physical: r.occupancy, economic: r.economic }));
  const agingByProp = m.agingByProperty.filter((p) => Number(p.total) > 0).slice(0, 14) as ChartPoint[];
  const slaByProp = m.slaByProperty.filter((p) => Number(p.due) > 0) as ChartPoint[];
  const aiTotal = m.series.ai.reduce((s, p) => s + Number(p.hours ?? 0), 0);

  return (
    <main>
      <PageHeader
        title={personaGreeting(persona)}
        meta={<><span>{persona.title}</span><span>·</span><span>{persona.scope.label}</span><span>·</span><span>Books closed through {monthLong(LAST_CLOSED)}</span></>}
        actions={<>
          <Button asChild size="sm" variant="outline"><Link href="/app/portfolio"><Calculator />Portfolio overview</Link></Button>
          <Button asChild size="sm"><Link href="/app/portfolio/what-if"><FlaskConical />What-if</Link></Button>
        </>}
      />
      <PageBody>
        {failed && <ErrorBanner title="Some figures didn't load" message="The rest of the page is current. Reload to try again." />}
        <div className="grid gap-3 xl:grid-cols-12">
          <div className="peer/brief xl:col-span-8 xl:has-[>[data-collapsed]]:col-span-full"><Briefing b={b} m={m} rows={rows} scope={persona.scope.label.split(" · ")[0]} /></div>
          <div className="flex flex-col gap-3 xl:col-span-4 xl:peer-has-[>[data-collapsed]]/brief:col-span-full" data-tour="ask-home">
            <HomeAsk suggestions={persona.assistantPrompts} />
            <QuickActions actions={persona.quickActions} extra={[{ label: `Approvals${b.queue.total ? ` (${b.queue.total})` : ""}`, href: "/app/ai/approvals", icon: Inbox }]} />
          </div>
        </div>

        <div data-tour="kpis"><Kpis m={m} regional={regional} /></div>

        {regional ? (
          <>
            <Section title="Property comparison" description={`${rows.length} properties · ${monthLong(LAST_CLOSED)} · sorted by variance to budget. Select Variance on a row for the AI's explanation.`}
              actions={<ExplainLink metric="portfolio.noi" label="Regional NOI" />} id="compare">
              <div data-tour="compare"><CompareTable rows={rows} /></div>
            </Section>
            <CollapsibleSection id="charts" title="Charts" summary="6 charts" description="Select a bar or point for the records behind it.">
            <DashboardGrid>
              <GridItem span={6}><ChartCard title="NOI vs budget by property" description={monthLong(LAST_CLOSED)} kind="hbar" data={noiByProp} x="name" series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money" }]} drill="/app/properties/{property_id}?tab=financials" height={Math.max(260, noiByProp.length * 30)} /></GridItem>
              <GridItem span={6}><ChartCard title="Occupancy by property" description="Physical vs economic, lowest first" kind="hbar" data={occByProp} x="name" series={[{ key: "physical", label: "Physical", format: "pct" }, { key: "economic", label: "Economic", format: "pct" }]} drill="/app/units?f.property_id={property_id}&f.status=Vacant" height={Math.max(260, occByProp.length * 30)} /></GridItem>
              <GridItem span={7}><ChartCard title="Delinquency aging by property" description={`Past-due balances at ${monthLong(LAST_CLOSED)} close`} kind="stacked" data={agingByProp} x="name" series={[{ key: "d0_30", label: "0–30 days", format: "money" }, { key: "d31_60", label: "31–60", format: "money" }, { key: "d61_90", label: "61–90", format: "money" }, { key: "d90p", label: "90+", format: "money" }]} drill="/app/receivables/charges?f.property_id={property_id}&f.status=Overdue" height={280} actions={<ExplainLink metric="receivables.delinquency" label="Delinquency" />} /></GridItem>
              <GridItem span={5}><ChartCard title="Aging buckets" description="Region total" kind="bar" data={m.aging as ChartPoint[]} x="label" series={[{ key: "amount", label: "Balance", format: "money" }]} drill="/app/receivables/charges?f.aging={bucket}" height={280} /></GridItem>
              <GridItem span={7}><ChartCard title="Maintenance SLA by property" description={`Work orders due in ${monthLong(LAST_CLOSED)}, met and missed`} kind="stacked" data={slaByProp} x="name" series={[{ key: "met", label: "Met SLA", format: "count" }, { key: "missed", label: "Missed SLA", format: "count", color: "var(--tone-danger)" }]} drill="/app/maintenance/work-orders?f.property_id={property_id}" height={280} actions={<ExplainLink metric="maintenance.sla" label="SLA" />} /></GridItem>
              <GridItem span={5}><ChartCard title="Work orders due vs missed SLA" description="Trailing 12 closed months" kind="line" data={pts(m.series.wo)} x="label" series={[{ key: "due", label: "Due", format: "count" }, { key: "missed", label: "Missed SLA", format: "count" }]} drill="/app/maintenance/work-orders" height={280} /></GridItem>
            </DashboardGrid>
            </CollapsibleSection>
          </>
        ) : (
          <CollapsibleSection id="charts" title="Charts" summary="6 charts and the below-budget list" description="Select a bar, slice or point for the records behind it.">
          <DashboardGrid>
            <GridItem span={8}><ChartCard title="Portfolio NOI vs budget" description="Trailing 12 closed months" kind="line" data={pts(m.series.noi)} x="label" series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money", dashed: true }]} drill="/app/properties?sort=-noi_month" height={260} actions={<ExplainLink metric="portfolio.noi" label="NOI" />} /></GridItem>
            <GridItem span={4}><ChartCard title="NOI by region" description={monthLong(LAST_CLOSED)} kind="donut" data={m.byRegion as ChartPoint[]} x="name" series={[{ key: "noi", label: "NOI", format: "money" }]} drill="/app/properties?f.region_id={region_id}" height={260} /></GridItem>
            <GridItem span={6}><ChartCard title="NOI by property" description={`${monthLong(LAST_CLOSED)}, highest first`} kind="hbar" data={noiByProp} x="name" series={[{ key: "noi", label: "NOI", format: "money" }]} drill="/app/properties/{property_id}?tab=financials" height={Math.max(300, noiByProp.length * 27)} /></GridItem>
            <GridItem span={6}>
              <div className="flex h-full flex-col gap-3">
                <ChartCard className="h-auto flex-1" title="Occupancy trend" description="Physical vs economic, trailing 12 months" kind="line" data={pts(m.series.occupancy)} x="label" series={[{ key: "physical", label: "Physical", format: "pct" }, { key: "economic", label: "Economic", format: "pct" }]} drill="/app/units?f.status=Vacant" height={210} actions={<ExplainLink metric="portfolio.occupancy" label="Occupancy" />} />
                <ChartCard className="h-auto flex-1" title="Collections" description="Charged vs collected by month" kind="bar" data={pts(m.series.collections)} x="label" series={[{ key: "charged", label: "Charged", format: "money" }, { key: "collected", label: "Collected", format: "money" }]} drill="/app/receivables/payments" height={210} actions={<ExplainLink metric="receivables.collections_rate" label="Collections rate" />} />
              </div>
            </GridItem>
            <GridItem span={7}><ChartCard title="AI hours saved" description={`${Math.round(aiTotal).toLocaleString("en-US")} staff hours over 12 months, from approved and in-policy agent actions`} kind="bar" data={aiTotal > 0 ? pts(m.series.ai) : []} empty="Hours appear here once agents start acting on approved or in-policy work." x="label" series={[{ key: "hours", label: "Hours saved", format: "count" }]} drill="/app/ai/activity" height={240} actions={<ExplainLink metric="intelligence.ai_minutes_saved" label="AI hours saved" />} /></GridItem>
            <GridItem span={5}><Watchlist rows={rows} /></GridItem>
          </DashboardGrid>
          </CollapsibleSection>
        )}

        <Section title="Waiting for your decision" description="Agent proposals in your scope. Approving runs the action once and records who approved it." actions={<Button asChild size="sm" variant="ghost"><Link href="/app/ai/approvals">Open inbox <ArrowRight /></Link></Button>}>
          <div data-tour="approvals"><ApprovalQueue rows={b.queue.rows as ProposalJson[]} total={b.queue.total} /></div>
        </Section>
      </PageBody>
    </main>
  );
}

// Properties furthest below budget: where a principal's attention goes first.
function Watchlist({ rows }: { rows: CompareRow[] }) {
  const list = rows.filter((r) => r.vsBudget != null).sort((a, b) => a.vsBudget! - b.vsBudget!).slice(0, 7);
  return (
    <section className="flex h-full flex-col rounded-lg border bg-card">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <CircleAlert className="size-3.5 text-tone-warning" />
        <h3 className="text-[13px] font-semibold">Furthest below budget</h3>
        <span className="ml-auto text-[12px] text-muted-foreground">{monthLong(LAST_CLOSED)}</span>
      </header>
      <ul className="flex-1 divide-y">
        {list.map((r) => (
          <li key={r.id}>
            <Link href={`/app/properties/${r.id}?tab=financials`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- 400px WebP thumb */}
              <img src={r.photo} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-md object-cover ring-1 ring-border" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{r.name}</span>
                <span className="block text-[11.5px] text-muted-foreground tabular-nums">{formatMoney(r.noi, "whole")} vs {formatMoney(r.budget, "whole")} budget</span>
              </span>
              <span className={cn("text-[12.5px] font-medium tabular-nums", r.vsBudget! < 0 ? "text-tone-danger" : "text-tone-success")}>{r.vsBudget! >= 0 ? "+" : "−"}{Math.abs(r.vsBudget! * 100).toFixed(1)}%</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
