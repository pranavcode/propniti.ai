import { z } from "zod";
import { Ban, BadgeCheck, CircleDollarSign, Landmark, Send, ShieldCheck, Wand2 } from "lucide-react";
import type { ActionContext, ActionResult, Role, Row } from "@/entities/types";
import { approveBill, auditStmt, eventStmt, payBill, uid } from "@/server/money";
import { effective, overlayUpsertSql } from "@/server/effective";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";

// Bill workflow: Draft (entered from an invoice) → Submit for approval → Approve → Pay.
// Approve and pay go through src/server/money.ts. Recoding a line and confirming a vendor's
// bank change are audited like every action (src/app/api/e/_lib/actions.ts).

const AP: Role[] = ["principal", "regional_manager", "accountant"];
const BILL_COLS = ["id", "deleted", "property_id", "owner_entity_id", "vendor_id", "work_order_id", "po_id", "recurring_bill_id", "document_id", "invoice_number", "bill_date", "due_on", "amount_cents", "status", "approved_by", "approved_at"];
const LINE_COLS = ["id", "deleted", "bill_id", "gl_account_id", "description", "qty", "unit_cents", "amount_cents"];
const ISSUE_COLS = ["id", "deleted", "rule_id", "entity_type", "entity_id", "property_id", "detected_at", "severity", "evidence", "suggested_fix", "status", "fixed_by", "fixed_at"];
const VENDOR_COLS = ["id", "deleted", "company", "trade", "contact_name", "email", "phone", "metros", "w9_on_file", "tin_last4", "is_1099", "bank_last4", "bank_changed_at", "rating", "status"];

const BANK_WINDOW_DAYS = 60;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Hard stop: a vendor with an open unverified-bank-change issue, or a bank change in the last 60
// days that nobody has confirmed, can't be approved or paid.
export async function bankHold(ctx: Pick<ActionContext, "db" | "ws">, vendorId: string): Promise<string | null> {
  const v = await ctx.db
    .prepare(`SELECT v.company, v.bank_changed_at,
        (SELECT count(*) FROM ${effective("data_issues", "?1")} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = v.id AND di.status = 'open') AS open_issue,
        (SELECT count(*) FROM ${effective("data_issues", "?1")} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = v.id AND di.status = 'fixed' AND di.fixed_at >= v.bank_changed_at) AS verified,
        julianday(coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))) - julianday(substr(v.bank_changed_at, 1, 10)) AS days
      FROM ${effective("vendors", "?1")} v WHERE v.id = ?2`)
    .bind(ctx.ws, vendorId)
    .first<{ company: string; bank_changed_at: string | null; open_issue: number; verified: number; days: number | null }>();
  if (!v) return "Vendor not found";
  if (v.open_issue || (v.bank_changed_at && !v.verified && v.days != null && v.days <= BANK_WINDOW_DAYS)) {
    return `${v.company} changed bank details${v.days != null ? ` ${Math.max(0, Math.round(v.days))} days ago` : ""} and nobody has verified the change by phone. Payments are on hold until someone confirms it.`;
  }
  return null;
}

