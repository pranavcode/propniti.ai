import type { Db } from "@/lib/platform/types";
import { AS_OF, CURRENT_PERIOD } from "@/seed/constants";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/entities/types";
import { NO_WORKSPACE, assertTable, effective } from "./effective";

// Low-level typed reads over base + overlay for the query layer (src/server/query.ts), the AI
// tools and custom pages. Identifiers are checked (table whitelist, column pattern); values are
// always bound; IN lists go through json_each so they never hit D1's 100-parameter limit.

export type Row = Record<string, unknown>;
export type DataCtx = { db: Db; ws: string | null };
type Scalar = string | number | null;
export type Cond = Scalar | Scalar[] | { op: "=" | "<>" | "<" | "<=" | ">" | ">=" | "like"; value: Scalar } | { op: "in" | "not in"; value: Scalar[] } | { op: "null" | "not null" };
export type Where = Record<string, Cond>;
export type Sort = [column: string, dir: "asc" | "desc"];
export type ListOptions = { where?: Where; sort?: Sort | Sort[]; page?: number; size?: number; columns?: string[]; propertyIds?: string[] | "all" };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (c: string) => {
  if (!IDENT.test(c)) throw new Error(`Bad column: ${c}`);
  return c;
};

// Builds "a.col = ?n AND …" for a Where, appending values to params. Exported for query.ts.
export function whereSql(where: Where | undefined, params: unknown[], alias = "t") {
  const parts: string[] = [];
  const bind = (v: unknown) => (params.push(v), `?${params.length + 1}`); // ?1 is the workspace
  for (const [col, cond] of Object.entries(where ?? {})) {
    const c = `${alias}.${ident(col)}`;
    if (cond === null) parts.push(`${c} IS NULL`);
    else if (Array.isArray(cond)) parts.push(`${c} IN (SELECT value FROM json_each(${bind(JSON.stringify(cond))}))`);
    else if (typeof cond !== "object") parts.push(`${c} = ${bind(cond)}`);
    else if (cond.op === "null") parts.push(`${c} IS NULL`);
    else if (cond.op === "not null") parts.push(`${c} IS NOT NULL`);
    else if (cond.op === "in" || cond.op === "not in") parts.push(`${c} ${cond.op.toUpperCase()} (SELECT value FROM json_each(${bind(JSON.stringify(cond.value))}))`);
    else if ("value" in cond) parts.push(`${c} ${cond.op === "like" ? "LIKE" : cond.op} ${bind(cond.value)}`);
  }
  return parts.length ? parts.join(" AND ") : "1 = 1";
}

const wsOf = (ctx: DataCtx) => ctx.ws ?? NO_WORKSPACE;

