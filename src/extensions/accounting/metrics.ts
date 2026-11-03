import type { Row } from "@/entities/types";
import { effective } from "@/server/query";
import { registerMetric, type MetricCtx } from "../metrics";
import { addMonths, asOfDate, scoped } from "../payables/metrics";

// Accounting KPIs and charts: trust cash, reconciliation, income vs expense, budget vs actual,
// capex, utilities and the 90-day cash forecast.

const months = (to: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(to, i - n + 1));

// Trust accounts belong to owner entities; a scoped actor sees the entities of their properties.
async function trustAccounts(ctx: MetricCtx): Promise<string[]> {
  const s = scoped(ctx, "p.id");
  const r = await ctx.db
    .prepare(`SELECT a.id FROM ${effective("bank_accounts", ctx.ws)} a WHERE a.kind = 'Trust' AND a.owner_entity_id IN (SELECT p.owner_entity_id FROM ${effective("properties", ctx.ws)} p WHERE 1 = 1${s.sql})`)
    .bind(...s.binds)
    .all<{ id: string }>();
  return r.results.map((x) => x.id);
}

export async function trustCash(ctx: MetricCtx): Promise<number> {
  const ids = await trustAccounts(ctx);
  const r = await ctx.db
    .prepare(`SELECT coalesce((SELECT sum(cleared_cents) FROM base_balances WHERE account_id IN (SELECT value FROM json_each(?1))), 0)
      + coalesce((SELECT sum(CASE WHEN t.kind IN ('Rent', 'Deposit', 'Other receipt') THEN CASE WHEN t.status = 'Cleared' THEN t.amount_cents ELSE 0 END ELSE -t.amount_cents END)
        FROM ${effective("transfers", ctx.ws)} t WHERE t.workspace_id <> 'base' AND t.status <> 'Returned' AND t.bank_account_id IN (SELECT value FROM json_each(?1))), 0) AS c`)
    .bind(JSON.stringify(ids))
    .first<{ c: number }>();
  return (r?.c ?? 0) / 100;
}

registerMetric({
  key: "accounting.trust_cash",
  label: "Cash in trust",
  run: async (ctx) => ({ value: await trustCash(ctx), points: [], source: "base balances + live transfers" }),
});

registerMetric({
  key: "accounting.unreconciled",
  label: "Unreconciled items",
  run: async (ctx) => {
    const r = await ctx.db
      .prepare(`SELECT i.status, count(*) AS n FROM ${effective("reconciliation_items", ctx.ws)} i JOIN ${effective("bank_reconciliations", ctx.ws)} r ON r.id = i.reconciliation_id WHERE r.status = 'Open' AND i.status IN ('Suggested', 'Unmatched') GROUP BY i.status`)
      .all<{ status: string; n: number }>();
    const n = (s: string) => r.results.find((x) => x.status === s)?.n ?? 0;
    return { value: n("Suggested") + n("Unmatched"), points: [{ label: "AI suggested", status: "Suggested", count: n("Suggested") }, { label: "Unmatched", status: "Unmatched", count: n("Unmatched") }], source: "reconciliation items (live)" };
  },
});

// Income and expense per month from the journal (closed months), with NOI.
export async function incomeExpense(ctx: MetricCtx, n = 12, property?: string) {
  const s = scoped(ctx, "j.property_id");
  const to = addMonths(ctx.asOf, -1);
  const extra = property ? " AND j.property_id = ?" : "";
  const r = await ctx.db
    .prepare(`SELECT j.period AS month, sum(CASE WHEN g.type = 'Income' THEN j.credit_cents - j.debit_cents ELSE 0 END) AS income, sum(CASE WHEN g.type = 'Expense' THEN j.debit_cents - j.credit_cents ELSE 0 END) AS expense
      FROM ${effective("journal_entries", ctx.ws)} j JOIN ${effective("gl_accounts", ctx.ws)} g ON g.id = j.gl_account_id
      WHERE j.period BETWEEN ? AND ?${s.sql}${extra} GROUP BY j.period ORDER BY j.period`)
    .bind(addMonths(to, -n + 1), to, ...s.binds, ...(property ? [property] : []))
    .all<{ month: string; income: number; expense: number }>();
  return months(to, n).map((m) => {
    const x = r.results.find((y) => y.month === m);
    const income = (x?.income ?? 0) / 100, expense = (x?.expense ?? 0) / 100;
    return { month: m, income, expense, noi: income - expense };
  });
}

