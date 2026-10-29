import { MANAGEMENT_FEE_RATE, PM, SETTLE_MS, TRUST, ownerStatement, trustBalance } from "@/lib/ledger";
import { money } from "@/lib/mockAi";
import type { Db } from "@/lib/platform/types";
import type { DemoState } from "@/lib/types";
import { auditStmt, notifyStmt, tables, toCents, transferExists, transferMissing, uid, type Gate } from "./repo";
import { stamp } from "./workspace";

// Money movement on D1. D1 has no interactive transactions, but a batch is one transaction and
// writes are serialized, so every money action is a single batch whose first statement is a
// guarded INSERT into transfers. Later statements run only if that row exists (Gate), and the
// partial unique index on transfers.key means a retry or double click can never insert twice.
// The JS pre-checks only choose the error message; the SQL guards are what decide.

export type Outcome = { status: 200 } | { status: 404 | 409; error: string };

// Trust money that can be spent now: cleared in, less cleared and pending out (ledger.trustBalance).
const AVAILABLE_CENTS = `(SELECT coalesce(sum(CASE WHEN to_kind = 'trust' AND status = 'Cleared' THEN amount_cents WHEN from_kind = 'trust' THEN -amount_cents ELSE 0 END), 0)
  FROM transfers WHERE workspace_id = ?1 AND status <> 'Returned')`;

const TRANSFER_COLS = "workspace_id, id, key, kind, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, settles_at";

// Clears pending transfers that are due, as ledger.settle does: rent clears with the management
// fee taken from trust, paid invoices and jobs are marked Paid, and the receiver is told.
// Runs at the start of every request; a transfer is only processed while it is still Pending,
// so two requests settling at once do the work once.
export async function settle(db: Db, ws: string, nowMs: number) {
  const due = (await db.prepare("SELECT * FROM transfers WHERE workspace_id = ?1 AND status = 'Pending' AND settles_at <= ?2 ORDER BY seq").bind(ws, nowMs).all()).results.map(tables.transfers.fromRow);
  if (!due.length) return;
  const ts = stamp(nowMs);
  const vendorUsers = due.some((t) => t.kind === "Vendor payout")
    ? new Map((await db.prepare("SELECT id, user_id FROM vendors WHERE workspace_id = ?1").bind(ws).all<{ id: string; user_id: string }>()).results.map((v) => [v.id, v.user_id]))
    : new Map<string, string>();
  // Fee in whole cents, rounded half up like ledger.managementFee.
  const feePct = Math.round(MANAGEMENT_FEE_RATE * 100);
  await db.batch(
    due.flatMap((t) => {
      const pending: Gate = { sql: "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?G AND status = 'Pending')", value: t.id };
      const steps = [];
      if (t.kind === "Rent") {
        steps.push(
          db
            .prepare(
              `INSERT INTO transfers (${TRANSFER_COLS}, cleared)
               SELECT ?1, ?2, 'fee:' || ref, 'Management fee', 'trust', ?4, ?5, 'pm', ?6, ?7, CAST((amount_cents * ?8 + 50) / 100 AS INTEGER), property_id, ref, 'Cleared', ?9, NULL, ?9
               FROM transfers WHERE workspace_id = ?1 AND id = ?3 AND status = 'Pending'
               ON CONFLICT DO NOTHING`,
            )
            .bind(ws, uid("tr"), t.id, TRUST.id, TRUST.name, PM.id, PM.name, feePct, ts),
          notifyStmt(db, ws, t.from.id, `Payment received: ${money(t.amount)} for ${t.ref}. Thank you!`, ts, pending),
          db.prepare("UPDATE invoices SET status = 'Paid' WHERE workspace_id = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3 AND status = 'Pending')").bind(ws, t.ref, t.id),
        );
      }
      if (t.kind === "Vendor payout") {
        const userId = vendorUsers.get(t.to.id);
        if (userId) steps.push(notifyStmt(db, ws, userId, `${money(t.amount)} for ${t.ref} has arrived in your account.`, ts, pending));
        steps.push(db.prepare("UPDATE work_orders SET status = 'Paid' WHERE workspace_id = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3 AND status = 'Pending')").bind(ws, t.ref, t.id));
      }
      if (t.kind === "Owner payout") steps.push(notifyStmt(db, ws, t.to.id, `Your payout of ${money(t.amount)} has arrived.`, ts, pending));
      // Last, so the steps above still see the transfer as Pending.
      steps.push(db.prepare("UPDATE transfers SET status = 'Cleared', cleared = ?3 WHERE workspace_id = ?1 AND id = ?2 AND status = 'Pending'").bind(ws, t.id, ts));
      return steps;
    }),
  );
}

