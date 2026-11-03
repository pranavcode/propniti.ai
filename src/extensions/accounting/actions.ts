import { z } from "zod";
import { Ban, BadgeCheck, Link2 } from "lucide-react";
import type { Role, Row } from "@/entities/types";
import { uid } from "@/server/money";
import { effective, overlayUpsertSql } from "@/server/effective";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";

// Bank reconciliation actions. Matching links a statement line to a ledger transfer; it moves no
// money. Approving a month is refused while the statement and book disagree or a line is unmatched.
// runAction (src/app/api/e/_lib/actions.ts) writes the audit row for each.

const RECON: Role[] = ["accountant", "principal"];
const TX_COLS = ["id", "deleted", "bank_account_id", "posted_on", "description", "amount_cents", "transfer_id"];
const ITEM_COLS = ["id", "deleted", "reconciliation_id", "bank_transaction_id", "transfer_id", "status", "confidence", "note"];
const REC_COLS = ["id", "deleted", "bank_account_id", "period", "statement_balance_cents", "book_balance_cents", "status", "completed_by", "completed_at"];
const ISSUE_COLS = ["id", "deleted", "rule_id", "entity_type", "entity_id", "property_id", "detected_at", "severity", "evidence", "suggested_fix", "status", "fixed_by", "fixed_at"];
const INFLOW = "('Rent', 'Deposit', 'Other receipt')";

registerAction({
  key: "bank_transactions.match",
  label: "Match to ledger",
  entity: "bank_transactions",
  roles: RECON,
  icon: Link2,
  bulk: true,
  when: (r: Row) => r.match === "Unmatched",
  input: z.strictObject({ transfer_id: z.string().min(1).max(80), confidence: z.number().min(0).max(1).optional(), reconciliation_id: z.string().max(80).optional() }),
  handler: async (ctx, row, input) => {
    const { db, ws } = ctx;
    const line = String(row.id);
    const t = await db
      .prepare(`SELECT t.id, CASE WHEN t.kind IN ${INFLOW} THEN t.amount_cents ELSE -t.amount_cents END AS signed, t.bank_account_id,
          (SELECT count(*) FROM ${effective("bank_transactions", "?1")} b WHERE b.transfer_id = t.id AND b.id <> ?3) AS taken
        FROM ${effective("transfers", "?1")} t WHERE t.id = ?2`)
      .bind(ws, input.transfer_id, line)
      .first<{ id: string; signed: number; bank_account_id: string; taken: number }>();
    if (!t) return { status: 404, error: "Ledger transfer not found" };
    if (t.bank_account_id !== row.bank_account_id) return { status: 400, error: "That transfer is on a different bank account" };
    if (Math.sign(t.signed) !== Math.sign(Math.round(Number(row.amount) * 100))) return { status: 400, error: "A deposit can only match money in, and a withdrawal money out" };
    if (t.taken) return { status: 409, error: "That transfer is already matched to another statement line" };
    const at = nowIso(ctx.nowMs);
    const [upd] = await db.batch([db.prepare(overlayUpsertSql("bank_transactions", TX_COLS, { transfer_id: "?3" }, "e.transfer_id IS NULL")).bind(ws, line, t.id)]);
    if (!upd.meta.changes) return { status: 409, error: "This line is already matched" };
    const rec = input.reconciliation_id ?? null;
    const item = rec ? await db.prepare(`SELECT id FROM ${effective("reconciliation_items", "?1")} WHERE reconciliation_id = ?2 AND bank_transaction_id = ?3`).bind(ws, rec, line).first<{ id: string }>() : null;
    const issues = await db.prepare(`SELECT id FROM ${effective("data_issues", "?1")} WHERE rule_id = 'bank_transactions.unmatched_deposit' AND entity_id = ?2 AND status = 'open'`).bind(ws, line).all<{ id: string }>();
    const note = input.confidence != null ? `Accepted AI match (${Math.round(input.confidence * 100)}% confidence)` : "Matched by hand";
    await db.batch([
      ...(item
        ? [db.prepare(overlayUpsertSql("reconciliation_items", ITEM_COLS, { status: "'Matched'", transfer_id: "?3", confidence: "?4", note: "?5" })).bind(ws, item.id, t.id, input.confidence ?? 1, note)]
        : rec
          ? [db.prepare("INSERT INTO reconciliation_items (workspace_id, id, reconciliation_id, bank_transaction_id, transfer_id, status, confidence, note) VALUES (?, ?, ?, ?, ?, 'Matched', ?, ?)").bind(ws, uid("ri"), rec, line, t.id, input.confidence ?? 1, note)]
          : []),
      ...issues.results.map((i) => db.prepare(overlayUpsertSql("data_issues", ISSUE_COLS, { status: "'fixed'", fixed_by: "?3", fixed_at: "?4" }, "e.status = 'open'")).bind(ws, i.id, ctx.actor.personaId, at)),
      ...issues.results.map((i) => db.prepare("INSERT INTO data_fix_log (workspace_id, id, issue_id, entity_type, entity_id, before_json, after_json, fixed_by, agent, at) VALUES (?, ?, ?, 'bank_transactions', ?, ?, ?, ?, ?, ?)")
        .bind(ws, uid("fix"), i.id, line, JSON.stringify({ transfer_id: null }), JSON.stringify({ transfer_id: t.id }), ctx.actor.personaId, input.confidence != null ? "reconciliation" : null, at)),
    ]);
    return { status: 200, message: `${String(row.description ?? line)} matched to ${t.id}` };
  },
  help: { summary: "Links a bank statement line to the ledger transfer it represents. Accepting an AI-suggested match does the same.", article: "bank-reconciliation-ai-matches" },
});

