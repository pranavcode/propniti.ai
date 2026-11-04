import type { Row } from "@/entities/types";
import { effective } from "@/server/query";
import { registerMetric, type MetricCtx } from "../metrics";

// Payables KPIs and charts. Bills and transfers are read through effective(), so a visitor's
// approvals and payments show up at once.

export function scoped(ctx: MetricCtx, col: string) {
  return ctx.propertyIds === "all" ? { sql: "", binds: [] as unknown[] } : { sql: ` AND ${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(ctx.propertyIds)] };
}

export const asOfDate = async (ctx: MetricCtx) => (await ctx.db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? `${ctx.asOf}-04`;

export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

const OPEN = "b.status IN ('Draft', 'Pending approval', 'Approved')";

export const AGING_BUCKETS = [
  { bucket: "Current", label: "Not yet due", min: -100000, max: 0 },
  { bucket: "1-30", label: "1–30 days", min: 1, max: 30 },
  { bucket: "31-60", label: "31–60 days", min: 31, max: 60 },
  { bucket: "61+", label: "61+ days", min: 61, max: 100000 },
];

export async function apAging(ctx: MetricCtx) {
  const today = await asOfDate(ctx);
  const s = scoped(ctx, "b.property_id");
  const r = await ctx.db
    .prepare(`SELECT CAST(julianday(?) - julianday(b.due_on) AS INTEGER) AS late, sum(b.amount_cents) AS cents, count(*) AS n FROM ${effective("bills", ctx.ws)} b WHERE ${OPEN}${s.sql} GROUP BY late`)
    .bind(today, ...s.binds)
    .all<{ late: number; cents: number; n: number }>();
  return AGING_BUCKETS.map((b) => {
    const xs = r.results.filter((x) => x.late >= b.min && x.late <= b.max);
    return { bucket: b.bucket, label: b.label, amount: xs.reduce((a, x) => a + x.cents, 0) / 100, count: xs.reduce((a, x) => a + x.n, 0) };
  });
}

registerMetric({
  key: "payables.aging",
  label: "Payables aging",
  run: async (ctx) => {
    const points = await apAging(ctx);
    return { value: points.reduce((a, p) => a + p.amount, 0), points, source: "bills (live)" };
  },
});

registerMetric({
  key: "payables.open_ap",
  label: "Open payables",
  run: async (ctx) => {
    const points = await apAging(ctx);
    return { value: points.reduce((a, p) => a + p.amount, 0), points, source: "bills (live)" };
  },
});

registerMetric({
  key: "payables.past_due",
  label: "Past-due payables",
  run: async (ctx) => {
    const points = await apAging(ctx);
    return { value: points.filter((p) => p.bucket !== "Current").reduce((a, p) => a + p.amount, 0), points, source: "bills (live)" };
  },
});

registerMetric({
  key: "payables.to_approve",
  label: "Bills waiting for approval",
  run: async (ctx) => {
    const s = scoped(ctx, "b.property_id");
    const r = await ctx.db.prepare(`SELECT count(*) AS n, coalesce(sum(b.amount_cents), 0) AS c FROM ${effective("bills", ctx.ws)} b WHERE b.status = 'Pending approval'${s.sql}`).bind(...s.binds).first<{ n: number; c: number }>();
    return { value: r?.n ?? 0, points: [{ label: "Pending approval", count: r?.n ?? 0, amount: (r?.c ?? 0) / 100 }], source: "bills (live)" };
  },
});

// Vendor payouts by the month they left trust.
registerMetric({
  key: "payables.paid_month",
  label: "Paid to vendors",
  run: async (ctx) => {
    const s = scoped(ctx, "t.property_id");
    const from = addMonths(ctx.asOf, -11);
    const r = await ctx.db
      .prepare(`SELECT substr(t.created, 1, 7) AS month, sum(t.amount_cents) AS cents FROM ${effective("transfers", ctx.ws)} t WHERE t.kind = 'Vendor payout' AND t.status <> 'Returned' AND substr(t.created, 1, 7) >= ?${s.sql} GROUP BY month ORDER BY month`)
      .bind(from, ...s.binds)
      .all<{ month: string; cents: number }>();
    const months = Array.from({ length: 12 }, (_, i) => addMonths(from, i));
    const points: Row[] = months.map((m) => ({ month: m, value: (r.results.find((x) => x.month === m)?.cents ?? 0) / 100 }));
    return { value: Number(points.at(-1)?.value ?? 0), previous: Number(points.at(-2)?.value ?? 0), spark: points.map((p) => Number(p.value)), points, asOf: ctx.asOf, source: "transfers (live)" };
  },
});

registerMetric({
  key: "payables.spend_by_gl",
  label: "Spend by GL account",
  run: async (ctx) => {
    const s = scoped(ctx, "b.property_id");
    const r = await ctx.db
      .prepare(`SELECT g.id AS gl, g.number || ' ' || g.name AS label, sum(l.amount_cents) AS cents FROM ${effective("bill_lines", ctx.ws)} l JOIN ${effective("bills", ctx.ws)} b ON b.id = l.bill_id JOIN ${effective("gl_accounts", ctx.ws)} g ON g.id = l.gl_account_id
        WHERE b.status <> 'Void' AND substr(b.bill_date, 1, 7) >= ?${s.sql} GROUP BY g.id ORDER BY cents DESC LIMIT 8`)
      .bind(addMonths(ctx.asOf, -3), ...s.binds)
      .all<{ gl: string; label: string; cents: number }>();
    return { points: r.results.map((x) => ({ gl: x.gl, label: x.label, amount: x.cents / 100 })), source: "bill lines (live)" };
  },
});
