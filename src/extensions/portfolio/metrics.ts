import { effective } from "@/server/query";
import { byProperty } from "../core-metrics";
import { getMetric, registerMetric } from "../metrics";

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

// SLA per property is maintenance.sla run for each property, so the principal, regional and
// maintenance homes always show the same number.
registerMetric({
  key: "portfolio.sla_by_property",
  label: "Maintenance SLA by property",
  run: async (ctx, params) => {
    const sla = getMetric("maintenance.sla")!;
    const scoped = ctx.propertyIds !== "all";
    const props = await ctx.db.prepare(`SELECT p.id, p.name FROM ${effective("properties", ctx.ws)} p${scoped ? " WHERE p.id IN (SELECT value FROM json_each(?))" : ""} ORDER BY p.name`)
      .bind(...(scoped ? [JSON.stringify(ctx.propertyIds)] : [])).all<{ id: string; name: string }>();
    const points = await Promise.all(props.results.map(async (p) => {
      const m = (await sla.run(ctx, { ...params, property: p.id, months: 1 })).points.at(-1) ?? {};
      return { property_id: p.id, name: p.name, due: Number(m.due ?? 0), met: Number(m.met ?? 0), missed: Number(m.missed ?? 0), sla: (m.value as number | null) ?? null };
    }));
    return { points: points.sort((x, y) => y.missed - x.missed), asOf: params.month ?? ctx.asOf, source: "maintenance.sla per property" };
  },
});

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

// Units by physical status right now (live, overlay included), drillable to the filtered unit list.
registerMetric({
  key: "portfolio.unit_status",
  label: "Units by status",
  run: async (ctx, params) => {
    const binds: unknown[] = [];
    let where = "";
    if (ctx.propertyIds !== "all") { where += " AND u.property_id IN (SELECT value FROM json_each(?))"; binds.push(JSON.stringify(ctx.propertyIds)); }
    if (params.property) { where += " AND u.property_id = ?"; binds.push(params.property); }
    const res = await ctx.db.prepare(`SELECT u.status, count(*) AS units FROM ${effective("units", ctx.ws)} u WHERE 1 = 1${where} GROUP BY u.status ORDER BY units DESC`).bind(...binds).all<{ status: string; units: number }>();
    const total = res.results.reduce((s, r) => s + r.units, 0);
    return { value: total, points: res.results.map((r) => ({ status: r.status, units: r.units })), asOf: ctx.asOf, source: "units (live)" };
  },
});

// NOI and occupancy per metro for the last closed month.
registerMetric({
  key: "portfolio.by_metro",
  label: "NOI by metro",
  run: async (ctx, params) => {
    const month = params.month ?? (await ctx.db.prepare("SELECT max(month) AS m FROM metrics_monthly WHERE workspace_id = 'base' AND month < substr(?, 1, 7)").bind(ctx.asOf).first<{ m: string }>())?.m;
    const scoped = ctx.propertyIds !== "all";
    const res = await ctx.db.prepare(
      `SELECT p.metro, sum(m.noi_cents) AS noi, sum(m.budget_noi_cents) AS budget, sum(m.units) AS units, sum(m.occupied) AS occupied
       FROM metrics_monthly m JOIN ${effective("properties", ctx.ws)} p ON p.id = m.property_id
       WHERE m.workspace_id = 'base' AND m.month = ?${scoped ? " AND m.property_id IN (SELECT value FROM json_each(?))" : ""} GROUP BY p.metro ORDER BY noi DESC`,
    ).bind(month, ...(scoped ? [JSON.stringify(ctx.propertyIds)] : [])).all<{ metro: string; noi: number; budget: number | null; units: number; occupied: number }>();
    return { points: res.results.map((r) => ({ metro: r.metro, noi: dollars(r.noi), budget: r.budget == null ? null : dollars(r.budget), occupancy: ratio(r.occupied, r.units), units: r.units })), asOf: month, source: "metrics_monthly" };
  },
});
