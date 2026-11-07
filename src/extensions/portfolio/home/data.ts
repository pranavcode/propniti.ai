import "server-only";
import type { Row } from "@/entities/types";
import type { MetricResult } from "@/extensions/metrics";
import { sql, type DataCtx } from "@/ai/data";
import { proposalsPage } from "@/ai/views";
import { metrics, type QueryCtx } from "@/server/query";
import { AS_OF } from "@/seed/constants";
import { seededPhoto } from "@/entities/common";

// Read model for the principal and regional homes. Every figure comes from the query layer or
// metrics_monthly in the persona's scope; nothing here is model output.

export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
export const CURRENT_MONTH = AS_OF.slice(0, 7);
export const LAST_CLOSED = addMonths(CURRENT_MONTH, -1);

const safe = (p: Promise<MetricResult>) => p.catch((e: unknown) => ({ points: [], value: null, previous: null, spark: [], error: e instanceof Error ? e.message : "Couldn't load" } as MetricResult & { error: string }));

export type Kpi = { value: number | null; previous: number | null; spark: number[]; error?: string; note?: string };
const kpi = (m: MetricResult & { error?: string }): Kpi => ({ value: m.value ?? null, previous: m.previous ?? null, spark: m.spark ?? [], error: m.error, note: m.note });

// Delinquent is what is past due today (open charges past their due date, every aging bucket): the
// figure Finance, Residents and the delinquency page show. It compares with the month-end balance
// at the last close, and the month-end history leads the sparkline.
const delinquentNow = (closed: MetricResult & { error?: string }, live: MetricResult & { error?: string }): Kpi => ({
  value: live.value ?? null, previous: closed.value ?? null, spark: live.value == null ? [] : [...(closed.spark ?? []), live.value], error: live.error,
});

// KPIs read the last closed month, so rates (collections, NOI) compare whole months.
export async function homeMetrics(q: QueryCtx) {
  const closed = { month: LAST_CLOSED, months: 12 };
  const [noi, occ, econ, coll, delinq, live, sla, ai, byProp, byPropPrev, aging, agingByProp, slaByProp, incomeExpense, byRegion] = await Promise.all([
    safe(metrics(q, "portfolio.noi", closed)),
    safe(metrics(q, "portfolio.occupancy", closed)),
    safe(metrics(q, "portfolio.economic_occupancy", closed)),
    safe(metrics(q, "receivables.collections_rate", closed)),
    safe(metrics(q, "receivables.delinquency", closed)),
    safe(metrics(q, "receivables.aging_live")),
    safe(metrics(q, "maintenance.sla", closed)),
    safe(metrics(q, "intelligence.ai_minutes_saved", closed)),
    safe(metrics(q, "portfolio.by_property", { month: LAST_CLOSED })),
    safe(metrics(q, "portfolio.by_property", { month: addMonths(LAST_CLOSED, -1) })),
    safe(metrics(q, "receivables.aging", { month: LAST_CLOSED })),
    safe(metrics(q, "portfolio.aging_by_property", { month: LAST_CLOSED })),
    safe(metrics(q, "maintenance.sla_by_property", { month: LAST_CLOSED })),
    safe(metrics(q, "portfolio.income_expense", closed)),
    safe(metrics(q, "portfolio.by_region", { month: LAST_CLOSED })),
  ]);
  return {
    month: LAST_CLOSED,
    kpis: { noi: kpi(noi), occupancy: kpi(occ), economic: kpi(econ), collections: kpi(coll), delinquency: delinquentNow(delinq, live), sla: kpi(sla), aiHours: kpi(ai) },
    series: { noi: noi.points, occupancy: occ.points, collections: coll.points, ai: ai.points, incomeExpense: incomeExpense.points, delinquency: delinq.points, wo: sla.points },
    byProperty: byProp.points, byPropertyPrev: byPropPrev.points, aging: aging.points, agingByProperty: agingByProp.points, slaByProperty: slaByProp.points, byRegion: byRegion.points,
  };
}
export type HomeMetrics = Awaited<ReturnType<typeof homeMetrics>>;

