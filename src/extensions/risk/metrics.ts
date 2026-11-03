import { AS_OF } from "@/entities/common";
import { COI_STATUS_SQL, COMPLIANCE_STATUS_SQL } from "./sql";
import type { Role, Row } from "@/entities/types";
import { effective } from "@/server/query";
import { registerMetric, type MetricCtx } from "../metrics";

// Risk and compliance metrics for the /app/compliance dashboard. Vendor certificates are org-level
// (every manager dispatches vendors), so they are not narrowed by property; everything else is.

const READERS: Role[] = ["platform_admin", "principal", "regional_manager", "property_manager", "broker", "accountant", "maintenance_supervisor", "admin"];
const SOURCE = "Live records";

function scoped(ctx: MetricCtx, col: string, property?: string) {
  const sql: string[] = [];
  const binds: unknown[] = [];
  if (ctx.propertyIds !== "all") {
    sql.push(`${col} IN (SELECT value FROM json_each(?))`);
    binds.push(JSON.stringify(ctx.propertyIds));
  }
  if (property) {
    sql.push(`${col} = ?`);
    binds.push(property);
  }
  return { sql: sql.map((s) => ` AND ${s}`).join(""), binds };
}

// The latest certificate per vendor; older rows are history.
const CURRENT_COI = "vendor_cois.expires_on = (SELECT max(c.expires_on) FROM vendor_cois_e c WHERE c.vendor_id = vendor_cois.vendor_id)";
const cois = (ctx: MetricCtx) => `${effective("vendor_cois", ctx.ws)} AS vendor_cois`;
const withCoi = (ctx: MetricCtx) => `WITH vendor_cois_e AS ${effective("vendor_cois", ctx.ws)} `;
const OPEN_ITEM = "(compliance_items.completed_on IS NULL AND compliance_items.status <> 'Done')";

async function one(ctx: MetricCtx, sql: string, binds: unknown[]) {
  const r = await ctx.db.prepare(sql).bind(...binds).first<{ n: number | null }>();
  return Number(r?.n ?? 0);
}

registerMetric({
  key: "risk.expiring_30",
  label: "Expiring in 30 days",
  roles: READERS,
  run: async (ctx, params) => {
    const p = scoped(ctx, "insurance_policies.property_id", params.property);
    const c = scoped(ctx, "compliance_items.property_id", params.property);
    const window = (col: string) => `${col} >= ${AS_OF} AND ${col} <= date(${AS_OF}, '+30 days')`;
    const [coi, policy, item] = await Promise.all([
      one(ctx, `${withCoi(ctx)}SELECT count(*) AS n FROM ${cois(ctx)} WHERE ${CURRENT_COI} AND vendor_cois.status <> 'Missing' AND ${window("vendor_cois.expires_on")}`, []),
      one(ctx, `SELECT count(*) AS n FROM ${effective("insurance_policies", ctx.ws)} AS insurance_policies WHERE ${window("insurance_policies.expires_on")}${p.sql}`, p.binds),
      one(ctx, `SELECT count(*) AS n FROM ${effective("compliance_items", ctx.ws)} AS compliance_items WHERE ${OPEN_ITEM} AND ${window("compliance_items.due_on")}${c.sql}`, c.binds),
    ]);
    return { value: coi + policy + item, points: [{ kind: "Vendor COIs", count: coi }, { kind: "Insurance policies", count: policy }, { kind: "Compliance items", count: item }], source: SOURCE };
  },
});

registerMetric({
  key: "risk.overdue_items",
  label: "Overdue compliance items",
  roles: READERS,
  run: async (ctx, params) => {
    const c = scoped(ctx, "compliance_items.property_id", params.property);
    const n = await one(ctx, `SELECT count(*) AS n FROM ${effective("compliance_items", ctx.ws)} AS compliance_items WHERE ${OPEN_ITEM} AND compliance_items.due_on < ${AS_OF}${c.sql}`, c.binds);
    return { value: n, points: [], source: SOURCE };
  },
});

