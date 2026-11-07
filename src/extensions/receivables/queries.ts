import "server-only";
import { cache } from "react";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { AS_OF } from "@/seed/constants";
import { CHARGE_IS_OPEN, chargeOpenStoredSql } from "@/server/data";
import { RETURNED_PAYMENT_FEE_CENTS, settle } from "@/server/money";
import { effective, type QueryCtx } from "@/server/query";
import { baseOf } from "@/server/effective";

// Receivables reads for the custom pages, tabs and widgets. Every figure is computed the same way
// as the charges list (open = amount − good payments − credits; aged by due date, past due only),
// so a number on a page and the rows behind its drill link always agree.

// Settle on read (plan §1): the visitor's ACH payments whose window has passed clear before any
// receivables figure is computed.
export async function settleDue(ctx: Pick<QueryCtx, "db" | "ws">) {
  if (ctx.ws) await settle(ctx.db, ctx.ws, Date.now());
}

export const BUCKETS = [
  { key: "0-30", label: "0–30 days", lo: 1, hi: 30 },
  { key: "31-60", label: "31–60 days", lo: 31, hi: 60 },
  { key: "61-90", label: "61–90 days", lo: 61, hi: 90 },
  { key: "90+", label: "90+ days", lo: 91, hi: 100_000 },
] as const;
export type BucketKey = (typeof BUCKETS)[number]["key"];

// Portfolio-wide reads (aging, delinquent lists, deposits in transit) are staff-only. A portal
// persona ("self" scope) is scoped to a whole property, which would show the neighbors.
export const isSelfScope = (actor: Actor) => actor.scope.kind === "self";