// Comparison rows: last closed month per property with the month before for deltas, plus a photo.
export type CompareRow = {
  id: string; name: string; metro: string; photo: string | undefined; units: number; occupancy: number | null; economic: number | null; noi: number | null; budget: number | null;
  vsBudget: number | null; noiPrev: number | null; collections: number | null; delinquent: number | null; woDue: number; breached: number; sla: number | null;
};
export function compareRows(m: HomeMetrics): CompareRow[] {
  const prev = new Map(m.byPropertyPrev.map((p) => [String(p.property_id), p]));
  const sla = new Map(m.slaByProperty.map((p) => [String(p.property_id), p]));
  const num = (v: unknown) => (v == null ? null : Number(v));
  return m.byProperty.map((p) => {
    const id = String(p.property_id);
    const noi = num(p.noi), budget = num(p.budget_noi);
    const s = sla.get(id);
    return {
      id, name: String(p.name), metro: String(p.metro), photo: seededPhoto(id), units: Number(p.units ?? 0),
      occupancy: num(p.occupancy), economic: num(p.economic_occupancy), noi, budget, vsBudget: noi != null && budget ? (noi - budget) / Math.abs(budget) : null,
      noiPrev: num(prev.get(id)?.noi), collections: num(p.collections_rate), delinquent: num(p.delinquent),
      woDue: Number(s?.due ?? 0), breached: Number(s?.missed ?? 0), sla: num(s?.value),
    };
  });
}

// The briefing: what the agents did in the last day, what is waiting on this persona, and the
// risks the figures show. Agent activity reads the visitor's overlay over base.
export type BriefingItem = { tone: "danger" | "warning" | "info" | "success" | "ai"; text: string; href: string };
export async function briefing(data: DataCtx, rows: CompareRow[], m: HomeMetrics) {
  const since = new Date(Date.parse(`${AS_OF}T23:59:59Z`) - 2 * 86_400_000).toISOString();
  const [runs, queue, issues, insurance] = await Promise.all([
    sql<{ agent_key: string; n: number; proposals: number }>(data,
      "SELECT r.agent_key, count(*) AS n, (SELECT count(*) FROM {ai_proposals} p WHERE p.run_id IN (SELECT id FROM {agent_runs} x WHERE x.agent_key = r.agent_key AND x.started_at >= ?)) AS proposals FROM {agent_runs} r WHERE r.started_at >= ? GROUP BY r.agent_key ORDER BY n DESC",
      [since, since], { unscoped: true }).catch(() => []),
    proposalsPage(data, { queue: "needs_you", size: 6 }).catch(() => ({ rows: [], total: 0, counts: {} as Record<string, number> })),
    sql<{ n: number }>(data, "SELECT count(*) AS n FROM {data_issues} WHERE status = 'open'").catch(() => [{ n: 0 }]),
    sql<{ n: number }>(data, "SELECT count(*) AS n FROM {insurance_policies} WHERE expires_on <= date(?, '+60 day')", [AS_OF]).catch(() => [{ n: 0 }]),
  ]);

  const risks: BriefingItem[] = [];
  const below = rows.filter((r) => r.vsBudget != null && r.vsBudget < -0.05).sort((a, b) => a.vsBudget! - b.vsBudget!);
  if (below.length) risks.push({ tone: "danger", text: `${below.length} ${below.length === 1 ? "property is" : "properties are"} more than 5% below budget NOI, led by ${below[0].name} (${Math.round(below[0].vsBudget! * 1000) / 10}%).`, href: `/app/properties/${below[0].id}?tab=financials` });
  const lowOcc = rows.filter((r) => r.occupancy != null && r.occupancy < 0.9).sort((a, b) => a.occupancy! - b.occupancy!);
  if (lowOcc.length) risks.push({ tone: "warning", text: `${lowOcc.length} ${lowOcc.length === 1 ? "property is" : "properties are"} under 90% occupied; ${lowOcc[0].name} is at ${Math.round(lowOcc[0].occupancy! * 1000) / 10}%.`, href: "/app/properties?view=below-92" });
  const breached = rows.reduce((s, r) => s + r.breached, 0);
  const due = rows.reduce((s, r) => s + r.woDue, 0);
  if (breached) risks.push({ tone: "warning", text: `${breached} of ${due} work orders due in ${new Date(`${LAST_CLOSED}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} missed SLA, across ${rows.filter((r) => r.breached).length} properties.`, href: "/app/maintenance/work-orders?view=past-sla" });
  const d90 = Number(m.aging.find((a) => a.bucket === "90+")?.amount ?? 0);
  if (d90 > 0) risks.push({ tone: "danger", text: `$${Math.round(d90).toLocaleString("en-US")} of resident balances are 90+ days past due.`, href: "/app/receivables/charges?f.aging=90%2B" });
  if (insurance[0]?.n) risks.push({ tone: "warning", text: `${insurance[0].n} property insurance ${insurance[0].n === 1 ? "policy expires" : "policies expire"} within 60 days.`, href: "/app/properties?tab=compliance" });
  if (issues[0]?.n) risks.push({ tone: "info", text: `${issues[0].n} open data-health ${issues[0].n === 1 ? "issue" : "issues"} could affect reported figures.`, href: "/app/data-health" });

  return {
    overnight: runs as Row[] as { agent_key: string; n: number; proposals: number }[],
    queue: { rows: queue.rows, total: queue.total, counts: queue.counts as Record<string, number> },
    risks,
  };
}
