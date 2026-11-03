import { PERMISSIONS } from "@/auth/personas";
import type { ActionContext, Actor, ModuleKey } from "@/entities/types";
import { MANAGEMENT_FEE_RATE, SETTLE_MS } from "@/lib/ledger";
import type { Db, DbStatement } from "@/lib/platform/types";
import { AS_OF, CURRENT_PERIOD } from "@/seed/constants";
import { AVAILABLE_SQL, OPEN_NET_SQL, chargeOpenSql, ownerStatement } from "./data";
import { effective, overlayUpsertSql } from "./effective";
import { nowIso } from "./workspace";

// Money movement for v2 (plan §1, AGENTS.md money rules). Base history is read-only; every money
// action is one D1 batch whose first statement is a guarded INSERT … SELECT … WHERE <guards> ON
// CONFLICT DO NOTHING into the visitor's overlay `transfers`. Later statements are gated on that
// row existing, so they run only if the money moved. The SQL guards decide; JS pre-checks only
// pick the error message. Idempotency comes from the transfers_live_key unique index, plus a
// NOT EXISTS check against base keys. Every action writes `events` (the agents' outbox) and `audit`.

export type Outcome = { status: 200; message?: string } | { status: 400 | 403 | 404 | 409; error: string };

// Legacy routes (src/app/api/*) still import these until Lane C turns them into redirects.
export { approveWorkOrder, disburseOwner, payInvoice } from "./legacy-money";

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

