import "server-only";
import Link from "@/components/Link";
import { ArrowRight, BarChart3, Bot, ChevronRight, CircleDollarSign, FileStack, Inbox, Landmark, Sparkles } from "lucide-react";
import type { Session } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { personaGreeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { widgetsFor } from "@/extensions/widgets";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { ChartCard, DashboardGrid, GridItem, KpiCard, KpiRow, type ChartPoint } from "@/components/app/dashboard";
import { AIBadge } from "@/components/app/ai";
import { CollapseBody, CollapseButton, Collapsible, WhenCollapsed, WhenExpanded } from "@/components/app/collapsible/Collapsible";
import type { ProposalJson } from "@/ai/ui/client";
import { agentName } from "@/ai/ui/labels";
import { ApprovalQueue, HomeAsk } from "@/extensions/portfolio/home/client";
import { financeHome, type BriefingItem } from "./data";
import { monthTick } from "@/components/app/dashboard/fmt";

// The accountant's home (Grace Kim): briefing and approvals first, then payables, cash and budget.
// Receivables widgets come from the receivables lane through the widgets registry.

const label = monthTick;
const monthLong = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const TONE: Record<BriefingItem["tone"], string> = { danger: "bg-tone-danger", warning: "bg-tone-warning", info: "bg-tone-info", success: "bg-tone-success" };
const SPAN = { sm: "xl:col-span-4", md: "xl:col-span-6", lg: "xl:col-span-8", full: "xl:col-span-12" } as const;

function Items({ items, empty }: { items: BriefingItem[]; empty: string }) {
  if (!items.length) return <p className="text-[12.5px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.slice(0, 5).map((r) => (
        <li key={r.text}>
          <Link href={r.href} className="flex gap-2 text-[12.5px] leading-snug hover:text-primary"><span className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", TONE[r.tone])} />{r.text}</Link>
          {r.action && <Link href={r.action.href} className="mt-0.5 ml-3.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">{r.action.label}<ArrowRight className="size-3" aria-hidden /></Link>}
        </li>
      ))}
    </ul>
  );
}

