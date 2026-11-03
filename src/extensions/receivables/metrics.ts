import { registerMetric, type MetricCtx } from "@/extensions/metrics";
import { AS_OF } from "@/seed/constants";
import { effective, type QueryCtx } from "@/server/query";
import { agingByProperty, BUCKETS } from "./queries";

// Live receivables metrics. Aging is computed from charges, payments and credits as of the demo
// date (the same figures the charges list shows), not from the month-end snapshot in metrics_monthly.

const q = (ctx: MetricCtx): QueryCtx => ({ db: ctx.db, ws: ctx.ws, actor: { ...ctx.actor, propertyIds: ctx.propertyIds } });
const dollars = (c: number) => c / 100;
const scope = (ctx: MetricCtx, col: string, property?: string) => {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (ctx.propertyIds !== "all") {
    sql.push(`${col} IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(ctx.propertyIds));
  }
  if (property) {
    sql.push(`${col} = ?`);
    params.push(property);
  }
  return { sql: sql.length ? sql.join(" AND ") : "1 = 1", params };
};
const monthsBack = (n: number) => {
  const d = new Date(`${AS_OF.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n + 1);
  return d.toISOString().slice(0, 7);
};

registerMetric({
  key: "receivables.aging_live",
  label: "Delinquency aging (live)",
  async run(ctx, params) {
    const rows = (await agingByProperty(q(ctx))).filter((r) => !params.property || r.property_id === params.property);
    const sum = (k: "b0_30" | "b31_60" | "b61_90" | "b90p") => rows.reduce((s, r) => s + r[k], 0);
    const keys = ["b0_30", "b31_60", "b61_90", "b90p"] as const;
    const points = BUCKETS.map((b, i) => ({ bucket: b.key, label: b.label, amount: dollars(sum(keys[i])) }));
    return { value: points.reduce((s, p) => s + p.amount, 0), points, asOf: AS_OF, source: "charges, payments and credits (live)" };
  },
});

registerMetric({
  key: "receivables.aging_by_property",
  label: "Delinquency by property",
  async run(ctx) {
    const rows = await agingByProperty(q(ctx));
    const points = rows.slice(0, 15).map((r) => ({ property_id: r.property_id, name: r.name, d0_30: dollars(r.b0_30), d31_60: dollars(r.b31_60), d61_90: dollars(r.b61_90), d90p: dollars(r.b90p), total: dollars(r.total) }));
    return { value: rows.reduce((s, r) => s + dollars(r.total), 0), points, asOf: AS_OF, source: "charges, payments and credits (live)" };
  },
});

registerMetric({
  key: "receivables.nsf",
  label: "Returned payments",
  async run(ctx, params) {
    const from = monthsBack(params.months ?? 12);
    const s = scope(ctx, "p.property_id", params.property);
    const res = await ctx.db
      .prepare(`SELECT substr(p.received_on, 1, 7) AS month, count(*) AS n, sum(p.amount_cents) AS cents FROM ${effective("payments", ctx.ws)} AS p WHERE p.nsf = 1 AND p.received_on >= ? AND ${s.sql} GROUP BY month ORDER BY month`)
      .bind(`${from}-01`, ...s.params)
      .all<{ month: string; n: number; cents: number }>();
    const by = new Map(res.results.map((r) => [r.month, r]));
    const points = Array.from({ length: params.months ?? 12 }, (_, i) => monthsBack((params.months ?? 12) - i)).map((m) => ({ month: m, count: by.get(m)?.n ?? 0, amount: dollars(by.get(m)?.cents ?? 0) }));
    // The current month is days old; compare the last closed month with the one before.
    const closed = points.slice(0, -1);
    return { value: closed.at(-1)?.count ?? 0, previous: closed.at(-2)?.count ?? null, spark: points.map((p) => p.count), points, asOf: closed.at(-1)?.month, source: "payments" };
  },
});

registerMetric({
  key: "receivables.payment_mix",
  label: "Payments by method",
  async run(ctx, params) {
    const month = params.month ?? monthsBack(2);
    const s = scope(ctx, "p.property_id", params.property);
    const res = await ctx.db
      .prepare(`SELECT p.method, count(*) AS n, sum(p.amount_cents) AS cents FROM ${effective("payments", ctx.ws)} AS p WHERE p.nsf = 0 AND substr(p.received_on, 1, 7) = ? AND ${s.sql} GROUP BY p.method ORDER BY cents DESC`)
      .bind(month, ...s.params)
      .all<{ method: string; n: number; cents: number }>();
    return { value: res.results.reduce((a, r) => a + dollars(r.cents), 0), points: res.results.map((r) => ({ method: r.method, amount: dollars(r.cents), count: r.n })), asOf: month, source: "payments" };
  },
});

registerMetric({
  key: "receivables.dispositions_due",
  label: "Deposit dispositions due",
  async run(ctx, params) {
    const s = scope(ctx, "d.property_id", params.property);
    const r = await ctx.db
      .prepare(`SELECT count(*) AS n, coalesce(sum(d.amount_cents), 0) AS cents FROM ${effective("deposits", ctx.ws)} AS d WHERE d.status = 'Disposition due' AND ${s.sql}`)
      .bind(...s.params)
      .first<{ n: number; cents: number }>();
    return { value: r?.n ?? 0, points: [{ label: "Due", count: r?.n ?? 0, amount: dollars(r?.cents ?? 0) }], asOf: AS_OF, source: "deposits" };
  },
});
