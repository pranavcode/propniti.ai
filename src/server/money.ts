import { PERMISSIONS, getPersona } from "@/auth/personas";
import type { ActionContext, Actor, ModuleKey } from "@/entities/types";
import { MANAGEMENT_FEE_RATE, SETTLE_MS } from "@/lib/ledger";
import type { Db, DbStatement } from "@/lib/platform/types";
import { AS_OF, CURRENT_PERIOD } from "@/seed/constants";
import { AVAILABLE_SQL, CHARGE_IS_OPEN, OPEN_NET_SQL, chargeOpenSql, ownerStatement } from "./data";
import { effective, overlayUpsertSql } from "./effective";
import { nowIso } from "./workspace";

// Money movement for v2 (plan §1, AGENTS.md money rules). Base history is read-only; every money
// action is one D1 batch whose first statement is a guarded INSERT … SELECT … WHERE <guards> ON
// CONFLICT DO NOTHING into the visitor's overlay `transfers`. Later statements are gated on that
// row existing, so they run only if the money moved. The SQL guards decide; JS pre-checks only
// pick the error message. Idempotency comes from the transfers_live_key unique index, plus a
// NOT EXISTS check against base keys. Every action writes `events` (the agents' outbox) and `audit`.

export type Outcome = { status: 200; message?: string } | { status: 400 | 403 | 404 | 409; error: string };

const FEE_PCT = Math.round(MANAGEMENT_FEE_RATE * 100);
const TRANSFER_COLS = "workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, settles_at, cleared";
const BILL_COLS = ["id", "deleted", "property_id", "owner_entity_id", "vendor_id", "work_order_id", "po_id", "recurring_bill_id", "document_id", "invoice_number", "bill_date", "due_on", "amount_cents", "status", "approved_by", "approved_at"];
const WO_COLS = ["id", "deleted", "property_id", "unit_id", "service_request_id", "pm_schedule_id", "turnover_id", "title", "description", "category", "priority", "source", "status", "vendor_id", "assignee_id", "estimate_cents", "cost_cents", "sla_due_at", "opened_at", "scheduled_at", "completed_at", "permission_to_enter"];

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Gates: a statement runs only when the transfer exists (or, for refusals, doesn't).
type Gate = { transferId: string; exists: boolean } | null;
const gateSql = (g: Gate, n: number) => (!g ? "1 = 1" : `${g.exists ? "" : "NOT "}EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?${n})`);
const gateParams = (g: Gate) => (g ? [g.transferId] : []);
export const done = (transferId: string): Gate => ({ transferId, exists: true });
const refused = (transferId: string): Gate => ({ transferId, exists: false });

// Re-allocates a lease's ledger to its charges, oldest first (due date, then id), the same rule as
// the generator: payments (not NSF) and credits on the lease pay charges in order; rent on its way
// by ACH (pending rent:<charge> transfers) fills what is still open, also oldest first. Writes only
// the charges whose stored amounts change, into the visitor's overlay. Pass any charge id of the
// lease; put the statement after the ledger rows it must see.
const CHARGE_COLS = ["id", "deleted", "lease_id", "household_id", "property_id", "unit_id", "gl_account_id", "description", "period", "due_on", "amount_cents"];
export function chargeRefreshStmt(db: Db, ws: string, chargeId: string | null, leaseId: string | null = null): DbStatement {
  return db
    .prepare(
      `WITH lease AS (SELECT coalesce(?3, (SELECT e.lease_id FROM ${effective("charges")} AS e WHERE e.id = ?2)) AS id),
       ch AS (SELECT e.*, coalesce(sum(e.amount_cents) OVER (ORDER BY e.due_on, e.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
              FROM ${effective("charges")} AS e WHERE e.lease_id = (SELECT id FROM lease)),
       tot AS (SELECT coalesce((SELECT sum(p.amount_cents) FROM ${effective("payments")} AS p WHERE p.lease_id = (SELECT id FROM lease) AND p.nsf = 0), 0)
                    + coalesce((SELECT sum(x.amount_cents) FROM ${effective("credits")} AS x WHERE x.lease_id = (SELECT id FROM lease)), 0) AS paid,
                 coalesce((SELECT sum(t.amount_cents) FROM transfers AS t WHERE t.workspace_id = ?1 AND t.status = 'Pending' AND t.kind = 'Rent' AND t.key = 'rent:' || t.ref AND t.ref IN (SELECT id FROM ch)), 0) AS pend),
       a AS (SELECT ch.*, max(0, min(ch.amount_cents, tot.paid - ch.before)) AS np FROM ch, tot),
       b AS (SELECT a.*, coalesce(sum(a.amount_cents - a.np) OVER (ORDER BY a.due_on, a.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS open_before FROM a),
       c AS (SELECT b.*, max(0, min(b.amount_cents - b.np, tot.pend - b.open_before)) AS npend FROM b, tot)
       INSERT INTO charges (workspace_id, ${CHARGE_COLS.join(", ")}, paid_cents, pending_cents)
       SELECT ?1, ${CHARGE_COLS.map((x) => `c.${x}`).join(", ")}, c.np, c.npend FROM c WHERE c.np <> c.paid_cents OR c.npend <> c.pending_cents
       ON CONFLICT (workspace_id, id) DO UPDATE SET paid_cents = excluded.paid_cents, pending_cents = excluded.pending_cents`,
    )
    .bind(ws, chargeId, leaseId);
}

export function auditStmt(db: Db, ws: string, at: string, actor: Pick<Actor, "name" | "personaId" | "role">, a: { action: string; entityType?: string; entityId?: string; propertyId?: string | null; detail: string; before?: unknown; after?: unknown; agent?: string; model?: string }, gate: Gate = null): DbStatement {
  return db
    .prepare(
      `INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, agent, model, action, entity_type, entity_id, property_id, detail, before_json, after_json)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15 WHERE ${gateSql(gate, 16)}`,
    )
    .bind(ws, uid("au"), at, actor.name, actor.personaId, actor.role, a.agent ?? null, a.model ?? null, a.action, a.entityType ?? null, a.entityId ?? null, a.propertyId ?? null, a.detail, a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after), ...gateParams(gate));
}

export function eventStmt(db: Db, ws: string, at: string, type: string, entityType: string, entityId: string, propertyId: string | null, payload: object, gate: Gate = null): DbStatement {
  return db
    .prepare(`INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE ${gateSql(gate, 9)}`)
    .bind(ws, uid("ev"), type, entityType, entityId, propertyId, JSON.stringify(payload), at, ...gateParams(gate));
}

export function notifyStmt(db: Db, ws: string, at: string, userId: string, title: string, body: string, href: string | null, entity: [string, string] | null, gate: Gate = null): DbStatement {
  return db
    .prepare(`INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at) SELECT ?1, ?2, ?3, 'In-app', ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${gateSql(gate, 10)}`)
    .bind(ws, uid("nt"), userId, title, body, href, entity?.[0] ?? null, entity?.[1] ?? null, at, ...gateParams(gate));
}

// Defence in depth: money approvals check role and property scope here too, not only in the
// action registry, so any caller (routes, agents after approval) gets the same answer.
function forbidden(actor: Actor, modules: ModuleKey[], propertyId: string | null, extraRoles: string[] = []): Outcome | null {
  if (!modules.some((m) => PERMISSIONS[actor.role]?.[m] === "approve") && !extraRoles.includes(actor.role)) return { status: 403, error: "Your role can't approve this" };
  if (propertyId && actor.propertyIds !== "all" && !actor.propertyIds.includes(propertyId)) return { status: 403, error: "That property is outside your scope" };
  return null;
}

const transferAt = (db: Db, ws: string, key: string) => db.prepare("SELECT id, status FROM transfers WHERE workspace_id IN ('base', ?1) AND key = ?2 AND status <> 'Returned'").bind(ws, key).first<{ id: string; status: string }>();

// ---------------------------------------------------------------------------------------------
// Settle: overlay transfers whose ACH window has passed clear on the next request.
// ---------------------------------------------------------------------------------------------

// When each workspace's next pending transfer is due, as last read by this isolate. Reads skip the
// database until then. Another isolate may add a transfer this one hasn't seen, so the marker is
// also re-read after SETTLE_RECHECK_MS; transfers added here move it at once (settleDueBy).
const SETTLE_RECHECK_MS = 10_000;
const nextDue = new WeakMap<Db, Map<string, { due: number; read: number }>>();
const dueMarks = (db: Db) => nextDue.get(db) ?? nextDue.set(db, new Map()).get(db)!;

export function settleDueBy(db: Db, ws: string, at: number) {
  const mark = dueMarks(db).get(ws);
  if (mark) mark.due = Math.min(mark.due, at);
}

// Settle-on-read for every request: called from actorFor (permissions.ts), which both page
// sessions and API sessions go through. No query while nothing is due; otherwise one indexed MIN.
// Never throws: a page must render even if settling fails (settle itself isolates each transfer).
export async function settleIfDue(db: Db, ws: string | null, nowMs: number) {
  if (!ws) return;
  const marks = dueMarks(db);
  const mark = marks.get(ws);
  if (mark && nowMs < mark.due && nowMs >= mark.read && nowMs - mark.read < SETTLE_RECHECK_MS) return;
  try {
    const row = await db.prepare("SELECT min(settles_at) AS due FROM transfers WHERE workspace_id = ?1 AND status = 'Pending'").bind(ws).first<{ due: number | null }>();
    const due = row?.due == null ? Infinity : Number(row.due);
    if (due > nowMs) {
      if (marks.size >= 5000) marks.clear();
      marks.set(ws, { due, read: nowMs });
      return;
    }
    // More may be due than one call settles (or one may have failed): check again next request.
    marks.delete(ws);
    await settle(db, ws, nowMs);
  } catch (e) {
    console.error("settle failed", ws, e);
  }
}