export async function FinanceHome({ session }: { session: Session }) {
  const { persona, actor } = session;
  const h = await financeHome(getPlatform().db, session.ws, actor);
  const k = h.kpis;
  const runs = h.briefing.runs.reduce((s, r) => s + Number(r.n), 0);
  const receivables = widgetsFor(actor.role).filter((w) => w.key.startsWith("receivables."));
  const ie = h.incomeExpense.map((p) => ({ ...p, label: label(p.month) })) as ChartPoint[];
  const bva = h.bva.map((p) => ({ ...p, label: label(p.month) })) as ChartPoint[];
  const forecast = (h.forecast?.weeks ?? []) as unknown as ChartPoint[];

  return (
    <div>
      <PageHeader
        title={personaGreeting(persona)}
        meta={<><span>{persona.title}</span><span>·</span><span>{persona.scope.label}</span><span>·</span><span>Books closed through {monthLong(h.lastClosed)}</span></>}
        actions={<>
          <Button asChild size="sm" variant="outline"><Link href="/app/reports"><BarChart3 />Reports</Link></Button>
          <Button asChild size="sm"><Link href="/app/finance/ap-inbox"><Inbox />AP inbox</Link></Button>
        </>}
      />
      <PageBody>
        <div className="grid gap-3 xl:grid-cols-12">
          <Collapsible id="briefing" label="Briefing" data-tour="briefing" className="peer/brief flex flex-col rounded-xl border bg-card xl:col-span-8 xl:data-collapsed:col-span-full">
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 group-data-collapsed/collapse:flex-nowrap group-data-collapsed/collapse:border-b-0">
              <span className="flex size-6 items-center justify-center rounded-md bg-tone-ai/10 text-tone-ai"><Sparkles className="size-3.5" /></span>
              <h2 className="shrink-0 text-[13.5px] font-semibold">Briefing</h2>
              <WhenExpanded><span className="text-[12px] text-muted-foreground">Payables, banking and budget as of {h.today}</span></WhenExpanded>
              <WhenCollapsed><span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{`${h.briefing.needs.length} need you · ${h.briefing.watch.length} to watch`}</span></WhenCollapsed>
              <AIBadge source="rules" className="ml-auto max-sm:group-data-collapsed/collapse:hidden" />
              <CollapseButton className="-mr-1.5 max-sm:group-data-collapsed/collapse:ml-auto" />
            </header>
            <CollapseBody className="flex-1">
            <div className="flex h-full flex-col">
            <div className="grid flex-1 md:grid-cols-3 md:divide-x">
              <div className="flex flex-col gap-2 px-4 py-3">
                <h3 className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">What happened</h3>
                <p className="text-[13px] leading-relaxed">
                  {k.paidMonth != null ? <>You paid vendors <b className="font-semibold tabular-nums">${Math.round(k.paidMonth).toLocaleString("en-US")}</b> so far this month</> : "No vendor payments yet this month"}
                  {k.noi != null && <>; {monthLong(h.lastClosed)} closed with NOI of <b className="font-semibold tabular-nums">${Math.round(k.noi).toLocaleString("en-US")}</b></>}.
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  <Bot className="mr-1 inline size-3.5" />
                  {runs ? <>{runs} agent {runs === 1 ? "run" : "runs"} in 48 hours: {h.briefing.runs.map((r) => `${agentName(r.agent_key)} ×${r.n}`).join(", ")}.</> : "No Payables or Reconciliation runs in the last 48 hours."}
                  {" "}<Link href="/app/agents" className="underline-offset-2 hover:underline">Agents</Link>
                </p>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                <h3 className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">Needs you</h3>
                <Items items={h.briefing.needs} empty="Nothing waiting on you in payables or banking." />
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                <h3 className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">Watch</h3>
                <Items items={h.briefing.watch} empty="Cash, budget and payables are inside normal ranges." />
              </div>
            </div>
            <footer className="border-t px-4 py-2 text-[11.5px] text-muted-foreground">Every figure comes from bills, bank lines, the journal and budgets. Rules pick what to show; click any line for the records behind it.</footer>
            </div>
            </CollapseBody>
          </Collapsible>
          <div className="flex flex-col gap-3 xl:col-span-4 xl:peer-data-collapsed/brief:col-span-full" data-tour="ask-home">
            <HomeAsk suggestions={persona.assistantPrompts} />
            <div className="flex flex-wrap gap-1.5">
              <Button asChild size="sm" variant="outline"><Link href="/app/ai/approvals?agent=ap"><Inbox />Approvals{h.queue.total ? ` (${h.queue.total})` : ""}</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/app/banking/reconciliations?f.status=Open"><Landmark />Reconcile</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/app/finance/payment-run"><CircleDollarSign />Payment run</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/app/finance/1099"><FileStack />1099s</Link></Button>
              {persona.quickActions.map((a) => <Button key={a.href} asChild size="sm" variant="ghost"><Link href={a.href}>{a.label}</Link></Button>)}
            </div>
          </div>
        </div>

        <div data-tour="kpis">
          <KpiRow className="xl:grid-cols-6">
            <KpiCard label="Open payables" format="money" value={k.openAp} href="/app/payables/bills?f.status=Draft,Pending%20approval,Approved" footnote="Not yet paid" help="Draft, pending and approved bills not yet sent to the bank." goodWhen="down" />
            <KpiCard label="Past due" format="money" value={k.pastDue} href="/app/payables/bills?view=past-due" footnote="Open bills" goodWhen="down" />
            <KpiCard label="Unreconciled items" format="count" value={k.unreconciled} help="AI-suggested and unmatched bank lines in open reconciliations." href="/app/banking/reconciliations?f.status=Open" footnote="Open reconciliations" goodWhen="down" />
            <KpiCard label="Cash in trust" format="money" value={k.trust} href="/app/banking/accounts?f.kind=Trust" footnote="Book balance" />
            <KpiCard label="NOI" format="money" value={k.noi} previous={k.noiPrev} spark={k.noiSpark} goodWhen="up" href="/app/reports?r=pnl" footnote={monthLong(h.lastClosed)} />
            <KpiCard label="Expense vs budget" format="pct" value={k.expenseVar} goodWhen="down" help="Operating expense over (+) or under (−) budget, year to date." href="/app/finance/budget-vs-actual" footnote="Year to date" />
          </KpiRow>
        </div>

        <DashboardGrid>
          <GridItem span={5}><ChartCard title="Payables aging" description="Open bills by days past due" kind="bar" data={h.aging as unknown as ChartPoint[]} x="label" series={[{ key: "amount", label: "Open", format: "money" }]} drill="/app/payables/bills?f.aging={bucket}" height={240} /></GridItem>
          <GridItem span={7}><ChartCard title="Income vs expense" description="Trailing 12 closed months, from the journal" kind="bar" data={ie} x="label" series={[{ key: "income", label: "Income", format: "money" }, { key: "expense", label: "Expense", format: "money" }]} drill="/app/reports?r=pnl&from={month}&to={month}" height={240} /></GridItem>
          <GridItem span={7}><ChartCard title="Operating expense: budget vs actual" description={`${h.asOf.slice(0, 4)} by month; dashed line is budget`} kind="line" data={bva} x="label" series={[{ key: "actual", label: "Actual", format: "money" }, { key: "budget", label: "Budget", format: "money", dashed: true }]} drill="/app/finance/budget-vs-actual?month={month}" height={240} /></GridItem>
          <GridItem span={5}><ChartCard title="Cash forecast, 90 days" description={h.forecast?.low ? `Trust balance by week; low point $${Math.round(h.forecast.low.balance).toLocaleString("en-US")} (week of ${h.forecast.low.week})` : "Trust balance by week"} kind="area" data={forecast} x="week" series={[{ key: "balance", label: "Projected balance", format: "money", curve: "linear" }]} drill="/app/reports?r=cash_forecast" height={240} empty="No trust balance to project yet." /></GridItem>
          <GridItem span={6}><ChartCard title="Spend by GL account" description="Bills dated in the last 3 months" kind="hbar" data={h.spend as ChartPoint[]} x="label" series={[{ key: "amount", label: "Billed", format: "money" }]} drill="/app/payables/bills?f.gl_account_id={gl}" height={260} /></GridItem>
          <GridItem span={6}>
            <Section title="Waiting for your decision" description="Payables and reconciliation proposals. Approving runs the action once and records who approved it." actions={<Button asChild size="sm" variant="ghost"><Link href="/app/ai/approvals?agent=ap">All <ArrowRight /></Link></Button>}>
              <div data-tour="approvals"><ApprovalQueue rows={h.queue.rows as ProposalJson[]} total={h.queue.total} /></div>
            </Section>
          </GridItem>
        </DashboardGrid>

        {receivables.length > 0 && (
          <Section title="Receivables" description="From the receivables team's dashboards" actions={<Button asChild size="sm" variant="ghost"><Link href="/app/receivables/charges">Charges <ChevronRight /></Link></Button>}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
              {receivables.map((w) => <div key={w.key} className={cn("min-w-0 md:col-span-2", SPAN[w.size])}><w.component actor={actor} /></div>)}
            </div>
          </Section>
        )}
      </PageBody>
    </div>
  );
}
