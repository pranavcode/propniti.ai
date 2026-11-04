import { beforeEach, describe, expect, it } from "vitest";
import type { ActionContext, Actor } from "@/entities/types";
import { getAction } from "@/extensions/actions";
import type { Db } from "@/lib/platform/types";
import { emptyDb } from "@/server/query.fixture";
import "../actions";
import { loadReconciliation } from "./data";

// Reconciliation on a small fixture (no generated base): one trust account, October statement
// lines, ledger transfers, one planted unexplained deposit with its data issue.

const WS = "recon-test-workspace-00000001";
const actor: Actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" };
let db: Db;
let ctx: ActionContext;

const tr = (id: string, kind: string, amount: number, to: string, on: string, ref = "") =>
  `INSERT INTO transfers (workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, cleared)
   VALUES ('base', '${id}', 'k:${id}', '${kind}', 'ba-oe01-trust', 'oe01', 'x', 'x', '${kind === "Rent" ? "Deposit batch · The Lofts" : "Operating trust"}', 'x', 'x', '${to}', ${amount}, 'p01', '${ref}', 'Cleared', '${on}T10:00:00Z', '${on}T10:00:00Z')`;
const bt = (id: string, on: string, desc: string, amount: number, transfer: string | null) =>
  `INSERT INTO bank_transactions (workspace_id, id, bank_account_id, posted_on, description, amount_cents, transfer_id) VALUES ('base', '${id}', 'ba-oe01-trust', '${on}', '${desc}', ${amount}, ${transfer ? `'${transfer}'` : "NULL"})`;

beforeEach(async () => {
  db = emptyDb();
  ctx = { db, ws: WS, actor, nowMs: Date.parse("2026-11-04T15:00:00Z") };
  const sql = [
    `INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('${WS}', 'demo', 0, 0)`,
    "INSERT INTO meta (key, value) VALUES ('as_of', '2026-11-04')",
    "INSERT INTO bank_accounts (workspace_id, id, owner_entity_id, name, kind, bank, last4) VALUES ('base', 'ba-oe01-trust', 'oe01', 'Bluebonnet operating trust', 'Trust', 'Frost Bank', '1234')",
    tr("t-batch", "Rent", 1250000, "Operating trust", "2026-10-02"),
    tr("t-plumb", "Vendor payout", 48000, "Lone Star Plumbing", "2026-10-14", "BILL-20001"),
    tr("t-hvac", "Vendor payout", 91000, "Hill Country HVAC", "2026-10-20", "BILL-20002"),
    bt("b1", "2026-10-02", "ACH CREDIT BATCH LOFTS", 1250000, "t-batch"),
    bt("b2", "2026-10-15", "ACH DEBIT LONE STAR PLUMBING", -48000, null),
    bt("b3", "2026-10-21", "MOBILE DEPOSIT", 31337, null),
    "INSERT INTO bank_reconciliations (workspace_id, id, bank_account_id, period, statement_balance_cents, book_balance_cents, status) VALUES ('base', 'rec-1', 'ba-oe01-trust', '2026-10', 100000, 100000, 'Open')",
    "INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, detected_at, severity, status) VALUES ('base', 'di-1', 'bank_transactions.unmatched_deposit', 'bank_transactions', 'b3', '2026-10-22', 'warn', 'open')",
  ];
  for (const s of sql) await db.prepare(s).run();
});

const row = async (table: string, id: string) => db.prepare(`SELECT * FROM ${table} WHERE id = ? ORDER BY workspace_id = 'base' LIMIT 1`).bind(id).first<Record<string, unknown>>();

describe("reconciliation", () => {
  it("pairs lines live when no items exist and flags the unexplained deposit", async () => {
    const v = (await loadReconciliation(db, WS, "rec-1"))!;
    expect(v.source).toBe("live");
    expect(v.counts).toMatchObject({ Matched: 1, Suggested: 1, Unmatched: 1, unexplained: 1 });
    expect(v.matches.find((m) => m.line.id === "b2")?.transfer?.id).toBe("t-plumb");
    expect(v.issues.b3?.id).toBe("di-1");
    expect(v.unmatchedLedger.map((t) => t.id)).toEqual(["t-hvac"]);
  });

  it("accepting a match links the line, records the item and won't reuse the transfer", async () => {
    const match = getAction("bank_transactions.match")!;
    const b2 = { ...(await row("bank_transactions", "b2")), match: "Unmatched", amount: -480 };
    expect((await match.handler(ctx, b2, { transfer_id: "t-plumb", confidence: 0.97, reconciliation_id: "rec-1" })).status).toBe(200);
    expect((await row("bank_transactions", "b2"))?.transfer_id).toBe("t-plumb");
    const v = (await loadReconciliation(db, WS, "rec-1"))!;
    expect(v.counts.Matched).toBe(2);
    const b3 = { ...(await row("bank_transactions", "b3")), match: "Unmatched", amount: 313.37 };
    expect((await match.handler(ctx, b3, { transfer_id: "t-plumb" })).status).toBe(400);
  });

  it("remembers a rejected suggestion across loads", async () => {
    const reject = getAction("bank_transactions.reject_match")!;
    const b2 = { ...(await row("bank_transactions", "b2")), match: "Unmatched", amount: -480 };
    expect((await reject.handler(ctx, b2, { transfer_id: "t-plumb", reconciliation_id: "rec-1" })).status).toBe(200);
    const v = (await loadReconciliation(db, WS, "rec-1"))!;
    const m = v.matches.find((x) => x.line.id === "b2")!;
    expect(m.status).toBe("Unmatched");
    expect(m.transfer).toBeNull();
    expect(v.counts.Suggested).toBe(0);
  });

  it("closes the unexplained-deposit issue when that deposit is matched", async () => {
    await db.prepare(tr("t-late", "Rent", 31337, "Operating trust", "2026-10-20")).run();
    const b3 = { ...(await row("bank_transactions", "b3")), match: "Unmatched", amount: 313.37 };
    expect((await getAction("bank_transactions.match")!.handler(ctx, b3, { transfer_id: "t-late", reconciliation_id: "rec-1" })).status).toBe(200);
    const issue = await db.prepare("SELECT status FROM data_issues WHERE workspace_id = ? AND id = 'di-1'").bind(WS).first<{ status: string }>();
    expect(issue?.status).toBe("fixed");
  });

  it("refuses approval while lines are unmatched, then approves", async () => {
    const approve = getAction("bank_reconciliations.approve")!;
    const rec = { ...(await row("bank_reconciliations", "rec-1")), statement_balance: 1000, book_balance: 1000 };
    expect((await approve.handler(ctx, rec, undefined)).status).toBe(409);
    await db.prepare("UPDATE bank_transactions SET transfer_id = 't-plumb' WHERE id = 'b2'").run();
    await db.prepare("UPDATE bank_transactions SET transfer_id = 't-hvac' WHERE id = 'b3'").run();
    expect((await approve.handler(ctx, rec, undefined)).status).toBe(200);
    expect((await db.prepare("SELECT status FROM bank_reconciliations WHERE workspace_id = ? AND id = 'rec-1'").bind(WS).first<{ status: string }>())?.status).toBe("Approved");
  });
});