// At most SETTLE_BATCH transfers per call (up to 5 statements each), to stay well inside D1's
// per-request query limit; anything left settles on the next request.
const SETTLE_BATCH = 10;
export async function settle(db: Db, ws: string, nowMs: number) {
  const due = (await db.prepare(`SELECT * FROM transfers WHERE workspace_id = ?1 AND status = 'Pending' AND settles_at <= ?2 ORDER BY seq LIMIT ${SETTLE_BATCH}`).bind(ws, nowMs).all<Record<string, string | number>>()).results;
  if (!due.length) return;
  const at = nowIso(nowMs);
  for (const t of due) {
    const steps: DbStatement[] = [];
    const id = String(t.id);
    const pending = `EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?2 AND status = 'Pending')`;
    if (t.kind === "Rent") {
      steps.push(
        db
          .prepare(
            `INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, transfer_id, method, reference, received_on, amount_cents, nsf)
             SELECT ?1, ?3, c.lease_id, c.household_id, c.property_id, c.id, ?2, 'ACH', 'Portal ACH ' || substr(?2, 4, 8), ?4, ?5, 0
             FROM ${effective("charges")} AS c WHERE c.id = ?6 AND ${pending}`,
          )
          .bind(ws, id, uid("pay"), AS_OF, t.amount_cents, t.ref),
        db
          .prepare(
            `INSERT INTO transfers (${TRANSFER_COLS})
             SELECT ?1, ?3, 'fee:' || id, 'Management fee', bank_account_id, owner_entity_id, 'trust', bank_account_id, 'Operating trust', 'pm', 'ba-mgmt', 'Summit Residential Partners (management fees)',
               CAST((amount_cents * ?4 + 50) / 100 AS INTEGER), property_id, id, 'Cleared', ?5, NULL, ?5
             FROM transfers WHERE workspace_id = ?1 AND id = ?2 AND status = 'Pending' AND CAST((amount_cents * ?4 + 50) / 100 AS INTEGER) > 0 ON CONFLICT DO NOTHING`,
          )
          .bind(ws, id, uid("tr"), FEE_PCT, at),
        eventStmt(db, ws, at, "payment.received", "charges", String(t.ref), String(t.property_id), { transfer_id: id, amount_cents: t.amount_cents }, done(id)),
        db
          .prepare(
            `INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at)
             SELECT ?1, ?3, r.id, 'In-app', 'Payment received', ?4, '/portal/resident', 'charges', ?5, ?6
             FROM ${effective("residents")} AS r WHERE r.household_id = ?7 AND r.is_primary = 1 AND ${pending}`,
          )
          .bind(ws, id, uid("nt"), `We received your payment of ${dollars(Number(t.amount_cents))}. Thank you!`, t.ref, at, t.from_id),
      );
    }
    if (t.kind === "Vendor payout") {
      const ref = String(t.ref);
      // The ref is a bill or a work order id; each upsert only matches a row that exists.
      const isBill = !!(await db.prepare(`SELECT 1 FROM ${effective("bills")} AS b WHERE b.id = ?2`).bind(ws, ref).first());
      const entity = isBill ? "bills" : "work_orders";
      steps.push(
        db.prepare(overlayUpsertSql(entity, isBill ? BILL_COLS : WO_COLS, { status: "'Paid'" }, pending, "?1", "?3")).bind(ws, id, ref),
        eventStmt(db, ws, at, "payment.sent", entity, ref, String(t.property_id), { transfer_id: id, amount_cents: t.amount_cents, vendor_id: t.to_id }, done(id)),
        notifyStmt(db, ws, at, String(t.to_id), "Payment sent", `${dollars(Number(t.amount_cents))} for ${ref} has arrived in your account.`, "/portal/vendor/payments", [entity, ref], done(id)),
      );
    }
    if (t.kind === "Owner payout") {
      steps.push(
        eventStmt(db, ws, at, "owner.distribution_paid", "owner_entities", String(t.owner_entity_id), null, { transfer_id: id, amount_cents: t.amount_cents }, done(id)),
        notifyStmt(db, ws, at, String(t.to_id), "Distribution arrived", `Your distribution of ${dollars(Number(t.amount_cents))} has arrived.`, "/portal/owner/statements", ["owner_entities", String(t.owner_entity_id)], done(id)),
      );
    }
    // Last, so the steps above still see the transfer as Pending.
    steps.push(db.prepare("UPDATE transfers SET status = 'Cleared', cleared = ?3 WHERE workspace_id = ?1 AND id = ?2 AND status = 'Pending'").bind(ws, id, at));
    if (t.kind === "Rent" && String(t.key).startsWith("rent:")) steps.push(chargeRefreshStmt(db, ws, String(t.ref)));
    // One batch per transfer: a row that can't settle is logged and retried in an hour, and the
    // others still clear.
    try {
      await db.batch(steps);
    } catch (e) {
      console.error("settle: transfer failed", id, e);
      await db.prepare("UPDATE transfers SET settles_at = ?3 WHERE workspace_id = ?1 AND id = ?2 AND status = 'Pending'").bind(ws, id, nowMs + 3_600_000).run();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Receivables
// ---------------------------------------------------------------------------------------------

type ChargeRow = { id: string; property_id: string; household_id: string; lease_id: string; description: string; amount_cents: number; open_cents: number; owner_entity_id: string; household_name: string; gl_account_id: string; due_on: string };
const chargeRow = (db: Db, ws: string, chargeId: string) =>
  db
    .prepare(
      `SELECT c.*, ${chargeOpenSql("c")} AS open_cents, p.owner_entity_id, h.name AS household_name
       FROM ${effective("charges")} AS c JOIN ${effective("properties")} AS p ON p.id = c.property_id LEFT JOIN ${effective("households")} AS h ON h.id = c.household_id
       WHERE c.id = ?2`,
    )
    .bind(ws, chargeId)
    .first<ChargeRow>();

// Resident pays a charge's open balance by ACH into the property's trust (key rent:<charge>).
export async function payRent(ctx: ActionContext, chargeId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const c = await chargeRow(db, ws, chargeId);
  if (!c) return { status: 404, error: "Charge not found" };
  const at = nowIso(nowMs);
  const id = uid("tr");
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'rent:' || c.id, 'Rent', 'ba-' || ?4 || '-trust', ?4, 'household', c.household_id, ?5, 'trust', 'ba-' || ?4 || '-trust', 'Operating trust', ?6, c.property_id, c.id, 'Pending', ?7, ?8, NULL
         FROM ${effective("charges")} AS c
         WHERE c.id = ?3 AND ?6 > 0 AND ?6 = ${chargeOpenSql("c")}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'rent:' || ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, c.id, c.owner_entity_id, c.household_name ?? "Resident", c.open_cents, at, nowMs + SETTLE_MS),
    chargeRefreshStmt(db, ws, c.id),
    eventStmt(db, ws, at, "payment.initiated", "charges", c.id, c.property_id, { transfer_id: id, amount_cents: c.open_cents, method: "ACH" }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Rent payment started", entityType: "charges", entityId: c.id, propertyId: c.property_id, detail: `${c.description}: ${dollars(c.open_cents)} by ACH into the operating trust` }, done(id)),
    notifyStmt(db, ws, at, "marcus", "Rent payment started", `${c.household_name} paid ${dollars(c.open_cents)} (${c.description}); ACH pending.`, `/app/receivables/charges/${c.id}`, ["charges", c.id], done(id)),
  ]);
  if (insert.meta.changes) {
    settleDueBy(db, ws, nowMs + SETTLE_MS);
    return { status: 200, message: `Payment of ${dollars(c.open_cents)} is processing.` };
  }
  const live = await transferAt(db, ws, `rent:${c.id}`);
  return { status: 409, error: live ? `${c.description} is already ${live.status === "Pending" ? "being processed" : "paid"}.` : c.open_cents <= 0 ? `${c.description} is already paid.` : `${c.description} changed while you were paying it. Check it and try again.` };
}

export type RecordPaymentInput = { chargeId: string; amountCents: number; method: "Check" | "Money order" | "Cash" | "ACH" | "Card"; reference: string; idempotencyKey: string };

// Staff records a payment received in the office (check, money order). It is deposited to trust
// at once (Cleared), with the management fee, and applied to the charge. Partial payments allowed.
export async function recordPayment(ctx: ActionContext, input: RecordPaymentInput): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const c = await chargeRow(db, ws, input.chargeId);
  if (!c) return { status: 404, error: "Charge not found" };
  if (!(input.amountCents > 0)) return { status: 400, error: "Amount must be more than $0" };
  const at = nowIso(nowMs);
  const id = uid("tr");
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'pmt:' || ?9, 'Rent', 'ba-' || ?4 || '-trust', ?4, 'household', c.household_id, ?5, 'trust', 'ba-' || ?4 || '-trust', 'Operating trust', ?6, c.property_id, c.id, 'Cleared', ?7, NULL, ?7
         FROM ${effective("charges")} AS c
         WHERE c.id = ?3 AND ?6 > 0 AND ?6 <= ${chargeOpenSql("c")}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'pmt:' || ?9)
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND key = 'rent:' || ?3 AND status = 'Pending')
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, c.id, c.owner_entity_id, c.household_name ?? "Resident", input.amountCents, at, null, input.idempotencyKey),
    db
      .prepare(
        `INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, transfer_id, method, reference, received_on, amount_cents, nsf)
         SELECT ?1, ?3, c.lease_id, c.household_id, c.property_id, c.id, ?2, ?5, ?6, ?7, ?8, 0 FROM ${effective("charges")} AS c
         WHERE c.id = ?4 AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?2)`,
      )
      .bind(ws, id, uid("pay"), c.id, input.method, input.reference, AS_OF, input.amountCents),
    chargeRefreshStmt(db, ws, c.id),
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?3, 'fee:' || id, 'Management fee', bank_account_id, owner_entity_id, 'trust', bank_account_id, 'Operating trust', 'pm', 'ba-mgmt', 'Summit Residential Partners (management fees)',
           CAST((amount_cents * ?4 + 50) / 100 AS INTEGER), property_id, id, 'Cleared', ?5, NULL, ?5
         FROM transfers WHERE workspace_id = ?1 AND id = ?2 AND CAST((amount_cents * ?4 + 50) / 100 AS INTEGER) > 0 ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, uid("tr"), FEE_PCT, at),
    eventStmt(db, ws, at, "payment.received", "charges", c.id, c.property_id, { transfer_id: id, amount_cents: input.amountCents, method: input.method }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Payment recorded", entityType: "charges", entityId: c.id, propertyId: c.property_id, detail: `${dollars(input.amountCents)} ${input.method} (${input.reference}) applied to ${c.description}` }, done(id)),
  ]);
  if (insert.meta.changes) return { status: 200, message: `Recorded ${dollars(input.amountCents)} against ${c.description}.` };
  if (await db.prepare("SELECT 1 FROM transfers WHERE workspace_id = ?1 AND key = ?2").bind(ws, `pmt:${input.idempotencyKey}`).first()) return { status: 200, message: "Already recorded." };
  return { status: 409, error: c.open_cents <= 0 ? `${c.description} is already paid.` : input.amountCents > c.open_cents ? `Only ${dollars(c.open_cents)} is open on ${c.description}.` : `${c.description} has a payment in progress. Try again shortly.` };
}