registerMetric({
  key: "accounting.income_expense",
  label: "Income vs expense",
  run: async (ctx, params) => {
    const points = await incomeExpense(ctx, params.months ?? 12, params.property);
    return { value: points.at(-1)?.noi ?? null, previous: points.at(-2)?.noi ?? null, spark: points.map((p) => p.noi), points, asOf: points.at(-1)?.month, source: "journal entries" };
  },
});

// Budget vs actual expense per month (closed months of the current year, plus the year's budget ahead).
export async function budgetVsActual(ctx: MetricCtx, opts: { property?: string; gl?: string; type?: "Income" | "Expense" } = {}) {
  const s = scoped(ctx, "x.property_id");
  const year = ctx.asOf.slice(0, 4);
  const type = opts.type ?? "Expense";
  const sign = type === "Income" ? "j.credit_cents - j.debit_cents" : "j.debit_cents - j.credit_cents";
  const filters = `${opts.property ? " AND x.property_id = ?" : ""}${opts.gl ? " AND x.gl_account_id = ?" : ""}`;
  const fb = [...(opts.property ? [opts.property] : []), ...(opts.gl ? [opts.gl] : [])];
  const [b, a] = await Promise.all([
    ctx.db.prepare(`SELECT x.period AS month, sum(x.amount_cents) AS c FROM ${effective("budget_lines", ctx.ws)} x JOIN ${effective("gl_accounts", ctx.ws)} g ON g.id = x.gl_account_id WHERE g.type = ? AND x.period LIKE ?${s.sql}${filters} GROUP BY x.period`)
      .bind(type, `${year}-%`, ...s.binds, ...fb).all<{ month: string; c: number }>(),
    ctx.db.prepare(`SELECT x.period AS month, sum(${sign.replace(/j\./g, "x.")}) AS c FROM ${effective("journal_entries", ctx.ws)} x JOIN ${effective("gl_accounts", ctx.ws)} g ON g.id = x.gl_account_id WHERE g.type = ? AND x.period LIKE ? AND x.period < ?${s.sql}${filters} GROUP BY x.period`)
      .bind(type, `${year}-%`, ctx.asOf, ...s.binds, ...fb).all<{ month: string; c: number }>(),
  ]);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((m) => {
    const budget = (b.results.find((x) => x.month === m)?.c ?? 0) / 100;
    const act = a.results.find((x) => x.month === m);
    return { month: m, budget, actual: act ? act.c / 100 : null };
  });
}

registerMetric({
  key: "accounting.budget_vs_actual",
  label: "Expense: budget vs actual",
  run: async (ctx, params) => {
    const points = await budgetVsActual(ctx, { property: params.property });
    const closed = points.filter((p) => p.actual != null);
    const ytdBudget = closed.reduce((s, p) => s + p.budget, 0);
    const ytdActual = closed.reduce((s, p) => s + (p.actual ?? 0), 0);
    return { value: ytdBudget ? (ytdActual - ytdBudget) / ytdBudget : null, points, asOf: closed.at(-1)?.month, source: "budget lines + journal entries" };
  },
});

registerMetric({
  key: "accounting.capex_over",
  label: "Capex projects over budget",
  run: async (ctx) => {
    const s = scoped(ctx, "c.property_id");
    const r = await ctx.db.prepare(`SELECT count(*) AS n FROM ${effective("capex_projects", ctx.ws)} c WHERE c.spent_cents > c.budget_cents${s.sql}`).bind(...s.binds).first<{ n: number }>();
    return { value: r?.n ?? 0, points: [], source: "capex projects (live)" };
  },
});

