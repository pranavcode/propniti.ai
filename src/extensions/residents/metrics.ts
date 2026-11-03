import { AS_OF } from "@/entities/common";
import type { MetricKey, Row } from "@/entities/types";
import { effective } from "@/server/query";
import { registerMetric, type MetricCtx, type MetricParams, type MetricResult } from "../metrics";

// Residents, leases and messaging metrics. Live over effective rows (base plus the visitor's
// overlay), always inside the persona's property scope.

function scope(ctx: MetricCtx, params: MetricParams, col: string) {
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

async function rows(ctx: MetricCtx, sql: string, binds: unknown[]) {
  return (await ctx.db.prepare(sql).bind(...binds).all<Row>()).results;
}

const count = (key: MetricKey, label: string, table: string, where: string, col = `${table}.property_id`) =>
  registerMetric({
    key,
    label,
    run: async (ctx, params): Promise<MetricResult> => {
      const s = scope(ctx, params, col);
      const r = await ctx.db.prepare(`SELECT count(*) AS n FROM ${effective(table, ctx.ws)} AS ${table} WHERE ${where}${s.sql}`).bind(...s.binds).first<{ n: number }>();
      return { value: Number(r?.n ?? 0), points: [], source: "live" };
    },
  });

const groupBy = (key: MetricKey, label: string, table: string, groupExpr: string, where: string, order: string[]) =>
  registerMetric({
    key,
    label,
    run: async (ctx, params) => {
      const s = scope(ctx, params, `${table}.property_id`);
      const res = await rows(ctx, `SELECT ${groupExpr} AS status, count(*) AS count FROM ${effective(table, ctx.ws)} AS ${table} WHERE ${where}${s.sql} GROUP BY 1`, s.binds);
      const points = order.map((status) => ({ status, count: Number(res.find((r) => r.status === status)?.count ?? 0) })).filter((p) => p.count > 0);
      return { value: points.reduce((a, p) => a + p.count, 0), points, source: "live" };
    },
  });

const ACTIVE_LEASE = "leases.status IN ('Active', 'Notice')";

count("residents.high_risk", "High delinquency risk", "residents", "residents.status IN ('Current', 'Notice') AND residents.risk_score >= 70");
count("residents.expiring_60", "Leases ending in 60 days", "leases", `${ACTIVE_LEASE} AND leases.end_on BETWEEN ${AS_OF} AND date(${AS_OF}, '+60 days')`);
count("residents.mtm", "Month-to-month leases", "leases", "leases.status = 'Month-to-month'");
count("residents.insurance_gaps", "Insurance lapsed or expiring", "renters_insurance", "renters_insurance.status IN ('Lapsed', 'Expiring')");
count("communications.open_threads", "Open conversations", "message_threads", "message_threads.status = 'Open'");

groupBy("residents.status_mix", "Residents by status", "residents", "residents.status", "1", ["Current", "Notice", "Future", "Eviction", "Past"]);
groupBy("residents.lease_status", "Leases by status", "leases", "leases.status", "leases.status NOT IN ('Expired', 'Terminated')", ["Active", "Notice", "Month-to-month", "Future", "Eviction"]);
groupBy("residents.insurance_status", "Renters insurance", "renters_insurance", "renters_insurance.status", "1", ["Active", "Expiring", "Lapsed", "Waived"]);

const BANDS = [
  { band: "0–29", min: 0, max: 29 },
  { band: "30–49", min: 30, max: 49 },
  { band: "50–69", min: 50, max: 69 },
  { band: "70–84", min: 70, max: 84 },
  { band: "85–100", min: 85, max: 100 },
];
registerMetric({
  key: "residents.risk_bands",
  label: "Delinquency risk bands",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "r.property_id");
    const res = await rows(ctx, `SELECT ${BANDS.map((b, i) => `sum(r.risk_score BETWEEN ${b.min} AND ${b.max}) AS b${i}`).join(", ")} FROM ${effective("residents", ctx.ws)} r WHERE r.status = 'Current' AND r.risk_score IS NOT NULL${s.sql}`, s.binds);
    const points = BANDS.map((b, i) => ({ ...b, count: Number(res[0]?.[`b${i}`] ?? 0) }));
    return { value: points.slice(3).reduce((a, p) => a + p.count, 0), points, source: "live" };
  },
});

// Leases ending per month over the next 12 months; each point carries its date range for the drill.
registerMetric({
  key: "residents.expirations",
  label: "Lease expirations",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "leases.property_id");
    const res = await rows(ctx, `SELECT substr(leases.end_on, 1, 7) AS month, count(*) AS count, sum(leases.status = 'Notice') AS notice FROM ${effective("leases", ctx.ws)} AS leases WHERE ${ACTIVE_LEASE} AND leases.end_on >= ${AS_OF} AND leases.end_on < date(${AS_OF}, 'start of month', '+12 months')${s.sql} GROUP BY 1`, s.binds);
    const [y, m] = ctx.asOf.split("-").map(Number);
    const points = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      const month = d.toISOString().slice(0, 7);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const hit = res.find((r) => r.month === month);
      return { month, from: `${month}-01`, to: last, count: Number(hit?.count ?? 0), notice: Number(hit?.notice ?? 0) };
    });
    return { value: points.slice(0, 2).reduce((a, p) => a + p.count, 0), points, source: "live" };
  },
});

registerMetric({
  key: "communications.by_channel",
  label: "Messages by channel",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "t.property_id");
    const res = await rows(ctx, `SELECT m.channel AS channel, count(*) AS count FROM ${effective("messages", ctx.ws)} m JOIN ${effective("message_threads", ctx.ws)} t ON t.id = m.thread_id WHERE m.sent_at >= date(${AS_OF}, '-30 days')${s.sql} GROUP BY 1 ORDER BY 2 DESC`, s.binds);
    return { value: res.reduce((a, r) => a + Number(r.count), 0), points: res.map((r) => ({ channel: String(r.channel), count: Number(r.count) })), source: "live" };
  },
});

// Open work orders by priority (the PM's Today page).
registerMetric({
  key: "residents.wo_by_priority",
  label: "Open work orders by priority",
  run: async (ctx, params) => {
    const s = scope(ctx, params, "w.property_id");
    const res = await rows(ctx, `SELECT w.priority AS priority, count(*) AS count, sum(w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < ${AS_OF}) AS past_sla FROM ${effective("work_orders", ctx.ws)} w WHERE w.status NOT IN ('Completed', 'Paid', 'Cancelled')${s.sql} GROUP BY 1`, s.binds);
    const points = ["Emergency", "Urgent", "Normal", "Low"].map((priority) => {
      const r = res.find((x) => x.priority === priority);
      const total = Number(r?.count ?? 0), late = Number(r?.past_sla ?? 0);
      return { priority, within: total - late, past_sla: late, count: total };
    });
    return { value: points.reduce((a, p) => a + p.count, 0), points, source: "live" };
  },
});