// Posts late fees on this month's unpaid rent past the grace period, capped by state rules.
// One fee per lease per month: the charge id lf-<lease>-<yyyymm> is the idempotency key.
export async function postLateFees(ctx: ActionContext, propertyIds: string[], period = CURRENT_PERIOD): Promise<Outcome & { posted?: number; remaining?: number }> {
  const { db, ws, nowMs, actor } = ctx;
  // Only properties in the actor's scope; the caller's list is never trusted on its own.
  const inScope = actor.propertyIds === "all" ? propertyIds : propertyIds.filter((id) => (actor.propertyIds as string[]).includes(id));
  if (!inScope.length) return { status: 403, error: "None of those properties are in your scope" };
  propertyIds = inScope;
  const props = JSON.stringify(propertyIds.slice(0, 50));
  const rules = (await db.prepare(`SELECT state, rule, value FROM ${effective("state_rules")} AS s WHERE s.effective_from <= ?2 ORDER BY s.effective_from`).bind(ws, AS_OF).all<{ state: string; rule: string; value: string }>()).results;
  const rule = (state: string, name: string) => rules.filter((r) => r.state === state && r.rule === name).at(-1)?.value;
  const policies = (await db.prepare(`SELECT * FROM ${effective("late_fee_policies")} AS l`).bind(ws).all<{ property_id: string | null; grace_days: number; kind: string; flat_cents: number; pct: number; daily_cents: number; max_cents: number | null }>()).results;
  const candidates = (
    await db
      .prepare(
        `SELECT c.id, c.lease_id, c.amount_cents, c.due_on, c.property_id, p.state, p.name AS property_name, ${chargeOpenSql("c")} AS open_cents
         FROM ${effective("charges")} AS c JOIN ${effective("properties")} AS p ON p.id = c.property_id
         WHERE c.period = ?2 AND c.gl_account_id IN ('gl-4000', 'gl-4010') AND c.property_id IN (SELECT value FROM json_each(?3))
           AND ${CHARGE_IS_OPEN("c")}
           AND NOT EXISTS (SELECT 1 FROM ${effective("charges")} AS x WHERE x.lease_id = c.lease_id AND x.gl_account_id = 'gl-4100' AND x.period = ?2)
         ORDER BY c.id LIMIT 900`,
      )
      .bind(ws, period, props)
      .all<{ id: string; lease_id: string; amount_cents: number; due_on: string; property_id: string; state: string; property_name: string; open_cents: number }>()
  ).results.filter((c) => c.open_cents > 0);
  const at = nowIso(nowMs);
  const today = Date.parse(`${AS_OF}T00:00:00Z`);
  const stmts: DbStatement[] = [];
  const posted: { id: string; amount: number }[] = [];
  for (const c of candidates) {
    const policy = policies.find((x) => x.property_id === c.property_id) ?? policies.find((x) => x.property_id === null);
    const grace = policy?.grace_days ?? Number(rule(c.state, "grace_days") ?? 3);
    const daysLate = Math.floor((today - Date.parse(`${c.due_on}T00:00:00Z`)) / 86_400_000) - grace;
    if (daysLate < 1) continue;
    let fee = !policy ? 5000 : policy.kind === "Percent" ? Math.floor((c.amount_cents * policy.pct + 50) / 100) : policy.kind === "Flat" ? policy.flat_cents : policy.flat_cents + policy.daily_cents * (daysLate - 1);
    if (policy?.max_cents != null) fee = Math.min(fee, policy.max_cents);
    const capPct = Number(rule(c.state, "late_fee_cap_pct"));
    if (capPct > 0) fee = Math.min(fee, Math.floor((c.amount_cents * capPct + 50) / 100));
    if (fee <= 0) continue;
    const feeId = `lf-${c.lease_id}-${period.replace("-", "")}`;
    posted.push({ id: feeId, amount: fee });
    stmts.push(
      db
        .prepare(
          `INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents)
           SELECT ?1, ?2, c.lease_id, c.household_id, c.property_id, c.unit_id, 'gl-4100', 'Late fee ' || ?4, ?4, ?5, ?6 FROM ${effective("charges")} AS c
           WHERE c.id = ?3 AND ${chargeOpenSql("c")} > 0
             AND NOT EXISTS (SELECT 1 FROM ${effective("charges")} AS x WHERE x.lease_id = c.lease_id AND x.gl_account_id = 'gl-4100' AND x.period = ?4)
           ON CONFLICT DO NOTHING`,
        )
        .bind(ws, feeId, c.id, period, AS_OF, fee),
    );
  }
  if (!stmts.length) return { status: 409, error: `No unpaid rent past its grace period without a ${period} late fee in the selected properties.` };
  // D1 counts every statement in a batch toward its per-request query limit: post at most 90.
  const remaining = Math.max(0, stmts.length - 90);
  stmts.splice(90);
  posted.splice(90);
  // Re-allocate each lease that got a fee (a credit balance on the lease pays it, oldest first).
  for (const leaseId of new Set(posted.map((x) => x.id.slice(3, x.id.lastIndexOf("-"))))) stmts.push(chargeRefreshStmt(db, ws, null, leaseId));
  const results = await db.batch(stmts);
  const n = results.slice(0, posted.length).reduce((s, r) => s + r.meta.changes, 0);
  if (!n) return { status: 409, error: `Late fees for ${period} are already posted.`, remaining };
  const total = posted.filter((_, i) => results[i].meta.changes).reduce((s, p) => s + p.amount, 0);
  await db.batch([
    eventStmt(db, ws, at, "charge.late_fees_posted", "properties", propertyIds[0], propertyIds.length === 1 ? propertyIds[0] : null, { count: n, total_cents: total, period, property_ids: propertyIds }),
    auditStmt(db, ws, at, actor, { action: "Late fees posted", entityType: "properties", entityId: propertyIds.join(","), detail: `${n} late fees, ${dollars(total)} total, for ${period} (capped by state rules)` }),
  ]);
  return { status: 200, message: `Posted ${n} late fees (${dollars(total)}).${remaining ? ` ${remaining} more to post: run it again.` : ""}`, posted: n, remaining };
}

// ---------------------------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------------------------

// Fraud hold: a vendor with an open unverified-bank-change issue can't be paid.
const NO_FRAUD_HOLD = (vendor: string) => `NOT EXISTS (SELECT 1 FROM ${effective("data_issues")} AS di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ${vendor} AND di.status = 'open')`;

// Maker-checker: whoever entered or submitted a bill (from the append-only audit log, as for bank
// changes) can't approve it. ?1 workspace, ?2 bill, ?3 approver.
const NOT_BILL_MAKER = `NOT EXISTS (SELECT 1 FROM audit AS mk WHERE mk.workspace_id IN ('base', ?1) AND mk.entity_type = 'bills' AND mk.entity_id = ?2 AND mk.action IN ('bills.created', 'bills.submit') AND mk.actor_id = ?3)`;

export async function approveBill(ctx: ActionContext, billId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const bill = await db.prepare(`SELECT * FROM ${effective("bills")} AS b WHERE b.id = ?2`).bind(ws, billId).first<{ id: string; status: string; amount_cents: number; property_id: string; vendor_id: string }>();
  if (!bill) return { status: 404, error: "Bill not found" };
  const denied = forbidden(actor, ["payables"], bill.property_id);
  if (denied) return denied;
  const maker = `You entered ${billId}, so someone else has to approve it.`;
  if (!(await db.prepare(`SELECT 1 AS ok WHERE ${NOT_BILL_MAKER}`).bind(ws, billId, actor.personaId).first())) return { status: 403, error: maker };
  const at = nowIso(nowMs);
  const [upsert] = await db.batch([
    db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Approved'", approved_by: "?3", approved_at: "?4" }, `e.status = 'Pending approval' AND ${NOT_BILL_MAKER}`)).bind(ws, billId, actor.personaId, at),
  ]);
  if (!upsert.meta.changes) {
    if (!(await db.prepare(`SELECT 1 AS ok WHERE ${NOT_BILL_MAKER}`).bind(ws, billId, actor.personaId).first())) return { status: 403, error: maker };
    return { status: 409, error: `${billId} is already ${bill.status.toLowerCase()}.` };
  }
  await db.batch([
    eventStmt(db, ws, at, "bill.approved", "bills", billId, bill.property_id, { amount_cents: bill.amount_cents, vendor_id: bill.vendor_id }),
    auditStmt(db, ws, at, actor, { action: "Bill approved", entityType: "bills", entityId: billId, propertyId: bill.property_id, detail: `${billId}: ${dollars(bill.amount_cents)}`, before: { status: bill.status }, after: { status: "Approved" } }),
  ]);
  return { status: 200, message: `${billId} approved.` };
}