// Vendors whose current certificate is expired or missing while they still hold open work orders
// in scope: the uninsured-work exposure the Compliance agent escalates to a person.
registerMetric({
  key: "risk.exposed_vendors",
  label: "Vendors working without valid insurance",
  roles: READERS,
  run: async (ctx, params) => {
    const w = scoped(ctx, "w.property_id", params.property);
    const n = await one(ctx, `${withCoi(ctx)}SELECT count(DISTINCT vendor_cois.vendor_id) AS n FROM ${cois(ctx)} WHERE ${CURRENT_COI} AND ${COI_STATUS_SQL} IN ('Expired', 'Missing')
      AND EXISTS (SELECT 1 FROM ${effective("work_orders", ctx.ws)} w WHERE w.vendor_id = vendor_cois.vendor_id AND w.status NOT IN ('Completed', 'Paid', 'Cancelled')${w.sql})`, w.binds);
    return { value: n, points: [], source: SOURCE };
  },
});

registerMetric({
  key: "risk.legal_open",
  label: "Open legal cases",
  roles: READERS,
  run: async (ctx, params) => {
    const s = scoped(ctx, "legal_cases.property_id", params.property);
    const r = await ctx.db.prepare(`SELECT count(*) AS n, coalesce(sum(balance_cents), 0) AS c FROM ${effective("legal_cases", ctx.ws)} AS legal_cases WHERE legal_cases.stage <> 'Closed'${s.sql}`).bind(...s.binds).first<{ n: number; c: number }>();
    return { value: Number(r?.n ?? 0), points: [{ cases: Number(r?.n ?? 0), balance: Number(r?.c ?? 0) / 100 }], source: SOURCE };
  },
});

registerMetric({
  key: "risk.legal_balance",
  label: "Balance in legal cases",
  roles: READERS,
  run: async (ctx, params) => {
    const s = scoped(ctx, "legal_cases.property_id", params.property);
    const c = await one(ctx, `SELECT coalesce(sum(balance_cents), 0) AS n FROM ${effective("legal_cases", ctx.ws)} AS legal_cases WHERE legal_cases.stage <> 'Closed'${s.sql}`, s.binds);
    return { value: c / 100, points: [], source: SOURCE };
  },
});

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

// Upcoming expiries per month, current month plus the next 11, by kind. Points carry the month's
// date range so a click opens the compliance items due that month.
registerMetric({
  key: "risk.expiries_by_month",
  label: "Upcoming expiries by month",
  roles: READERS,
  run: async (ctx, params) => {
    const from = `${ctx.asOf}-01`;
    const to = monthEnd(addMonths(ctx.asOf, 11));
    const p = scoped(ctx, "insurance_policies.property_id", params.property);
    const c = scoped(ctx, "compliance_items.property_id", params.property);
    const [coi, pol, item] = await Promise.all([
      ctx.db.prepare(`${withCoi(ctx)}SELECT substr(vendor_cois.expires_on, 1, 7) AS m, count(*) AS n FROM ${cois(ctx)} WHERE ${CURRENT_COI} AND vendor_cois.expires_on BETWEEN ? AND ? GROUP BY m`).bind(from, to).all<{ m: string; n: number }>(),
      ctx.db.prepare(`SELECT substr(expires_on, 1, 7) AS m, count(*) AS n FROM ${effective("insurance_policies", ctx.ws)} AS insurance_policies WHERE expires_on BETWEEN ? AND ?${p.sql} GROUP BY m`).bind(from, to, ...p.binds).all<{ m: string; n: number }>(),
      ctx.db.prepare(`SELECT substr(due_on, 1, 7) AS m, count(*) AS n FROM ${effective("compliance_items", ctx.ws)} AS compliance_items WHERE ${OPEN_ITEM} AND due_on BETWEEN ? AND ?${c.sql} GROUP BY m`).bind(from, to, ...c.binds).all<{ m: string; n: number }>(),
    ]);
    const at = (rows: { m: string; n: number }[], m: string) => Number(rows.find((r) => r.m === m)?.n ?? 0);
    const points: Row[] = Array.from({ length: 12 }, (_, i) => {
      const m = addMonths(ctx.asOf, i);
      return { month: m, from: `${m}-01`, to: monthEnd(m), coi: at(coi.results, m), policy: at(pol.results, m), item: at(item.results, m) };
    });
    return { value: points.reduce((s, p) => s + Number(p.coi) + Number(p.policy) + Number(p.item), 0), points, source: SOURCE };
  },
});