// Rejecting a suggested match is saved as an Unmatched item for that line, with the rejected
// transfer in the note, so the suggestion doesn't come back on the next load.
registerAction({
  key: "bank_transactions.reject_match",
  label: "Reject suggested match",
  entity: "bank_transactions",
  roles: RECON,
  icon: Ban,
  when: (r: Row) => r.match === "Unmatched",
  input: z.strictObject({ transfer_id: z.string().min(1).max(80), reconciliation_id: z.string().min(1).max(80) }),
  handler: async (ctx, row, input) => {
    const { db, ws } = ctx;
    const line = String(row.id);
    const rec = await db.prepare(`SELECT r.status FROM ${effective("bank_reconciliations", "?1")} r WHERE r.id = ?2 AND r.bank_account_id = ?3`).bind(ws, input.reconciliation_id, String(row.bank_account_id)).first<{ status: string }>();
    if (!rec) return { status: 404, error: "Reconciliation not found for this account" };
    if (rec.status === "Approved") return { status: 409, error: "This reconciliation is already approved" };
    const note = `Suggested match to ${input.transfer_id} rejected by ${ctx.actor.name}`;
    const item = await db.prepare(`SELECT id FROM ${effective("reconciliation_items", "?1")} WHERE reconciliation_id = ?2 AND bank_transaction_id = ?3`).bind(ws, input.reconciliation_id, line).first<{ id: string }>();
    await db.batch([
      item
        ? db.prepare(overlayUpsertSql("reconciliation_items", ITEM_COLS, { status: "'Unmatched'", transfer_id: "NULL", confidence: "NULL", note: "?3" }, "e.status <> 'Matched'")).bind(ws, item.id, note)
        : db.prepare("INSERT INTO reconciliation_items (workspace_id, id, reconciliation_id, bank_transaction_id, transfer_id, status, confidence, note) VALUES (?, ?, ?, ?, NULL, 'Unmatched', NULL, ?)").bind(ws, uid("ri"), input.reconciliation_id, line, note),
    ]);
    return { status: 200, message: "Suggestion rejected. The line stays unmatched until you match it by hand." };
  },
  help: { summary: "Rejects an AI-suggested match. The line stays unmatched and the suggestion isn't offered again.", article: "bank-reconciliation-ai-matches" },
});

registerAction({
  key: "bank_reconciliations.approve",
  label: "Approve reconciliation",
  entity: "bank_reconciliations",
  roles: RECON,
  icon: BadgeCheck,
  when: (r: Row) => ["Open", "Balanced"].includes(String(r.status)),
  confirm: { title: "Approve this reconciliation?", body: "The month is closed for this account. The statement and book balances must agree and every statement line must be matched." },
  handler: async (ctx, row) => {
    const { db, ws } = ctx;
    const at = nowIso(ctx.nowMs);
    const unmatched = `(SELECT count(*) FROM ${effective("bank_transactions", "?1")} b WHERE b.bank_account_id = e.bank_account_id AND substr(b.posted_on, 1, 7) = e.period AND b.transfer_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ${effective("reconciliation_items", "?1")} i WHERE i.bank_transaction_id = b.id AND i.reconciliation_id = e.id AND i.status = 'Excluded'))`;
    const [r] = await db.batch([
      db.prepare(overlayUpsertSql("bank_reconciliations", REC_COLS, { status: "'Approved'", completed_by: "?3", completed_at: "?4" },
        `e.status IN ('Open', 'Balanced') AND e.statement_balance_cents = e.book_balance_cents AND ${unmatched} = 0`)).bind(ws, String(row.id), ctx.actor.personaId, at),
    ]);
    if (r.meta.changes) return { status: 200, message: `${String(row.title ?? row.id)} approved` };
    const diff = Math.round((Number(row.statement_balance ?? 0) - Number(row.book_balance ?? 0)) * 100);
    if (diff) return { status: 409, error: `Statement and book differ by $${(Math.abs(diff) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}. Resolve the difference first.` };
    if (!["Open", "Balanced"].includes(String(row.status))) return { status: 409, error: "This reconciliation is already approved" };
    return { status: 409, error: "Some statement lines are still unmatched. Match or exclude them first." };
  },
  help: { summary: "Closes the month for one bank account once every line is matched and the balances agree.", article: "bank-reconciliation-ai-matches" },
});