export async function settle(db: Db, ws: string, nowMs: number) {
  const due = (await db.prepare("SELECT * FROM transfers WHERE workspace_id = ?1 AND status = 'Pending' AND settles_at <= ?2 ORDER BY seq").bind(ws, nowMs).all<Record<string, string | number>>()).results;
  if (!due.length) return;
  const at = nowIso(nowMs);
  const steps: DbStatement[] = [];
  for (const t of due) {
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
             FROM transfers WHERE workspace_id = ?1 AND id = ?2 AND status = 'Pending' ON CONFLICT DO NOTHING`,
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
      steps.push(
        ref.startsWith("BILL-")
          ? db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Paid'" }, pending, "?1", "?3")).bind(ws, id, ref)
          : db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "'Paid'" }, pending, "?1", "?3")).bind(ws, id, ref),
        eventStmt(db, ws, at, "payment.sent", ref.startsWith("BILL-") ? "bills" : "work_orders", ref, String(t.property_id), { transfer_id: id, amount_cents: t.amount_cents, vendor_id: t.to_id }, done(id)),
        notifyStmt(db, ws, at, String(t.to_id), "Payment sent", `${dollars(Number(t.amount_cents))} for ${ref} has arrived in your account.`, "/portal/vendor/payments", [ref.startsWith("BILL-") ? "bills" : "work_orders", ref], done(id)),
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
  }
  await db.batch(steps);
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
    eventStmt(db, ws, at, "payment.initiated", "charges", c.id, c.property_id, { transfer_id: id, amount_cents: c.open_cents, method: "ACH" }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Rent payment started", entityType: "charges", entityId: c.id, propertyId: c.property_id, detail: `${c.description}: ${dollars(c.open_cents)} by ACH into the operating trust` }, done(id)),
    notifyStmt(db, ws, at, "marcus", "Rent payment started", `${c.household_name} paid ${dollars(c.open_cents)} (${c.description}); ACH pending.`, `/app/receivables/charges/${c.id}`, ["charges", c.id], done(id)),
  ]);
  if (insert.meta.changes) return { status: 200, message: `Payment of ${dollars(c.open_cents)} is processing.` };
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
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?3, 'fee:' || id, 'Management fee', bank_account_id, owner_entity_id, 'trust', bank_account_id, 'Operating trust', 'pm', 'ba-mgmt', 'Summit Residential Partners (management fees)',
           CAST((amount_cents * ?4 + 50) / 100 AS INTEGER), property_id, id, 'Cleared', ?5, NULL, ?5
         FROM transfers WHERE workspace_id = ?1 AND id = ?2 ON CONFLICT DO NOTHING`,
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
export async function postLateFees(ctx: ActionContext, propertyIds: string[], period = CURRENT_PERIOD): Promise<Outcome & { posted?: number }> {
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
  if (!stmts.length) return { status: 409, error: "No unpaid rent is past its grace period in the selected properties." };
  // D1 counts every statement in a batch toward its per-request query limit: post at most 90.
  stmts.splice(90);
  posted.splice(90);
  const results = await db.batch(stmts);
  const n = results.reduce((s, r) => s + r.meta.changes, 0);
  if (!n) return { status: 409, error: `Late fees for ${period} are already posted.` };
  const total = posted.filter((_, i) => results[i].meta.changes).reduce((s, p) => s + p.amount, 0);
  await db.batch([
    eventStmt(db, ws, at, "charge.late_fees_posted", "properties", propertyIds[0], propertyIds.length === 1 ? propertyIds[0] : null, { count: n, total_cents: total, period, property_ids: propertyIds }),
    auditStmt(db, ws, at, actor, { action: "Late fees posted", entityType: "properties", entityId: propertyIds.join(","), detail: `${n} late fees, ${dollars(total)} total, for ${period} (capped by state rules)` }),
  ]);
  return { status: 200, message: `Posted ${n} late fees (${dollars(total)}).`, posted: n };
}

// ---------------------------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------------------------

// Fraud hold: a vendor with an open unverified-bank-change issue can't be paid.
const NO_FRAUD_HOLD = (vendor: string) => `NOT EXISTS (SELECT 1 FROM ${effective("data_issues")} AS di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ${vendor} AND di.status = 'open')`;

export async function approveBill(ctx: ActionContext, billId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const bill = await db.prepare(`SELECT * FROM ${effective("bills")} AS b WHERE b.id = ?2`).bind(ws, billId).first<{ id: string; status: string; amount_cents: number; property_id: string; vendor_id: string }>();
  if (!bill) return { status: 404, error: "Bill not found" };
  const denied = forbidden(actor, ["payables"], bill.property_id);
  if (denied) return denied;
  const at = nowIso(nowMs);
  const [upsert] = await db.batch([
    db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Approved'", approved_by: "?3", approved_at: "?4" }, "e.status IN ('Pending approval', 'Draft')")).bind(ws, billId, actor.personaId, at),
  ]);
  if (!upsert.meta.changes) return { status: 409, error: `${billId} is already ${bill.status.toLowerCase()}.` };
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
         SELECT ?1, ?2, 'vendor:' || b.id, 'Vendor payout', ${trust}, b.owner_entity_id, 'trust', ${trust}, 'Operating trust', 'vendor', b.vendor_id, ?4, b.amount_cents, b.property_id, b.id, 'Pending', ?5, ?6, NULL
         FROM ${effective("bills")} AS b
         WHERE b.id = ?3 AND b.status IN ('Approved', 'Scheduled') AND b.amount_cents > 0 AND b.amount_cents <= ${AVAILABLE_SQL(trust)}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'vendor:' || ?3) AND ${NO_FRAUD_HOLD("b.vendor_id")}
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, billId, bill.company, at, nowMs + SETTLE_MS),
    db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Scheduled'" }, "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)")).bind(ws, billId, id),
    eventStmt(db, ws, at, "payment.scheduled", "bills", billId, bill.property_id, { transfer_id: id, amount_cents: bill.amount_cents, vendor_id: bill.vendor_id }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Bill paid", entityType: "bills", entityId: billId, propertyId: bill.property_id, detail: `${billId}: ${dollars(bill.amount_cents)} to ${bill.company} by ACH` }, done(id)),
  ]);
  if (insert.meta.changes) return { status: 200, message: `${dollars(bill.amount_cents)} to ${bill.company} is on its way.` };
  if (await transferAt(db, ws, `vendor:${billId}`)) return { status: 409, error: `${billId} is already paid.` };
  if (!["Approved", "Scheduled"].includes(bill.status)) return { status: 409, error: `Only approved bills can be paid (this one is ${bill.status.toLowerCase()}).` };
  const hold = await db.prepare(`SELECT 1 FROM ${effective("data_issues")} AS di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ?2 AND di.status = 'open'`).bind(ws, bill.vendor_id).first();
  if (hold) return { status: 409, error: `${bill.company} changed bank details and isn't verified yet. Payments are on hold.` };
  const avail = await db.prepare(`SELECT ${AVAILABLE_SQL("?2")} AS a`).bind(ws, `ba-${bill.owner_entity_id}-trust`).first<{ a: number }>();
  return { status: 409, error: `Trust account can't cover ${dollars(bill.amount_cents)} (available ${dollars(avail?.a ?? 0)})` };
}