registerMetric({
  key: "accounting.capex_by_property",
  label: "Capex budget vs spent",
  run: async (ctx) => {
    const s = scoped(ctx, "c.property_id");
    const r = await ctx.db
      .prepare(`SELECT c.property_id, p.name AS label, sum(c.budget_cents) AS budget, sum(c.spent_cents) AS spent FROM ${effective("capex_projects", ctx.ws)} c JOIN ${effective("properties", ctx.ws)} p ON p.id = c.property_id
        WHERE c.status <> 'Complete'${s.sql} GROUP BY c.property_id ORDER BY budget DESC LIMIT 10`)
      .bind(...s.binds)
      .all<{ property_id: string; label: string; budget: number; spent: number }>();
    return { points: r.results.map((x) => ({ property_id: x.property_id, label: x.label, budget: x.budget / 100, spent: x.spent / 100 })), source: "capex projects (live)" };
  },
});

registerMetric({
  key: "accounting.utilities_by_month",
  label: "Utility cost by month",
  run: async (ctx, params) => {
    const s = scoped(ctx, "u.property_id");
    const to = addMonths(ctx.asOf, -1);
    const extra = params.property ? " AND u.property_id = ?" : "";
    const r = await ctx.db
      .prepare(`SELECT u.period AS month, u.utility, sum(u.amount_cents) AS c FROM ${effective("utility_bills", ctx.ws)} u WHERE u.period BETWEEN ? AND ?${s.sql}${extra} GROUP BY u.period, u.utility`)
      .bind(addMonths(to, -11), to, ...s.binds, ...(params.property ? [params.property] : []))
      .all<{ month: string; utility: string; c: number }>();
    const points: Row[] = months(to, 12).map((m) => {
      const p: Row = { month: m };
      for (const x of r.results.filter((y) => y.month === m)) p[x.utility] = x.c / 100;
      return p;
    });
    return { points, source: "utility bills" };
  },
});

// ---------------------------------------------------------------------------------------------
// 90-day cash forecast for the trust accounts in scope, by week. Inflows: the trailing 3-month
// average collected rent, landing mostly in the first week of each month. Outflows: open bills by
// due date (past due counts in week 1), recurring bills on their schedule, other vendor spend at
// the trailing run rate, and owner distributions at month end.
// ---------------------------------------------------------------------------------------------

