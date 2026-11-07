import "server-only";
import type { Actor } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/query";
import { baseOf } from "@/server/effective";
import { addMonths, measureOf, type GroupBy, type Measure, type QuerySpec, type ScopeProperty } from "./spec";

// Runs a validated QuerySpec. Every identifier below comes from this file or the registry in
// spec.ts; values (periods, ids, metros) are bound parameters.

export type Ctx = { db: Db; ws: string | null; actor: Actor };
export type ResultRow = { key: string; label: string; value: number; compare: number | null; href?: string };

const scopeSql = (ctx: Ctx, col: string) => (ctx.actor.propertyIds === "all" ? { sql: "", binds: [] as unknown[] } : { sql: ` AND ${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(ctx.actor.propertyIds)] as unknown[] });

export async function scopeProperties(ctx: Ctx): Promise<ScopeProperty[]> {
  const s = scopeSql(ctx, "p.id");
  const r = await ctx.db.prepare(`SELECT p.id, p.name, p.metro FROM ${effective("properties", ctx.ws)} p WHERE 1 = 1${s.sql} ORDER BY p.name`).bind(...s.binds).all<ScopeProperty>();
  return r.results;
}

// Group key and label expressions per source alias. property/metro join `p`.
const DIM: Record<GroupBy, (alias: string, monthCol: string) => { key: string; label: string }> = {
  property: () => ({ key: "p.id", label: "p.name" }),
  metro: () => ({ key: "p.metro", label: "p.metro" }),
  gl: () => ({ key: "g.id", label: "g.number || ' ' || g.name" }),
  month: (_a, monthCol) => ({ key: monthCol, label: monthCol }),
  vendor: (a) => ({ key: `${a}.to_id`, label: `${a}.to_name` }),
};

function filters(ctx: Ctx, spec: QuerySpec, propCol: string) {
  const s = scopeSql(ctx, propCol);
  let sql = s.sql;
  const binds = [...s.binds];
  if (spec.properties.length) { sql += ` AND ${propCol} IN (SELECT value FROM json_each(?))`; binds.push(JSON.stringify(spec.properties)); }
  if (spec.metros.length) { sql += " AND p.metro IN (SELECT value FROM json_each(?))"; binds.push(JSON.stringify(spec.metros)); }
  return { sql, binds };
}

function glFilter(m: Measure) {
  if (m.gls) return { sql: " AND g.number IN (SELECT value FROM json_each(?))", binds: [JSON.stringify(m.gls)] };
  return { sql: " AND g.type IN (SELECT value FROM json_each(?))", binds: [JSON.stringify(m.types ?? ["Expense"])] };
}

// Signed amount: income as credits − debits, expense as debits − credits; NOI = income − expense.
function journalSign(m: Measure, debit: string, credit: string) {
  if (m.key === "noi") return `${credit} - ${debit}`;
  if (m.types?.includes("Income") || m.gls?.some((g) => g.startsWith("4"))) return `${credit} - ${debit}`;
  return `${debit} - ${credit}`;
}

async function series(ctx: Ctx, m: Measure, spec: QuerySpec, from: string, to: string, budget: boolean): Promise<Map<string, { label: string; cents: number }>> {
  const ws = ctx.ws;
  let sql: string;
  let binds: unknown[];
  if (m.source === "journal") {
    const a = budget ? "l" : "j";
    const monthCol = `${a}.period`;
    const d = DIM[spec.groupBy](a, monthCol);
    const f = filters(ctx, spec, `${a}.property_id`);
    const g = glFilter(m);
    const amount = budget
      ? (m.key === "noi" ? "CASE WHEN g.type = 'Income' THEN l.amount_cents ELSE -l.amount_cents END" : "l.amount_cents")
      : journalSign(m, "j.debit_cents", "j.credit_cents");
    const table = budget ? effective("budget_lines", ws) : effective("journal_entries", ws);
    sql = `SELECT ${d.key} AS k, ${d.label} AS label, sum(${amount}) AS cents FROM ${table} ${a}
      JOIN ${effective("gl_accounts", ws)} g ON g.id = ${a}.gl_account_id JOIN ${effective("properties", ws)} p ON p.id = ${a}.property_id
      WHERE ${monthCol} BETWEEN ? AND ?${g.sql}${f.sql} GROUP BY k`;
    binds = [from, to, ...g.binds, ...f.binds];
  } else if (m.source === "metrics") {
    const d = DIM[spec.groupBy]("mm", "mm.month");
    const f = filters(ctx, spec, "mm.property_id");
    // Month-end balances add up across properties, not across months: use the last month unless by month.
    const range = m.stock && spec.groupBy !== "month" ? "mm.month = ?" : "mm.month BETWEEN ? AND ?";
    sql = `SELECT ${d.key} AS k, ${d.label} AS label, sum(${m.column}) AS cents FROM metrics_monthly mm JOIN ${effective("properties", ws)} p ON p.id = mm.property_id
      WHERE mm.workspace_id = '${baseOf(ws)}' AND ${range}${f.sql} GROUP BY k`;
    binds = [...(m.stock && spec.groupBy !== "month" ? [to] : [from, to]), ...f.binds];
  } else {
    const monthCol = "substr(coalesce(t.cleared, t.created), 1, 7)";
    const d = DIM[spec.groupBy]("t", monthCol);
    const f = filters(ctx, spec, "t.property_id");
    sql = `SELECT ${d.key} AS k, ${d.label} AS label, sum(t.amount_cents) AS cents FROM ${effective("transfers", ws)} t JOIN ${effective("properties", ws)} p ON p.id = t.property_id
      WHERE t.kind = 'Vendor payout' AND t.status <> 'Returned' AND ${monthCol} BETWEEN ? AND ?${f.sql} GROUP BY k`;
    binds = [from, to, ...f.binds];
  }
  const r = await ctx.db.prepare(sql).bind(...binds).all<{ k: string; label: string; cents: number }>();
  return new Map(r.results.map((x) => [String(x.k), { label: String(x.label), cents: Number(x.cents) }]));
}

function hrefFor(spec: QuerySpec, key: string): string | undefined {
  const m = measureOf(spec.measure)!;
  if (spec.groupBy === "property") return `/app/properties/${encodeURIComponent(key)}`;
  if (spec.groupBy === "gl") return `/app/gl/journal?f.gl_account_id=${encodeURIComponent(key)}`;
  if (spec.groupBy === "vendor") return `/app/maintenance/vendors/${encodeURIComponent(key)}?tab=bills`;
  if (spec.groupBy === "month" && m.source === "journal") return `/app/reports?r=pnl&from=${key}&to=${key}`;
  return undefined;
}

export async function runSpec(ctx: Ctx, spec: QuerySpec): Promise<{ rows: ResultRow[]; total: number; compareTotal: number | null; note?: string }> {
  const m = measureOf(spec.measure)!;
  const main = await series(ctx, m, spec, spec.from, spec.to, false);
  let cmp: Map<string, { label: string; cents: number }> | null = null;
  if (spec.compareTo === "budget") cmp = await series(ctx, m, spec, spec.from, spec.to, true);
  if (spec.compareTo === "prior_year") {
    const prior = await series(ctx, m, spec, addMonths(spec.from, -12), addMonths(spec.to, -12), false);
    cmp = spec.groupBy === "month" ? new Map([...prior].map(([k, v]) => [addMonths(k, 12), v])) : prior;
  }
  const keys = new Set([...main.keys(), ...(spec.groupBy === "month" ? [] : cmp?.keys() ?? [])]);
  if (spec.groupBy === "month") for (let k = spec.from; k <= spec.to; k = addMonths(k, 1)) keys.add(k);
  const rows: ResultRow[] = [...keys].map((k) => ({
    key: k,
    label: main.get(k)?.label ?? cmp?.get(k)?.label ?? k,
    value: (main.get(k)?.cents ?? 0) / 100,
    compare: cmp ? (cmp.get(k)?.cents ?? 0) / 100 : null,
    href: hrefFor(spec, k),
  }));
  rows.sort(spec.groupBy === "month" ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const compareTotal = cmp ? rows.reduce((s, r) => s + (r.compare ?? 0), 0) : null;
  const note = m.stock && spec.groupBy !== "month" ? `Balances at the end of ${spec.to}; month-end balances aren't added across months.` : undefined;
  return { rows, total, compareTotal, note };
}
