import { effective } from "@/server/query";
import { baseOf } from "@/server/effective";
import type { MetricKey, Row } from "@/entities/types";
import { getMetric, registerMetric, type MetricCtx, type MetricParams, type MetricResult } from "./metrics";

// Portfolio-wide metrics over metrics_monthly (base, precomputed by the generator) plus the
// visitor's live overlay for the current month. Module lanes add their own with monthly() or
// registerMetric(); keys are "<module>.<name>".

// Column sums per month. Rates are recomputed from sums, never averaged.
const SUMS = ["units", "occupied", "gpr_cents", "charged_cents", "collected_cents", "vacancy_loss_cents", "concessions_cents", "aging_0_30_cents", "aging_31_60_cents", "aging_61_90_cents", "aging_90p_cents", "opex_cents", "noi_cents", "budget_noi_cents", "wo_opened", "wo_open", "wo_sla_breach", "move_ins", "move_outs", "leads", "tours", "applications", "ai_actions", "ai_minutes_saved"] as const;
export type MonthSums = Record<(typeof SUMS)[number] | "econ_weighted", number> & { month: string };

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

function scopeSql(ctx: MetricCtx, params: MetricParams, col = "property_id") {
  const sql: string[] = [];
  const binds: unknown[] = [];
  if (ctx.propertyIds !== "all") {
    sql.push(`${col} IN (SELECT value FROM json_each(?))`);
    binds.push(JSON.stringify(ctx.propertyIds));
  }
  if (params.property) {
    sql.push(`${col} = ?`);
    binds.push(params.property);
  }
  return { sql: sql.map((s) => ` AND ${s}`).join(""), binds };
}

// Live changes the visitor made this month that the precomputed base doesn't know about:
// payments recorded toward this month's charges and work orders opened in their overlay.
async function liveDelta(ctx: MetricCtx, params: MetricParams, month: string): Promise<Partial<MonthSums>> {
  if (!ctx.ws) return {};
  const s = scopeSql(ctx, params);
  const newRows = (t: string) => `workspace_id = ? AND deleted = 0 AND id NOT IN (SELECT id FROM ${t} WHERE workspace_id = 'base')`;
  const [pay, wo] = await Promise.all([
    ctx.db.prepare(`SELECT coalesce(sum(amount_cents), 0) AS c FROM payments WHERE ${newRows("payments")} AND nsf = 0 AND charge_id IN (SELECT id FROM charges WHERE workspace_id IN ('base', ?) AND deleted = 0 AND period = ?)${s.sql}`).bind(ctx.ws, ctx.ws, month, ...s.binds).first<{ c: number }>(),
    ctx.db.prepare(`SELECT count(*) AS n, sum(substr(opened_at, 1, 7) = ?) AS opened FROM work_orders WHERE ${newRows("work_orders")} AND status NOT IN ('Completed', 'Paid', 'Cancelled')${s.sql}`).bind(month, ctx.ws, ...s.binds).first<{ n: number; opened: number | null }>(),
  ]);
  return { collected_cents: Number(pay?.c ?? 0), wo_open: Number(wo?.n ?? 0), wo_opened: Number(wo?.opened ?? 0) };
}

export async function monthSeries(ctx: MetricCtx, params: MetricParams): Promise<MonthSums[]> {
  const to = params.month ?? ctx.asOf;
  const from = addMonths(to, -Math.max(1, Math.min(24, params.months ?? 12)) + 1);
  const s = scopeSql(ctx, params);
  const res = await ctx.db.prepare(`SELECT month, ${SUMS.map((c) => `coalesce(sum(${c}), 0) AS ${c}`).join(", ")}, coalesce(sum(occupancy_econ * gpr_cents), 0) AS econ_weighted FROM metrics_monthly WHERE workspace_id = '${baseOf(ctx.ws)}' AND month BETWEEN ? AND ?${s.sql} GROUP BY month ORDER BY month`).bind(from, to, ...s.binds).all<MonthSums>();
  const rows = res.results.map((r) => ({ ...r, month: String(r.month) }));
  const last = rows[rows.length - 1];
  if (last && last.month === ctx.asOf) {
    const d = await liveDelta(ctx, params, last.month);
    for (const [k, v] of Object.entries(d)) (last as Record<string, number | string>)[k] = Number(last[k as keyof MonthSums]) + Number(v);
  }
  return rows;
}

