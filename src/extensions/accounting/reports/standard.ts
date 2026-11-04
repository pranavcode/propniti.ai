import "server-only";
import { AS_OF } from "@/seed/constants";
import { effective } from "@/server/query";
import type { Ctx } from "./run";

// The standard finance reports. All reads go through effective() and the actor's property scope.

const scope = (ctx: Ctx, col: string) => (ctx.actor.propertyIds === "all" ? { sql: "", binds: [] as unknown[] } : { sql: ` AND ${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(ctx.actor.propertyIds)] as unknown[] });
const prop = (property: string | undefined, col: string) => (property ? { sql: ` AND ${col} = ?`, binds: [property] as unknown[] } : { sql: "", binds: [] as unknown[] });

export async function today(ctx: Ctx) {
  return (await ctx.db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? AS_OF;
}

// ---------------------------------------------------------------------------------------------
// P&L: income and expense by GL account for a period range, plus the monthly trend.
// ---------------------------------------------------------------------------------------------

export type PnlLine = { gl_id: string; number: string; name: string; type: "Income" | "Expense"; amount: number };

export async function pnl(ctx: Ctx, from: string, to: string, property?: string) {
  const s = scope(ctx, "j.property_id");
  const p = prop(property, "j.property_id");
  const base = `FROM ${effective("journal_entries", ctx.ws)} j JOIN ${effective("gl_accounts", ctx.ws)} g ON g.id = j.gl_account_id
    WHERE g.type IN ('Income', 'Expense') AND j.period BETWEEN ? AND ?${s.sql}${p.sql}`;
  const sign = "CASE WHEN g.type = 'Income' THEN j.credit_cents - j.debit_cents ELSE j.debit_cents - j.credit_cents END";
  const [lines, months] = await Promise.all([
    ctx.db.prepare(`SELECT g.id AS gl_id, g.number, g.name, g.type, sum(${sign}) AS cents ${base} GROUP BY g.id ORDER BY g.number`).bind(from, to, ...s.binds, ...p.binds).all<{ gl_id: string; number: string; name: string; type: "Income" | "Expense"; cents: number }>(),
    ctx.db.prepare(`SELECT j.period AS month, sum(CASE WHEN g.type = 'Income' THEN j.credit_cents - j.debit_cents ELSE 0 END) AS income, sum(CASE WHEN g.type = 'Expense' THEN j.debit_cents - j.credit_cents ELSE 0 END) AS expense ${base} GROUP BY j.period ORDER BY j.period`).bind(from, to, ...s.binds, ...p.binds).all<{ month: string; income: number; expense: number }>(),
  ]);
  const rows: PnlLine[] = lines.results.filter((l) => l.cents !== 0).map((l) => ({ gl_id: l.gl_id, number: l.number, name: l.name, type: l.type, amount: l.cents / 100 }));
  const income = rows.filter((r) => r.type === "Income").reduce((a, r) => a + r.amount, 0);
  const expense = rows.filter((r) => r.type === "Expense").reduce((a, r) => a + r.amount, 0);
  return { rows, income, expense, noi: income - expense, months: months.results.map((m) => ({ month: m.month, income: m.income / 100, expense: m.expense / 100, noi: (m.income - m.expense) / 100 })) };
}

// ---------------------------------------------------------------------------------------------
// Rent roll: every unit with its current lease, server-paginated.
// ---------------------------------------------------------------------------------------------

export type RentRollRow = { unit_id: string; unit: string; property_id: string; property: string; status: string; sqft: number; market_rent: number; lease_id: string | null; household: string | null; lease_status: string | null; start_on: string | null; end_on: string | null; rent: number | null; deposit: number | null; balance: number | null };

const CURRENT = "('Active', 'Notice', 'Month-to-month', 'Eviction')";

export async function rentRoll(ctx: Ctx, page: number, size: number, property?: string) {
  const ws = ctx.ws;
  const s = scope(ctx, "u.property_id");
  const p = prop(property, "u.property_id");
  // One current lease per unit: the latest-starting one in a current status.
  const lease = `(SELECT * FROM (SELECT l.*, row_number() OVER (PARTITION BY l.unit_id ORDER BY l.start_on DESC) AS rn FROM ${effective("leases", ws)} l WHERE l.status IN ${CURRENT}) WHERE rn = 1)`;
  const from = `FROM ${effective("units", ws)} u JOIN ${effective("properties", ws)} pr ON pr.id = u.property_id LEFT JOIN ${lease} cl ON cl.unit_id = u.id LEFT JOIN ${effective("households", ws)} h ON h.id = cl.household_id WHERE 1 = 1${s.sql}${p.sql}`;
  const [rows, totals] = await Promise.all([
    ctx.db.prepare(`SELECT u.id AS unit_id, u.number AS unit, u.property_id, pr.name AS property, u.status, u.sqft, u.market_rent_cents, cl.id AS lease_id, h.name AS household, cl.status AS lease_status, cl.start_on, cl.end_on, cl.rent_cents, cl.deposit_cents
      ${from} ORDER BY pr.name, u.number LIMIT ? OFFSET ?`).bind(...s.binds, ...p.binds, size, (page - 1) * size).all<Record<string, string | number | null>>(),
    ctx.db.prepare(`SELECT count(*) AS units, sum(cl.id IS NOT NULL) AS leased, coalesce(sum(u.market_rent_cents), 0) AS market, coalesce(sum(cl.rent_cents), 0) AS rent ${from}`).bind(...s.binds, ...p.binds).first<{ units: number; leased: number; market: number; rent: number }>(),
  ]);
  const leaseIds = rows.results.map((r) => r.lease_id).filter(Boolean) as string[];
  const bal = new Map<string, number>();
  if (leaseIds.length) {
    const t = await today(ctx);
    const ids = JSON.stringify(leaseIds);
    const r = await ctx.db.prepare(`SELECT lease_id, sum(c) AS c FROM (
        SELECT lease_id, amount_cents AS c FROM ${effective("charges", ws)} WHERE lease_id IN (SELECT value FROM json_each(?1)) AND due_on <= ?2
        UNION ALL SELECT lease_id, -amount_cents FROM ${effective("payments", ws)} WHERE lease_id IN (SELECT value FROM json_each(?1)) AND nsf = 0
        UNION ALL SELECT lease_id, -amount_cents FROM ${effective("credits", ws)} WHERE lease_id IN (SELECT value FROM json_each(?1))
      ) GROUP BY lease_id`).bind(ids, t).all<{ lease_id: string; c: number }>();
    for (const x of r.results) bal.set(x.lease_id, x.c / 100);
  }
  const out: RentRollRow[] = rows.results.map((r) => ({
    unit_id: String(r.unit_id), unit: String(r.unit), property_id: String(r.property_id), property: String(r.property), status: String(r.status), sqft: Number(r.sqft ?? 0),
    market_rent: Number(r.market_rent_cents ?? 0) / 100, lease_id: (r.lease_id as string) ?? null, household: (r.household as string) ?? null, lease_status: (r.lease_status as string) ?? null,
    start_on: (r.start_on as string) ?? null, end_on: (r.end_on as string) ?? null, rent: r.rent_cents == null ? null : Number(r.rent_cents) / 100, deposit: r.deposit_cents == null ? null : Number(r.deposit_cents) / 100,
    balance: r.lease_id ? bal.get(String(r.lease_id)) ?? 0 : null,
  }));
  return { rows: out, total: totals?.units ?? 0, leased: totals?.leased ?? 0, market: (totals?.market ?? 0) / 100, rent: (totals?.rent ?? 0) / 100 };
}

// ---------------------------------------------------------------------------------------------
// AR aging by property: each charge's open balance (amount less good payments and credits applied
// to it, as in the charges def), bucketed by days past due.
// ---------------------------------------------------------------------------------------------

export type AgingRow = { property_id: string; property: string; d0_30: number; d31_60: number; d61_90: number; d90p: number; total: number; charges: number };

export async function arAging(ctx: Ctx, property?: string) {
  const ws = ctx.ws;
  const t = await today(ctx);
  const s = scope(ctx, "c.property_id");
  const p = prop(property, "c.property_id");
  const r = await ctx.db.prepare(`WITH pay AS (SELECT charge_id, sum(amount_cents) AS a FROM ${effective("payments", ws)} WHERE nsf = 0 AND charge_id IS NOT NULL GROUP BY charge_id),
      cr AS (SELECT charge_id, sum(amount_cents) AS a FROM ${effective("credits", ws)} WHERE charge_id IS NOT NULL GROUP BY charge_id),
      open AS (SELECT c.property_id, CAST(julianday(?) - julianday(c.due_on) AS INTEGER) AS late, c.amount_cents - coalesce(pay.a, 0) - coalesce(cr.a, 0) AS bal
        FROM ${effective("charges", ws)} c LEFT JOIN pay ON pay.charge_id = c.id LEFT JOIN cr ON cr.charge_id = c.id WHERE c.due_on < ?${s.sql}${p.sql})
    SELECT o.property_id, pr.name AS property, sum(CASE WHEN late <= 30 THEN bal ELSE 0 END) AS d0_30, sum(CASE WHEN late BETWEEN 31 AND 60 THEN bal ELSE 0 END) AS d31_60,
      sum(CASE WHEN late BETWEEN 61 AND 90 THEN bal ELSE 0 END) AS d61_90, sum(CASE WHEN late > 90 THEN bal ELSE 0 END) AS d90p, sum(bal) AS total, count(*) AS charges
    FROM open o JOIN ${effective("properties", ws)} pr ON pr.id = o.property_id WHERE o.bal > 0 GROUP BY o.property_id ORDER BY total DESC`)
    .bind(t, t, ...s.binds, ...p.binds).all<Record<string, string | number>>();
  const rows: AgingRow[] = r.results.map((x) => ({ property_id: String(x.property_id), property: String(x.property), d0_30: Number(x.d0_30) / 100, d31_60: Number(x.d31_60) / 100, d61_90: Number(x.d61_90) / 100, d90p: Number(x.d90p) / 100, total: Number(x.total) / 100, charges: Number(x.charges) }));
  return { rows, asOf: t };
}

// ---------------------------------------------------------------------------------------------
// NOI by property, trailing months, against budget (metrics_monthly).
// ---------------------------------------------------------------------------------------------

export type NoiRow = { property_id: string; property: string; metro: string; noi: number; budget: number | null; variance: number | null; pct: number | null };

export async function noiByProperty(ctx: Ctx, from: string, to: string) {
  const s = scope(ctx, "m.property_id");
  const r = await ctx.db.prepare(`SELECT m.property_id, p.name AS property, p.metro, sum(m.noi_cents) AS noi, sum(m.budget_noi_cents) AS budget, count(m.budget_noi_cents) AS budgeted
      FROM metrics_monthly m JOIN ${effective("properties", ctx.ws)} p ON p.id = m.property_id
      WHERE m.workspace_id = 'base' AND m.month BETWEEN ? AND ?${s.sql} GROUP BY m.property_id ORDER BY noi DESC`)
    .bind(from, to, ...s.binds).all<{ property_id: string; property: string; metro: string; noi: number; budget: number | null; budgeted: number }>();
  const rows: NoiRow[] = r.results.map((x) => {
    const noi = x.noi / 100;
    const budget = x.budgeted ? Number(x.budget) / 100 : null;
    return { property_id: x.property_id, property: x.property, metro: x.metro, noi, budget, variance: budget == null ? null : noi - budget, pct: budget ? (noi - budget) / Math.abs(budget) : null };
  });
  return { rows, noi: rows.reduce((a, r) => a + r.noi, 0), budget: rows.some((r) => r.budget != null) ? rows.reduce((a, r) => a + (r.budget ?? 0), 0) : null };
}
