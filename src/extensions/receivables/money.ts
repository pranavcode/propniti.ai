import type { ActionContext } from "@/entities/types";
import type { DbStatement } from "@/lib/platform/types";
import { AS_OF } from "@/seed/constants";
import { AVAILABLE_SQL, chargeOpenSql } from "@/server/data";
import { effective, overlayUpsertSql } from "@/server/effective";
import { auditStmt, done, eventStmt, uid, type Outcome } from "@/server/money";
import { nowIso } from "@/server/workspace";

// INTEGRATE: Lane A moves these two into src/server/money.ts (research/lane-requests.md). They follow
// its rules: one batch whose first statement is a guarded insert into the overlay `transfers`, later
// statements gated on that row, idempotency from transfers_live_key plus a base-key check.

const TRANSFER_COLS = "workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, settles_at, cleared";
const DEPOSIT_COLS = ["id", "deleted", "lease_id", "property_id", "bank_account_id", "amount_cents", "received_on", "status"];
const PAYMENT_COLS = ["id", "deleted", "lease_id", "household_id", "property_id", "charge_id", "transfer_id", "method", "reference", "received_on", "amount_cents", "nsf"];
const ISSUE_COLS = ["id", "deleted", "rule_id", "entity_type", "entity_id", "property_id", "detected_at", "severity", "evidence", "suggested_fix", "status", "fixed_by", "fixed_at"];
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
         AND NOT EXISTS (SELECT 1 FROM json_each(?15) AS j JOIN ${effective("charges")} AS c ON c.id = json_extract(j.value, '$.id')
                         WHERE c.lease_id <> d.lease_id OR json_extract(j.value, '$.amount') > ${chargeOpenSql("c")})
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
        .prepare("INSERT INTO data_fix_log (workspace_id, id, issue_id, entity_type, entity_id, before_json, after_json, fixed_by, agent, at) VALUES (?1, ?2, ?3, 'payments', ?4, ?5, ?6, ?7, 'data_health', ?8)")
        .bind(ws, uid("fix"), issueId, p.id, JSON.stringify(before), JSON.stringify(after), actor.personaId, at),
    );
  }
  await db.batch(steps);
  return { status: 200, message: `Moved ${dollars(p.amount_cents)} to ${c.lease_id} and applied it to ${c.description}.` };
}