registerMetric({
  key: "risk.items_by_kind",
  label: "Compliance items by type",
  roles: READERS,
  run: async (ctx, params) => {
    const c = scoped(ctx, "compliance_items.property_id", params.property);
    const res = await ctx.db.prepare(`SELECT compliance_items.kind AS kind, ${COMPLIANCE_STATUS_SQL} AS st, count(*) AS n FROM ${effective("compliance_items", ctx.ws)} AS compliance_items WHERE 1 = 1${c.sql} GROUP BY 1, 2`).bind(...c.binds).all<{ kind: string; st: string; n: number }>();
    const by = new Map<string, Row>();
    for (const r of res.results) {
      const p = by.get(r.kind) ?? { kind: r.kind, overdue: 0, due_soon: 0, open: 0, done: 0 };
      const k = r.st === "Overdue" ? "overdue" : r.st === "Due soon" ? "due_soon" : r.st === "Done" ? "done" : "open";
      p[k] = Number(p[k]) + Number(r.n);
      by.set(r.kind, p);
    }
    const points = [...by.values()].sort((a, b) => Number(b.overdue) + Number(b.due_soon) - (Number(a.overdue) + Number(a.due_soon)) || String(a.kind).localeCompare(String(b.kind)));
    return { value: points.reduce((s, p) => s + Number(p.overdue), 0), points, source: SOURCE };
  },
});

registerMetric({
  key: "risk.coi_status",
  label: "Vendor certificates by status",
  roles: READERS,
  run: async (ctx) => {
    const res = await ctx.db.prepare(`${withCoi(ctx)}SELECT ${COI_STATUS_SQL} AS st, count(*) AS n FROM ${cois(ctx)} WHERE ${CURRENT_COI} GROUP BY 1`).all<{ st: string; n: number }>();
    const order = ["Valid", "Expiring", "Expired", "Missing"];
    const points = order.map((status) => ({ status, count: Number(res.results.find((r) => r.st === status)?.n ?? 0) })).filter((p) => p.count > 0);
    return { value: points.find((p) => p.status === "Valid")?.count ?? 0, points, source: SOURCE };
  },
});

registerMetric({
  key: "risk.legal_by_stage",
  label: "Legal cases by stage",
  roles: READERS,
  run: async (ctx, params) => {
    const s = scoped(ctx, "legal_cases.property_id", params.property);
    const res = await ctx.db.prepare(`SELECT legal_cases.stage AS stage, count(*) AS n, coalesce(sum(balance_cents), 0) AS c FROM ${effective("legal_cases", ctx.ws)} AS legal_cases WHERE 1 = 1${s.sql} GROUP BY 1`).bind(...s.binds).all<{ stage: string; n: number; c: number }>();
    const order = ["Notice served", "Filed", "Hearing set", "Judgment", "Writ", "Closed"];
    const points = order.map((stage) => {
      const r = res.results.find((x) => x.stage === stage);
      return { stage, cases: Number(r?.n ?? 0), balance: Number(r?.c ?? 0) / 100 };
    }).filter((p) => p.cases > 0);
    return { value: points.filter((p) => p.stage !== "Closed").reduce((a, p) => a + p.cases, 0), points, source: SOURCE };
  },
});
