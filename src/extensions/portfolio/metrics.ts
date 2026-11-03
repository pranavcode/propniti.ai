import { effective } from "@/server/query";
import { byProperty } from "../core-metrics";
import { registerMetric } from "../metrics";

// Portfolio-module metrics on top of the shared monthly ones in core-metrics.ts.

const dollars = (c: number) => c / 100;
const ratio = (a: number, b: number) => (b ? a / b : null);

// Regional comparison inputs: one row per property for the last closed month.
byProperty("portfolio.aging_by_property", "Delinquency aging by property", {
  d0_30: (m) => dollars(m.aging_0_30_cents),
  d31_60: (m) => dollars(m.aging_31_60_cents),
  d61_90: (m) => dollars(m.aging_61_90_cents),
  d90p: (m) => dollars(m.aging_90p_cents),
  total: (m) => dollars(m.aging_0_30_cents + m.aging_31_60_cents + m.aging_61_90_cents + m.aging_90p_cents),
}, "total");

byProperty("portfolio.sla_by_property", "Maintenance SLA by property", {
  wo_open: (m) => m.wo_open,
  breached: (m) => m.wo_sla_breach,
  within: (m) => m.wo_open - m.wo_sla_breach,
  sla: (m) => (m.wo_open ? 1 - m.wo_sla_breach / m.wo_open : null),
}, "breached");

// NOI by region for the last closed month (regions list chart, principal home).
registerMetric({
  key: "portfolio.by_region",
  label: "NOI by region",
  run: async (ctx, params) => {
    const scoped = ctx.propertyIds !== "all";
    const month = params.month ?? (await ctx.db.prepare("SELECT max(month) AS m FROM metrics_monthly WHERE workspace_id = 'base' AND month < substr(?, 1, 7)").bind(ctx.asOf).first<{ m: string }>())?.m;
    const res = await ctx.db.prepare(
      `SELECT r.id AS region_id, r.name, sum(m.noi_cents) AS noi, sum(m.units) AS units, sum(m.occupied) AS occupied
       FROM metrics_monthly m JOIN ${effective("properties", ctx.ws)} p ON p.id = m.property_id JOIN ${effective("regions", ctx.ws)} r ON r.id = p.region_id
       WHERE m.workspace_id = 'base' AND m.month = ?${scoped ? " AND m.property_id IN (SELECT value FROM json_each(?))" : ""}
       GROUP BY r.id, r.name ORDER BY noi DESC`,
    ).bind(month, ...(scoped ? [JSON.stringify(ctx.propertyIds)] : [])).all<{ region_id: string; name: string; noi: number; units: number; occupied: number }>();
    return { points: res.results.map((r) => ({ region_id: r.region_id, name: r.name, noi: dollars(r.noi), occupancy: ratio(r.occupied, r.units) })), asOf: month, source: "metrics_monthly" };
  },
});