// Rent goes into trust as a pending ACH transfer, once per invoice (key rent:<invoice>).
export async function payInvoice(db: Db, ws: string, s: DemoState, invoiceId: string, nowMs: number): Promise<Outcome> {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  const tenancy = inv && s.tenancies.find((t) => t.id === inv.tenancyId);
  const tenant = tenancy && s.users.find((u) => u.id === tenancy.tenantId);
  if (!inv || !tenancy || !tenant) return { status: 404, error: "Invoice not found" };
  const ts = stamp(nowMs);
  const id = uid("tr");
  const done = transferExists(id);
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'rent:' || ?3, 'Rent', 'tenant', ?4, ?5, 'trust', ?6, ?7, ?8, ?9, ?3, 'Pending', ?10, ?11
         WHERE EXISTS (SELECT 1 FROM invoices WHERE workspace_id = ?1 AND id = ?3 AND status IN ('Due', 'Overdue') AND amount_cents = ?8)
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, inv.id, tenant.id, tenant.name, TRUST.id, TRUST.name, toCents(inv.amount), tenancy.propertyId, ts, nowMs + SETTLE_MS),
    db.prepare("UPDATE invoices SET status = 'Processing' WHERE workspace_id = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)").bind(ws, inv.id, id),
    notifyStmt(db, ws, "u-pm", `${tenant.name} paid ${money(inv.amount)} (${inv.id}); ACH pending.`, ts, done),
    auditStmt(db, ws, ts, tenant.name, "Rent payment started", `${inv.id} ${money(inv.amount)} by ACH into the trust account`, done),
  ]);
  return insert.meta.changes ? { status: 200 } : { status: 409, error: `${inv.id} is already paid or being processed.` };
}

// Approves a submitted job (ledger.approveWorkOrder). Vendor jobs pay out from trust, refused
// when trust can't cover it; in-house jobs just complete.
export async function approveWorkOrder(db: Db, ws: string, s: DemoState, woId: string, nowMs: number): Promise<Outcome> {
  const wo = s.workOrders.find((w) => w.id === woId);
  if (!wo) return { status: 404, error: "Work order not found" };
  const ts = stamp(nowMs);
  const submission = wo.submission ? JSON.stringify(wo.submission) : null;
  const notSubmitted = `Only submitted work can be approved (this one is ${wo.status.toLowerCase()})`;
  const vendor = s.vendors.find((v) => v.id === wo.vendorId);
  if (!vendor) {
    const { meta } = await db.prepare("UPDATE work_orders SET status = 'Completed' WHERE workspace_id = ?1 AND id = ?2 AND status = 'Submitted' AND submission IS ?3").bind(ws, woId, submission).run();
    if (!meta.changes) return { status: 409, error: notSubmitted };
    await auditStmt(db, ws, ts, "Maya Patel", "Job completed", `${woId} completed in-house`).run();
    return { status: 200 };
  }
  const amount = wo.submission?.total ?? wo.po.total;
  const available = trustBalance(s).available;
  const error =
    wo.status !== "Submitted" ? notSubmitted
    : !(amount > 0) ? "Invoice total must be more than $0"
    : amount > available ? `Trust account can't cover ${amount.toFixed(2)} (available ${available.toFixed(2)})`
    : `${woId} changed while you were approving it. Check it and try again.`;
  const id = uid("tr");
  const done = transferExists(id);
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'vendor:' || ?3, 'Vendor payout', 'trust', ?4, ?5, 'vendor', ?6, ?7, ?8, ?9, ?3, 'Pending', ?10, ?11
         WHERE ?8 > 0
           AND EXISTS (SELECT 1 FROM work_orders WHERE workspace_id = ?1 AND id = ?3 AND status = 'Submitted' AND submission IS ?12)
           AND ?8 <= ${AVAILABLE_CENTS}
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, woId, TRUST.id, TRUST.name, vendor.id, vendor.company, toCents(amount), wo.propertyId, ts, nowMs + SETTLE_MS, submission),
    db.prepare("UPDATE work_orders SET status = 'Payment pending' WHERE workspace_id = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?3)").bind(ws, woId, id),
    notifyStmt(db, ws, vendor.userId, `${woId} approved. ${money(amount)} sent by ACH, arriving in 1–2 business days.`, ts, done),
    auditStmt(db, ws, ts, "Maya Patel", "Payment approved", `${woId}: ${money(amount)} to ${vendor.company} by ACH`, done),
    auditStmt(db, ws, ts, "Maya Patel", "Approval refused", `${woId}: ${error}`, transferMissing(id), true),
  ]);
  return insert.meta.changes ? { status: 200 } : { status: 409, error };
}