// Pays an approved bill from the property's trust (key vendor:<bill>), refused when trust can't cover it.
export async function payBill(ctx: ActionContext, billId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const bill = await db
    .prepare(`SELECT b.*, v.company FROM ${effective("bills")} AS b JOIN ${effective("vendors")} AS v ON v.id = b.vendor_id WHERE b.id = ?2`)
    .bind(ws, billId)
    .first<{ id: string; status: string; amount_cents: number; property_id: string; vendor_id: string; owner_entity_id: string; company: string }>();
  if (!bill) return { status: 404, error: "Bill not found" };
  const denied = forbidden(actor, ["payables"], bill.property_id);
  if (denied) return denied;
  const at = nowIso(nowMs);
  const id = uid("tr");
  const trust = `'ba-' || b.owner_entity_id || '-trust'`;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'vendor:' || b.id, 'Vendor payout', ${trust}, b.owner_entity_id, 'trust', ${trust}, 'Operating trust', 'vendor', b.vendor_id, ?4, ?7, b.property_id, b.id, 'Pending', ?5, ?6, NULL
         FROM ${effective("bills")} AS b
         WHERE b.id = ?3 AND b.status IN ('Approved', 'Scheduled') AND b.amount_cents = ?7 AND b.amount_cents > 0 AND b.amount_cents <= ${AVAILABLE_SQL(trust)}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'vendor:' || ?3) AND ${NO_FRAUD_HOLD("b.vendor_id")}
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, billId, bill.company, at, nowMs + SETTLE_MS, bill.amount_cents),
    db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Scheduled'" }, "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)")).bind(ws, billId, id),
    eventStmt(db, ws, at, "payment.scheduled", "bills", billId, bill.property_id, { transfer_id: id, amount_cents: bill.amount_cents, vendor_id: bill.vendor_id }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Bill paid", entityType: "bills", entityId: billId, propertyId: bill.property_id, detail: `${billId}: ${dollars(bill.amount_cents)} to ${bill.company} by ACH` }, done(id)),
  ]);
  if (insert.meta.changes) {
    settleDueBy(db, ws, nowMs + SETTLE_MS);
    return { status: 200, message: `${dollars(bill.amount_cents)} to ${bill.company} is on its way.` };
  }
  if (await transferAt(db, ws, `vendor:${billId}`)) return { status: 409, error: `${billId} is already paid.` };
  if (!["Approved", "Scheduled"].includes(bill.status)) return { status: 409, error: `Only approved bills can be paid (this one is ${bill.status.toLowerCase()}).` };
  const hold = await db.prepare(`SELECT 1 FROM ${effective("data_issues")} AS di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ?2 AND di.status = 'open'`).bind(ws, bill.vendor_id).first();
  if (hold) return { status: 409, error: `${bill.company} changed bank details and isn't verified yet. Payments are on hold.` };
  const current = await db.prepare(`SELECT b.amount_cents FROM ${effective("bills")} AS b WHERE b.id = ?2`).bind(ws, billId).first<{ amount_cents: number }>();
  if (current && current.amount_cents !== bill.amount_cents) return { status: 409, error: `${billId} changed to ${dollars(current.amount_cents)} while you were paying it. Check it and try again.` };
  const avail = await db.prepare(`SELECT ${AVAILABLE_SQL("?2")} AS a`).bind(ws, `ba-${bill.owner_entity_id}-trust`).first<{ a: number }>();
  return { status: 409, error: `Trust account can't cover ${dollars(bill.amount_cents)} (available ${dollars(avail?.a ?? 0)})` };
}

// The payee a work order's money may go to: the vendor named on its latest invoice (or, for an
// older vendor-entered invoice without the field, the vendor who sent it), else the vendor its
// latest dispatch named. NULL when none is known, which refuses the payment.
const INVOICED_VENDOR = (wo: string) => `coalesce(
  (SELECT coalesce(json_extract(s.detail, '$.vendor_id'), CASE WHEN s.actor_kind = 'vendor' THEN s.actor_id END) FROM ${effective("wo_events")} AS s WHERE s.work_order_id = ${wo} AND s.kind = 'Submission' ORDER BY s.at DESC, s.seq DESC LIMIT 1),
  (SELECT json_extract(a.detail, '$.vendor_id') FROM ${effective("wo_events")} AS a WHERE a.work_order_id = ${wo} AND a.kind = 'Assigned' ORDER BY a.at DESC, a.seq DESC LIMIT 1))`;

