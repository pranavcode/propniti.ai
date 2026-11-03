import type { Metadata } from "next";
import { staffSession } from "@/extensions/receivables/staff";
import Link from "next/link";
import { ArrowRight, Banknote, Gavel, Landmark, Scale } from "lucide-react";
import { can } from "@/entities";
import { ChartCard } from "@/components/app/dashboard/ChartCard";
import { KpiCard } from "@/components/app/dashboard/KpiCard";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AS_OF } from "@/seed/constants";
import { effective, metrics, type QueryCtx } from "@/server/query";
import { workbench } from "@/extensions/receivables/collections";
import { depositsInTransit, settleDue } from "@/extensions/receivables/queries";
import { AGING_SERIES } from "@/extensions/receivables/ui/aging";
import { PageHeader } from "@/extensions/receivables/ui/bits";
import { LateFeeRunner, type PolicyRow } from "@/extensions/receivables/ui/LateFeeRunner";
import { AgingCard, NsfCard, ScheduledVsCollected } from "@/extensions/receivables/widgets";

export const metadata: Metadata = { title: "Receivables · Propniti" };

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const safe = <T,>(p: Promise<T>) => p.catch((e) => (console.error("receivables dashboard", e), null));

async function policies(ctx: QueryCtx): Promise<PolicyRow[]> {
  const res = await ctx.db
    .prepare(`SELECT l.id, l.property_id, l.kind, l.grace_days, l.flat_cents, l.pct, l.daily_cents, l.max_cents, p.name AS property FROM ${effective("late_fee_policies", ctx.ws)} AS l LEFT JOIN ${effective("properties", ctx.ws)} AS p ON p.id = l.property_id ORDER BY l.property_id IS NOT NULL, p.name LIMIT 50`)
    .all<{ id: string; property_id: string | null; kind: string; grace_days: number; flat_cents: number; pct: number; daily_cents: number; max_cents: number | null; property: string | null }>();
  const scope = ctx.actor.propertyIds;
  return res.results
    .filter((r) => !r.property_id || scope === "all" || scope.includes(r.property_id))
    .map((r) => ({
      id: r.id, label: r.property ?? "Organization default",
      summary: `${r.kind === "Percent" ? `${r.pct}% of rent` : r.kind === "Flat" ? usd(r.flat_cents) : `${usd(r.flat_cents)} + ${usd(r.daily_cents)}/day`} after ${r.grace_days} day${r.grace_days === 1 ? "" : "s"}${r.max_cents != null ? `, max ${usd(r.max_cents)}` : ""}`,
    }));
}