const scopeSql = (actor: Actor, col: string) => (actor.propertyIds === "all" ? { sql: "1 = 1", params: [] as unknown[] } : { sql: `${col} IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(actor.propertyIds)] });

// Open, past-due charges with their open amount and age (one row per charge), from the stored
// settlement columns. CHARGE_IS_OPEN stays verbatim so the charges_open_due partial index applies:
// about 1.4k open rows are read instead of every charge.
function openChargesSql(ws: string | null, where: string) {
  return `WITH oc AS (SELECT c.id, c.lease_id, c.household_id, c.property_id, c.gl_account_id, c.description, c.due_on, c.amount_cents,
                ${chargeOpenStoredSql("c")} AS open_cents, CAST(julianday('${AS_OF}') - julianday(c.due_on) AS INTEGER) AS age
              FROM ${effective("charges", ws)} AS c
              WHERE ${CHARGE_IS_OPEN("c")} AND c.due_on < '${AS_OF}' AND ${where})`;
}
const bucketCase = `CASE WHEN age <= 30 THEN '0-30' WHEN age <= 60 THEN '31-60' WHEN age <= 90 THEN '61-90' ELSE '90+' END`;

export type AgingRow = { property_id: string; name: string; metro: string; units: number; b0_30: number; b31_60: number; b61_90: number; b90p: number; total: number; households: number; charges: number };

// The aging scan reads every charge (~1–2 s), and the dashboard, widgets and charts all need it. Cache
// it per workspace and scope; the key carries the overlay's latest ledger rows, so a payment, credit
// or new charge the visitor records shows on the next read.
const agingCache = new Map<string, { at: number; rows: AgingRow[] }>();
const AGING_TTL_MS = 5 * 60_000;

export async function agingByProperty(ctx: QueryCtx): Promise<AgingRow[]> {
  if (isSelfScope(ctx.actor)) return [];
  const version = ctx.ws
    ? await ctx.db.prepare("SELECT (SELECT max(seq) FROM payments WHERE workspace_id = ?1) AS p, (SELECT max(seq) FROM credits WHERE workspace_id = ?1) AS c, (SELECT max(seq) FROM charges WHERE workspace_id = ?1) AS ch").bind(ctx.ws).first<Record<string, number | null>>()
    : null;
  const key = JSON.stringify([ctx.ws, ctx.actor.propertyIds, version]);
  const hit = agingCache.get(key);
  if (hit && Date.now() - hit.at < AGING_TTL_MS) return hit.rows;
  const rows = await scanAging(ctx);
  if (agingCache.size > 200) agingCache.clear();
  agingCache.set(key, { at: Date.now(), rows });
  return rows;
}

async function scanAging(ctx: QueryCtx): Promise<AgingRow[]> {
  const s = scopeSql(ctx.actor, "c.property_id");
  const res = await ctx.db
    .prepare(
      `${openChargesSql(ctx.ws, s.sql)}
       SELECT oc.property_id, p.name, p.metro, p.unit_count AS units,
         sum(CASE WHEN age <= 30 THEN open_cents ELSE 0 END) AS b0_30, sum(CASE WHEN age BETWEEN 31 AND 60 THEN open_cents ELSE 0 END) AS b31_60,
         sum(CASE WHEN age BETWEEN 61 AND 90 THEN open_cents ELSE 0 END) AS b61_90, sum(CASE WHEN age > 90 THEN open_cents ELSE 0 END) AS b90p,
         sum(open_cents) AS total, count(DISTINCT oc.household_id) AS households, count(*) AS charges
       FROM oc JOIN ${effective("properties", ctx.ws)} AS p ON p.id = oc.property_id WHERE open_cents > 0 GROUP BY oc.property_id ORDER BY total DESC`,
    )
    .bind(...s.params)
    .all<AgingRow>();
  return res.results;
}

export type DelinquentLease = { lease_id: string; property_id: string; property: string; unit: string; household: string; resident_id: string | null; total: number; b0_30: number; b31_60: number; b61_90: number; b90p: number; oldest_due_on: string; days_late: number; charges: number; rent_cents: number; lease_status: string };

// Delinquent leases (drill-down from an aging cell), largest balance first, paginated.
export async function delinquentLeases(ctx: QueryCtx, f: { property?: string; bucket?: BucketKey; page: number; size: number; sort?: "total" | "days" }) {
  if (isSelfScope(ctx.actor)) return { rows: [] as DelinquentLease[], total: 0, totalCents: 0, page: f.page, size: f.size };
  const s = scopeSql(ctx.actor, "c.property_id");
  const where = [s.sql];
  const params = [...s.params];
  if (f.property) {
    where.push("c.property_id = ?");
    params.push(f.property);
  }
  const having = f.bucket ? `HAVING sum(CASE WHEN ${bucketCase} = ? THEN open_cents ELSE 0 END) > 0` : "";
  const order = f.sort === "days" ? "days_late DESC" : "total DESC";
  const body = `${openChargesSql(ctx.ws, where.join(" AND "))},
    agg AS (SELECT lease_id, property_id, household_id, sum(open_cents) AS total, min(due_on) AS oldest_due_on, max(age) AS days_late, count(*) AS charges,
        sum(CASE WHEN age <= 30 THEN open_cents ELSE 0 END) AS b0_30, sum(CASE WHEN age BETWEEN 31 AND 60 THEN open_cents ELSE 0 END) AS b31_60,
        sum(CASE WHEN age BETWEEN 61 AND 90 THEN open_cents ELSE 0 END) AS b61_90, sum(CASE WHEN age > 90 THEN open_cents ELSE 0 END) AS b90p
      FROM oc WHERE open_cents > 0 GROUP BY lease_id ${having})`;
  const bucketParam = f.bucket ? [f.bucket] : [];
  const offset = (f.page - 1) * f.size;
  const [rows, total] = await Promise.all([
    ctx.db
      .prepare(
        `${body}
         SELECT agg.*, p.name AS property, u.number AS unit, h.name AS household, l.rent_cents, l.status AS lease_status,
           (SELECT r.id FROM ${effective("residents", ctx.ws)} AS r WHERE r.household_id = agg.household_id AND r.is_primary = 1 LIMIT 1) AS resident_id
         FROM agg JOIN ${effective("leases", ctx.ws)} AS l ON l.id = agg.lease_id JOIN ${effective("properties", ctx.ws)} AS p ON p.id = agg.property_id
         LEFT JOIN ${effective("units", ctx.ws)} AS u ON u.id = l.unit_id LEFT JOIN ${effective("households", ctx.ws)} AS h ON h.id = agg.household_id
         ORDER BY ${order}, agg.lease_id LIMIT ? OFFSET ?`,
      )
      .bind(...params, ...bucketParam, f.size, offset)
      .all<DelinquentLease>(),
    ctx.db.prepare(`${body} SELECT count(*) AS n, coalesce(sum(total), 0) AS cents FROM agg`).bind(...params, ...bucketParam).first<{ n: number; cents: number }>(),
  ]);
  return { rows: rows.results.map((r) => ({ ...r, lease_id: String(r.lease_id) })), total: total?.n ?? 0, totalCents: total?.cents ?? 0, page: f.page, size: f.size };
}

// ---------------------------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------------------------

export type LedgerEntry = {
  id: string; kind: "charge" | "payment" | "credit"; date: string; description: string; detail: string;
  debit: number; credit: number; balance: number; open?: number; status?: string; nsf?: boolean; returned?: number; href: string; charge_id?: string | null;
};
export type LeaseHeader = { id: string; property_id: string; property: string; unit: string; unit_id: string; household_id: string; household: string; status: string; start_on: string; end_on: string | null; move_out_on: string | null; rent_cents: number; deposit_cents: number; state: string };

// The lease if the actor may see it: in scope, and for a resident only their own household's.
// Cached per request: the ledger page and its LedgerView both resolve the same lease.
export const leaseFor = cache(leaseForUncached);
async function leaseForUncached(ctx: QueryCtx, leaseId: string): Promise<LeaseHeader | null> {
  const lease = await ctx.db
    .prepare(
      `SELECT l.id, l.property_id, p.name AS property, p.state, u.number AS unit, l.unit_id, l.household_id, h.name AS household, l.status, l.start_on, l.end_on, l.move_out_on, l.rent_cents, l.deposit_cents
       FROM ${effective("leases", ctx.ws)} AS l JOIN ${effective("properties", ctx.ws)} AS p ON p.id = l.property_id
       LEFT JOIN ${effective("units", ctx.ws)} AS u ON u.id = l.unit_id LEFT JOIN ${effective("households", ctx.ws)} AS h ON h.id = l.household_id WHERE l.id = ?`,
    )
    .bind(leaseId)
    .first<LeaseHeader>();
  if (!lease) return null;
  if (ctx.actor.propertyIds !== "all" && !ctx.actor.propertyIds.includes(lease.property_id)) return null;
  if (ctx.actor.scope.kind === "self" && (await householdOf(ctx)) !== lease.household_id) return null;
  return lease;
}

// The returned-payment fee for a property: the policy fee, capped by its state's nsf_fee_cap_cents.
// The same rule markPaymentReturned applies; the confirm dialog shows it before anyone clicks.
export async function returnedFeeCents(ctx: Pick<QueryCtx, "db" | "ws">, propertyId: string) {
  const cap = await ctx.db
    .prepare(`SELECT s.value FROM ${effective("state_rules", ctx.ws)} AS s WHERE s.state = (SELECT p.state FROM ${effective("properties", ctx.ws)} AS p WHERE p.id = ?) AND s.rule = 'nsf_fee_cap_cents' AND s.effective_from <= ? ORDER BY s.effective_from DESC LIMIT 1`)
    .bind(propertyId, AS_OF)
    .first<{ value: string }>();
  return Math.min(RETURNED_PAYMENT_FEE_CENTS, cap ? Number(cap.value) : RETURNED_PAYMENT_FEE_CENTS);
}

// A portal resident's household (persona record → residents.household_id).
export async function householdOf(ctx: Pick<QueryCtx, "db" | "ws" | "actor">): Promise<string | null> {
  const rec = getPersona(ctx.actor.personaId)?.record;
  if (rec?.entity !== "residents") return null;
  const r = await ctx.db.prepare(`SELECT household_id FROM ${effective("residents", ctx.ws)} AS r WHERE r.id = ?`).bind(rec.id).first<{ household_id: string }>();
  return r?.household_id ?? null;
}

export async function leasesOfHousehold(ctx: QueryCtx, householdId: string) {
  const res = await ctx.db.prepare(`SELECT l.id, l.status, l.start_on, l.end_on FROM ${effective("leases", ctx.ws)} AS l WHERE l.household_id = ? ORDER BY l.start_on DESC LIMIT 10`).bind(householdId).all<{ id: string; status: string; start_on: string; end_on: string | null }>();
  return res.results;
}

// Every charge, payment and credit on a lease in date order with a running balance. Unapplied
// payments lower the lease balance but not any charge's open amount; returned (NSF) payments show
// but don't count.
export async function leaseLedger(ctx: QueryCtx, leaseId: string) {
  const ws = ctx.ws;
  const [charges, payments, credits, pending] = await Promise.all([
    ctx.db
      .prepare(`SELECT c.id, c.due_on AS date, c.description, c.period, g.name AS gl, c.amount_cents FROM ${effective("charges", ws)} AS c LEFT JOIN ${effective("gl_accounts", ws)} AS g ON g.id = c.gl_account_id WHERE c.lease_id = ? ORDER BY c.due_on, c.id LIMIT 1000`)
      .bind(leaseId)
      .all<{ id: string; date: string; description: string; period: string; gl: string | null; amount_cents: number }>(),
    ctx.db.prepare(`SELECT p.id, p.received_on AS date, p.method, p.reference, p.amount_cents, p.nsf, p.charge_id FROM ${effective("payments", ws)} AS p WHERE p.lease_id = ? ORDER BY p.received_on, p.id LIMIT 1000`).bind(leaseId)
      .all<{ id: string; date: string; method: string; reference: string; amount_cents: number; nsf: number; charge_id: string | null }>(),
    ctx.db.prepare(`SELECT x.id, x.on_date AS date, x.kind, x.description, x.amount_cents, x.charge_id FROM ${effective("credits", ws)} AS x WHERE x.lease_id = ? ORDER BY x.on_date, x.id LIMIT 1000`).bind(leaseId)
      .all<{ id: string; date: string; kind: string; description: string; amount_cents: number; charge_id: string | null }>(),
    ctx.db.prepare(`SELECT t.ref AS charge_id FROM transfers AS t WHERE t.workspace_id = ? AND t.kind = 'Rent' AND t.status = 'Pending' AND t.key LIKE 'rent:%'`).bind(ws ?? "~")
      .all<{ charge_id: string }>(),
  ]);
  const processing = new Set(pending.results.map((p) => p.charge_id));
  const applied = new Map<string, number>();
  for (const x of [...payments.results.filter((p) => !p.nsf), ...credits.results]) if (x.charge_id) applied.set(x.charge_id, (applied.get(x.charge_id) ?? 0) + x.amount_cents);
  const status = (c: { id: string; date: string; open_cents: number; amount_cents: number }) =>
    c.open_cents <= 0 ? "Paid" : processing.has(c.id) ? "Processing" : c.date < AS_OF ? "Overdue" : c.open_cents < c.amount_cents ? "Partial" : "Due";
  const entries: Omit<LedgerEntry, "balance">[] = [
    ...charges.results.map((c) => ({ ...c, open_cents: c.amount_cents - (applied.get(c.id) ?? 0) })).map((c) => ({ id: c.id, kind: "charge" as const, date: c.date, description: c.description, detail: [c.gl, c.period].filter(Boolean).join(" · "), debit: c.amount_cents, credit: 0, open: Math.max(0, c.open_cents), status: status(c), href: `/app/receivables/charges/${c.id}` })),
    ...payments.results.map((p) => ({ id: p.id, kind: "payment" as const, date: p.date, description: `Payment · ${p.method}`, detail: [p.reference, p.charge_id ? `applied to ${p.charge_id}` : "unapplied"].filter(Boolean).join(" · "), debit: 0, credit: p.nsf ? 0 : p.amount_cents, returned: p.nsf ? p.amount_cents : undefined, nsf: !!p.nsf, status: p.nsf ? "Returned" : undefined, href: `/app/receivables/payments/${p.id}`, charge_id: p.charge_id })),
    ...credits.results.map((x) => ({ id: x.id, kind: "credit" as const, date: x.date, description: `${x.kind} · ${x.description}`, detail: x.charge_id ? `against ${x.charge_id}` : "", debit: 0, credit: x.amount_cents, href: `/app/receivables/credits/${x.id}`, charge_id: x.charge_id })),
  ];
  // Same day: charges first, so a payment on its due date nets to zero instead of dipping negative.
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "charge" ? 0 : 1) - (b.kind === "charge" ? 0 : 1) || a.id.localeCompare(b.id));
  let bal = 0;
  const rows: LedgerEntry[] = entries.map((e) => ({ ...e, balance: (bal += e.debit - e.credit) }));
  const sum = (k: "debit" | "credit", kind?: LedgerEntry["kind"]) => rows.filter((r) => !kind || r.kind === kind).reduce((s, r) => s + r[k], 0);
  const open = rows.filter((r) => r.kind === "charge" && (r.open ?? 0) > 0);
  const pastDue = open.filter((r) => r.date < AS_OF);
  return {
    rows,
    totals: {
      charged: sum("debit"), paid: sum("credit", "payment"), credited: sum("credit", "credit"), balance: bal,
      open: open.reduce((s, r) => s + (r.open ?? 0), 0), pastDue: pastDue.reduce((s, r) => s + (r.open ?? 0), 0),
      unapplied: rows.filter((r) => r.kind === "payment" && !r.charge_id && !r.nsf).reduce((s, r) => s + r.credit, 0),
      nsf: rows.filter((r) => r.nsf).length,
    },
  };
}

// Open charges a resident can pay now (portal Pay rent), oldest first.
export async function openCharges(ctx: QueryCtx, householdId: string) {
  const [charges, paid, pending] = await Promise.all([
    ctx.db.prepare(`SELECT c.id, c.lease_id, c.description, c.due_on, c.amount_cents FROM ${effective("charges", ctx.ws)} AS c WHERE c.household_id = ? AND c.due_on <= date('${AS_OF}', '+31 days') ORDER BY c.due_on, c.id LIMIT 500`).bind(householdId)
      .all<{ id: string; lease_id: string; description: string; due_on: string; amount_cents: number }>(),
    ctx.db.prepare(`SELECT p.charge_id, p.amount_cents FROM ${effective("payments", ctx.ws)} AS p WHERE p.household_id = ? AND p.nsf = 0 AND p.charge_id IS NOT NULL UNION ALL
      SELECT x.charge_id, x.amount_cents FROM ${effective("credits", ctx.ws)} AS x WHERE x.charge_id IS NOT NULL AND x.lease_id IN (SELECT l.id FROM ${effective("leases", ctx.ws)} AS l WHERE l.household_id = ?)`).bind(householdId, householdId)
      .all<{ charge_id: string; amount_cents: number }>(),
    ctx.db.prepare("SELECT t.ref FROM transfers AS t WHERE t.workspace_id = ? AND t.kind = 'Rent' AND t.status = 'Pending'").bind(ctx.ws ?? "~").all<{ ref: string }>(),
  ]);
  const applied = new Map<string, number>();
  for (const p of paid.results) applied.set(p.charge_id, (applied.get(p.charge_id) ?? 0) + p.amount_cents);
  const processing = new Set(pending.results.map((p) => p.ref));
  return charges.results.map((c) => ({ ...c, open_cents: c.amount_cents - (applied.get(c.id) ?? 0), processing: processing.has(c.id) })).filter((c) => c.open_cents > 0);
}

// ---------------------------------------------------------------------------------------------
// Widget figures
// ---------------------------------------------------------------------------------------------

// Money received but not yet cleared into trust: pending portal ACH (rent:<charge>) and today's
// office payments in base batches that clear after the demo date.
export async function depositsInTransit(ctx: QueryCtx) {
  if (isSelfScope(ctx.actor)) return { count: 0, cents: 0 };
  const s = scopeSql(ctx.actor, "t.property_id");
  const r = await ctx.db
    .prepare(`SELECT count(*) AS n, coalesce(sum(t.amount_cents), 0) AS cents FROM transfers AS t WHERE t.workspace_id IN ('${baseOf(ctx.ws)}', ?) AND t.kind = 'Rent' AND (t.status = 'Pending' OR substr(t.cleared, 1, 10) > '${AS_OF}') AND ${s.sql}`)
    .bind(ctx.ws ?? "~", ...s.params)
    .first<{ n: number; cents: number }>();
  return { count: r?.n ?? 0, cents: r?.cents ?? 0 };
}