registerAction({
  key: "bills.submit",
  label: "Submit for approval",
  entity: "bills",
  roles: AP,
  icon: Send,
  when: (r: Row) => r.status === "Draft",
  input: z.strictObject({
    lines: z.array(z.strictObject({ description: z.string().trim().min(1).max(200), gl_account_id: z.string().min(1).max(40), amount: z.number().finite().positive().max(1_000_000) })).min(1).max(20),
  }),
  handler: async (ctx, row, input) => {
    const { db, ws } = ctx;
    const id = String(row.id);
    const gl = await db.prepare(`SELECT count(*) AS n FROM ${effective("gl_accounts", "?1")} g WHERE g.id IN (SELECT value FROM json_each(?2)) AND g.type IN ('Expense', 'Asset')`).bind(ws, JSON.stringify([...new Set(input.lines.map((l) => l.gl_account_id))])).first<{ n: number }>();
    if ((gl?.n ?? 0) !== new Set(input.lines.map((l) => l.gl_account_id)).size) return { status: 400, error: "Code each line to an expense or capital (asset) GL account" };
    const total = input.lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
    const at = nowIso(ctx.nowMs);
    const owner = await db.prepare(`SELECT p.owner_entity_id AS o FROM ${effective("properties", "?1")} p WHERE p.id = ?2`).bind(ws, String(row.property_id)).first<{ o: string }>();
    if (!owner) return { status: 400, error: "The bill's property wasn't found" };
    const [upd] = await db.batch([
      db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Pending approval'", amount_cents: "?3", owner_entity_id: "?4" }, "e.status = 'Draft'")).bind(ws, id, total, owner.o),
    ]);
    if (!upd.meta.changes) return { status: 409, error: `${id} isn't a draft any more` };
    await db.batch([
      db.prepare(`INSERT INTO bill_lines (workspace_id, id, deleted, bill_id, gl_account_id, description, qty, unit_cents, amount_cents)
        SELECT ?1, l.id, 1, l.bill_id, l.gl_account_id, l.description, l.qty, l.unit_cents, l.amount_cents FROM ${effective("bill_lines", "?1")} l WHERE l.bill_id = ?2
        ON CONFLICT (workspace_id, id) DO UPDATE SET deleted = 1`).bind(ws, id),
      ...input.lines.map((l, i) => {
        const cents = Math.round(l.amount * 100);
        return db.prepare(`INSERT INTO bill_lines (workspace_id, id, bill_id, gl_account_id, description, qty, unit_cents, amount_cents) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`).bind(ws, `bl-${id}-${i + 1}-${uid("x").slice(2, 8)}`, id, l.gl_account_id, l.description, cents);
      }),
      eventStmt(db, ws, at, "invoice.received", "bills", id, String(row.property_id), { amount_cents: total, vendor_id: row.vendor_id }),
    ]);
    return { status: 200, message: `${id} (${dollars(total)}) is waiting for approval. The Payables Agent will review it.`, href: `/app/payables/bills/${encodeURIComponent(id)}` };
  },
  help: { summary: "Saves the coded lines and sends the bill for approval. The Payables Agent reviews it for anomalies.", article: "ap-inbox" },
});

async function approve(ctx: ActionContext, row: Row): Promise<ActionResult> {
  const hold = await bankHold(ctx, String(row.vendor_id));
  if (hold) return { status: 409, error: hold };
  return approveBill(ctx, String(row.id));
}

registerAction({
  key: "bills.approve",
  label: "Approve",
  entity: "bills",
  roles: AP,
  icon: BadgeCheck,
  bulk: true,
  when: (r: Row) => r.status === "Pending approval",
  confirm: { title: "Approve this bill?", body: "It becomes payable from the property's trust account. Payment is a separate step." },
  handler: (ctx, row) => approve(ctx, row),
  help: { summary: "Approves the bill for payment. Refused while the vendor has an unverified bank change.", article: "approve-a-bill" },
});

registerAction({
  key: "bills.pay",
  label: "Pay by ACH",
  entity: "bills",
  roles: AP,
  icon: CircleDollarSign,
  money: true,
  when: (r: Row) => r.status === "Approved",
  confirm: { title: "Send payment?", body: "The amount leaves the property's trust account by ACH. The trust balance must cover it." },
  handler: async (ctx, row) => {
    const hold = await bankHold(ctx, String(row.vendor_id));
    if (hold) return { status: 409, error: hold };
    return payBill(ctx, String(row.id));
  },
  help: { summary: "Pays an approved bill from trust. Guarded: the trust balance must cover it and each bill pays once.", article: "approve-a-bill" },
});

registerAction({
  key: "bills.approve_and_pay",
  label: "Approve and pay",
  entity: "bills",
  roles: ["principal", "accountant"],
  icon: CircleDollarSign,
  money: true,
  when: (r: Row) => r.status === "Pending approval",
  confirm: { title: "Approve and send payment?", body: "The bill is approved and paid by ACH from the property's trust account in one step." },
  handler: async (ctx, row) => {
    const a = await approve(ctx, row);
    if (a.status !== 200) return a;
    const p = await payBill(ctx, String(row.id));
    return p.status === 200 ? { status: 200, message: `Approved. ${p.message ?? ""}`.trim() } : { status: p.status, error: `Approved, but not paid: ${p.error}` };
  },
  help: { summary: "Approves and pays in one step, through the same guards as each step alone.", article: "approve-a-bill" },
});

