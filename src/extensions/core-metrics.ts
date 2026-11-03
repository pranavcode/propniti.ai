import { effective } from "@/server/query";
import type { MetricKey, Row } from "@/entities/types";
import { registerMetric, type MetricCtx, type MetricParams, type MetricResult } from "./metrics";

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
// payments recorded and work orders opened in their overlay.
async function liveDelta(ctx: MetricCtx, params: MetricParams, month: string): Promise<Partial<MonthSums>> {
  if (!ctx.ws) return {};
  const s = scopeSql(ctx, params);
  const newRows = (t: string) => `workspace_id = ? AND deleted = 0 AND id NOT IN (SELECT id FROM ${t} WHERE workspace_id = 'base')`;
  const [pay, wo] = await Promise.all([
    ctx.db.prepare(`SELECT coalesce(sum(amount_cents), 0) AS c FROM payments WHERE ${newRows("payments")} AND nsf = 0 AND substr(received_on, 1, 7) = ?${s.sql}`).bind(ctx.ws, month, ...s.binds).first<{ c: number }>(),
    ctx.db.prepare(`SELECT count(*) AS n, sum(substr(opened_at, 1, 7) = ?) AS opened FROM work_orders WHERE ${newRows("work_orders")} AND status NOT IN ('Completed', 'Paid', 'Cancelled')${s.sql}`).bind(month, ctx.ws, ...s.binds).first<{ n: number; opened: number | null }>(),
  ]);
  return { collected_cents: Number(pay?.c ?? 0), wo_open: Number(wo?.n ?? 0), wo_opened: Number(wo?.opened ?? 0) };
}