export async function list<T = Row>(ctx: DataCtx, table: string, opts: ListOptions = {}): Promise<{ rows: T[]; total: number; page: number; size: number }> {
  assertTable(table);
  const size = Math.max(1, Math.min(MAX_PAGE_SIZE, opts.size ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, opts.page ?? 1);
  const params: unknown[] = [];
  let where = whereSql(opts.where, params);
  if (opts.propertyIds && opts.propertyIds !== "all") {
    params.push(JSON.stringify(opts.propertyIds));
    where += ` AND t.property_id IN (SELECT value FROM json_each(?${params.length + 1}))`;
  }
  const sorts: Sort[] = !opts.sort ? [] : Array.isArray(opts.sort[0]) ? (opts.sort as Sort[]) : [opts.sort as Sort];
  const order = [...sorts.map(([c, d]) => `t.${ident(c)} ${d === "desc" ? "DESC" : "ASC"}`), table === "metrics_monthly" ? "t.property_id" : "t.id"].join(", ");
  const cols = opts.columns?.length ? opts.columns.map((c) => `t.${ident(c)}`).join(", ") : "t.*";
  const from = `${effective(table)} AS t`;
  const [rows, total] = await Promise.all([
    ctx.db.prepare(`SELECT ${cols} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`).bind(wsOf(ctx), ...params).all<T>(),
    ctx.db.prepare(`SELECT count(*) AS n FROM ${from} WHERE ${where}`).bind(wsOf(ctx), ...params).first<{ n: number }>(),
  ]);
  return { rows: rows.results, total: total?.n ?? 0, page, size };
}

export async function get<T = Row>(ctx: DataCtx, table: string, id: string): Promise<T | null> {
  return ctx.db.prepare(`SELECT * FROM ${effective(table)} AS t WHERE t.id = ?2`).bind(wsOf(ctx), id).first<T>();
}

// ---------------------------------------------------------------------------------------------
// Derived money state (status is computed, never stored on base rows)
// ---------------------------------------------------------------------------------------------

// Amount still owed on a charge: amount − payments − credits − rent already on its way (a pending
// rent:<charge> ACH). Counting the pending ACH keeps every pay-down path from paying it twice.
export const chargeOpenSql = (c = "c", ws = "?1") =>
  `(${c}.amount_cents
    - coalesce((SELECT sum(p.amount_cents) FROM ${effective("payments", ws)} AS p WHERE p.charge_id = ${c}.id AND p.nsf = 0), 0)
    - coalesce((SELECT sum(x.amount_cents) FROM ${effective("credits", ws)} AS x WHERE x.charge_id = ${c}.id), 0)
    - coalesce((SELECT sum(tr.amount_cents) FROM transfers AS tr WHERE tr.workspace_id = ${ws} AND tr.key = 'rent:' || ${c}.id AND tr.status = 'Pending'), 0))`;

// Processing (a live rent:<id> transfer is pending) | Paid | Partial | Overdue | Due.
export const chargeStatusSql = (c = "c", ws = "?1") => `(CASE
    WHEN EXISTS (SELECT 1 FROM transfers AS tr WHERE tr.workspace_id = ${ws} AND tr.key = 'rent:' || ${c}.id AND tr.status = 'Pending') THEN 'Processing'
    WHEN ${chargeOpenSql(c, ws)} <= 0 THEN 'Paid'
    WHEN julianday('${AS_OF}') - julianday(${c}.due_on) >= 3 THEN 'Overdue'
    WHEN ${chargeOpenSql(c, ws)} < ${c}.amount_cents THEN 'Partial'
    ELSE 'Due' END)`;

// Trust money per bank account: base constant + overlay (cleared in, less cleared and pending out).
export const AVAILABLE_SQL = (account: string, ws = "?1") => `(coalesce((SELECT cleared_cents FROM base_balances WHERE account_id = ${account}), 0)
  + coalesce((SELECT sum(CASE WHEN kind IN ('Rent', 'Deposit', 'Other receipt') THEN CASE WHEN status = 'Cleared' THEN amount_cents ELSE 0 END ELSE -amount_cents END)
     FROM transfers WHERE workspace_id = ${ws} AND bank_account_id = ${account} AND status <> 'Returned'), 0))`;

export async function trustBalances(ctx: DataCtx, ownerEntityId?: string) {
  const { results } = await ctx.db
    .prepare(
      `SELECT b.id, b.name, b.kind, b.owner_entity_id, ${AVAILABLE_SQL("b.id")} AS available_cents,
        coalesce((SELECT sum(amount_cents) FROM transfers WHERE workspace_id = ?1 AND bank_account_id = b.id AND status = 'Pending' AND kind IN ('Rent', 'Deposit', 'Other receipt')), 0) AS pending_in_cents
       FROM ${effective("bank_accounts")} AS b WHERE (?2 IS NULL OR b.owner_entity_id = ?2) ORDER BY b.id`,
    )
    .bind(wsOf(ctx), ownerEntityId ?? null)
    .all<{ id: string; name: string; kind: string; owner_entity_id: string | null; available_cents: number; pending_in_cents: number }>();
  return results;
}

// Owner statement open items: trust transfers after the entity's latest owner payout (seq cutoff).
export const OPEN_ITEMS_WHERE = (entity: string, ws = "?1") => `t.workspace_id IN ('base', ${ws}) AND t.owner_entity_id = ${entity} AND t.status <> 'Returned'
  AND t.bank_account_id = 'ba-' || ${entity} || '-trust' AND t.kind <> 'Owner payout'
  AND t.seq > coalesce((SELECT max(seq) FROM transfers WHERE workspace_id IN ('base', ${ws}) AND owner_entity_id = ${entity} AND kind = 'Owner payout' AND status <> 'Returned'), 0)`;
// Net owed to the owner from open items: cleared receipts − fees − vendor payouts (pending ones too).
export const OPEN_NET_SQL = (entity: string, ws = "?1") => `(SELECT coalesce(sum(CASE
    WHEN t.kind IN ('Rent', 'Other receipt') THEN CASE WHEN t.status = 'Cleared' THEN t.amount_cents ELSE 0 END
    WHEN t.kind = 'Management fee' THEN CASE WHEN t.status = 'Cleared' THEN -t.amount_cents ELSE 0 END
    WHEN t.kind = 'Vendor payout' THEN -t.amount_cents ELSE 0 END), 0) FROM transfers AS t WHERE ${OPEN_ITEMS_WHERE(entity, ws)})`;

export async function ownerStatement(ctx: DataCtx, ownerEntityId: string) {
  const ws = wsOf(ctx);
  const sums = await ctx.db
    .prepare(
      `SELECT
        coalesce(sum(CASE WHEN t.kind IN ('Rent', 'Other receipt') AND t.status = 'Cleared' THEN t.amount_cents END), 0) AS income_cents,
        coalesce(sum(CASE WHEN t.kind = 'Vendor payout' THEN t.amount_cents END), 0) AS expense_cents,
        coalesce(sum(CASE WHEN t.kind = 'Management fee' AND t.status = 'Cleared' THEN t.amount_cents END), 0) AS fee_cents,
        count(*) AS items
       FROM transfers AS t WHERE ${OPEN_ITEMS_WHERE("?2")}`,
    )
    .bind(ws, ownerEntityId)
    .first<{ income_cents: number; expense_cents: number; fee_cents: number; items: number }>();
  const s = sums ?? { income_cents: 0, expense_cents: 0, fee_cents: 0, items: 0 };
  return { ...s, net_cents: s.income_cents - s.expense_cents - s.fee_cents };
}

// ---------------------------------------------------------------------------------------------
// Metrics (pre-aggregated monthly rows plus live current-month figures)
// ---------------------------------------------------------------------------------------------

export type MetricKey = "monthly" | "portfolio_monthly" | "aging" | "trust";
export type MetricParams = { propertyIds?: string[] | "all"; from?: string; to?: string; ownerEntityId?: string };

const SUM_COLS = ["units", "occupied", "gpr_cents", "charged_cents", "collected_cents", "vacancy_loss_cents", "concessions_cents", "aging_0_30_cents", "aging_31_60_cents", "aging_61_90_cents", "aging_90p_cents", "opex_cents", "noi_cents", "budget_noi_cents", "wo_opened", "wo_open", "wo_sla_breach", "move_ins", "move_outs", "leads", "tours", "applications", "ai_actions", "ai_minutes_saved"];

export async function metrics(ctx: DataCtx, key: MetricKey, params: MetricParams = {}): Promise<Row[]> {
  const ws = wsOf(ctx);
  const props = params.propertyIds && params.propertyIds !== "all" ? JSON.stringify(params.propertyIds) : null;
  const scope = "(?2 IS NULL OR t.property_id IN (SELECT value FROM json_each(?2)))";
  const from = params.from ?? "0000-00", to = params.to ?? CURRENT_PERIOD;
  if (key === "monthly") {
    return (await ctx.db.prepare(`SELECT t.* FROM ${effective("metrics_monthly")} AS t WHERE ${scope} AND t.month BETWEEN ?3 AND ?4 ORDER BY t.property_id, t.month`).bind(ws, props, from, to).all()).results;
  }
  if (key === "portfolio_monthly") {
    return (
      await ctx.db
        .prepare(
          `SELECT t.month, ${SUM_COLS.map((c) => `sum(t.${c}) AS ${c}`).join(", ")},
            round(1.0 * sum(t.occupied) / sum(t.units), 4) AS occupancy_phys,
            round(sum(t.occupancy_econ * t.gpr_cents) / sum(t.gpr_cents), 4) AS occupancy_econ
           FROM ${effective("metrics_monthly")} AS t WHERE ${scope} AND t.month BETWEEN ?3 AND ?4 GROUP BY t.month ORDER BY t.month`,
        )
        .bind(ws, props, from, to)
        .all()
    ).results;
  }
  if (key === "aging") {
    // Live AR aging as of the demo date, from base + overlay charges, payments and credits.
    const inScope = (a: string) => `(?2 IS NULL OR ${a}.property_id IN (SELECT value FROM json_each(?2)))`;
    return (
      await ctx.db
        .prepare(
          `SELECT t.property_id,
             sum(CASE WHEN age <= 30 THEN open ELSE 0 END) AS aging_0_30_cents,
             sum(CASE WHEN age BETWEEN 31 AND 60 THEN open ELSE 0 END) AS aging_31_60_cents,
             sum(CASE WHEN age BETWEEN 61 AND 90 THEN open ELSE 0 END) AS aging_61_90_cents,
             sum(CASE WHEN age > 90 THEN open ELSE 0 END) AS aging_90p_cents,
             sum(open) AS open_cents, count(DISTINCT t.household_id) AS households
           FROM (SELECT c.property_id, c.household_id, c.amount_cents - coalesce(p.s, 0) - coalesce(x.s, 0) AS open,
                   CAST(julianday('${AS_OF}') - julianday(c.due_on) AS INTEGER) AS age
                 FROM ${effective("charges")} AS c
                 LEFT JOIN (SELECT charge_id, sum(amount_cents) AS s FROM ${effective("payments")} AS p WHERE p.nsf = 0 AND p.charge_id IS NOT NULL AND ${inScope("p")} GROUP BY charge_id) AS p ON p.charge_id = c.id
                 LEFT JOIN (SELECT charge_id, sum(amount_cents) AS s FROM ${effective("credits")} AS x WHERE x.charge_id IS NOT NULL AND ${inScope("x")} GROUP BY charge_id) AS x ON x.charge_id = c.id
                 WHERE ${inScope("c")}) AS t
           WHERE t.open > 0 GROUP BY t.property_id ORDER BY t.property_id`,
        )
        .bind(ws, props)
        .all()
    ).results;
  }
  return trustBalances(ctx, params.ownerEntityId);
}

export async function asOf(ctx: DataCtx) {
  return (await ctx.db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? AS_OF;
}