const ratio = (a: number, b: number) => (b ? a / b : null);
// Collections rate: the month's charges paid so far ÷ the month's charges. collected_cents is the
// ledger allocation to that month's charges (oldest charge first), so paying down an older
// balance never counts here; the cap only guards a live payment larger than its charge.
const collectionsRate = (m: MonthSums) => (m.charged_cents ? Math.min(1, m.collected_cents / m.charged_cents) : null);

// A metric whose value is one number per month: KPI value = latest month, previous = the month
// before, spark and points = the trailing window. Flows (NOI, income) end at the last closed
// month, since the current one is only days old (collections and month-end delinquency too:
// early in a month, rent just billed would read as delinquent); stocks (occupancy, open work
// orders) end at the current month and include the visitor's live changes.
// A company with no monthly history yet (just imported) reads current-state figures from its live
// records (`live`); figures that need a closed month say so instead.
export const NEEDS_HISTORY = "Needs a month of activity";
type Live = (ctx: MetricCtx, params: MetricParams) => Promise<number | null>;

export function monthly(key: MetricKey, label: string, value: (m: MonthSums) => number | null, series?: Record<string, (m: MonthSums) => number | null>, kind: "stock" | "flow" = "stock", live?: Live) {
  return registerMetric({
    key,
    label,
    run: async (ctx, params): Promise<MetricResult> => {
      const rows = await monthSeries(ctx, kind === "flow" && !params.month ? { ...params, month: addMonths(ctx.asOf, -1) } : params);
      if (!rows.length && !(await hasHistory(ctx))) {
        return live ? { value: await live(ctx, params), previous: null, spark: [], points: [], asOf: ctx.asOf, source: "live records" } : { value: null, previous: null, spark: [], points: [], note: NEEDS_HISTORY };
      }
      const vals = rows.map(value);
      const points = rows.map((m, i) => {
        const p: Row = { month: m.month, value: vals[i] };
        for (const [k, fn] of Object.entries(series ?? {})) p[k] = fn(m);
        return p;
      });
      return { value: vals.at(-1) ?? null, previous: vals.at(-2) ?? null, spark: vals.map((v) => v ?? 0), points, asOf: rows.at(-1)?.month, source: "metrics_monthly + live overlay" };
    },
  });
}

// One row per property for the month (horizontal bars, comparison tables).
export function byProperty(key: MetricKey, label: string, cols: Record<string, (m: MonthSums) => number | null>, sortBy: string) {
  return registerMetric({
    key,
    label,
    run: async (ctx, params) => {
      // NOI and collections need a whole month: compare properties on the last closed one.
      const month = params.month ?? addMonths(ctx.asOf, -1);
      const s = scopeSql(ctx, params, "m.property_id");
      const res = await ctx.db.prepare(`SELECT m.property_id, p.name, p.metro, m.month, ${SUMS.map((c) => `coalesce(m.${c}, 0) AS ${c}`).join(", ")}, m.occupancy_econ * m.gpr_cents AS econ_weighted FROM metrics_monthly m JOIN ${effective("properties", ctx.ws)} p ON p.id = m.property_id WHERE m.workspace_id = 'base' AND m.month = ?${s.sql}`).bind(month, ...s.binds).all<MonthSums & { property_id: string; name: string; metro: string }>();
      const points = res.results.map((r) => {
        const p: Row = { property_id: r.property_id, name: r.name, metro: r.metro };
        for (const [k, fn] of Object.entries(cols)) p[k] = fn(r);
        return p;
      }).sort((a, b) => Number(b[sortBy] ?? 0) - Number(a[sortBy] ?? 0));
      return { points, asOf: month, source: "metrics_monthly" };
    },
  });
}

// Whether the workspace's org has any monthly figures at all (Summit always does; a new company
// before its first close has none), so a filter that matches nothing still reads as "no data".
async function hasHistory(ctx: MetricCtx) {
  return !!(await ctx.db.prepare(`SELECT 1 FROM metrics_monthly WHERE workspace_id IN ('${baseOf(ctx.ws)}', ?) LIMIT 1`).bind(ctx.ws ?? "~").first());
}