registerAction({
  key: "bills.void",
  label: "Void",
  entity: "bills",
  roles: AP,
  icon: Ban,
  when: (r: Row) => ["Draft", "Pending approval"].includes(String(r.status)),
  input: z.strictObject({ reason: z.string().trim().min(3).max(300) }),
  confirm: { title: "Void this bill?", body: "It won't be paid. Use this for duplicates and invoices sent in error.", tone: "danger" },
  handler: async (ctx, row, input) => {
    const [r] = await ctx.db.batch([ctx.db.prepare(overlayUpsertSql("bills", BILL_COLS, { status: "'Void'" }, "e.status IN ('Draft', 'Pending approval')")).bind(ctx.ws, String(row.id))]);
    return r.meta.changes ? { status: 200, message: `${row.id} voided: ${input.reason}` } : { status: 409, error: `${row.id} can't be voided now` };
  },
  help: { summary: "Cancels a bill that hasn't been approved, for example a duplicate invoice.", article: "approve-a-bill" },
});

// Moves one line to another GL account. Usually accepted from the Payables Agent's or Data
// Health's suggestion; closes the matching gl_miscoded issue and logs the before/after.
registerAction({
  key: "bills.recode",
  label: "Recode a line",
  entity: "bills",
  roles: AP,
  icon: Wand2,
  when: (r: Row) => r.status !== "Void",
  input: z.strictObject({ line_id: z.string().min(1).max(80), gl_account_id: z.string().min(1).max(40), issue_id: z.string().max(80).optional(), agent: z.string().max(40).optional() }),
  handler: async (ctx, row, input) => {
    const { db, ws } = ctx;
    const id = String(row.id);
    const line = await db.prepare(`SELECT l.id, l.gl_account_id, l.description FROM ${effective("bill_lines", "?1")} l WHERE l.id = ?2 AND l.bill_id = ?3`).bind(ws, input.line_id, id).first<{ id: string; gl_account_id: string; description: string }>();
    if (!line) return { status: 404, error: "That line isn't on this bill" };
    if (line.gl_account_id === input.gl_account_id) return { status: 409, error: "The line is already coded to that account" };
    const gl = await db.prepare(`SELECT g.number || ' ' || g.name AS label FROM ${effective("gl_accounts", "?1")} g WHERE g.id = ?2 AND g.type IN ('Expense', 'Asset')`).bind(ws, input.gl_account_id).first<{ label: string }>();
    if (!gl) return { status: 400, error: "Pick an expense or capital GL account" };
    const at = nowIso(ctx.nowMs);
    const issue = input.issue_id ?? (await db.prepare(`SELECT di.id FROM ${effective("data_issues", "?1")} di WHERE di.rule_id LIKE '%gl_miscoded' AND di.entity_id IN (?2, ?3) AND di.status = 'open'`).bind(ws, id, line.id).first<{ id: string }>())?.id;
    await db.batch([
      db.prepare(overlayUpsertSql("bill_lines", LINE_COLS, { gl_account_id: "?3" })).bind(ws, line.id, input.gl_account_id),
      ...(issue
        ? [
            db.prepare(overlayUpsertSql("data_issues", ISSUE_COLS, { status: "'fixed'", fixed_by: "?3", fixed_at: "?4" }, "e.status = 'open'")).bind(ws, issue, ctx.actor.personaId, at),
            db.prepare("INSERT INTO data_fix_log (workspace_id, id, issue_id, entity_type, entity_id, before_json, after_json, fixed_by, agent, at) VALUES (?, ?, ?, 'bills', ?, ?, ?, ?, ?, ?)")
              .bind(ws, uid("fix"), issue, id, JSON.stringify({ line_id: line.id, gl_account_id: line.gl_account_id }), JSON.stringify({ line_id: line.id, gl_account_id: input.gl_account_id }), ctx.actor.personaId, input.agent ?? null, at),
          ]
        : []),
      auditStmt(db, ws, at, ctx.actor, { action: "Bill line recoded", entityType: "bills", entityId: id, propertyId: String(row.property_id), detail: `${line.description}: recoded to ${gl.label}`, before: { gl_account_id: line.gl_account_id }, after: { gl_account_id: input.gl_account_id }, agent: input.agent }),
    ]);
    return { status: 200, message: `Recoded to ${gl.label}` };
  },
  help: { summary: "Moves a bill line to the right GL account. Suggested recodes need a person to accept them.", article: "gl-recode-miscoded-bills" },
});

// Vendor bank changes (fraud control). A change is entered by an accountant, recorded as an open
// vendors.unverified_bank_change issue (which money.ts and bankHold() treat as a payment hold) and
// a vendor.bank_changed event for the Payables Agent. Lifting the hold needs a callback on the
// phone number already on file, recorded by a different person than the one who made the change.