export async function monthSeries(ctx: MetricCtx, params: MetricParams): Promise<MonthSums[]> {
  const to = params.month ?? ctx.asOf;
  const from = addMonths(to, -Math.max(1, Math.min(24, params.months ?? 12)) + 1);
  const s = scopeSql(ctx, params);
  const res = await ctx.db.prepare(`SELECT month, ${SUMS.map((c) => `coalesce(sum(${c}), 0) AS ${c}`).join(", ")}, coalesce(sum(occupancy_econ * gpr_cents), 0) AS econ_weighted FROM metrics_monthly WHERE workspace_id = 'base' AND month BETWEEN ? AND ?${s.sql} GROUP BY month ORDER BY month`).bind(from, to, ...s.binds).all<MonthSums>();
  const rows = res.results.map((r) => ({ ...r, month: String(r.month) }));
  const last = rows[rows.length - 1];
  if (last && last.month === ctx.asOf) {
    const d = await liveDelta(ctx, params, last.month);
    for (const [k, v] of Object.entries(d)) (last as Record<string, number | string>)[k] = Number(last[k as keyof MonthSums]) + Number(v);
  }
  return rows;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

// A metric whose value is one number per month: KPI value = latest month, previous = the month
// before, spark and points = the trailing window. Flows (NOI, income) end at the last closed
// month, since the current one is only days old (collections and month-end delinquency too:
// early in a month, rent just billed would read as delinquent); stocks (occupancy, open work
// orders) end at the current month and include the visitor's live changes.
export function monthly(key: MetricKey, label: string, value: (m: MonthSums) => number | null, series?: Record<string, (m: MonthSums) => number | null>, kind: "stock" | "flow" = "stock") {
  return registerMetric({
    key,
    label,
    run: async (ctx, params): Promise<MetricResult> => {
      const rows = await monthSeries(ctx, kind === "flow" && !params.month ? { ...params, month: addMonths(ctx.asOf, -1) } : params);
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

const dollars = (c: number) => c / 100;
const aging = (m: MonthSums) => m.aging_0_30_cents + m.aging_31_60_cents + m.aging_61_90_cents + m.aging_90p_cents;

monthly("portfolio.occupancy", "Physical occupancy", (m) => ratio(m.occupied, m.units), {
  physical: (m) => ratio(m.occupied, m.units),
  economic: (m) => ratio(m.econ_weighted, m.gpr_cents),
});
monthly("portfolio.economic_occupancy", "Economic occupancy", (m) => ratio(m.econ_weighted, m.gpr_cents));
monthly("portfolio.noi", "Net operating income", (m) => dollars(m.noi_cents), {
  noi: (m) => dollars(m.noi_cents),
  budget: (m) => (m.budget_noi_cents ? dollars(m.budget_noi_cents) : null),
}, "flow");
monthly("portfolio.income_expense", "Income vs expenses", (m) => dollars(m.collected_cents - m.opex_cents), {
  income: (m) => dollars(m.collected_cents),
  expenses: (m) => dollars(m.opex_cents),
}, "flow");
monthly("portfolio.units", "Units", (m) => m.units);
monthly("receivables.collections_rate", "Collections rate", (m) => ratio(m.collected_cents, m.charged_cents), {
  charged: (m) => dollars(m.charged_cents),
  collected: (m) => dollars(m.collected_cents),
}, "flow");
monthly("receivables.delinquency", "Delinquent balance", (m) => dollars(aging(m)), {
  d0_30: (m) => dollars(m.aging_0_30_cents),
  d31_60: (m) => dollars(m.aging_31_60_cents),
  d61_90: (m) => dollars(m.aging_61_90_cents),
  d90p: (m) => dollars(m.aging_90p_cents),
}, "flow");
monthly("leasing.vacancy_loss", "Vacancy loss", (m) => dollars(m.vacancy_loss_cents), undefined, "flow");
monthly("leasing.move_ins", "Move-ins", (m) => m.move_ins, { move_ins: (m) => m.move_ins, move_outs: (m) => m.move_outs }, "flow");
monthly("maintenance.wo_open", "Open work orders", (m) => m.wo_open, { opened: (m) => m.wo_opened, open: (m) => m.wo_open, breached: (m) => m.wo_sla_breach });
// SLA met rate: work orders completed by their SLA due time ÷ work orders due in the month (the
// current month counts only what is due by the demo's today). Open jobs past due count as missed,
// so the rate is always between 0 and 1. Live from work_orders, scoped like every list.
registerMetric({
  key: "maintenance.sla",
  label: "SLA met",
  run: async (ctx, params) => {
    const to = params.month ?? ctx.asOf;
    const from = addMonths(to, -Math.max(1, Math.min(24, params.months ?? 12)) + 1);
    const s = scopeSql(ctx, params, "w.property_id");
    const asOf = "coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))";
    const res = await ctx.db.prepare(
      `SELECT substr(w.sla_due_at, 1, 7) AS month, count(*) AS due, coalesce(sum(w.completed_at IS NOT NULL AND w.completed_at <= w.sla_due_at), 0) AS met
       FROM ${effective("work_orders", ctx.ws)} AS w
       WHERE w.sla_due_at IS NOT NULL AND w.status <> 'Cancelled' AND substr(w.sla_due_at, 1, 10) <= ${asOf} AND substr(w.sla_due_at, 1, 7) BETWEEN ? AND ?${s.sql}
       GROUP BY 1`,
    ).bind(from, to, ...s.binds).all<{ month: string; due: number; met: number }>();
    const by = new Map(res.results.map((r) => [String(r.month), r]));
    const points: Row[] = [];
    for (let m = from; m <= to; m = addMonths(m, 1)) {
      const r = by.get(m);
      const due = Number(r?.due ?? 0), met = Number(r?.met ?? 0);
      points.push({ month: m, value: due ? met / due : null, due, met, missed: due - met });
    }
    const vals = points.map((p) => p.value as number | null);
    return { value: vals.at(-1) ?? null, previous: vals.at(-2) ?? null, spark: vals.map((v) => v ?? 0), points, asOf: to, source: "work_orders (live)" };
  },
});
monthly("intelligence.ai_minutes_saved", "Staff hours saved by AI", (m) => Math.round(m.ai_minutes_saved / 60), { hours: (m) => Math.round(m.ai_minutes_saved / 60), actions: (m) => m.ai_actions }, "flow");

byProperty("portfolio.by_property", "Property comparison", {
  units: (m) => m.units,
  occupancy: (m) => ratio(m.occupied, m.units),
  economic_occupancy: (m) => ratio(m.econ_weighted, m.gpr_cents),
  noi: (m) => dollars(m.noi_cents),
  budget_noi: (m) => (m.budget_noi_cents ? dollars(m.budget_noi_cents) : null),
  collections_rate: (m) => ratio(m.collected_cents, m.charged_cents),
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