// Approves submitted work. Vendor jobs pay out from trust (key vendor:<wo>), within the owner's
// approval limit; in-house jobs just complete.
export async function approveAndPayWorkOrder(ctx: ActionContext, woId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const wo = await db
    .prepare(
      `SELECT w.*, p.owner_entity_id, v.company,
         (SELECT e.id FROM ${effective("wo_events")} AS e WHERE e.work_order_id = w.id AND e.kind = 'Submission' ORDER BY e.at DESC, e.seq DESC LIMIT 1) AS latest_submission,
         (SELECT e.id FROM ${effective("wo_events")} AS e WHERE e.work_order_id = w.id AND e.kind = 'Submission' AND json_array_length(json_extract(e.detail, '$.lines')) > 0 ORDER BY e.at DESC, e.seq DESC LIMIT 1) AS itemised_submission,
         (SELECT json_extract(e.detail, '$.total_cents') FROM ${effective("wo_events")} AS e WHERE e.work_order_id = w.id AND e.kind = 'Submission' AND json_array_length(json_extract(e.detail, '$.lines')) > 0 ORDER BY e.at DESC, e.seq DESC LIMIT 1) AS invoice_cents,
         ${INVOICED_VENDOR("w.id")} AS invoiced_vendor,
         (SELECT CASE WHEN e.actor_kind = 'staff' THEN e.actor_id END FROM ${effective("wo_events")} AS e WHERE e.work_order_id = w.id AND e.kind = 'Submission' ORDER BY e.at DESC, e.seq DESC LIMIT 1) AS entered_by
       FROM ${effective("work_orders")} AS w JOIN ${effective("properties")} AS p ON p.id = w.property_id LEFT JOIN ${effective("vendors")} AS v ON v.id = w.vendor_id
       WHERE w.id = ?2`,
    )
    .bind(ws, woId)
    .first<{ id: string; status: string; vendor_id: string | null; company: string | null; cost_cents: number | null; latest_submission: string | null; itemised_submission: string | null; invoice_cents: number | null; invoiced_vendor: string | null; entered_by: string | null; property_id: string; owner_entity_id: string; title: string }>();
  if (!wo) return { status: 404, error: "Work order not found" };
  // Maintenance approvers sign off the work, payables approvers pay it, owners approve over-limit
  // repairs from their portal.
  const denied = forbidden(actor, ["maintenance", "payables"], wo.property_id, ["owner"]);
  if (denied) return denied;
  const at = nowIso(nowMs);
  const notSubmitted = `Only submitted work can be approved (this one is ${wo.status.toLowerCase()})`;
  if (!wo.vendor_id) {
    const [r] = await db.batch([db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "'Completed'", completed_at: "?3" }, "e.status = 'Submitted'")).bind(ws, woId, at)]);
    if (!r.meta.changes) return { status: 409, error: notSubmitted };
    await auditStmt(db, ws, at, actor, { action: "Job completed", entityType: "work_orders", entityId: woId, propertyId: wo.property_id, detail: `${woId} completed in-house` }).run();
    return { status: 200, message: `${woId} completed.` };
  }
  // Pay one canonical invoice: the latest itemised submission (or, with none submitted, a cost staff
  // recorded). Never the estimate, which the vendor can edit. A newer submission without line items
  // makes it ambiguous which invoice is meant, so that is refused.
  if (wo.latest_submission && wo.latest_submission !== wo.itemised_submission)
    return { status: 409, error: `${woId} has a newer invoice without line items. Ask ${wo.company} to resubmit it itemised.` };
  const amount = wo.itemised_submission ? wo.invoice_cents : wo.cost_cents;
  if (amount == null) return { status: 409, error: `${woId} has no invoice yet. Ask ${wo.company} to submit one.` };
  // Maker-checker: an invoice staff entered by hand is approved by someone else. Vendor-submitted
  // invoices have no staff maker. The insert below re-checks it in SQL.
  if (wo.entered_by && wo.entered_by === actor.personaId) return { status: 403, error: `You entered the invoice on ${woId}, so someone else has to approve it.` };
  if (wo.invoiced_vendor !== wo.vendor_id) return { status: 409, error: `The vendor on ${woId} isn't the one who invoiced it. Ask the invoicing vendor to resubmit, or dispatch the job again.` };
  const policy = await db
    .prepare(`SELECT owner_approval_over_cents FROM ${effective("approval_policies")} AS a WHERE a.category = 'Maintenance spend' AND (a.owner_entity_id = ?2 OR a.owner_entity_id IS NULL) ORDER BY a.owner_entity_id IS NULL LIMIT 1`)
    .bind(ws, wo.owner_entity_id)
    .first<{ owner_approval_over_cents: number | null }>();
  // Over the owner's limit, staff may pay only after the owner approved at least this amount in
  // their portal (a wo_events Approval by the owner). The insert below re-checks it in SQL.
  const ownerLimit = policy?.owner_approval_over_cents ?? null;
  const OWNER_OK = `(?10 IS NULL OR ?7 <= ?10 OR ?11 = 'owner' OR EXISTS (SELECT 1 FROM ${effective("wo_events")} AS oa WHERE oa.work_order_id = ?3 AND oa.kind = 'Approval' AND oa.actor_kind = 'owner'
    AND json_extract(oa.detail, '$.decision') = 'Approved' AND json_extract(oa.detail, '$.amount_cents') >= ?7))`;
  if (ownerLimit != null && amount > ownerLimit && actor.role !== "owner") {
    const approved = await db.prepare(`SELECT 1 FROM ${effective("wo_events")} AS oa WHERE oa.work_order_id = ?2 AND oa.kind = 'Approval' AND oa.actor_kind = 'owner' AND json_extract(oa.detail, '$.decision') = 'Approved' AND json_extract(oa.detail, '$.amount_cents') >= ?3`).bind(ws, woId, amount).first();
    if (!approved) return { status: 409, error: `${dollars(amount)} is over the owner's approval limit of ${dollars(ownerLimit)}. Send it to the owner to approve.` };
  }
  const id = uid("tr");
  const trust = `ba-${wo.owner_entity_id}-trust`;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'vendor:' || w.id, 'Vendor payout', ?4, ?5, 'trust', ?4, 'Operating trust', 'vendor', w.vendor_id, ?6, ?7, w.property_id, w.id, 'Pending', ?8, ?9, NULL
         FROM ${effective("work_orders")} AS w
         WHERE w.id = ?3 AND w.status = 'Submitted' AND ?7 > 0 AND ?7 <= ${AVAILABLE_SQL("?4")}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'vendor:' || ?3) AND ${NO_FRAUD_HOLD("w.vendor_id")} AND ${OWNER_OK}
           AND coalesce((SELECT e.id FROM ${effective("wo_events")} AS e WHERE e.work_order_id = w.id AND e.kind = 'Submission' ORDER BY e.at DESC, e.seq DESC LIMIT 1), '') = ?12
           AND (?12 <> '' OR w.cost_cents = ?7) AND w.vendor_id = ${INVOICED_VENDOR("w.id")}
           AND NOT EXISTS (SELECT 1 FROM ${effective("wo_events")} AS mk WHERE mk.id = ?12 AND mk.work_order_id = w.id AND mk.actor_kind = 'staff' AND mk.actor_id = ?13)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, woId, trust, wo.owner_entity_id, wo.company, amount, at, nowMs + SETTLE_MS, ownerLimit, actor.role, wo.latest_submission ?? "", actor.personaId),
    db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "'Completed'", cost_cents: "?4", completed_at: "?5" }, "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)")).bind(ws, woId, id, amount, at),
    db
      .prepare(`INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail) SELECT ?1, ?2, ?3, ?4, ?5, 'staff', ?6, 'Approval', 'Completed', ?7 WHERE EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?8)`)
      .bind(ws, uid("woe"), woId, wo.property_id, at, actor.personaId, JSON.stringify({ amount_cents: amount, transfer_id: id }), id),
    eventStmt(db, ws, at, "wo.approved", "work_orders", woId, wo.property_id, { transfer_id: id, amount_cents: amount, vendor_id: wo.vendor_id }, done(id)),
    notifyStmt(db, ws, at, wo.vendor_id, "Work approved", `${woId} approved. ${dollars(amount)} sent by ACH, arriving in 1–2 business days.`, "/portal/vendor/payments", ["work_orders", woId], done(id)),
    auditStmt(db, ws, at, actor, { action: "Payment approved", entityType: "work_orders", entityId: woId, propertyId: wo.property_id, detail: `${woId}: ${dollars(amount)} to ${wo.company} by ACH` }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Approval refused", entityType: "work_orders", entityId: woId, propertyId: wo.property_id, detail: `${woId}: not paid (status, trust balance or payment hold)` }, refused(id)),
  ]);
  if (insert.meta.changes) {
    settleDueBy(db, ws, nowMs + SETTLE_MS);
    return { status: 200, message: `${woId} approved; ${dollars(amount)} is on its way to ${wo.company}.` };
  }
  // A double click's losing request saw the job as Submitted; report what actually happened.
  if (await transferAt(db, ws, `vendor:${woId}`)) return { status: 409, error: `${woId} is already approved` };
  if (wo.status !== "Submitted") return { status: 409, error: notSubmitted };
  const now = await db.prepare(`SELECT coalesce((SELECT e.id FROM ${effective("wo_events")} AS e WHERE e.work_order_id = ?2 AND e.kind = 'Submission' ORDER BY e.at DESC, e.seq DESC LIMIT 1), '') AS s`).bind(ws, woId).first<{ s: string }>();
  if ((now?.s ?? "") !== (wo.latest_submission ?? "")) return { status: 409, error: `${wo.company} sent a new invoice for ${woId} while you were approving. Check it and try again.` };
  const avail = await db.prepare(`SELECT ${AVAILABLE_SQL("?2")} AS a`).bind(ws, trust).first<{ a: number }>();
  if ((avail?.a ?? 0) < amount) return { status: 409, error: `Trust account can't cover ${dollars(amount)} (available ${dollars(avail?.a ?? 0)})` };
  return { status: 409, error: `${wo.company} has a payment hold (unverified bank change).` };
}

// ---------------------------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------------------------

// Pays the owner entity its open statement balance (period cutoff: everything after its last
// payout). The client's Idempotency-Key is the transfer key, so a retry finds the first payout.
export async function distributeOwner(ctx: ActionContext, ownerEntityId: string, idempotencyKey: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const oe = await db
    .prepare(`SELECT e.id, e.name, e.owner_id, o.name AS owner_name, (SELECT min(id) FROM ${effective("properties")} AS p WHERE p.owner_entity_id = e.id) AS property_id FROM ${effective("owner_entities")} AS e JOIN ${effective("owners")} AS o ON o.id = e.owner_id WHERE e.id = ?2`)
    .bind(ws, ownerEntityId)
    .first<{ id: string; name: string; owner_id: string; owner_name: string; property_id: string }>();
  if (!oe) return { status: 404, error: "Owner entity not found" };
  const denied = forbidden(actor, ["owners"], null);
  if (denied) return denied;
  const st = await ownerStatement({ db, ws }, ownerEntityId);
  const at = nowIso(nowMs);
  const id = uid("tr");
  const trust = `ba-${ownerEntityId}-trust`;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'owner:' || ?3, 'Owner payout', ?4, ?5, 'trust', ?4, 'Operating trust', 'owner', ?6, ?7, ?8, ?9, 'Statement ' || ?10, 'Pending', ?11, ?12, NULL
         WHERE ?8 > 0 AND ?8 = ${OPEN_NET_SQL("?5")} AND ?8 <= ${AVAILABLE_SQL("?4")}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'owner:' || ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, idempotencyKey, trust, ownerEntityId, oe.owner_id, oe.owner_name, st.net_cents, oe.property_id, CURRENT_PERIOD, at, nowMs + SETTLE_MS),
    db
      .prepare(`INSERT INTO owner_distributions (workspace_id, id, owner_entity_id, transfer_id, period, income_cents, expense_cents, fee_cents, reserve_cents, amount_cents, paid_on) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10 WHERE EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?4)`)
      .bind(ws, uid("od"), ownerEntityId, id, CURRENT_PERIOD, st.income_cents, st.expense_cents, st.fee_cents, st.net_cents, AS_OF),
    eventStmt(db, ws, at, "owner.distribution_sent", "owner_entities", ownerEntityId, null, { transfer_id: id, amount_cents: st.net_cents }, done(id)),
    notifyStmt(db, ws, at, oe.owner_id, "Distribution on its way", `Your distribution of ${dollars(st.net_cents)} from ${oe.name} is on its way by ACH.`, "/portal/owner/statements", ["owner_entities", ownerEntityId], done(id)),
    auditStmt(db, ws, at, actor, { action: "Owner distribution", entityType: "owner_entities", entityId: ownerEntityId, detail: `${dollars(st.net_cents)} to ${oe.owner_name} (${oe.name}) from the operating trust` }, done(id)),
  ]);
  if (insert.meta.changes) {
    settleDueBy(db, ws, nowMs + SETTLE_MS);
    return { status: 200, message: `${dollars(st.net_cents)} is on its way to ${oe.owner_name}.` };
  }
  if (await db.prepare("SELECT 1 FROM transfers WHERE workspace_id = ?1 AND key = ?2").bind(ws, `owner:${idempotencyKey}`).first()) return { status: 200, message: "Already sent." };
  const avail = await db.prepare(`SELECT ${AVAILABLE_SQL("?2")} AS a`).bind(ws, trust).first<{ a: number }>();
  return {
    status: 409,
    error: st.net_cents <= 0 ? `Nothing is owed to ${oe.owner_name} right now.` : st.net_cents > (avail?.a ?? 0) ? `Trust account can't cover ${dollars(st.net_cents)} (available ${dollars(avail?.a ?? 0)})` : `${oe.name}'s statement changed while you were paying it. Check it and try again.`,
  };
}