const ConfirmInput = z.strictObject({ spoke_with: z.string().trim().min(2).max(120), phone_on_file: z.literal(true) });
const CONFIRM = { title: "Confirm the new bank details?", body: "Only confirm after calling the vendor on the phone number already on file, not one from the request. Payments resume right away.", tone: "warning" as const };

async function confirmBankChange(ctx: ActionContext, vendor: string, input: z.infer<typeof ConfirmInput>): Promise<ActionResult> {
  const { db, ws } = ctx;
  const at = nowIso(ctx.nowMs);
  const v = await db.prepare(`SELECT v.company, v.status, v.bank_changed_at FROM ${effective("vendors", "?1")} v WHERE v.id = ?2`).bind(ws, vendor).first<{ company: string; status: string; bank_changed_at: string | null }>();
  if (!v?.bank_changed_at) return { status: 409, error: "This vendor has no bank change to confirm" };
  const open = await db.prepare(`SELECT di.id, di.evidence FROM ${effective("data_issues", "?1")} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ?2 AND di.status = 'open'`).bind(ws, vendor).all<{ id: string; evidence: string }>();
  // Who entered the change comes from the append-only audit log, not the issue: an issue can be
  // dismissed from Data Health, which must not let the same person verify their own change.
  const entered = await db.prepare("SELECT actor_id FROM audit WHERE workspace_id IN ('base', ?1) AND action = 'Vendor bank account changed' AND entity_id = ?2 AND at >= ?3 ORDER BY at DESC LIMIT 1")
    .bind(ws, vendor, v.bank_changed_at).first<{ actor_id: string }>();
  const changedBy = entered?.actor_id ?? open.results.map((r) => { try { return (JSON.parse(r.evidence) as { changed_by?: string }).changed_by; } catch { return undefined; } }).find(Boolean);
  if (changedBy === ctx.actor.personaId) return { status: 403, error: "You entered this bank change, so someone else has to verify it" };
  const issueId = open.results[0]?.id ?? uid("di");
  const fix = open.results.length
    ? open.results.map((r) => db.prepare(overlayUpsertSql("data_issues", ISSUE_COLS, { status: "'fixed'", fixed_by: "?3", fixed_at: "?4" }, "e.status = 'open'")).bind(ws, r.id, ctx.actor.personaId, at))
    : [db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, status, fixed_by, fixed_at) VALUES (?, ?, 'vendors.unverified_bank_change', 'vendors', ?, NULL, ?, 'critical', ?, 'fixed', ?, ?)")
        .bind(ws, issueId, vendor, at, JSON.stringify({ bank_changed_at: v.bank_changed_at }), ctx.actor.personaId, at)];
  await db.batch([
    ...fix,
    // The Payables Agent's hold proposal sets a vendor Inactive; verification reactivates it.
    db.prepare(overlayUpsertSql("vendors", VENDOR_COLS, { status: "?3" })).bind(ws, vendor, v.status === "Inactive" ? "Active" : v.status),
    eventStmt(db, ws, at, "vendor.bank_change_verified", "vendors", vendor, null, { spoke_with: input.spoke_with, by: ctx.actor.personaId }),
    auditStmt(db, ws, at, ctx.actor, { action: "Vendor bank change verified", entityType: "vendors", entityId: vendor, detail: `${v.company}: verified by callback with ${input.spoke_with} on the number on file`, before: { hold: true }, after: { hold: false } }),
  ]);
  return { status: 200, message: `Bank change verified. Payments to ${v.company} can go out again.` };
}

