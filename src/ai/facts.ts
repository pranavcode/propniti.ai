import { AS_OF } from "@/seed/constants";
import type { Row } from "@/entities/types";
import { chargeOwedSql } from "@/server/data";
import { daysBetween, sql, type DataCtx } from "./data";

// Computed facts the agents and the assistant state as figures. The model never computes money:
// it reads these.

export type Delinquent = {
  lease_id: string; property_id: string; property: string; metro: string; unit: string; household_id: string;
  resident: string; resident_id: string | null; phone: string; email: string; language: string;
  balance_cents: number; days_late: number; oldest_due_on: string;
  aging: { d0_30: number; d31_60: number; d61_90: number; d90p: number };
  lease_status: string; risk_score: number | null; open_plan: boolean; manager: string | null;
};

const METROS = ["Austin", "Dallas", "Atlanta", "Phoenix"];
export const matchMetro = (text: string) => METROS.find((m) => new RegExp(`\\b${m}\\b`, "i").test(text) || (m === "Dallas" && /\bDFW\b/i.test(text)));

// Balances per lease from the charges still owed and due by today, read from the stored allocation
// (charges.paid_cents: each lease's payments and credits applied oldest first, kept current by every
// money action) instead of summing the whole ledger. Rent on its way by ACH isn't paid yet, so it
// still counts as owed, as on the ledger. Days late is the age of the oldest charge still owed.
export async function delinquency(ctx: DataCtx, today: string, f: { minDays?: number; metro?: string; propertyIds?: string[]; leaseIds?: string[]; limit?: number } = {}): Promise<{ rows: Delinquent[]; total: number; total_balance_cents: number }> {
  const filters: string[] = [];
  const params: unknown[] = [today];
  if (f.metro) {
    filters.push("p.metro = ?");
    params.push(f.metro);
  }
  if (f.propertyIds?.length) {
    filters.push("c.property_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(f.propertyIds));
  }
  if (f.leaseIds?.length) {
    filters.push("c.lease_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(f.leaseIds));
  }
  const owed = await sql<{ lease_id: string; due_on: string; owed: number; property: string; metro: string }>(
    ctx,
    `SELECT c.lease_id, c.due_on, ${chargeOwedSql("c")} AS owed, p.name AS property, p.metro
     FROM {charges} c JOIN {properties} p ON p.id = c.property_id
     WHERE c.paid_cents < c.amount_cents AND c.due_on <= ? ${filters.length ? "AND " + filters.join(" AND ") : ""}
     ORDER BY c.lease_id, c.due_on`,
    params,
  );
  if (!owed.length) return { rows: [], total: 0, total_balance_cents: 0 };
  const byLease = new Map<string, typeof owed>();
  for (const c of owed) (byLease.get(c.lease_id) ?? byLease.set(c.lease_id, []).get(c.lease_id)!).push(c);
  const ids = [...byLease.keys()];
  const leases = await sql<{ id: string; property_id: string; household_id: string; unit_id: string; status: string; manager: string | null }>(ctx,
    "SELECT l.id, l.property_id, l.household_id, l.unit_id, l.status, (SELECT s.name FROM {staff} s JOIN {properties} p ON s.id = p.manager_id WHERE p.id = l.property_id) AS manager FROM {leases} l WHERE l.id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids)]);
  const [people, units, plans] = await Promise.all([
    sql<{ household_id: string; id: string; first_name: string; last_name: string; phone: string; email: string; language: string; risk_score: number | null }>(
      ctx, "SELECT household_id, id, first_name, last_name, phone, email, language, risk_score FROM {residents} WHERE is_primary = 1 AND household_id IN (SELECT value FROM json_each(?))", [JSON.stringify(leases.map((l) => l.household_id))],
    ),
    sql<{ id: string; number: string }>(ctx, "SELECT id, number FROM {units} WHERE id IN (SELECT value FROM json_each(?))", [JSON.stringify(leases.map((l) => l.unit_id))]),
    sql<{ entity_id: string }>(ctx, "SELECT entity_id FROM {tasks} WHERE entity_type = 'leases' AND title LIKE '%payment plan%' AND status <> 'Cancelled' AND entity_id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids)]).catch(() => []),
  ]);
  const person = new Map(people.map((p) => [p.household_id, p]));
  const unit = new Map(units.map((u) => [u.id, u.number]));
  const planned = new Set(plans.map((p) => p.entity_id));

  let rows: Delinquent[] = leases.map((l) => {
    const charges = byLease.get(l.id)!;
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    for (const c of charges) {
      const age = daysBetween(c.due_on, today);
      if (age <= 30) aging.d0_30 += c.owed;
      else if (age <= 60) aging.d31_60 += c.owed;
      else if (age <= 90) aging.d61_90 += c.owed;
      else aging.d90p += c.owed;
    }
    const p = person.get(l.household_id);
    const oldest = charges[0].due_on;
    return {
      lease_id: l.id, property_id: l.property_id, property: charges[0].property, metro: charges[0].metro, manager: l.manager ?? null, unit: unit.get(l.unit_id) ?? l.unit_id, household_id: l.household_id,
      resident: p ? `${p.first_name} ${p.last_name}` : l.household_id, resident_id: p?.id ?? null, phone: p?.phone ?? "", email: p?.email ?? "", language: p?.language ?? "en",
      balance_cents: charges.reduce((s, c) => s + c.owed, 0), days_late: daysBetween(oldest, today), oldest_due_on: oldest, aging, lease_status: l.status,
      risk_score: p?.risk_score ?? null, open_plan: planned.has(l.id),
    };
  });
  if (f.minDays) rows = rows.filter((r) => r.days_late >= f.minDays!);
  rows.sort((a, b) => b.days_late - a.days_late || b.balance_cents - a.balance_cents);
  const total_balance_cents = rows.reduce((s, r) => s + r.balance_cents, 0);
  return { rows: rows.slice(0, f.limit ?? 50), total: rows.length, total_balance_cents };
}

// metrics_monthly rows (base only: it's precomputed by the seed), scoped to the actor's properties.
export async function monthly(ctx: DataCtx, f: { metro?: string; propertyIds?: string[]; months?: number } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (ctx.actor.propertyIds !== "all") {
    where.push("m.property_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(ctx.actor.propertyIds));
  }
  if (f.metro) {
    where.push("p.metro = ?");
    params.push(f.metro);
  }
  if (f.propertyIds?.length) {
    where.push("m.property_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(f.propertyIds));
  }
  const { results } = await ctx.db
    .prepare(
      `SELECT m.*, p.name AS property, p.metro FROM metrics_monthly m JOIN properties p ON p.id = m.property_id AND p.workspace_id = 'base'
       WHERE m.workspace_id = 'base' AND m.month IN (SELECT DISTINCT month FROM metrics_monthly WHERE workspace_id = 'base' ORDER BY month DESC LIMIT ?)
       ${where.length ? "AND " + where.join(" AND ") : ""} ORDER BY m.month, m.property_id`,
    )
    .bind(f.months ?? 13, ...params)
    .all<Row>();
  return results;
}

export type Driver = { label: string; delta_cents: number; detail: string };
export type NoiExplanation = {
  scope: string; month: string; prior_month: string; noi_cents: number; prior_noi_cents: number; change_pct: number;
  budget_noi_cents: number | null; drivers: Driver[]; by_property: { property_id: string; property: string; noi_cents: number; prior_noi_cents: number; change_cents: number }[];
  expense_lines: { gl: string; delta_cents: number; month_cents: number; prior_cents: number }[];
};

// "Why did NOI drop?": month over month NOI, split into computed drivers. The model only words it.
export async function explainNoi(ctx: DataCtx, f: { metro?: string; propertyIds?: string[]; month?: string; today?: string } = {}): Promise<NoiExplanation | null> {
  const rows = await monthly(ctx, { ...f, months: 25 });
  const months = [...new Set(rows.map((r) => String(r.month)))].sort();
  // The current month is still open; explain the last closed month unless one is named.
  const closed = months.filter((m) => m < (f.today ?? AS_OF).slice(0, 7));
  const month = f.month && months.includes(f.month) ? f.month : closed.at(-1) ?? months.at(-1);
  if (!month) return null;
  const prior = months[months.indexOf(month) - 1];
  if (!prior) return null;
  const sum = (m: string, k: string) => rows.filter((r) => r.month === m).reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const noi = sum(month, "noi_cents");
  const priorNoi = sum(prior, "noi_cents");
  const budgetRows = rows.filter((r) => r.month === month && r.budget_noi_cents != null);
  // NOI is booked income less operating expenses, so the drivers split that change and add up to
  // it exactly: vacancy and concessions are named, and the rest of the income change is "other".
  // Cash collected is not a driver: it isn't part of NOI.
  const opexEffect = -(sum(month, "opex_cents") - sum(prior, "opex_cents"));
  const vacancyEffect = -(sum(month, "vacancy_loss_cents") - sum(prior, "vacancy_loss_cents"));
  const concessionEffect = -(sum(month, "concessions_cents") - sum(prior, "concessions_cents"));
  const drivers: Driver[] = [
    { label: "Operating expenses", delta_cents: opexEffect, detail: "higher expenses lower NOI" },
    { label: "Vacancy loss", delta_cents: vacancyEffect, detail: "rent lost on empty units" },
    { label: "Concessions", delta_cents: concessionEffect, detail: "discounts given" },
    { label: "Other income", delta_cents: noi - priorNoi - opexEffect - vacancyEffect - concessionEffect, detail: "rent billed, fees and other income not covered above" },
  ].sort((a, b) => Math.abs(b.delta_cents) - Math.abs(a.delta_cents));
  const ids = [...new Set(rows.map((r) => String(r.property_id)))];
  const by_property = ids
    .map((id) => {
      const r = rows.find((x) => x.property_id === id && x.month === month);
      const q = rows.find((x) => x.property_id === id && x.month === prior);
      const n = Number(r?.noi_cents ?? 0);
      const pn = Number(q?.noi_cents ?? 0);
      return { property_id: id, property: String(r?.property ?? q?.property ?? id), noi_cents: n, prior_noi_cents: pn, change_cents: n - pn };
    })
    .sort((a, b) => a.change_cents - b.change_cents);
  const lines = await sql<{ gl: string; period: string; amt: number }>(
    ctx,
    `SELECT g.name AS gl, j.period, sum(j.debit_cents - j.credit_cents) AS amt FROM {journal_entries} j JOIN {gl_accounts} g ON g.id = j.gl_account_id
     WHERE g.type = 'Expense' AND j.period IN (?, ?) AND j.property_id IN (SELECT value FROM json_each(?)) GROUP BY g.name, j.period`,
    [month, prior, JSON.stringify(ids)],
  ).catch(() => []);
  const gl = new Map<string, { m: number; p: number }>();
  for (const l of lines) {
    const g = gl.get(l.gl) ?? { m: 0, p: 0 };
    if (l.period === month) g.m += l.amt;
    else g.p += l.amt;
    gl.set(l.gl, g);
  }
  const expense_lines = [...gl.entries()].map(([k, v]) => ({ gl: k, month_cents: v.m, prior_cents: v.p, delta_cents: v.m - v.p })).sort((a, b) => Math.abs(b.delta_cents) - Math.abs(a.delta_cents)).slice(0, 5);
  return {
    scope: f.metro ?? (f.propertyIds?.length === 1 ? by_property[0]?.property ?? "" : "portfolio"), month, prior_month: prior, noi_cents: noi, prior_noi_cents: priorNoi,
    change_pct: pct(noi, priorNoi), budget_noi_cents: budgetRows.length ? budgetRows.reduce((s, r) => s + Number(r.budget_noi_cents), 0) : null,
    drivers, by_property: by_property.slice(0, 8), expense_lines,
  };
}

export const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : 0);