// Pays an owner a small correction to a closed statement, e.g. the cent a rounding error left in
// trust (data issue owner_distributions.rounding_cent). The amount must equal what the statement
// still owes: net − distribution − reserve − corrections already paid. Its key owner-adj:<dist>
// makes it one payment per statement, and the period cutoff ignores it, so the open statement
// isn't closed early. Trust drops by exactly the amount, which was being held there.
const ISSUE_COLS = ["id", "deleted", "rule_id", "entity_type", "entity_id", "property_id", "detected_at", "severity", "evidence", "suggested_fix", "status", "fixed_by", "fixed_at"];
export async function payOwnerAdjustment(ctx: ActionContext, distributionId: string, amountCents: number, issueId?: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const d = await db
    .prepare(
      `SELECT d.*, e.owner_id, o.name AS owner_name, e.name AS entity_name,
         d.income_cents - d.expense_cents - d.fee_cents - d.amount_cents - d.reserve_cents AS owed_cents
       FROM ${effective("owner_distributions")} AS d JOIN ${effective("owner_entities")} AS e ON e.id = d.owner_entity_id JOIN ${effective("owners")} AS o ON o.id = e.owner_id
       WHERE d.id = ?2`,
    )
    .bind(ws, distributionId)
    .first<{ id: string; owner_entity_id: string; owner_id: string; owner_name: string; entity_name: string; period: string; owed_cents: number }>();
  if (!d) return { status: 404, error: "Statement not found" };
  const denied = forbidden(actor, ["owners"], null);
  if (denied) return denied;
  if (!(amountCents > 0)) return { status: 400, error: "Amount must be more than $0" };
  const at = nowIso(nowMs);
  const id = uid("tr");
  const trust = `ba-${d.owner_entity_id}-trust`;
  const key = `owner-adj:${d.id}`;
  const statementOwed = `(SELECT d.income_cents - d.expense_cents - d.fee_cents - d.amount_cents - d.reserve_cents FROM ${effective("owner_distributions")} AS d WHERE d.id = ?3)`;
  const steps: DbStatement[] = [
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, ?4, 'Owner payout', ?5, ?6, 'trust', ?5, 'Operating trust', 'owner', ?7, ?8, ?9, (SELECT min(p.id) FROM ${effective("properties")} AS p WHERE p.owner_entity_id = ?6), 'Statement ' || ?10 || ' correction', 'Pending', ?11, ?12, NULL
         WHERE ?9 > 0 AND ?9 = ${statementOwed} AND ?9 <= ${AVAILABLE_SQL("?5")}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = ?4)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, d.id, key, trust, d.owner_entity_id, d.owner_id, d.owner_name, amountCents, d.period, at, nowMs + SETTLE_MS),
    eventStmt(db, ws, at, "owner.adjustment_sent", "owner_distributions", d.id, null, { transfer_id: id, amount_cents: amountCents }, done(id)),
    notifyStmt(db, ws, at, d.owner_id, "Statement correction", `A correction of ${dollars(amountCents)} to your ${d.period} statement for ${d.entity_name} is on its way.`, "/portal/owner/statements", ["owner_distributions", d.id], done(id)),
    auditStmt(db, ws, at, actor, { action: "Owner statement correction paid", entityType: "owner_distributions", entityId: d.id, detail: `${dollars(amountCents)} to ${d.owner_name} for the ${d.period} statement (${d.entity_name})`, before: { owed_cents: d.owed_cents }, after: { owed_cents: 0 } }, done(id)),
  ];
  if (issueId)
    steps.push(
      db.prepare(overlayUpsertSql("data_issues", ISSUE_COLS, { status: "'fixed'", fixed_by: "?4", fixed_at: "?5" }, "e.status = 'open' AND e.rule_id = 'owner_distributions.rounding_cent' AND e.entity_id = ?6 AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)")).bind(ws, issueId, id, actor.personaId, at, d.id),
    );
  const [insert] = await db.batch(steps);
  if (insert.meta.changes) {
    settleDueBy(db, ws, nowMs + SETTLE_MS);
    return { status: 200, message: `${dollars(amountCents)} correction is on its way to ${d.owner_name}.` };
  }
  if (await transferAt(db, ws, key)) return { status: 409, error: `The ${d.period} statement correction is already paid.` };
  return { status: 409, error: d.owed_cents <= 0 ? `The ${d.period} statement doesn't owe anything.` : `The ${d.period} statement owes ${dollars(d.owed_cents)}, not ${dollars(amountCents)}.` };
}

// Application fee. Policy: the fee is the owner's income (management agreement), so it goes into
// the property's operating trust as an Other receipt, by card, settling like rent. One fee per
// application (key appfee:<application>), guarded on fee_paid = 0 in the same statement.
export const APPLICATION_FEE_CENTS = 5_500;
const APPLICATION_COLS = ["id", "deleted", "property_id", "unit_id", "listing_id", "applicant_id", "co_applicants", "stage", "desired_move_in", "rent_cents", "income_to_rent", "score", "scoring_factors", "recommendation", "decided_by", "decided_at", "fee_paid", "submitted_at"];
export async function payApplicationFee(ctx: ActionContext, applicationId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const a = await db
    .prepare(
      `SELECT a.*, p.owner_entity_id, p.name AS property_name, ap.first_name || ' ' || ap.last_name AS applicant_name
       FROM ${effective("applications")} AS a JOIN ${effective("properties")} AS p ON p.id = a.property_id JOIN ${effective("applicants")} AS ap ON ap.id = a.applicant_id
       WHERE a.id = ?2`,
    )
    .bind(ws, applicationId)
    .first<{ id: string; applicant_id: string; property_id: string; owner_entity_id: string; property_name: string; applicant_name: string; fee_paid: number; stage: string }>();
  if (!a) return { status: 404, error: "Application not found" };
  // Applicants pay only their own application; staff only within their properties.
  if (actor.role === "applicant") {
    if (getPersona(actor.personaId)?.record?.id !== a.applicant_id) return { status: 404, error: "Application not found" };
  } else {
    const denied = forbidden(actor, ["leasing"], a.property_id) && forbidden(actor, ["receivables"], a.property_id);
    if (denied) return denied;
  }
  const at = nowIso(nowMs);
  const id = uid("tr");
  const trust = `ba-${a.owner_entity_id}-trust`;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'appfee:' || a.id, 'Other receipt', ?4, ?5, 'applicant', a.applicant_id, ?6, 'trust', ?4, 'Operating trust', ?7, a.property_id, a.id, 'Pending', ?8, ?9, NULL
         FROM ${effective("applications")} AS a
         WHERE a.id = ?3 AND a.fee_paid = 0 AND a.stage NOT IN ('Denied', 'Withdrawn', 'Leased')
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'appfee:' || ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, a.id, trust, a.owner_entity_id, a.applicant_name, APPLICATION_FEE_CENTS, at, nowMs + SETTLE_MS),
    db.prepare(overlayUpsertSql("applications", APPLICATION_COLS, { fee_paid: "1" }, "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)")).bind(ws, a.id, id),
    eventStmt(db, ws, at, "application.fee_paid", "applications", a.id, a.property_id, { transfer_id: id, amount_cents: APPLICATION_FEE_CENTS }, done(id)),
    notifyStmt(db, ws, at, a.applicant_id, "Application fee received", `We received your ${dollars(APPLICATION_FEE_CENTS)} application fee for ${a.property_name}.`, "/portal/applicant", ["applications", a.id], done(id)),
    auditStmt(db, ws, at, actor, { action: "Application fee paid", entityType: "applications", entityId: a.id, propertyId: a.property_id, detail: `${dollars(APPLICATION_FEE_CENTS)} from ${a.applicant_name} into the operating trust` }, done(id)),
  ]);
  if (insert.meta.changes) {
    settleDueBy(db, ws, nowMs + SETTLE_MS);
    return { status: 200, message: `${dollars(APPLICATION_FEE_CENTS)} application fee paid.` };
  }
  if (a.fee_paid || (await transferAt(db, ws, `appfee:${a.id}`))) return { status: 409, error: "The application fee is already paid." };
  return { status: 409, error: `This application is ${a.stage.toLowerCase()}; no fee is due.` };
}

// ---------------------------------------------------------------------------------------------
// Deposits and payment corrections (moved from the receivables lane; same guarded-batch rules)
// ---------------------------------------------------------------------------------------------

const DEPOSIT_COLS = ["id", "deleted", "lease_id", "property_id", "bank_account_id", "amount_cents", "received_on", "status"];
const PAYMENT_COLS = ["id", "deleted", "lease_id", "household_id", "property_id", "charge_id", "transfer_id", "method", "reference", "received_on", "amount_cents", "nsf"];
export type DispositionLine = { label: string; amount_cents: number; charge_id?: string };

type DepositRow = { id: string; lease_id: string; property_id: string; bank_account_id: string; amount_cents: number; status: string; owner_entity_id: string; state: string; household_id: string; household_name: string; move_out_on: string | null; due_on: string | null };

export async function depositRow(ctx: Pick<ActionContext, "db" | "ws">, depositId: string) {
  return ctx.db
    .prepare(
      `SELECT d.*, p.owner_entity_id, p.state, l.household_id, h.name AS household_name, l.move_out_on,
         (SELECT x.due_on FROM ${effective("deposit_dispositions")} AS x WHERE x.deposit_id = d.id) AS due_on
       FROM ${effective("deposits")} AS d JOIN ${effective("leases")} AS l ON l.id = d.lease_id JOIN ${effective("properties")} AS p ON p.id = d.property_id
       LEFT JOIN ${effective("households")} AS h ON h.id = l.household_id WHERE d.id = ?2`,
    )
    .bind(ctx.ws, depositId)
    .first<DepositRow>();
}