// Live unit counts in scope: rentable units and occupied or on-notice ones (as the property list).
async function liveUnits(ctx: MetricCtx, params: MetricParams) {
  const s = scopeSql(ctx, params);
  return ctx.db.prepare(`SELECT count(*) AS units, coalesce(sum(status IN ('Occupied', 'Notice')), 0) AS occupied FROM ${effective("units", ctx.ws)} WHERE 1 = 1${s.sql}`).bind(...s.binds).first<{ units: number; occupied: number }>();
}
const liveOccupancy: Live = async (ctx, params) => { const u = await liveUnits(ctx, params); return u?.units ? u.occupied / u.units : null; };
const liveUnitCount: Live = async (ctx, params) => (await liveUnits(ctx, params))?.units ?? 0;
const liveDelinquency: Live = async (ctx, params) => (await getMetric("receivables.aging_live")?.run(ctx, params))?.value ?? null;
const liveOpenWorkOrders: Live = async (ctx, params) => {
  const s = scopeSql(ctx, params);
  return Number((await ctx.db.prepare(`SELECT count(*) AS n FROM ${effective("work_orders", ctx.ws)} WHERE status NOT IN ('Completed', 'Paid', 'Cancelled')${s.sql}`).bind(...s.binds).first<{ n: number }>())?.n ?? 0);
};

const dollars = (c: number) => c / 100;
const aging = (m: MonthSums) => m.aging_0_30_cents + m.aging_31_60_cents + m.aging_61_90_cents + m.aging_90p_cents;

monthly("portfolio.occupancy", "Physical occupancy", (m) => ratio(m.occupied, m.units), {
  physical: (m) => ratio(m.occupied, m.units),
  economic: (m) => ratio(m.econ_weighted, m.gpr_cents),
}, "stock", liveOccupancy);
monthly("portfolio.economic_occupancy", "Economic occupancy", (m) => ratio(m.econ_weighted, m.gpr_cents));
monthly("portfolio.noi", "Net operating income", (m) => dollars(m.noi_cents), {
  noi: (m) => dollars(m.noi_cents),
  budget: (m) => (m.budget_noi_cents ? dollars(m.budget_noi_cents) : null),
}, "flow");
// Income here is what each month's charges were paid (collected_cents), not cash received.
monthly("portfolio.income_expense", "Charges paid vs expenses", (m) => dollars(m.collected_cents - m.opex_cents), {
  income: (m) => dollars(m.collected_cents),
  expenses: (m) => dollars(m.opex_cents),
}, "flow");
monthly("portfolio.units", "Units", (m) => m.units, undefined, "stock", liveUnitCount);
monthly("receivables.collections_rate", "Collections rate", collectionsRate, {
  charged: (m) => dollars(m.charged_cents),
  collected: (m) => dollars(m.collected_cents),
}, "flow");
monthly("receivables.delinquency", "Delinquent balance", (m) => dollars(aging(m)), {
  d0_30: (m) => dollars(m.aging_0_30_cents),
  d31_60: (m) => dollars(m.aging_31_60_cents),
  d61_90: (m) => dollars(m.aging_61_90_cents),
  d90p: (m) => dollars(m.aging_90p_cents),
}, "flow", liveDelinquency);
monthly("leasing.vacancy_loss", "Vacancy loss", (m) => dollars(m.vacancy_loss_cents), undefined, "flow");
monthly("leasing.move_ins", "Move-ins", (m) => m.move_ins, { move_ins: (m) => m.move_ins, move_outs: (m) => m.move_outs }, "flow");
monthly("maintenance.wo_open", "Open work orders", (m) => m.wo_open, { opened: (m) => m.wo_opened, open: (m) => m.wo_open, breached: (m) => m.wo_sla_breach }, "stock", liveOpenWorkOrders);
// SLA met rate: work orders completed by their SLA due time ÷ work orders due in the month (the
// current month counts only what is due by the demo's today). Open jobs past due count as missed,
// so the rate is always between 0 and 1. Live from work_orders, scoped like every list.
// One query serves both the scope total and the per-property split, so they can't drift.
async function slaCounts(ctx: MetricCtx, params: MetricParams, byProperty: boolean) {
  const to = params.month ?? ctx.asOf;
  const from = addMonths(to, -Math.max(1, Math.min(24, params.months ?? 12)) + 1);
  const s = scopeSql(ctx, params, "w.property_id");
  const asOf = "coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))";
  const res = await ctx.db.prepare(
    `SELECT substr(w.sla_due_at, 1, 7) AS month${byProperty ? ", w.property_id" : ""}, count(*) AS due, coalesce(sum(w.completed_at IS NOT NULL AND w.completed_at <= w.sla_due_at), 0) AS met
     FROM ${effective("work_orders", ctx.ws)} AS w
     WHERE w.sla_due_at IS NOT NULL AND w.status <> 'Cancelled' AND substr(w.sla_due_at, 1, 10) <= ${asOf} AND substr(w.sla_due_at, 1, 7) BETWEEN ? AND ?${s.sql}
     GROUP BY 1${byProperty ? ", 2" : ""}`,
  ).bind(from, to, ...s.binds).all<{ month: string; property_id?: string; due: number; met: number }>();
  return { from, to, rows: res.results.map((r) => ({ month: String(r.month), property_id: r.property_id, due: Number(r.due), met: Number(r.met) })) };
}
const slaPoint = (due: number, met: number) => ({ value: due ? met / due : null, due, met, missed: due - met });

