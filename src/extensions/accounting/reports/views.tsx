import "server-only";
import Link from "@/components/Link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import type { MetricCtx } from "@/extensions/metrics";
import { ChartCard, KpiCard, KpiRow, type ChartPoint } from "@/components/app/dashboard";
import { AIBadge } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cashForecast } from "../metrics";
import { CsvButton } from "./CsvButton";
import { runSpec, type Ctx } from "./run";
import { arAging, noiByProperty, pnl, rentRoll } from "./standard";
import { COMPARE_LABEL, describeSpec, GROUP_LABEL, measureOf, periodLabel, type ScopeProperty } from "./spec";
import type { AskResult } from "./ask";

// Server-rendered report bodies. Each pairs a chart (one axis) with the table behind it and a CSV
// of exactly the rows shown.

const monthShort = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " ’");
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`);

export function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <th className={cn("px-3 py-2 font-medium whitespace-nowrap", right ? "text-right" : "text-left", className)}>{children}</th>;
}
export function Td({ children, right, className, colSpan }: { children?: React.ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("px-3 py-1.5", right && "text-right tabular-nums", className)}>{children}</td>;
}

export function TableCard({ title, description, actions, children, footer }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {description && <p className="text-[12px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-[13px]">{children}</table>
      </div>
      {footer && <footer className="border-t px-4 py-2 text-[12px] text-muted-foreground">{footer}</footer>}
    </section>
  );
}

const HEAD = "sticky top-0 z-10 bg-muted/90 text-[12px] text-muted-foreground backdrop-blur";
const ROW = "border-b last:border-0 hover:bg-muted/40";
const TOTAL = "sticky bottom-0 border-t bg-muted/90 font-semibold backdrop-blur";

// ---------------------------------------------------------------------------------------------

export async function PnlReport({ ctx, from, to, property }: { ctx: Ctx; from: string; to: string; property?: string }) {
  const r = await pnl(ctx, from, to, property);
  if (!r.rows.length) return <EmptyState kind="table" title="No journal activity in this period" description="Pick a different period or property." />;
  const glHref = (gl: string) => `/app/gl/journal?f.gl_account_id=${encodeURIComponent(gl)}${from === to ? `&f.period=${from}` : ""}${property ? `&f.property_id=${property}` : ""}`;
  const section = (type: "Income" | "Expense") => r.rows.filter((x) => x.type === type);
  const csv = [...r.rows.map((x) => [x.type, x.number, x.name, r2(x.amount)]), ["Total", "", "Income", r2(r.income)], ["Total", "", "Expense", r2(r.expense)], ["Total", "", "NOI", r2(r.noi)]];
  return (
    <div className="flex flex-col gap-3">
      <KpiRow className="xl:grid-cols-4">
        <KpiCard label="Income" format="money" value={r.income} footnote={periodLabel(from, to)} />
        <KpiCard label="Operating expense" format="money" value={r.expense} footnote={periodLabel(from, to)} goodWhen="down" />
        <KpiCard label="NOI" format="money" value={r.noi} footnote="Income less operating expense" />
        <KpiCard label="Expense ratio" format="pct" value={r.income ? r.expense / r.income : null} footnote="Expense over income" goodWhen="down" />
      </KpiRow>
      {r.months.length > 1 && (
        <ChartCard title="Income and expense by month" description="From the journal; click a month for its P&L" kind="bar" x="label" height={220}
          data={r.months.map((m) => ({ ...m, label: monthShort(m.month) })) as ChartPoint[]} series={[{ key: "income", label: "Income", format: "money" }, { key: "expense", label: "Expense", format: "money" }]}
          drill={`/app/reports?r=pnl&from={month}&to={month}${property ? `&property=${property}` : ""}`} />
      )}
      <TableCard title="Profit and loss" description={`${periodLabel(from, to)} · accrual, from monthly journal entries`} actions={<CsvButton filename={`pnl-${from}-${to}`} header={["Section", "GL", "Account", "Amount"]} rows={csv} />}>
        <thead className={HEAD}><tr className="border-b"><Th>Account</Th><Th right>Amount</Th><Th right>% of income</Th></tr></thead>
        <tbody>
          {(["Income", "Expense"] as const).map((type) => (
            <PnlSection key={type} type={type} rows={section(type)} total={type === "Income" ? r.income : r.expense} income={r.income} glHref={glHref} />
          ))}
          <tr className="border-t-2 font-semibold"><Td>Net operating income</Td><Td right><Money value={r.noi} /></Td><Td right>{r.income ? `${((r.noi / r.income) * 100).toFixed(1)}%` : "—"}</Td></tr>
        </tbody>
      </TableCard>
    </div>
  );
}

function PnlSection({ type, rows, total, income, glHref }: { type: string; rows: { gl_id: string; number: string; name: string; amount: number }[]; total: number; income: number; glHref: (gl: string) => string }) {
  return (
    <>
      <tr className="bg-muted/30"><Td colSpan={3} className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">{type}</Td></tr>
      {rows.map((x) => (
        <tr key={x.gl_id} className={ROW}>
          <Td><Link href={glHref(x.gl_id)} className="hover:text-primary hover:underline"><span className="mr-2 text-muted-foreground tabular-nums">{x.number}</span>{x.name}</Link></Td>
          <Td right><Money value={x.amount} /></Td>
          <Td right className="text-muted-foreground">{income ? `${((x.amount / income) * 100).toFixed(1)}%` : "—"}</Td>
        </tr>
      ))}
      <tr className="border-b font-medium"><Td>Total {type.toLowerCase()}</Td><Td right><Money value={total} /></Td><Td right className="text-muted-foreground">{income ? `${((total / income) * 100).toFixed(1)}%` : "—"}</Td></tr>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

export async function RentRollReport({ ctx, page, property, baseHref }: { ctx: Ctx; page: number; property?: string; baseHref: string }) {
  const size = 50;
  const r = await rentRoll(ctx, page, size, property);
  const pages = Math.max(1, Math.ceil(r.total / size));
  const csv = r.rows.map((x) => [x.property, x.unit, x.status, x.sqft, r2(x.market_rent), x.household, x.lease_id, x.lease_status, x.start_on, x.end_on, r2(x.rent), r2(x.deposit), r2(x.balance)]);
  const nav = (p: number) => `${baseHref}&page=${p}`;
  return (
    <div className="flex flex-col gap-3">
      <KpiRow className="xl:grid-cols-4">
        <KpiCard label="Units" format="count" value={r.total} href={property ? `/app/units?f.property_id=${property}` : "/app/units"} />
        <KpiCard label="Leased" format="pct" value={r.total ? r.leased / r.total : null} footnote={`${r.leased.toLocaleString("en-US")} units with a current lease`} />
        <KpiCard label="Market rent" format="money" value={r.market} footnote="Monthly, all units" />
        <KpiCard label="Lease rent" format="money" value={r.rent} footnote={r.market ? `${((r.rent / r.market) * 100).toFixed(1)}% of market` : "Monthly, current leases"} />
      </KpiRow>
      <TableCard title="Rent roll" description={`${r.total.toLocaleString("en-US")} units · page ${page} of ${pages}`}
        actions={<CsvButton filename={`rent-roll-page-${page}`} label="Export this page" header={["Property", "Unit", "Unit status", "Sq ft", "Market rent", "Resident", "Lease", "Lease status", "Start", "End", "Rent", "Deposit", "Balance"]} rows={csv} />}
        footer={<div className="flex items-center gap-2"><span>CSV export covers the {r.rows.length} rows on this page.</span>
          <span className="ml-auto flex gap-1">
            {page > 1 && <Button asChild size="sm" variant="outline"><Link href={nav(page - 1)}>Previous</Link></Button>}
            {page < pages && <Button asChild size="sm" variant="outline"><Link href={nav(page + 1)}>Next</Link></Button>}
          </span></div>}>
        <thead className={HEAD}><tr className="border-b"><Th>Property</Th><Th>Unit</Th><Th>Status</Th><Th right>Sq ft</Th><Th right>Market</Th><Th>Resident</Th><Th>Lease</Th><Th>Start</Th><Th>End</Th><Th right>Rent</Th><Th right>Deposit</Th><Th right>Balance</Th></tr></thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.unit_id} className={ROW}>
              <Td className="max-w-[200px] truncate"><Link href={`/app/properties/${x.property_id}`} className="hover:underline">{x.property}</Link></Td>
              <Td><Link href={`/app/units/${encodeURIComponent(x.unit_id)}`} className="font-medium hover:text-primary hover:underline">{x.unit}</Link></Td>
              <Td><StatusBadge value={x.status} /></Td>
              <Td right>{x.sqft ? x.sqft.toLocaleString("en-US") : "—"}</Td>
              <Td right><Money value={x.market_rent} /></Td>
              <Td className="max-w-[180px] truncate">{x.household ?? <span className="text-muted-foreground">Vacant</span>}</Td>
              <Td>{x.lease_id ? <Link href={`/app/leases/${encodeURIComponent(x.lease_id)}`} className="hover:underline">{x.lease_status}</Link> : "—"}</Td>
              <Td className="tabular-nums">{x.start_on ?? "—"}</Td>
              <Td className="tabular-nums">{x.end_on ?? (x.lease_id ? "Month-to-month" : "—")}</Td>
              <Td right>{x.rent == null ? "—" : <Money value={x.rent} />}</Td>
              <Td right>{x.deposit == null ? "—" : <Money value={x.deposit} />}</Td>
              <Td right className={cn(x.balance && x.balance > 0 && "text-tone-danger")}>{x.balance == null ? "—" : <Money value={x.balance} />}</Td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export async function ArAgingReport({ ctx, property }: { ctx: Ctx; property?: string }) {
  const { rows, asOf } = await arAging(ctx, property);
  if (!rows.length) return <EmptyState kind="table" title="No past-due resident balances" description="Every charge due before today is paid or credited." />;
  const sum = (k: "d0_30" | "d31_60" | "d61_90" | "d90p" | "total") => rows.reduce((a, r) => a + r[k], 0);
  const buckets = [{ key: "d0_30", label: "0–30 days", bucket: "0-30" }, { key: "d31_60", label: "31–60", bucket: "31-60" }, { key: "d61_90", label: "61–90", bucket: "61-90" }, { key: "d90p", label: "90+", bucket: "90+" }] as const;
  const csv = [...rows.map((r) => [r.property, r2(r.d0_30), r2(r.d31_60), r2(r.d61_90), r2(r.d90p), r2(r.total), r.charges]), ["Total", r2(sum("d0_30")), r2(sum("d31_60")), r2(sum("d61_90")), r2(sum("d90p")), r2(sum("total")), rows.reduce((a, r) => a + r.charges, 0)]];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <ChartCard title="Aging buckets" description={`Open resident balances at ${asOf}`} kind="bar" x="label" height={240}
            data={buckets.map((b) => ({ label: b.label, bucket: b.bucket, amount: sum(b.key) }))} series={[{ key: "amount", label: "Balance", format: "money" }]}
            drill={`/app/receivables/charges?f.aging={bucket}${property ? `&f.property_id=${property}` : ""}`} />
        </div>
        <div className="xl:col-span-7">
          <ChartCard title="Past due by property" description="Stacked by age, largest first" kind="stacked" x="property" height={240}
            data={rows.slice(0, 12) as unknown as ChartPoint[]} series={buckets.map((b) => ({ key: b.key, label: b.label, format: "money" as const }))}
            drill="/app/receivables/charges?f.property_id={property_id}&f.status=Overdue" />
        </div>
      </div>
      <TableCard title="Accounts receivable aging" description={`By property · as of ${asOf} · open balance of each past-due charge`}
        actions={<CsvButton filename={`ar-aging-${asOf}`} header={["Property", "0-30", "31-60", "61-90", "90+", "Total", "Charges"]} rows={csv} />}>
        <thead className={HEAD}><tr className="border-b"><Th>Property</Th>{buckets.map((b) => <Th key={b.key} right>{b.label}</Th>)}<Th right>Total</Th><Th right>Charges</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.property_id} className={ROW}>
              <Td><Link href={`/app/properties/${r.property_id}`} className="font-medium hover:text-primary hover:underline">{r.property}</Link></Td>
              {buckets.map((b) => <Td key={b.key} right><Link href={`/app/receivables/charges?f.property_id=${r.property_id}&f.aging=${b.bucket}`} className="hover:underline"><Money value={r[b.key]} /></Link></Td>)}
              <Td right className="font-medium"><Money value={r.total} /></Td>
              <Td right className="text-muted-foreground">{r.charges.toLocaleString("en-US")}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className={TOTAL}><Td>Total</Td>{buckets.map((b) => <Td key={b.key} right><Money value={sum(b.key)} /></Td>)}<Td right><Money value={sum("total")} /></Td><Td right>{rows.reduce((a, r) => a + r.charges, 0).toLocaleString("en-US")}</Td></tr></tfoot>
      </TableCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export async function NoiReport({ ctx, from, to }: { ctx: Ctx; from: string; to: string }) {
  const r = await noiByProperty(ctx, from, to);
  if (!r.rows.length) return <EmptyState kind="table" title="No NOI for this period" description="Pick a different period." />;
  const csv = r.rows.map((x) => [x.property, x.metro, r2(x.noi), r2(x.budget), r2(x.variance), x.pct == null ? null : Math.round(x.pct * 1000) / 10]);
  return (
    <div className="flex flex-col gap-3">
      <KpiRow className="xl:grid-cols-3">
        <KpiCard label="NOI" format="money" value={r.noi} footnote={periodLabel(from, to)} />
        <KpiCard label="Budget NOI" format="money" value={r.budget} footnote="Approved budgets" />
        <KpiCard label="Variance to budget" format="pct" value={r.budget ? (r.noi - r.budget) / Math.abs(r.budget) : null} goodWhen="up" footnote={r.budget != null ? `${r.noi >= r.budget ? "+" : "−"}$${Math.abs(Math.round(r.noi - r.budget)).toLocaleString("en-US")}` : "No budget loaded"} />
      </KpiRow>
      <ChartCard title="NOI vs budget by property" description={periodLabel(from, to)} kind="hbar" x="property" height={Math.max(280, r.rows.length * 26)}
        data={r.rows as unknown as ChartPoint[]} series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money" }]}
        drill={`/app/reports?r=pnl&property={property_id}&from=${from}&to=${to}`} />
      <TableCard title="NOI by property" description={`${periodLabel(from, to)} · from monthly metrics`} actions={<CsvButton filename={`noi-${from}-${to}`} header={["Property", "Metro", "NOI", "Budget", "Variance", "Variance %"]} rows={csv} />}>
        <thead className={HEAD}><tr className="border-b"><Th>Property</Th><Th>Metro</Th><Th right>NOI</Th><Th right>Budget</Th><Th right>Variance</Th><Th right>%</Th></tr></thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.property_id} className={ROW}>
              <Td><Link href={`/app/reports?r=pnl&property=${x.property_id}&from=${from}&to=${to}`} className="font-medium hover:text-primary hover:underline">{x.property}</Link></Td>
              <Td className="text-muted-foreground">{x.metro}</Td>
              <Td right><Money value={x.noi} /></Td>
              <Td right>{x.budget == null ? "—" : <Money value={x.budget} />}</Td>
              <Td right className={cn(x.variance != null && (x.variance >= 0 ? "text-tone-success" : "text-tone-danger"))}>{x.variance == null ? "—" : <Money value={x.variance} tone="none" />}</Td>
              <Td right className={cn(x.pct != null && (x.pct >= 0 ? "text-tone-success" : "text-tone-danger"))}>{pct(x.pct)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className={TOTAL}><Td>Total</Td><Td /><Td right><Money value={r.noi} /></Td><Td right>{r.budget == null ? "—" : <Money value={r.budget} />}</Td><Td right>{r.budget == null ? "—" : <Money value={r.noi - r.budget} tone="none" />}</Td><Td right>{r.budget ? pct((r.noi - r.budget) / Math.abs(r.budget)) : "—"}</Td></tr></tfoot>
      </TableCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export async function CashForecastReport({ m }: { m: MetricCtx }) {
  const f = await cashForecast(m);
  if (!f.weeks.length) return <EmptyState kind="chart" title="No trust balance to project" />;
  const end = f.weeks.at(-1)!;
  const csv = f.weeks.map((w) => [w.start, w.inflow, w.bills, w.recurring, w.other, w.distributions, w.outflow, w.balance]);
  return (
    <div className="flex flex-col gap-3">
      <KpiRow className="xl:grid-cols-4">
        <KpiCard label="Trust cash today" format="money" value={f.opening} href="/app/banking/accounts?f.kind=Trust" />
        <KpiCard label="In 90 days" format="money" value={end.balance} previous={f.opening} deltaLabel="vs today" goodWhen="up" />
        <KpiCard label="Low point" format="money" value={f.low?.balance ?? null} footnote={f.low ? `Week of ${f.low.week}` : undefined} />
        <KpiCard label="Net change" format="money" value={end.balance - f.opening} footnote="Over 13 weeks" />
      </KpiRow>
      {f.low && f.low.balance < f.opening * 0.6 && (
        <div className="flex items-start gap-2 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-tone-warning" />
          <span>Trust cash falls to <b className="tabular-nums">${Math.round(f.low.balance).toLocaleString("en-US")}</b> in the week of {f.low.week}, {Math.round((1 - f.low.balance / f.opening) * 100)}% below today. Review bills due that week before approving more.</span>
          <Button asChild size="sm" variant="ghost" className="ml-auto"><Link href="/app/payables/bills?view=ready-to-pay">Bills to pay <ArrowRight /></Link></Button>
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Projected trust balance" description="All trust accounts in scope, by week" kind="area" x="week" height={240} data={f.weeks as unknown as ChartPoint[]} series={[{ key: "balance", label: "Balance", format: "money" }]} />
        <ChartCard title="Cash in and out by week" kind="bar" x="week" height={240} data={f.weeks as unknown as ChartPoint[]} series={[{ key: "inflow", label: "In", format: "money" }, { key: "outflow", label: "Out", format: "money" }]} />
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <TableCard title="Weekly forecast" description="Inflows and outflows by source" actions={<CsvButton filename="cash-forecast-90-days" header={["Week starting", "Rent in", "Open bills", "Recurring bills", "Other vendor spend", "Owner distributions", "Total out", "Balance"]} rows={csv} />}>
            <thead className={HEAD}><tr className="border-b"><Th>Week of</Th><Th right>Rent in</Th><Th right>Open bills</Th><Th right>Recurring</Th><Th right>Other spend</Th><Th right>Distributions</Th><Th right>Balance</Th></tr></thead>
            <tbody>
              {f.weeks.map((w) => (
                <tr key={w.start} className={cn(ROW, f.low?.start === w.start && "bg-tone-warning/[0.06]")}>
                  <Td className="tabular-nums">{w.week}</Td>
                  <Td right><Money value={w.inflow} style="whole" /></Td>
                  <Td right>{w.bills ? <Link href="/app/payables/bills?view=ready-to-pay" className="hover:underline"><Money value={-w.bills} style="whole" /></Link> : "—"}</Td>
                  <Td right>{w.recurring ? <Money value={-w.recurring} style="whole" /> : "—"}</Td>
                  <Td right><Money value={-w.other} style="whole" /></Td>
                  <Td right>{w.distributions ? <Money value={-w.distributions} style="whole" /> : "—"}</Td>
                  <Td right className="font-medium"><Money value={w.balance} style="whole" /></Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        </div>
        <section className="rounded-lg border bg-card p-4 xl:col-span-4">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold">How this is projected <AIBadge source="rules" /></h3>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[12.5px] text-muted-foreground">{f.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="mt-3 text-[12px] text-muted-foreground">A rules forecast from live balances, open bills and recent run rates. It doesn&apos;t assume new leases, rent changes or capital spending.</p>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export async function AskReport({ ctx, ask, scope }: { ctx: Ctx; ask: AskResult; scope: ScopeProperty[] }) {
  const { spec, dropped } = ask;
  const m = measureOf(spec.measure)!;
  const r = await runSpec(ctx, spec);
  const cmp = spec.compareTo !== "none";
  const cmpLabel = COMPARE_LABEL[spec.compareTo];
  const isMonth = spec.groupBy === "month";
  const data = r.rows.slice(0, isMonth ? 24 : 20).map((x) => ({ key: x.key, label: isMonth ? monthShort(x.key) : x.label, value: x.value, compare: x.compare })) as ChartPoint[];
  const series = [{ key: "value", label: m.label, format: "money" as const }, ...(cmp ? [{ key: "compare", label: cmpLabel, format: "money" as const, dashed: spec.compareTo === "budget" && isMonth }] : [])];
  const header = [GROUP_LABEL[spec.groupBy], m.label, ...(cmp ? [cmpLabel, "Variance", "Variance %"] : [])];
  const csv = r.rows.map((x) => [isMonth ? x.key : x.label, r2(x.value), ...(cmp ? [r2(x.compare), r2(x.value - (x.compare ?? 0)), x.compare ? Math.round(((x.value - x.compare) / Math.abs(x.compare)) * 1000) / 10 : null] : [])]);
  // Over budget is bad for costs and good for income.
  const goodDelta = (d: number) => (m.goodWhen === "up" ? d >= 0 : d <= 0);
  const drillTemplate = spec.groupBy === "property" ? "/app/properties/{key}" : spec.groupBy === "gl" ? "/app/gl/journal?f.gl_account_id={key}" : spec.groupBy === "vendor" ? "/app/maintenance/vendors/{key}?tab=bills" : isMonth && m.source === "journal" ? "/app/reports?r=pnl&from={key}&to={key}" : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-semibold">{spec.title}</h2>
          <AIBadge source={ask.live ? "live" : "rules"} model={ask.live ? ask.model : undefined} className="ml-auto" />
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Read as: {describeSpec(spec, scope)}.</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
          {[["Measure", m.label], ["Grouped by", GROUP_LABEL[spec.groupBy]], ["Period", periodLabel(spec.from, spec.to)], ...(cmp ? [["Compared with", cmpLabel]] : []),
            ...(spec.metros.length ? [["Metros", spec.metros.join(", ")]] : []), ...(spec.properties.length ? [["Properties", scope.filter((p) => spec.properties.includes(p.id)).map((p) => p.name).join(", ")]] : [])].map(([k, v]) => (
            <span key={k} className="rounded-md border bg-card px-2 py-0.5"><span className="text-muted-foreground">{k}:</span> {v}</span>
          ))}
        </div>
        {dropped.length > 0 && <p className="mt-2 flex items-start gap-1.5 text-[12px] text-tone-warning"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Not applied: {dropped.join("; ")}.</p>}
        <p className="mt-1 text-[11.5px] text-muted-foreground">{ask.live ? `${ask.source} turned the question into this spec; ` : "Rules matched keywords in the question; "}the figures come from a query of your data, checked against the report registry.</p>
      </div>
      {!r.rows.length ? <EmptyState kind="chart" title="No data for that question" description="Try a longer period, another measure, or fewer filters." /> : (
        <>
          <KpiRow className={cmp ? "xl:grid-cols-3" : "xl:grid-cols-2"}>
            <KpiCard label={m.label} format="money" value={r.total} footnote={r.note ?? periodLabel(spec.from, spec.to)} />
            {cmp && <KpiCard label={cmpLabel} format="money" value={r.compareTotal} />}
            {cmp && <KpiCard label="Variance" format="pct" value={r.compareTotal ? (r.total - r.compareTotal) / Math.abs(r.compareTotal) : null} goodWhen={m.goodWhen} footnote={r.compareTotal != null ? `${r.total >= r.compareTotal ? "+" : "−"}$${Math.abs(Math.round(r.total - r.compareTotal)).toLocaleString("en-US")}` : undefined} />}
            {!cmp && <KpiCard label={`${GROUP_LABEL[spec.groupBy]} count`} format="count" value={r.rows.length} />}
          </KpiRow>
          {spec.chart !== "table" && (
            <ChartCard title={spec.title} description={r.rows.length > data.length ? `Top ${data.length} of ${r.rows.length}; the table has all` : undefined} kind={spec.chart} x="label" data={data} series={series} drill={drillTemplate}
              height={spec.chart === "hbar" ? Math.max(260, data.length * 26) : 260} />
          )}
          <TableCard title="Results" description={`${r.rows.length} ${r.rows.length === 1 ? "row" : "rows"}`} actions={<CsvButton filename={spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)} header={header} rows={csv} />}>
            <thead className={HEAD}><tr className="border-b">{header.map((h, i) => <Th key={h} right={i > 0}>{h}</Th>)}</tr></thead>
            <tbody>
              {r.rows.map((x) => {
                const d = x.value - (x.compare ?? 0);
                return (
                  <tr key={x.key} className={ROW}>
                    <Td>{x.href ? <Link href={x.href} className="font-medium hover:text-primary hover:underline">{isMonth ? monthShort(x.key) : x.label}</Link> : isMonth ? monthShort(x.key) : x.label}</Td>
                    <Td right><Money value={x.value} /></Td>
                    {cmp && <Td right><Money value={x.compare} /></Td>}
                    {cmp && <Td right className={goodDelta(d) ? "text-tone-success" : "text-tone-danger"}><Money value={d} tone="none" /></Td>}
                    {cmp && <Td right className={goodDelta(d) ? "text-tone-success" : "text-tone-danger"}>{x.compare ? pct(d / Math.abs(x.compare)) : "—"}</Td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className={TOTAL}><Td>Total</Td><Td right><Money value={r.total} /></Td>{cmp && <><Td right><Money value={r.compareTotal} /></Td><Td right><Money value={r.total - (r.compareTotal ?? 0)} tone="none" /></Td><Td right>{r.compareTotal ? pct((r.total - r.compareTotal) / Math.abs(r.compareTotal)) : "—"}</Td></>}</tr></tfoot>
          </TableCard>
        </>
      )}
    </div>
  );
}
