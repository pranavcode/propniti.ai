import type { Metadata } from "next";
import Link from "@/components/Link";
import { ArrowRight, BarChart3, Building2, CalendarClock, FileSpreadsheet, LineChart, Sparkles, Wallet } from "lucide-react";
import "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { asOfMonth } from "@/server/query";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { askReport } from "@/extensions/accounting/reports/ask";
import { scopeProperties, type Ctx } from "@/extensions/accounting/reports/run";
import { addMonths, FIRST_MONTH, periodLabel, REPORT_ROLES } from "@/extensions/accounting/reports/spec";
import { ArAgingReport, AskReport, CashForecastReport, NoiReport, PnlReport, RentRollReport } from "@/extensions/accounting/reports/views";

export const metadata: Metadata = { title: "Reports · Propniti" };

const REPORTS = [
  { key: "pnl", label: "Profit and loss", icon: FileSpreadsheet, blurb: "Income and expense by GL account for any period, with NOI and the monthly trend.", period: true, property: true },
  { key: "rent_roll", label: "Rent roll", icon: Building2, blurb: "Every unit with its resident, lease dates, rent, deposit and balance.", period: false, property: true },
  { key: "ar_aging", label: "AR aging", icon: Wallet, blurb: "Past-due resident balances by property in 0–30, 31–60, 61–90 and 90+ day buckets.", period: false, property: true },
  { key: "noi", label: "NOI by property", icon: BarChart3, blurb: "Net operating income per property against budget, trailing twelve months by default.", period: true, property: false },
  { key: "cash_forecast", label: "Cash forecast", icon: CalendarClock, blurb: "The next 90 days of trust cash by week: rent in, bills and distributions out.", period: false, property: false },
] as const;
const EXAMPLES = ["Show me utilities by property for Q3 vs budget", "Repairs by month, last 12 months, vs last year", "NOI by metro YTD vs budget", "Top vendors paid in Q3", "Delinquency by property in Phoenix", "Landscaping by property this year"];

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
type SP = { r?: string; ask?: string; from?: string; to?: string; property?: string; page?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await currentSession();
  if (!REPORT_ROLES.includes(session.actor.role)) {
    return <div className="p-6"><EmptyState kind="chart" title="Reports aren't part of your role" description="Switch role from your avatar menu to see reports as an accountant, manager or principal." action={{ label: "Go to your home", href: "/app" }} /></div>;
  }
  const sp = await searchParams;
  const db = getPlatform().db;
  const ctx: Ctx = { db, ws: session.ws, actor: session.actor };
  const scope = await scopeProperties(ctx);
  // The month before meta.as_of (the demo's today) is the last closed month.
  const LAST_CLOSED = addMonths(await asOfMonth(db), -1);
  const report = REPORTS.find((r) => r.key === sp.r);
  const ask = sp.ask?.trim().slice(0, 300) || null;
  const property = sp.property && scope.some((p) => p.id === sp.property) ? sp.property : undefined;
  const defaultFrom = report?.key === "pnl" ? `${LAST_CLOSED.slice(0, 4)}-01` : addMonths(LAST_CLOSED, -11);
  let from = sp.from && YM.test(sp.from) ? sp.from : defaultFrom;
  let to = sp.to && YM.test(sp.to) ? sp.to : LAST_CLOSED;
  if (from > to) [from, to] = [to, from];
  if (from < FIRST_MONTH) from = FIRST_MONTH;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  // Errors inside a report fall through to the app's error boundary (src/app/(app)/app/error.tsx).
  const a = ask ? await askReport(ask, scope, LAST_CLOSED) : null;
  const asOf = report?.key === "cash_forecast" ? await asOfMonth(db) : "";
  const body = a ? <AskReport ctx={ctx} ask={a} scope={scope} />
    : report?.key === "pnl" ? <PnlReport ctx={ctx} from={from} to={to} property={property} />
    : report?.key === "rent_roll" ? <RentRollReport ctx={ctx} page={page} property={property} baseHref={`/app/reports?r=rent_roll${property ? `&property=${property}` : ""}`} />
    : report?.key === "ar_aging" ? <ArAgingReport ctx={ctx} property={property} />
    : report?.key === "noi" ? <NoiReport ctx={ctx} from={from} to={to} />
    : report?.key === "cash_forecast" ? <CashForecastReport m={{ db, ws: session.ws, actor: session.actor, propertyIds: session.actor.propertyIds, asOf }} />
    : <ReportIndex />;

  return (
    <div>
      <PageHeader icon={<LineChart />} title={ask ? "Report from your question" : report?.label ?? "Reports"}
        description={ask ? undefined : report?.blurb ?? "Standard finance reports, or ask for the one you need in plain words."}
        meta={<><span>{session.actor.scope.label}</span><span>·</span><span>Books closed through {periodLabel(LAST_CLOSED, LAST_CLOSED)}</span></>}>
        <nav aria-label="Reports" className="-mb-px flex gap-1 overflow-x-auto border-b">
          <Tab href="/app/reports" active={!report && !ask}>All reports</Tab>
          {REPORTS.map((r) => <Tab key={r.key} href={`/app/reports?r=${r.key}`} active={report?.key === r.key && !ask}>{r.label}</Tab>)}
        </nav>
      </PageHeader>
      <PageBody>
        <AskForm value={ask ?? ""} />
        {report && !ask && (report.period || report.property) && (
          <form method="get" className="flex flex-wrap items-end gap-2 text-[12.5px]" aria-label="Report filters">
            <input type="hidden" name="r" value={report.key} />
            {report.property && (
              <label className="flex flex-col gap-1"><span className="text-muted-foreground">Property</span>
                <select name="property" defaultValue={property ?? ""} className="h-8 min-w-56 rounded-md border bg-background px-2">
                  <option value="">All {scope.length} properties</option>
                  {scope.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.metro}</option>)}
                </select>
              </label>
            )}
            {report.period && <>
              <label className="flex flex-col gap-1"><span className="text-muted-foreground">From</span><input type="month" name="from" defaultValue={from} min={FIRST_MONTH} max={LAST_CLOSED} className="h-8 rounded-md border bg-background px-2 tabular-nums" /></label>
              <label className="flex flex-col gap-1"><span className="text-muted-foreground">To</span><input type="month" name="to" defaultValue={to} min={FIRST_MONTH} max={LAST_CLOSED} className="h-8 rounded-md border bg-background px-2 tabular-nums" /></label>
            </>}
            <Button type="submit" size="sm" variant="outline">Apply</Button>
          </form>
        )}
        {body}
      </PageBody>
    </div>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={cn("border-b-2 px-3 py-2 text-[13px] whitespace-nowrap transition-colors", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{children}</Link>;
}

function AskForm({ value }: { value: string }) {
  return (
    <section className="rounded-xl border bg-card p-3">
      <form method="get" className="flex items-center gap-2" role="search" aria-label="Ask for a report">
        <Sparkles className="size-4 shrink-0 text-tone-ai" />
        <label htmlFor="ask" className="sr-only">Ask for a report</label>
        <input id="ask" name="ask" defaultValue={value} maxLength={300} autoComplete="off" placeholder="Ask for a report, e.g. “show me utilities by property for Q3 vs budget”…"
          className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground" />
        <Button type="submit" size="sm">Build report</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => <Link key={e} href={`/app/reports?ask=${encodeURIComponent(e)}`} className="rounded-full border px-2.5 py-0.5 text-[12px] text-muted-foreground hover:border-tone-ai/40 hover:text-foreground">{e}</Link>)}
      </div>
    </section>
  );
}

function ReportIndex() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {REPORTS.map((r) => (
        <Link key={r.key} href={`/app/reports?r=${r.key}`} className="group flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
          <span className="flex items-center gap-2 text-[13.5px] font-semibold"><r.icon className="size-4 text-muted-foreground" />{r.label}<ArrowRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></span>
          <span className="text-[12.5px] text-muted-foreground">{r.blurb}</span>
          <span className="mt-auto text-[11.5px] text-muted-foreground">Table, chart and download as CSV, Excel or PDF</span>
        </Link>
      ))}
    </div>
  );
}
