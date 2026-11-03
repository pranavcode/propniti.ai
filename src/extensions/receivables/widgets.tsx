import { currentSession } from "@/auth/session";
import type { Actor, Role } from "@/entities/types";
import { registerWidget } from "@/extensions/widgets";
import { ChartCard } from "@/components/app/dashboard/ChartCard";
import { KpiCard } from "@/components/app/dashboard/KpiCard";
import { ErrorBanner } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { metrics, type QueryCtx } from "@/server/query";
import { depositsInTransit, nsfCounts } from "./queries";

// Receivables cards for the Accountant's home (shared with payables) and the receivables dashboard.
// Each card links to the rows behind its number.

const ROLES: Role[] = ["principal", "regional_manager", "property_manager", "accountant"];
const ctxFor = async (actor: Actor): Promise<QueryCtx> => ({ db: getPlatform().db, ws: (await currentSession()).ws, actor });
const failed = (what: string) => <ErrorBanner title={`${what} couldn't load`} message="Refresh the page to try again." />;
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export async function ScheduledVsCollected({ actor }: { actor: Actor }) {
  const m = await metrics(await ctxFor(actor), "receivables.collections_rate", { months: 12 }).catch(() => null);
  if (!m) return failed("Scheduled vs collected");
  const last = m.points.at(-2);
  return (
    <ChartCard
      title="Scheduled vs collected"
      description={last ? `${String(last.month)}: ${((Number(last.collected) / Number(last.charged || 1)) * 100).toFixed(1)}% collected` : "Trailing 12 months"}
      kind="bar" data={m.points as never} x="month" height={220}
      series={[{ key: "charged", label: "Scheduled", format: "money" }, { key: "collected", label: "Collected", format: "money" }]}
      drill="/app/receivables/charges?f.period={month}"
      help="Charges billed per month against money received. Click a month to see its charges."
    />
  );
}

export async function AgingCard({ actor }: { actor: Actor }) {
  const m = await metrics(await ctxFor(actor), "receivables.aging_live").catch(() => null);
  if (!m) return failed("Delinquency aging");
  return (
    <ChartCard
      title="Delinquency aging"
      description={`${money(Math.round(Number(m.value ?? 0) * 100))} past due as of ${m.asOf}`}
      kind="bar" data={m.points as never} x="label" height={220}
      series={[{ key: "amount", label: "Past due", format: "money" }]}
      drill="/app/receivables/delinquency?bucket={bucket}"
      help="Open balances on charges past their due date, by days late. Click a bucket for the residents in it."
    />
  );
}

export async function DepositsInTransit({ actor }: { actor: Actor }) {
  const d = await depositsInTransit(await ctxFor(actor)).catch(() => null);
  if (!d) return failed("Deposits in transit");
  return <KpiCard label="Deposits in transit" value={d.cents / 100} format="money" footnote={`${d.count} payment${d.count === 1 ? "" : "s"} received, not yet cleared to trust`} href="/app/receivables/payments?f.status=Processing" help="Resident ACH payments and office deposits that haven't cleared into the trust account yet." />;
}

export async function NsfCard({ actor }: { actor: Actor }) {
  const n = await nsfCounts(await ctxFor(actor)).catch(() => null);
  if (!n) return failed("Returned payments");
  return <KpiCard label="Returned payments (NSF)" value={n.count} previous={n.previous} goodWhen="down" deltaLabel={`vs ${n.previousMonth}`} footnote={n.count ? `${money(n.cents)} this month` : "None this month"} href="/app/receivables/payments?view=nsf" help="Payments the bank returned unpaid. Each one reopens the charge and adds an NSF fee." />;
}

registerWidget({ key: "receivables.scheduled_vs_collected", title: "Scheduled vs collected", roles: ROLES, size: "md", component: ScheduledVsCollected });
registerWidget({ key: "receivables.aging", title: "Delinquency aging", roles: ROLES, size: "md", component: AgingCard });
registerWidget({ key: "receivables.deposits_in_transit", title: "Deposits in transit", roles: ROLES, size: "sm", component: DepositsInTransit });
registerWidget({ key: "receivables.nsf", title: "Returned payments", roles: ROLES, size: "sm", component: NsfCard });