// Approves submitted work. Vendor jobs pay out from trust (key vendor:<wo>), within the owner's
// approval limit; in-house jobs just complete.
export async function approveAndPayWorkOrder(ctx: ActionContext, woId: string): Promise<Outcome> {
  const { db, ws, nowMs, actor } = ctx;
  const wo = await db
    .prepare(
      `SELECT w.*, p.owner_entity_id, v.company,
         coalesce((SELECT json_extract(e.detail, '$.total_cents') FROM ${effective("wo_events")} AS e WHERE e.work_order_id = w.id AND e.kind = 'Submission' ORDER BY e.at DESC LIMIT 1), w.cost_cents, w.estimate_cents) AS amount_cents
       FROM ${effective("work_orders")} AS w JOIN ${effective("properties")} AS p ON p.id = w.property_id LEFT JOIN ${effective("vendors")} AS v ON v.id = w.vendor_id
       WHERE w.id = ?2`,
    )
    .bind(ws, woId)
    .first<{ id: string; status: string; vendor_id: string | null; company: string | null; amount_cents: number; property_id: string; owner_entity_id: string; title: string }>();
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
  const policy = await db
    .prepare(`SELECT owner_approval_over_cents FROM ${effective("approval_policies")} AS a WHERE a.category = 'Maintenance spend' AND (a.owner_entity_id = ?2 OR a.owner_entity_id IS NULL) ORDER BY a.owner_entity_id IS NULL LIMIT 1`)
    .bind(ws, wo.owner_entity_id)
    .first<{ owner_approval_over_cents: number | null }>();
  if (policy?.owner_approval_over_cents != null && wo.amount_cents > policy.owner_approval_over_cents && actor.role !== "owner")
    return { status: 409, error: `${dollars(wo.amount_cents)} is over the owner's approval limit of ${dollars(policy.owner_approval_over_cents)}. Send it to the owner to approve.` };
  const id = uid("tr");
  const trust = `ba-${wo.owner_entity_id}-trust`;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'vendor:' || w.id, 'Vendor payout', ?4, ?5, 'trust', ?4, 'Operating trust', 'vendor', w.vendor_id, ?6, ?7, w.property_id, w.id, 'Pending', ?8, ?9, NULL
         FROM ${effective("work_orders")} AS w
         WHERE w.id = ?3 AND w.status = 'Submitted' AND ?7 > 0 AND ?7 <= ${AVAILABLE_SQL("?4")}
           AND NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = 'base' AND key = 'vendor:' || ?3) AND ${NO_FRAUD_HOLD("w.vendor_id")}
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, woId, trust, wo.owner_entity_id, wo.company, wo.amount_cents, at, nowMs + SETTLE_MS),
    db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "'Completed'", cost_cents: "?4", completed_at: "?5" }, "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)")).bind(ws, woId, id, wo.amount_cents, at),
    db
      .prepare(`INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail) SELECT ?1, ?2, ?3, ?4, ?5, 'staff', ?6, 'Approval', 'Completed', ?7 WHERE EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?8)`)
      .bind(ws, uid("woe"), woId, wo.property_id, at, actor.personaId, JSON.stringify({ amount_cents: wo.amount_cents, transfer_id: id }), id),
    eventStmt(db, ws, at, "wo.approved", "work_orders", woId, wo.property_id, { transfer_id: id, amount_cents: wo.amount_cents, vendor_id: wo.vendor_id }, done(id)),
    notifyStmt(db, ws, at, wo.vendor_id, "Work approved", `${woId} approved. ${dollars(wo.amount_cents)} sent by ACH, arriving in 1–2 business days.`, "/portal/vendor/payments", ["work_orders", woId], done(id)),
    auditStmt(db, ws, at, actor, { action: "Payment approved", entityType: "work_orders", entityId: woId, propertyId: wo.property_id, detail: `${woId}: ${dollars(wo.amount_cents)} to ${wo.company} by ACH` }, done(id)),
    auditStmt(db, ws, at, actor, { action: "Approval refused", entityType: "work_orders", entityId: woId, propertyId: wo.property_id, detail: `${woId}: not paid (status, trust balance or payment hold)` }, refused(id)),
  ]);
  if (insert.meta.changes) return { status: 200, message: `${woId} approved; ${dollars(wo.amount_cents)} is on its way to ${wo.company}.` };
  // A double click's losing request saw the job as Submitted; report what actually happened.
  if (await transferAt(db, ws, `vendor:${woId}`)) return { status: 409, error: `${woId} is already approved` };
  if (wo.status !== "Submitted") return { status: 409, error: notSubmitted };
  const avail = await db.prepare(`SELECT ${AVAILABLE_SQL("?2")} AS a`).bind(ws, trust).first<{ a: number }>();
  if ((avail?.a ?? 0) < wo.amount_cents) return { status: 409, error: `Trust account can't cover ${dollars(wo.amount_cents)} (available ${dollars(avail?.a ?? 0)})` };
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
  if (insert.meta.changes) return { status: 200, message: `${dollars(st.net_cents)} is on its way to ${oe.owner_name}.` };
  if (await db.prepare("SELECT 1 FROM transfers WHERE workspace_id = ?1 AND key = ?2").bind(ws, `owner:${idempotencyKey}`).first()) return { status: 200, message: "Already sent." };
  const avail = await db.prepare(`SELECT ${AVAILABLE_SQL("?2")} AS a`).bind(ws, trust).first<{ a: number }>();
  return {
    status: 409,
    error: st.net_cents <= 0 ? `Nothing is owed to ${oe.owner_name} right now.` : st.net_cents > (avail?.a ?? 0) ? `Trust account can't cover ${dollars(st.net_cents)} (available ${dollars(avail?.a ?? 0)})` : `${oe.name}'s statement changed while you were paying it. Check it and try again.`,
  };
}
