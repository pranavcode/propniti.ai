import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { metrics } from "@/server/query";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { ChartCard, KpiCard } from "@/components/app/dashboard";
import { Money, StatusBadge } from "@/components/app/display";
import { entitiesOf, entityInScope, monthLabel, periodsOf, statementOf } from "@/extensions/owners/statements";
import { StatementView } from "@/extensions/owners/ui/StatementView";

export const metadata = { title: "Owner statements · Propniti" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

// Owner statements: one per owner entity per month, built from the trust ledger. The open month can
// be distributed (guarded, idempotent); every line explains itself from the transfers behind it.
export default async function OwnerStatementsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const session = await currentSession();
  const role = session.actor.role;
  if (!can(role, "read", "owner_distributions")) {
    return <PageBody><EmptyState title="Owner statements are for finance and leadership" description="Ask an accountant or your regional manager for access." /></PageBody>;
  }
  const c = { db: getPlatform().db, ws: session.ws };
  const ctx = { db: c.db, ws: c.ws, actor: session.actor };
  const scope = session.actor.propertyIds;
  const all = await entitiesOf(c);
  const ok = await Promise.all(all.map((e) => entityInScope(c, e.id, scope)));
  const inScope = all.filter((_, i) => ok[i]);
  if (!inScope.length) return <PageBody><EmptyState title="No owner entities in your scope" description="Statements appear here for the entities that own properties you manage." /></PageBody>;

  const entityId = inScope.some((e) => e.id === sp.entity) ? sp.entity! : inScope[0].id;
  const [periods, owed, dist, unrec, waterfall, byEntity] = await Promise.all([
    periodsOf(c, entityId),
    metrics(ctx, "owners.owed_now"),
    metrics(ctx, "owners.distributions"),
    metrics(ctx, "owners.unreconciled"),
    metrics(ctx, "owners.waterfall"),
    metrics(ctx, "owners.by_entity"),
  ]);
  const period = periods.some((p) => p.period === sp.period) ? sp.period! : periods[0].period;
  const st = await statementOf(c, entityId, period);
  const href = (e: string, p?: string) => `/app/owner-statements?entity=${e}${p ? `&period=${p}` : ""}`;

  return (
    <main>
      <PageHeader
        icon={<FileSpreadsheet />}
        title="Owner statements"
        description="One statement per owner entity per month, built from the operating trust ledger. Click Explain on any line to see the transfers behind it."
        meta={<span>{inScope.length} owner entities · closes by period cutoff at each distribution</span>}
      />
      <PageBody>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Owed to owners now" value={owed.value ?? null} format="money" href="/app/owner-entities?view=owed" help="Cleared income since each entity's last payout, less fees and vendor payments." />
          <KpiCard label={`Distributed in ${dist.asOf ? monthLabel(dist.asOf) : "last month"}`} value={dist.value ?? null} previous={dist.previous} format="money" spark={dist.spark} goodWhen="up" href="/app/owner-distributions" />
          <KpiCard label="Unreconciled statements" value={unrec.value ?? null} format="count" goodWhen="down" href="/app/owner-distributions?view=unreconciled" help="Statements where the payout doesn't equal income less expenses, fee and reserve." />
          <KpiCard label="Owner entities" value={inScope.length} format="count" href="/app/owner-entities" footnote={<span>{inScope.reduce((a, e) => a + e.properties, 0)} properties</span>} />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <ChartCard className="lg:col-span-2" title="Rent collected to distribution, trailing 12 months" kind="stacked" data={waterfall.points as never} x="month"
            series={[{ key: "amount", label: "Distributed", format: "money" }, { key: "expense", label: "Vendor payments", format: "money" }, { key: "fee", label: "Management fee", format: "money" }]}
            drill="/app/owner-distributions?f.period={month}" help="Each bar is one month's cleared income, split into what was paid out, spent on vendors and kept as fees." />
          <ChartCard title={`Distribution by entity, ${byEntity.asOf ? monthLabel(byEntity.asOf) : ""}`} kind="hbar" data={byEntity.points as never} x="name"
            series={[{ key: "amount", label: "Distributed", format: "money" }]} drill="/app/owner-statements?entity={owner_entity_id}" />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[300px_1fr]">
          <Section title="Entities">
            <nav aria-label="Owner entities" data-tour="statement-entities" className="overflow-hidden rounded-lg border bg-card">
              <ul className="divide-y">
                {inScope.map((e) => (
                  <li key={e.id}>
                    <Link href={href(e.id)} aria-current={e.id === entityId ? "page" : undefined}
                      className={cn("block px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", e.id === entityId && "bg-primary/[0.06] shadow-[inset_2px_0_0_var(--primary)]")}>
                      <p className="truncate text-[13px] font-medium">{e.name}</p>
                      <p className="truncate text-[12px] text-muted-foreground">{e.owner_name} · {e.state} · {e.properties} properties</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </Section>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label="Statement months">
              {periods.slice(0, 13).map((p) => (
                <Link key={p.period} role="listitem" href={href(entityId, p.period)} aria-current={p.period === period ? "page" : undefined}
                  className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] tabular-nums transition-colors hover:bg-muted", p.period === period ? "border-primary/40 bg-primary/[0.07] font-medium text-primary" : "bg-card")}>
                  {p.closed ? new Date(`${p.period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : "Open"}
                  {p.gap_cents !== 0 && <span className="size-1.5 rounded-full bg-tone-danger" aria-label="has an unreconciled difference" />}
                </Link>
              ))}
            </div>
            {st ? (
              <StatementView st={st} explainUrl="/app/owner-statements/explain" mode="staff"
                canDistribute={can(role, "owner_entities.distribute", "owner_entities")} canFix={can(role, "owner_distributions.pay_rounding_cent", "owner_distributions")} />
            ) : (
              <EmptyState title="No statement for this month" description="Pick another month above." />
            )}
            {periods.length > 1 && (
              <Section title="Recent distributions">
                <div className="overflow-hidden rounded-lg border bg-card">
                  <table className="w-full text-[13px]">
                    <thead><tr className="border-b text-left text-[11.5px] text-muted-foreground"><th className="px-3 py-2 font-medium">Month</th><th className="px-3 py-2 font-medium">Paid</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
                    <tbody>
                      {periods.filter((p) => p.closed).slice(0, 6).map((p) => (
                        <tr key={p.distributionId} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="px-3 py-2"><Link href={href(entityId, p.period)} className="font-medium hover:text-primary hover:underline">{monthLabel(p.period)}</Link></td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{p.paid_on}</td>
                          <td className="px-3 py-2">{p.gap_cents ? <StatusBadge value="Unreconciled" tone="danger" /> : <StatusBadge value={p.status === "Pending" ? "On its way" : "Paid"} tone={p.status === "Pending" ? "info" : "success"} />}</td>
                          <td className="px-3 py-2 text-right"><Money value={p.amount_cents} cents /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </div>
        </div>
      </PageBody>
    </main>
  );
}