export type ForecastWeek = { week: string; start: string; inflow: number; outflow: number; bills: number; recurring: number; other: number; distributions: number; balance: number };

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const weekLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export async function cashForecast(ctx: MetricCtx): Promise<{ opening: number; weeks: ForecastWeek[]; low: ForecastWeek | null; assumptions: string[] }> {
  const today = await asOfDate(ctx);
  const s = scoped(ctx, "property_id");
  const sb = scoped(ctx, "b.property_id");
  const last3 = [addMonths(ctx.asOf, -3), addMonths(ctx.asOf, -1)];
  const [opening, collected, openBills, recurring, payouts, dist] = await Promise.all([
    trustCash(ctx),
    ctx.db.prepare(`SELECT coalesce(sum(collected_cents), 0) / 3 AS c FROM metrics_monthly WHERE workspace_id = 'base' AND month BETWEEN ? AND ?${s.sql}`).bind(...last3, ...s.binds).first<{ c: number }>(),
    ctx.db.prepare(`SELECT b.due_on, b.amount_cents FROM ${effective("bills", ctx.ws)} b WHERE b.status IN ('Draft', 'Pending approval', 'Approved', 'Scheduled') AND b.due_on <= ?${sb.sql}`).bind(addDays(today, 91), ...sb.binds).all<{ due_on: string; amount_cents: number }>(),
    ctx.db.prepare(`SELECT b.day_of_month, b.amount_cents FROM ${effective("recurring_bills", ctx.ws)} b WHERE b.active = 1${sb.sql}`).bind(...sb.binds).all<{ day_of_month: number; amount_cents: number }>(),
    ctx.db.prepare(`SELECT coalesce(sum(t.amount_cents), 0) / 3 AS c FROM ${effective("transfers", ctx.ws)} t WHERE t.kind = 'Vendor payout' AND t.status <> 'Returned' AND substr(t.created, 1, 7) BETWEEN ? AND ?${scoped(ctx, "t.property_id").sql}`).bind(...last3, ...scoped(ctx, "t.property_id").binds).first<{ c: number }>(),
    ctx.db.prepare(`SELECT coalesce(sum(d.amount_cents), 0) / 3 AS c FROM ${effective("owner_distributions", ctx.ws)} d WHERE d.period BETWEEN ? AND ? AND d.owner_entity_id IN (SELECT p.owner_entity_id FROM ${effective("properties", ctx.ws)} p WHERE 1 = 1${scoped(ctx, "p.id").sql})`).bind(...last3, ...scoped(ctx, "p.id").binds).first<{ c: number }>(),
  ]);
  const monthlyRent = (collected?.c ?? 0) / 100;
  const recurringMonthly = recurring.results.reduce((a, r) => a + r.amount_cents, 0) / 100;
  const otherWeekly = Math.max(0, (payouts?.c ?? 0) / 100 - recurringMonthly) * 12 / 52;
  const distMonthly = (dist?.c ?? 0) / 100;
  const weeks: ForecastWeek[] = [];
  let balance = opening;
  for (let w = 0; w < 13; w++) {
    const start = addDays(today, w * 7);
    const end = addDays(start, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    let inflow = 0, recur = 0, distributions = 0;
    for (const d of days) {
      const dom = Number(d.slice(8));
      const dim = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
      inflow += dom <= 5 ? monthlyRent * 0.14 : monthlyRent * 0.3 / (dim - 5);
      recur += recurring.results.filter((r) => Math.min(r.day_of_month, dim) === dom).reduce((a, r) => a + r.amount_cents, 0) / 100;
      if (dom === dim) distributions += distMonthly;
    }
    const bills = openBills.results.filter((b) => (w === 0 ? b.due_on <= end : b.due_on >= start && b.due_on <= end)).reduce((a, b) => a + b.amount_cents, 0) / 100;
    const outflow = bills + recur + otherWeekly + distributions;
    balance += inflow - outflow;
    weeks.push({ week: weekLabel(start), start, inflow: Math.round(inflow), outflow: Math.round(outflow), bills: Math.round(bills), recurring: Math.round(recur), other: Math.round(otherWeekly), distributions: Math.round(distributions), balance: Math.round(balance) });
  }
  const low = weeks.reduce<ForecastWeek | null>((m, w) => (!m || w.balance < m.balance ? w : m), null);
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return {
    opening,
    weeks,
    low,
    assumptions: [
      `Rent: ${usd(monthlyRent)} a month (average collected, last 3 closed months), 70% in the first 5 days`,
      `Open bills: ${openBills.results.length} due within 90 days; past-due bills are paid in week 1`,
      `Recurring bills: ${usd(recurringMonthly)} a month on their billing day`,
      `Other vendor spend: ${usd(otherWeekly)} a week (run rate less recurring)`,
      `Owner distributions: ${usd(distMonthly)} at each month end`,
    ],
  };
}

registerMetric({
  key: "accounting.cash_forecast",
  label: "90-day cash forecast",
  run: async (ctx) => {
    const f = await cashForecast(ctx);
    return { value: f.weeks.at(-1)?.balance ?? null, previous: f.opening, spark: f.weeks.map((w) => w.balance), points: f.weeks, source: "rules forecast from live balances" };
  },
});