// Pays an owner their statement balance from trust and closes the statement (ledger.disburse).
// The client's Idempotency-Key is the transfer key, so a retried request finds the first payout.
export async function disburseOwner(db: Db, ws: string, s: DemoState, ownerId: string, idempotencyKey: string, nowMs: number): Promise<Outcome> {
  const owner = s.users.find((u) => u.id === ownerId && u.role === "Owner");
  const propertyId = s.properties.find((p) => p.ownerId === ownerId)?.id;
  if (!owner || !propertyId) return { status: 404, error: "Owner not found" };
  const { net } = ownerStatement(s, ownerId);
  const available = trustBalance(s).available;
  const ts = stamp(nowMs);
  const id = uid("payout");
  const done = transferExists(id);
  // The owner's open items: not in a payout yet, on their properties.
  const open = "workspace_id = ?1 AND statement IS NULL AND status <> 'Returned' AND property_id IN (SELECT id FROM properties WHERE workspace_id = ?1 AND owner_id = ?3)";
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (${TRANSFER_COLS})
         SELECT ?1, ?2, 'owner:' || ?4, 'Owner payout', 'trust', ?5, ?6, 'owner', ?3, ?7, ?8, ?9, ?10, 'Pending', ?11, ?12
         WHERE ?8 > 0
           AND ?8 = (SELECT coalesce(sum(CASE WHEN kind = 'Rent' AND status = 'Cleared' THEN amount_cents
                                              WHEN kind = 'Management fee' AND status = 'Cleared' THEN -amount_cents
                                              WHEN kind = 'Vendor payout' THEN -amount_cents ELSE 0 END), 0)
                     FROM transfers WHERE ${open})
           AND ?8 <= ${AVAILABLE_CENTS}
         ON CONFLICT DO NOTHING`,
      )
      .bind(ws, id, ownerId, idempotencyKey, TRUST.id, TRUST.name, owner.name, toCents(net), propertyId, `Statement ${ts.slice(0, 10)}`, ts, nowMs + SETTLE_MS),
    notifyStmt(db, ws, ownerId, `Your payout of ${money(net)} is on its way by ACH.`, ts, done),
    auditStmt(db, ws, ts, "Maya Patel", "Owner payout", `${money(net)} to ${owner.name} from the trust account`, done),
    // Close the statement: every item the payout covered points at it.
    db
      .prepare(
        `UPDATE transfers SET statement = ?2 WHERE ${open} AND kind <> 'Owner payout' AND (kind = 'Vendor payout' OR status = 'Cleared')
         AND EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?2)`,
      )
      .bind(ws, id, ownerId),
  ]);
  if (insert.meta.changes) return { status: 200 };
  const replay = await db.prepare("SELECT 1 FROM transfers WHERE workspace_id = ?1 AND key = ?2").bind(ws, `owner:${idempotencyKey}`).first();
  if (replay) return { status: 200 };
  const error =
    net <= 0 ? `Nothing is owed to ${owner.name} right now.`
    : net > available ? `Trust account can't cover ${net.toFixed(2)} (available ${available.toFixed(2)})`
    : `${owner.name}'s statement changed while you were paying it. Check it and try again.`;
  return { status: 409, error };
}