registerAction({
  key: "vendors.change_bank_account",
  label: "Change bank account",
  entity: "vendors",
  roles: ["accountant"],
  icon: Landmark,
  input: z.strictObject({
    bank_last4: z.string().regex(/^\d{4}$/, "Enter the last 4 digits of the new account"),
    received_via: z.enum(["Vendor portal", "Email", "Letter", "Phone call"]),
    requested_by: z.string().trim().min(2).max(120),
    note: z.string().trim().max(500).optional(),
  }),
  confirm: { title: "Record a bank account change?", body: "Payments to this vendor stop until someone else calls the vendor on the number already on file and confirms the change.", tone: "warning" },
  handler: async (ctx, row, input) => {
    const { db, ws } = ctx;
    const vendor = String(row.id);
    const old = await db.prepare(`SELECT v.bank_last4 FROM ${effective("vendors", "?1")} v WHERE v.id = ?2`).bind(ws, vendor).first<{ bank_last4: string }>();
    if (old?.bank_last4 === input.bank_last4) return { status: 409, error: "That's the account already on file" };
    const at = nowIso(ctx.nowMs);
    const evidence = { old_last4: old?.bank_last4 ?? "", new_last4: input.bank_last4, received_via: input.received_via, requested_by: input.requested_by, changed_by: ctx.actor.personaId, note: input.note ?? "" };
    const why = ["Bank details changed and not yet verified by a callback on the number on file", `Request came by ${input.received_via.toLowerCase()} from ${input.requested_by}`];
    await db.batch([
      db.prepare(overlayUpsertSql("vendors", VENDOR_COLS, { bank_last4: "?3", bank_changed_at: "?4" })).bind(ws, vendor, input.bank_last4, at),
      // Close earlier open flags so exactly one open hold describes the latest change.
      db.prepare(overlayUpsertSql("data_issues", ISSUE_COLS, { status: "'dismissed'", fixed_by: "?3", fixed_at: "?4" }, "e.status = 'open'").replace("WHERE e.id = ?2", "WHERE e.entity_id = ?2 AND e.rule_id = 'vendors.unverified_bank_change'")).bind(ws, vendor, ctx.actor.personaId, at),
      db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix, status) VALUES (?, ?, 'vendors.unverified_bank_change', 'vendors', ?, NULL, ?, 'critical', ?, ?, 'open')")
        .bind(ws, uid("di"), vendor, at, JSON.stringify(evidence), JSON.stringify({ action: "vendors.confirm_bank_change", why, confidence: 0.99, source: "rule" })),
      db.prepare("INSERT INTO tasks (workspace_id, id, title, detail, entity_type, entity_id, assignee_role, created_by, due_on, priority, status, queue_state, source, created_at) VALUES (?, ?, ?, ?, 'vendors', ?, 'accountant', ?, ?, 'High', 'Open', 'needs_you', 'Automation', ?)")
        .bind(ws, uid("task"), `Verify ${String(row.company ?? vendor)}'s new bank account by callback`, `Call the number already on file (not one from the request). Account ending ${input.bank_last4}, requested by ${input.requested_by} via ${input.received_via.toLowerCase()}. Someone other than ${ctx.actor.name} must confirm.`, vendor, ctx.actor.personaId, at.slice(0, 10), at),
      eventStmt(db, ws, at, "vendor.bank_changed", "vendors", vendor, null, { old_last4: evidence.old_last4, new_last4: input.bank_last4, received_via: input.received_via, by: ctx.actor.personaId }),
      auditStmt(db, ws, at, ctx.actor, { action: "Vendor bank account changed", entityType: "vendors", entityId: vendor, detail: `Account ending ${evidence.old_last4 || "none"} → ${input.bank_last4}; requested by ${input.requested_by} via ${input.received_via.toLowerCase()}. Payments held until verified.`, before: { bank_last4: evidence.old_last4 }, after: { bank_last4: input.bank_last4 } }),
    ]);
    return { status: 200, message: `Bank account updated. Payments to ${String(row.company ?? vendor)} are on hold until someone else verifies it by callback.` };
  },
  help: { summary: "Records a new vendor bank account and holds payments until a second person verifies it by phone.", article: "vendor-bank-change-fraud-hold" },
});

registerAction({
  key: "vendors.confirm_bank_change",
  label: "Verify bank change",
  entity: "vendors",
  roles: ["accountant", "principal"],
  icon: ShieldCheck,
  when: (r: Row) => !!r.bank_changed_at,
  input: ConfirmInput,
  confirm: CONFIRM,
  handler: (ctx, row, input) => confirmBankChange(ctx, String(row.id), input),
  help: { summary: "Lifts the payment hold after a callback on the number on file. The person who entered the change can't verify it.", article: "vendor-bank-change-fraud-hold" },
});

// The same check from a held bill, where the hold actually stops a payment.
registerAction({
  key: "bills.confirm_vendor_bank",
  label: "Verify vendor bank change",
  entity: "bills",
  roles: ["accountant", "principal"],
  icon: ShieldCheck,
  when: (r: Row) => ["Draft", "Pending approval", "Approved"].includes(String(r.status)),
  input: ConfirmInput,
  confirm: CONFIRM,
  handler: (ctx, row, input) => confirmBankChange(ctx, String(row.vendor_id), input),
  help: { summary: "Lifts the vendor's payment hold after a callback on the number on file.", article: "vendor-bank-change-fraud-hold" },
});