export default async function ReceivablesPage() {
  const session = await staffSession();
  const role = session.actor.role;
  if (!can(role, "read", "charges")) return <div className="p-6"><EmptyState title="Receivables isn't part of your role" description="Switch role from your avatar menu to see this area." action={{ label: "Go to your home", href: "/app" }} /></div>;
  const ctx: QueryCtx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  await settleDue(ctx);
  const [aging, rate, transit, dispo, byProp, trend, mix, wb, pol] = await Promise.all([
    safe(metrics(ctx, "receivables.aging_live")),
    safe(metrics(ctx, "receivables.collections_rate", { months: 12 })),
    safe(depositsInTransit(ctx)),
    safe(metrics(ctx, "receivables.dispositions_due")),
    safe(metrics(ctx, "receivables.aging_by_property")),
    safe(metrics(ctx, "receivables.delinquency", { months: 12 })),
    safe(metrics(ctx, "receivables.payment_mix")),
    safe(workbench(ctx, { page: 1, size: 5 })),
    can(role, "late_fee_policies.post_late_fees", "late_fee_policies") ? safe(policies(ctx)) : Promise.resolve(null),
  ]);
  // The current month is days old; the collections rate compares closed months.
  const closed = (rate?.points ?? []).filter((p) => String(p.month) < AS_OF.slice(0, 7));
  const rateNow = closed.at(-1), ratePrev = closed.at(-2);
  const pct = (p?: Record<string, unknown>) => (p && Number(p.charged) ? Number(p.collected) / Number(p.charged) : null);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageHeader title="Receivables" description={<>What residents owe, what came in and what needs following up. {session.actor.scope.label} · as of {AS_OF}.</>}>
        <Button asChild variant="outline"><Link href="/app/receivables/record-payment"><Banknote data-icon="inline-start" />Record payment</Link></Button>
        <Button asChild><Link href="/app/receivables/collections"><Scale data-icon="inline-start" />Work collections</Link></Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Past due" value={aging?.value ?? null} format="money" href="/app/receivables/delinquency" footnote={aging ? `${usd(Math.round(Number(aging.points.at(-1)?.amount ?? 0) * 100))} over 90 days` : "Couldn't load"} goodWhen="down" help="Open balances on charges past their due date, live from the ledger." />
        <KpiCard label="Collections rate" value={pct(rateNow)} previous={pct(ratePrev)} format="pct" href={rateNow ? `/app/receivables/charges?f.period=${String(rateNow.month)}` : undefined} footnote={rateNow ? `${String(rateNow.month)}, collected of charged` : "Couldn't load"} spark={closed.map((p) => pct(p) ?? 0)} help="Money collected in the month over charges billed in the month." />
        <KpiCard label="Deposits in transit" value={transit ? transit.cents / 100 : null} format="money" href="/app/receivables/payments?f.status=Processing" footnote={transit ? `${transit.count} not yet cleared to trust` : "Couldn't load"} />
        <NsfCard actor={session.actor} />
        <KpiCard label="Dispositions due" value={dispo?.value ?? null} format="count" goodWhen="down" href="/app/receivables/deposits?view=due" footnote="Move-outs waiting on a deposit statement" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ScheduledVsCollected actor={session.actor} />
        <AgingCard actor={session.actor} />
        {byProp ? (
          <ChartCard title="Past due by property" description="Top 15 properties, stacked by days late" kind="stacked" data={byProp.points as never} x="name" height={260}
            series={AGING_SERIES}
            drill="/app/receivables/delinquency?property={property_id}" help="Click a property to see its delinquent residents." />
        ) : <ErrorBanner title="Past due by property couldn't load" />}
        {trend ? (
          <ChartCard title="Delinquency at month end" description="Month-end snapshots, trailing 12 months" kind="stacked" data={trend.points as never} x="month" height={260}
            series={AGING_SERIES}
            drill="/app/receivables/charges?f.period={month}&f.status=Overdue" help="From the month-end close. Today's live figure is on the aging card." />
        ) : <ErrorBanner title="Delinquency trend couldn't load" />}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold">Highest-risk residents</h2>
            <Link href="/app/receivables/collections" className="flex items-center gap-1 text-[12.5px] text-primary hover:underline">Collections workbench<ArrowRight className="size-3.5" /></Link>
          </header>
          {!wb ? <ErrorBanner className="m-3" title="Couldn't load" /> : wb.rows.length === 0 ? <EmptyState compact title="No one is behind" /> : (
            <ul className="divide-y">
              {wb.rows.map((r) => (
                <li key={r.lease_id} className="flex items-center gap-3 px-4 py-2">
                  <span className={cn("w-10 shrink-0 text-right text-[12px] font-semibold tabular-nums", r.band === "High" ? "text-tone-danger" : r.band === "Medium" ? "text-tone-warning" : "text-muted-foreground")} title={`${r.band} risk`}>{r.score}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/receivables/ledger/${r.lease_id}`} className="block truncate text-[13px] font-medium hover:text-primary hover:underline">{r.resident}</Link>
                    <span className="block truncate text-[11.5px] text-muted-foreground">{r.why[0]}{r.dataError ? " · lease rent typo flagged" : ""}</span>
                  </div>
                  <span className="shrink-0 text-right text-[13px] font-medium tabular-nums">{usd(r.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex flex-col gap-3">
          {mix && (
            <ChartCard title="How residents paid" description={`${String(mix.asOf)}, by amount`} kind="donut" data={mix.points as never} x="method" height={180}
              series={[{ key: "amount", label: "Amount", format: "money" }]} drill={`/app/receivables/payments?f.method={method}`} />
          )}
          {pol && (
            <section className="rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2.5">
                <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold"><Gavel className="size-4 text-muted-foreground" />Late fees</h2>
                <Link href="/app/receivables/late-fees" className="text-[12.5px] text-primary hover:underline">Policies</Link>
              </header>
              <LateFeeRunner policies={pol} period={AS_OF.slice(0, 7)} />
            </section>
          )}
          <Link href="/app/receivables/deposits?view=due" className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-muted/40">
            <Landmark className="size-4 text-muted-foreground" />
            <span className="flex-1 text-[13px]"><span className="font-medium">{dispo?.value ?? "—"} deposit dispositions due</span><span className="block text-[11.5px] text-muted-foreground">Itemize deductions and refund before the state deadline</span></span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </div>
  );
}