// Move-out disposition: deductions are applied to the lease's open charges (new damage lines become
// a move-out charge first), the rest is refunded. Mirrors the seed: depapply:<lease> moves the
// deductions from the deposit account to trust (depreceipt:<lease>), refund:<lease> pays the resident.
export async function disposeDeposit(ctx: ActionContext, depositId: string, lines: DispositionLine[]): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const d = await depositRow(ctx, depositId);
  if (!d) return { status: 404, error: "Deposit not found" };
  if (d.status === "Settled") return { status: 409, error: "This deposit is already settled." };
  if (!d.move_out_on || d.move_out_on > AS_OF) return { status: 409, error: "The resident hasn't moved out yet. Dispositions are sent after move-out." };
  if (lines.some((l) => !(l.amount_cents > 0) || !Number.isInteger(l.amount_cents))) return { status: 400, error: "Each deduction needs an amount above $0." };
  const applied = lines.reduce((s, l) => s + l.amount_cents, 0);
  if (applied > d.amount_cents) return { status: 400, error: `Deductions (${dollars(applied)}) are more than the ${dollars(d.amount_cents)} deposit.` };
  const refund = d.amount_cents - applied;
  const trust = `ba-${d.owner_entity_id}-trust`;
  const at = nowIso(nowMs);
  const gateId = uid("tr");
  const gateKey = applied > 0 ? `depapply:${d.lease_id}` : `refund:${d.lease_id}`;
  let n = 0;
  const withIds = lines.map((l) => ({ ...l, id: l.charge_id ?? `mo-${d.lease_id}-${++n}`, damage: !l.charge_id }));
  const existing = withIds.filter((l) => !l.damage).map((l) => ({ id: l.id, amount: l.amount_cents }));
  // Each existing charge once, and only this lease's charges: an unknown id would leave a credit
  // waiting for a charge created later (a late fee or next month's rent) under that id.
  if (new Set(existing.map((e) => e.id)).size !== existing.length) return { status: 400, error: "Each charge can appear only once in a disposition." };
  if (existing.length) {
    const found = await db.prepare(`SELECT count(*) AS n FROM ${effective("charges")} AS c WHERE c.lease_id = ?2 AND c.id IN (SELECT value FROM json_each(?3))`).bind(ws, d.lease_id, JSON.stringify(existing.map((e) => e.id))).first<{ n: number }>();
    if (Number(found?.n ?? 0) !== existing.length) return { status: 400, error: "A deduction points at a charge that isn't on this lease." };
  }
  const damages = withIds.filter((l) => l.damage);
  const toResident = [d.household_id, d.household_name ?? "Resident"];

  // The gate: the deposit is unsettled, the deposit account holds it, nothing was disposed under this
  // lease in the base, and every deduction against an existing charge fits its open balance.
  const gate = db
    .prepare(
      `INSERT INTO transfers (${TRANSFER_COLS})
       SELECT ?1, ?2, ?3, 'Deposit refund', ?4, ?5, 'deposit', ?4, 'Security deposit account', ?6, ?7, ?8, ?9, ?10, ?11, 'Cleared', ?12, NULL, ?12
       FROM ${effective("deposits")} AS d
       WHERE d.id = ?13 AND d.status <> 'Settled' AND d.amount_cents = ?14 AND d.amount_cents <= ${AVAILABLE_SQL("?4")}
         AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key IN ('depapply:' || d.lease_id, 'refund:' || d.lease_id))
         AND (SELECT count(DISTINCT c.id) FROM json_each(?15) AS j JOIN ${effective("charges")} AS c ON c.id = json_extract(j.value, '$.id') AND c.lease_id = d.lease_id) = json_array_length(?15)
         AND (SELECT count(DISTINCT json_extract(j.value, '$.id')) FROM json_each(?15) AS j) = json_array_length(?15)
         AND NOT EXISTS (SELECT 1 FROM json_each(?15) AS j JOIN ${effective("charges")} AS c ON c.id = json_extract(j.value, '$.id')
                         WHERE json_extract(j.value, '$.amount') > ${chargeOpenSql("c")})
       ON CONFLICT DO NOTHING`,
    )
    .bind(ws, gateId, gateKey, d.bank_account_id, d.owner_entity_id, applied > 0 ? "trust" : "resident", applied > 0 ? trust : toResident[0], applied > 0 ? "Operating trust" : toResident[1],
      applied > 0 ? applied : refund, d.property_id, `${applied > 0 ? "Deposit applied" : "Deposit refund"} ${d.lease_id}`, at, d.id, applied + refund, JSON.stringify(existing));
  const ok = done(gateId);
  const gated = `EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?2)`;
  const transfer = (key: string, kind: string, account: string, toKind: string, toId: string, toName: string, cents: number, ref: string) =>
    db
      .prepare(`INSERT INTO transfers (${TRANSFER_COLS}) SELECT ?1, ?3, ?4, ?5, ?6, ?7, 'deposit', ?8, 'Security deposit account', ?9, ?10, ?11, ?12, ?13, ?14, 'Cleared', ?15, NULL, ?15 WHERE ${gated} ON CONFLICT DO NOTHING`)
      .bind(ws, gateId, uid("tr"), key, kind, account, d.owner_entity_id, d.bank_account_id, toKind, toId, toName, cents, d.property_id, ref, at);

  const steps: DbStatement[] = [gate];
  if (applied > 0) {
    steps.push(transfer(`depreceipt:${d.lease_id}`, "Other receipt", trust, "trust", trust, "Operating trust", applied, `Deposit applied ${d.lease_id}`));
    if (refund > 0) steps.push(transfer(`refund:${d.lease_id}`, "Deposit refund", d.bank_account_id, "resident", toResident[0], toResident[1], refund, `Deposit refund ${d.lease_id}`));
  }
  for (const dm of damages) {
    steps.push(
      db
        .prepare(
          `INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents)
           SELECT ?1, ?3, l.id, l.household_id, l.property_id, l.unit_id, 'gl-6050', ?4, substr(?5, 1, 7), ?5, ?6 FROM ${effective("leases")} AS l WHERE l.id = ?7 AND ${gated}
           ON CONFLICT DO NOTHING`,
        )
        .bind(ws, gateId, dm.id, `Move-out: ${dm.label}`, AS_OF, dm.amount_cents, d.lease_id),
    );
  }
  for (const c of [...existing, ...damages.map((dm) => ({ id: dm.id, amount: dm.amount_cents }))]) {
    steps.push(
      db
        .prepare(`INSERT INTO credits (workspace_id, id, lease_id, property_id, charge_id, kind, description, on_date, amount_cents, approved_by) SELECT ?1, ?3, ?4, ?5, ?6, 'Credit', 'Security deposit applied', ?7, ?8, ?9 WHERE ${gated}`)
        .bind(ws, gateId, uid("cr"), d.lease_id, d.property_id, c.id, AS_OF, c.amount, actor.personaId),
    );
  }
  for (const c of [...existing.map((e) => e.id), ...damages.map((dm) => dm.id)]) steps.push(chargeRefreshStmt(db, ws, c));
  const deductions = withIds.map((l) => ({ label: l.label, amount_cents: l.amount_cents, charge_id: l.id, photo: null }));
  steps.push(
    db.prepare(overlayUpsertSql("deposits", DEPOSIT_COLS, { status: "'Settled'" }, `EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)`)).bind(ws, d.id, gateId),
    db
      .prepare(
        `INSERT INTO deposit_dispositions (workspace_id, id, deposit_id, property_id, deductions, refund_cents, due_on, sent_on, status) SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Sent' WHERE ${gated}
         ON CONFLICT (workspace_id, id) DO UPDATE SET deductions = excluded.deductions, refund_cents = excluded.refund_cents, sent_on = excluded.sent_on, status = 'Sent'`,
      )
      .bind(ws, gateId, `dd-${d.lease_id}`, d.id, d.property_id, JSON.stringify(deductions), refund, d.due_on ?? AS_OF, AS_OF),
    eventStmt(db, ws, at, "deposit.disposed", "deposits", d.id, d.property_id, { applied_cents: applied, refund_cents: refund }, ok),
    auditStmt(db, ws, at, actor, { action: "Deposit disposition sent", entityType: "deposits", entityId: d.id, propertyId: d.property_id, detail: `${dollars(d.amount_cents)} deposit: ${dollars(applied)} applied to charges, ${dollars(refund)} refunded to ${d.household_name}`, after: { deductions, refund_cents: refund } }, ok),
  );
  const [first] = await db.batch(steps);
  if (first.meta.changes) return { status: 200, message: `Disposition sent: ${dollars(applied)} applied, ${dollars(refund)} refunded.` };
  const again = await db.prepare("SELECT 1 FROM transfers WHERE workspace_id IN ('base', ?1) AND key IN (?2, ?3)").bind(ws, `depapply:${d.lease_id}`, `refund:${d.lease_id}`).first();
  if (again) return { status: 409, error: "This deposit's disposition was already sent." };
  return { status: 409, error: "A deduction is more than what's open on its charge. Refresh and check the amounts." };
}

