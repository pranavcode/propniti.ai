import { registerMetric, type MetricCtx, type MetricParams } from "../metrics";
import { AGE_BUCKETS, ageBucket } from "./rules";
import { all, effective, OPEN_SQL, scoped } from "./store";

// Live maintenance metrics, computed from the effective work orders, bills, turnovers and
// schedules in the persona's scope (the visitor's own changes included).

const AS_OF = "coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))";
const PRIORITIES = ["Emergency", "Urgent", "Normal", "Low"] as const;
const scope = (ctx: MetricCtx, params: MetricParams, col: string) => {
  const s = scoped(ctx.propertyIds, col);
  return params.property ? { sql: `${s.sql} AND ${col} = ?`, binds: [...s.binds, params.property] } : s;
};
// Vendors paid from operating budgets that aren't maintenance work (taxes, payroll, utilities…).
const NON_MAINTENANCE = "('Insurance', 'Marketing', 'Payroll', 'Property tax', 'Supplies', 'Trash', 'Utilities')";
const BOUNDS = [[0, 2], [3, 7], [8, 14], [15, 30], [31, 9999]] as const;

registerMetric({
  key: "maintenance.by_age_priority",
  label: "Open work orders by age and priority",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "w.property_id");
    const rows = await all<{ priority: string; age: number }>(ctx.db,
      `SELECT w.priority, CAST(julianday(${AS_OF}) - julianday(substr(w.opened_at, 1, 10)) AS INTEGER) AS age FROM ${effective("work_orders", ctx.ws)} AS w WHERE w.status IN ${OPEN_SQL}${s.sql}`, s.binds);
    const points = AGE_BUCKETS.map((bucket, i) => ({ bucket, min: BOUNDS[i][0], max: BOUNDS[i][1], ...Object.fromEntries(PRIORITIES.map((p) => [p, 0])) } as Record<string, string | number>));
    for (const r of rows) (points[ageBucket(Math.max(0, r.age))][r.priority] as number) += 1;
    return { value: rows.length, points, source: "work_orders (live)" };
  },
});

registerMetric({
  key: "maintenance.vendor_spend",
  label: "Maintenance vendor spend, trailing 12 months",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "b.property_id");
    const points = await all(ctx.db,
      `SELECT b.vendor_id, v.company AS vendor, v.trade, round(sum(b.amount_cents) / 100.0, 2) AS spend, count(*) AS bills
       FROM ${effective("bills", ctx.ws)} AS b JOIN ${effective("vendors", ctx.ws)} AS v ON v.id = b.vendor_id
       WHERE b.status <> 'Void' AND b.bill_date >= date(${AS_OF}, '-12 months') AND v.trade NOT IN ${NON_MAINTENANCE}${s.sql}
       GROUP BY b.vendor_id ORDER BY spend DESC LIMIT 10`, s.binds);
    return { value: points.reduce((a, p) => a + Number(p.spend), 0), points, source: "bills (live)" };
  },
});

registerMetric({
  key: "maintenance.tech_workload",
  label: "Technician workload",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "w.property_id");
    const points = await all(ctx.db,
      `SELECT w.assignee_id AS staff_id, coalesce(st.name, w.assignee_id) AS name, count(*) AS open,
              sum(w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < ${AS_OF}) AS past_sla
       FROM ${effective("work_orders", ctx.ws)} AS w LEFT JOIN ${effective("staff", ctx.ws)} AS st ON st.id = w.assignee_id
       WHERE w.status IN ${OPEN_SQL} AND w.assignee_id IS NOT NULL AND w.vendor_id IS NULL${s.sql}
       GROUP BY w.assignee_id ORDER BY open DESC LIMIT 12`, s.binds);
    return { value: points.reduce((a, p) => a + Number(p.open), 0), points, source: "work_orders (live)" };
  },
});

registerMetric({
  key: "maintenance.sla_by_trade",
  label: "Open work orders and SLA breaches by trade",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "w.property_id");
    const points = await all(ctx.db,
      `SELECT w.category, sum(w.sla_due_at IS NULL OR substr(w.sla_due_at, 1, 10) >= ${AS_OF}) AS on_time, sum(w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < ${AS_OF}) AS breached
       FROM ${effective("work_orders", ctx.ws)} AS w WHERE w.status IN ${OPEN_SQL}${s.sql} GROUP BY w.category ORDER BY count(*) DESC LIMIT 10`, s.binds);
    return { points, source: "work_orders (live)" };
  },
});

registerMetric({
  key: "maintenance.make_ready",
  label: "Units not rent-ready",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "t.property_id");
    const points = await all(ctx.db,
      `SELECT t.status, count(*) AS units, sum(t.target_ready_on < ${AS_OF}) AS late, round(sum(t.cost_cents) / 100.0, 2) AS cost
       FROM ${effective("turnovers", ctx.ws)} AS t WHERE t.status IN ('Not started', 'In progress')${s.sql} GROUP BY t.status ORDER BY t.status DESC`, s.binds);
    return { value: points.reduce((a, p) => a + Number(p.units), 0), points, source: "turnovers (live)" };
  },
});

registerMetric({
  key: "maintenance.pm_due",
  label: "Preventive tasks due in 14 days",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "m.property_id");
    const points = await all(ctx.db,
      `SELECT m.category, count(*) AS due, sum(m.next_due_on < ${AS_OF}) AS overdue FROM ${effective("pm_schedules", ctx.ws)} AS m
       WHERE m.active = 1 AND m.next_due_on <= date(${AS_OF}, '+14 days')${s.sql} GROUP BY m.category ORDER BY due DESC`, s.binds);
    return { value: points.reduce((a, p) => a + Number(p.due), 0), points, source: "pm_schedules (live)" };
  },
});