registerMetric({
  key: "maintenance.sla",
  label: "SLA met",
  run: async (ctx, params) => {
    const { from, to, rows } = await slaCounts(ctx, params, false);
    const by = new Map(rows.map((r) => [r.month, r]));
    const points: Row[] = [];
    for (let m = from; m <= to; m = addMonths(m, 1)) points.push({ month: m, ...slaPoint(by.get(m)?.due ?? 0, by.get(m)?.met ?? 0) });
    const vals = points.map((p) => p.value as number | null);
    return { value: vals.at(-1) ?? null, previous: vals.at(-2) ?? null, spark: vals.map((v) => v ?? 0), points, asOf: to, source: "work_orders (live)" };
  },
});

// The same SLA, one point per property for one month (default: the demo's current month).
// Summing met and due across points gives maintenance.sla for the scope.
registerMetric({
  key: "maintenance.sla_by_property",
  label: "SLA met by property",
  run: async (ctx, params) => {
    const { to, rows } = await slaCounts(ctx, { ...params, months: 1 }, true);
    const names = new Map((await ctx.db.prepare(`SELECT id, name FROM ${effective("properties", ctx.ws)}`).all<{ id: string; name: string }>()).results.map((p) => [p.id, p.name]));
    const points = rows.map((r) => ({ property_id: r.property_id!, name: names.get(r.property_id!) ?? r.property_id!, ...slaPoint(r.due, r.met) })).sort((a, b) => b.missed - a.missed);
    return { points, asOf: to, source: "work_orders (live)" };
  },
});
monthly("intelligence.ai_minutes_saved", "Staff hours saved by AI", (m) => Math.round(m.ai_minutes_saved / 60), { hours: (m) => Math.round(m.ai_minutes_saved / 60), actions: (m) => m.ai_actions }, "flow");

byProperty("portfolio.by_property", "Property comparison", {
  units: (m) => m.units,
  occupancy: (m) => ratio(m.occupied, m.units),
  economic_occupancy: (m) => ratio(m.econ_weighted, m.gpr_cents),
  noi: (m) => dollars(m.noi_cents),
  budget_noi: (m) => (m.budget_noi_cents ? dollars(m.budget_noi_cents) : null),
  collections_rate: collectionsRate,
  delinquent: (m) => dollars(aging(m)),
  wo_open: (m) => m.wo_open,
}, "noi");

// Aging buckets for the month, one point per bucket (bar or donut), drillable by bucket.
registerMetric({
  key: "receivables.aging",
  label: "Delinquency aging",
  run: async (ctx, params) => {
    const rows = await monthSeries(ctx, { ...params, months: 1 });
    const m = rows.at(-1);
    const b = (bucket: string, label: string, cents: number) => ({ bucket, label, amount: dollars(cents) });
    return {
      value: m ? dollars(aging(m)) : null,
      points: m ? [b("0-30", "0–30 days", m.aging_0_30_cents), b("31-60", "31–60 days", m.aging_31_60_cents), b("61-90", "61–90 days", m.aging_61_90_cents), b("90+", "90+ days", m.aging_90p_cents)] : [],
      asOf: m?.month,
      source: "metrics_monthly + live overlay",
    };
  },
});

registerMetric({
  key: "leasing.funnel",
  label: "Leasing funnel",
  run: async (ctx, params) => {
    const rows = await monthSeries(ctx, { ...params, months: params.months ?? 3 });
    const sum = (k: keyof MonthSums) => rows.reduce((a, r) => a + Number(r[k]), 0);
    const points = [
      { stage: "Leads", count: sum("leads") },
      { stage: "Tours", count: sum("tours") },
      { stage: "Applications", count: sum("applications") },
      { stage: "Move-ins", count: sum("move_ins") },
    ];
    return { value: points[3].count, points, asOf: rows.at(-1)?.month, source: "metrics_monthly" };
  },
});