// Data Health fix for payments.wrong_lease: the payment is re-pointed at the charge it was meant for
// on the neighbouring lease (often it already names that charge and only its lease is wrong). No money moves (same property, same trust deposit); the ledger rows
// move, so it is guarded on the payment's current lease and on the target charge's open balance.
export async function movePayment(ctx: ActionContext, paymentId: string, toChargeId: string, issueId?: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const p = await db.prepare(`SELECT * FROM ${effective("payments")} AS p WHERE p.id = ?2`).bind(ws, paymentId).first<{ id: string; lease_id: string; charge_id: string | null; household_id: string; property_id: string; amount_cents: number; nsf: number }>();
  if (!p) return { status: 404, error: "Payment not found" };
  const c = await db.prepare(`SELECT c.*, ${chargeOpenSql("c")} AS open_cents FROM ${effective("charges")} AS c WHERE c.id = ?2`).bind(ws, toChargeId).first<{ id: string; lease_id: string; household_id: string; property_id: string; description: string; open_cents: number }>();
  if (!c) return { status: 404, error: "Target charge not found" };
  if (c.property_id !== p.property_id) return { status: 400, error: "A payment can only move to a lease at the same property." };
  if (c.lease_id === p.lease_id) return { status: 409, error: "The payment is already on that lease." };
  // Only this payment's own wrong-lease issue can be closed here. Other issues (a vendor bank-change
  // fraud hold above all) have their own guarded flows; closing one from here would lift the hold.
  if (issueId) {
    const own = await db.prepare(`SELECT 1 FROM ${effective("data_issues")} AS i WHERE i.id = ?2 AND i.rule_id = 'payments.wrong_lease' AND i.entity_type = 'payments' AND i.entity_id = ?3`).bind(ws, issueId, p.id).first();
    if (!own) return { status: 400, error: "That data issue isn't this payment's wrong-lease issue." };
  }
  const at = nowIso(nowMs);
  const [moved] = await db.batch([
    db
      .prepare(overlayUpsertSql("payments", PAYMENT_COLS, { lease_id: "?3", household_id: "?4", charge_id: "?5" },
        `e.lease_id = ?6 AND e.nsf = 0 AND e.amount_cents <= (SELECT ${chargeOpenSql("t")} FROM ${effective("charges")} AS t WHERE t.id = ?5) + CASE WHEN e.charge_id = ?5 THEN e.amount_cents ELSE 0 END`))
      .bind(ws, p.id, c.lease_id, c.household_id, c.id, p.lease_id),
    chargeRefreshStmt(db, ws, null, c.lease_id),
    chargeRefreshStmt(db, ws, null, p.lease_id),
  ]);
  const room = c.open_cents + (p.charge_id === c.id ? p.amount_cents : 0);
  if (!moved.meta.changes) return { status: 409, error: room < p.amount_cents ? `Only ${dollars(room)} is open on ${c.description}.` : "This payment was already moved." };
  const before = { lease_id: p.lease_id, charge_id: p.charge_id, household_id: p.household_id };
  const after = { lease_id: c.lease_id, charge_id: c.id, household_id: c.household_id };
  const steps: DbStatement[] = [
    eventStmt(db, ws, at, "payment.moved", "payments", p.id, p.property_id, { from_lease: p.lease_id, to_lease: c.lease_id, amount_cents: p.amount_cents }),
    auditStmt(db, ws, at, actor, { action: "Payment moved to the correct lease", entityType: "payments", entityId: p.id, propertyId: p.property_id, detail: `${dollars(p.amount_cents)} moved from ${p.lease_id} to ${c.lease_id} (${c.description})`, before, after }),
  ];
  if (issueId) {
    steps.push(
      db.prepare(overlayUpsertSql("data_issues", ISSUE_COLS, { status: "'fixed'", fixed_by: "?3", fixed_at: "?4" }, "e.status = 'open' AND e.rule_id = 'payments.wrong_lease' AND e.entity_type = 'payments' AND e.entity_id = ?5")).bind(ws, issueId, actor.personaId, at, p.id),
      db
        .prepare("INSERT INTO data_fix_log (workspace_id, id, issue_id, entity_type, entity_id, before_json, after_json, fixed_by, agent, at) SELECT ?1, ?2, ?3, 'payments', ?4, ?5, ?6, ?7, 'data_health', ?8 WHERE EXISTS (SELECT 1 FROM data_issues WHERE workspace_id = ?1 AND id = ?3 AND rule_id = 'payments.wrong_lease' AND entity_id = ?4 AND status = 'fixed' AND fixed_at = ?8)")
        .bind(ws, uid("fix"), issueId, p.id, JSON.stringify(before), JSON.stringify(after), actor.personaId, at),
    );
  }
  await db.batch(steps);
  return { status: 200, message: `Moved ${dollars(p.amount_cents)} to ${c.lease_id} and applied it to ${c.description}.` };
}

// A resident's payment bounced (NSF or a returned ACH). In one guarded batch: the bank takes the
// money back out of trust (a Returned payment transfer, key return:<payment>, so once per payment),
// the management fee taken on it goes back to trust, the payment is marked NSF so the lease owes the
// amount again (re-allocated oldest first), and a returned-payment fee is charged at the policy
// amount capped by the state rule. Emits payment.failed for the Collections Agent.
export const RETURNED_PAYMENT_FEE_CENTS = 3_500;
export async function markPaymentReturned(ctx: ActionContext, paymentId: string, reason: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const pay = await db
    .prepare(
      `SELECT p.*, pr.owner_entity_id, pr.state, h.name AS household_name,
         (SELECT r.id FROM ${effective("residents")} AS r WHERE r.household_id = p.household_id ORDER BY r.is_primary DESC LIMIT 1) AS resident_id,
         (SELECT l.unit_id FROM ${effective("leases")} AS l WHERE l.id = p.lease_id) AS unit_id
       FROM ${effective("payments")} AS p JOIN ${effective("properties")} AS pr ON pr.id = p.property_id LEFT JOIN ${effective("households")} AS h ON h.id = p.household_id
       WHERE p.id = ?2`,
    )
    .bind(ws, paymentId)
    .first<{ id: string; lease_id: string; household_id: string; property_id: string; amount_cents: number; nsf: number; owner_entity_id: string; state: string; household_name: string | null; resident_id: string | null; unit_id: string | null; method: string; reference: string }>();
  if (!pay) return { status: 404, error: "Payment not found" };
  const denied = forbidden(actor, ["receivables", "accounting"], pay.property_id);
  if (denied) return denied;
  const why = reason.trim().slice(0, 200) || "Returned by the bank";
  const cap = await db.prepare(`SELECT s.value FROM ${effective("state_rules")} AS s WHERE s.state = ?2 AND s.rule = 'nsf_fee_cap_cents' AND s.effective_from <= ?3 ORDER BY s.effective_from DESC LIMIT 1`).bind(ws, pay.state, AS_OF).first<{ value: string }>();
  const fee = Math.min(RETURNED_PAYMENT_FEE_CENTS, cap ? Number(cap.value) : RETURNED_PAYMENT_FEE_CENTS);
  const mgmtFee = Math.floor((pay.amount_cents * FEE_PCT + 50) / 100);
  const at = nowIso(nowMs);
  const id = uid("tr");
  const trust = `ba-${pay.owner_entity_id}-trust`;
  const gated = "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?2)";
  const steps: DbStatement[] = [
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'return:' || p.id, 'Returned payment', ?4, ?5, 'trust', ?4, 'Operating trust', 'bank', p.household_id, 'Returned to the bank', p.amount_cents, p.property_id, p.id, 'Cleared', ?6, NULL, ?6
         FROM ${effective("payments")} AS p WHERE p.id = ?3 AND p.nsf = 0 AND p.amount_cents = ?7
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'return:' || ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, pay.id, trust, pay.owner_entity_id, at, pay.amount_cents),
    db.prepare(overlayUpsertSql("payments", PAYMENT_COLS, { nsf: "1" }, `EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)`)).bind(ws, pay.id, id),
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?3, 'feeback:' || ?4, 'Other receipt', ?5, ?6, 'pm', 'ba-mgmt', 'Summit Residential Partners (management fees)', 'trust', ?5, 'Operating trust', ?7, ?8, ?4, 'Cleared', ?9, NULL, ?9
         WHERE ?7 > 0 AND ${gated} ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, uid("tr"), pay.id, trust, pay.owner_entity_id, mgmtFee, pay.property_id, at),
    db
      .prepare(
        `INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents)
         SELECT ?1, ?3, ?4, ?5, ?6, ?7, 'gl-4110', ?8, substr(?9, 1, 7), ?9, ?10 WHERE ?10 > 0 AND ${gated} ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, `nsf-${pay.id}`, pay.lease_id, pay.household_id, pay.property_id, pay.unit_id, `Returned payment fee (${pay.method} ${pay.reference})`, AS_OF, fee),
    chargeRefreshStmt(db, ws, null, pay.lease_id),
    eventStmt(db, ws, at, "payment.failed", "payments", pay.id, pay.property_id, { lease_id: pay.lease_id, household_id: pay.household_id, amount_cents: pay.amount_cents, fee_cents: fee, reason: why }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Payment returned", entityType: "payments", entityId: pay.id, propertyId: pay.property_id, detail: `${dollars(pay.amount_cents)} ${pay.method} (${pay.reference}) returned: ${why}. Fee ${dollars(fee)}.`, before: { nsf: 0 }, after: { nsf: 1 } }, done(id)),
  ];
  if (pay.resident_id)
    steps.push(notifyStmt(db, ws, at, pay.resident_id, "Your payment was returned", `Your ${dollars(pay.amount_cents)} payment (${pay.reference}) was returned by the bank (${why}). A ${dollars(fee)} returned-payment fee applies. Please pay in the resident portal.`, "/portal/resident/pay", ["payments", pay.id], done(id)));
  const [insert] = await db.batch(steps);
  if (insert.meta.changes) return { status: 200, message: `Marked ${dollars(pay.amount_cents)} returned; ${dollars(fee)} fee charged to ${pay.household_name ?? "the household"}.` };
  if (pay.nsf || (await transferAt(db, ws, `return:${pay.id}`))) return { status: 409, error: "This payment is already marked returned." };
  return { status: 409, error: "This payment changed while you were marking it. Check it and try again." };
}
