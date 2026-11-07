import { beforeAll, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import { getAction } from "@/extensions/actions";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { createRecord, getDef, getRow, list, metrics, writeSchema, type QueryCtx } from "@/server/query";
import { resolveActor } from "@/server/permissions";
import { runAction } from "@/app/api/e/_lib/actions";

// Finance lane: every entity lists through the generic query layer, every metric runs on the
// generated base, and the bill money flow (draft → submit → approve → pay) moves money once.

const WS = "finance-test-workspace-0000001";
const ENTITIES = ["bills", "recurring_bills", "vendor_1099s", "bank_accounts", "bank_transactions", "bank_reconciliations", "gl_accounts", "journal_entries", "budgets", "capex_projects", "utility_meters", "utility_bills"];
const METRICS = ["payables.aging", "payables.open_ap", "payables.past_due", "payables.to_approve", "payables.paid_month", "payables.spend_by_gl", "accounting.trust_cash", "accounting.unreconciled", "accounting.income_expense", "accounting.budget_vs_actual", "accounting.capex_over", "accounting.capex_by_property", "accounting.utilities_by_month", "accounting.cash_forecast"];

let db: Db;
let ctx: QueryCtx;

beforeAll(async () => {
  db = openSqlite(":memory:");
  await db.prepare("INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES (?, 'demo', 0, 0)").bind(WS).run();
  ctx = { db, ws: WS, actor: await resolveActor(db, getPersona("grace")!, WS) };
}, 120_000);

const write = () => ({ ...ctx, ws: WS, nowMs: Date.parse("2026-11-04T15:00:00Z") });

describe("finance entities and metrics", () => {
  it.each(ENTITIES)("lists %s for the accountant", async (e) => {
    const r = await list(ctx, e, { size: 5 });
    expect(r.page).toBe(1);
    expect(r.rows.length).toBeLessThanOrEqual(5);
  });

  it.each(METRICS)("runs metric %s", async (k) => {
    const m = await metrics(ctx, k);
    expect(Array.isArray(m.points)).toBe(true);
  });

  it("forecasts 13 weeks from the trust balance", async () => {
    const m = await metrics(ctx, "accounting.cash_forecast");
    expect(m.points).toHaveLength(13);
    expect(Number(m.previous)).toBeGreaterThan(0);
  });

  it("forecasts rent from cash received (payments not returned), not from what the month's charges were paid", async () => {
    const { cashForecast } = await import("@/extensions/accounting/metrics");
    const asOf = String((await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())!.value).slice(0, 7);
    const back = (n: number) => { const [y, m] = asOf.split("-").map(Number); return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7); };
    const cash = await db.prepare("SELECT sum(amount_cents) AS c FROM payments WHERE workspace_id = 'base' AND nsf = 0 AND received_on >= ? AND received_on < ?").bind(`${back(3)}-01`, `${asOf}-01`).first<{ c: number }>();
    const usd = `$${Math.round(Math.floor(cash!.c / 3) / 100).toLocaleString("en-US")}`;
    const f = await cashForecast({ ...ctx, propertyIds: ctx.actor.propertyIds, asOf });
    expect(f.assumptions[0]).toContain(`Rent: ${usd} a month (average cash received`);
  });

  it("buckets open payables by age", async () => {
    const m = await metrics(ctx, "payables.aging");
    expect(m.points.map((p) => p.bucket)).toEqual(["Current", "1-30", "31-60", "61+"]);
    expect(Number(m.value)).toBeGreaterThan(0);
  });
});

describe("bill money flow", () => {
  it("creates a draft, submits, approves and pays once on a double click", async () => {
    const w = write();
    const draft = await createRecord(w, "bills", { vendor_id: "v01", property_id: "p01", owner_entity_id: "oe01", invoice_number: "LSP-TEST-1", bill_date: "2026-11-03", due_on: "2026-12-03", amount: 480, status: "Draft" });
    const id = String(draft.id);
    const submit = await runAction(w, getAction("bills.submit")!, id, { lines: [{ description: "Replace kitchen faucet, unit 412", gl_account_id: "gl-6000", amount: 480 }] });
    expect(submit.status).toBe(200);
    expect((await getRow(ctx, "bills", id))?.status).toBe("Pending approval");
    const daniel = { ...w, actor: await resolveActor(db, getPersona("daniel")!, WS) };
    expect((await runAction(daniel, getAction("bills.approve")!, id, {})).status).toBe(200);
    const pay = getAction("bills.pay")!;
    const results = await Promise.all([runAction(w, pay, id, {}), runAction(w, pay, id, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const n = await db.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND key = ?").bind(WS, `vendor:${id}`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("refuses approval by the person who entered or submitted the bill, in SQL too", async () => {
    const grace = write();
    const daniel = { ...grace, actor: await resolveActor(db, getPersona("daniel")!, WS) };
    const draft = await createRecord(grace, "bills", { vendor_id: "v01", property_id: "p01", owner_entity_id: "oe01", invoice_number: "LSP-TEST-MC", bill_date: "2026-11-03", due_on: "2026-12-03", amount: 220, status: "Draft" });
    const id = String(draft.id);
    expect((await runAction(grace, getAction("bills.submit")!, id, { lines: [{ description: "Disposal", gl_account_id: "gl-6000", amount: 220 }] })).status).toBe(200);
    expect(await runAction(grace, getAction("bills.approve")!, id, {})).toMatchObject({ status: 403 });
    expect(await runAction(grace, getAction("bills.approve_and_pay")!, id, {})).toMatchObject({ status: 403 });
    // The SQL guard decides even when the JavaScript check is skipped.
    const { approveBill } = await import("@/server/money");
    expect((await approveBill({ ...grace }, id)).status).toBe(403);
    expect((await getRow(ctx, "bills", id))?.status).toBe("Pending approval");
    const n = await db.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND key = ?").bind(WS, `vendor:${id}`).first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect((await runAction(daniel, getAction("bills.approve")!, id, {})).status).toBe(200);
  });

  it("pays a bill over the bill-payment limit only for a payables approver, the rule the payment run routes to", async () => {
    const w = write();
    const { payBill } = await import("@/server/money");
    const over = await db.prepare("SELECT b.id FROM bills b WHERE b.workspace_id = 'base' AND b.status = 'Approved' AND b.property_id = 'p01' AND b.amount_cents > 500000 LIMIT 1").first<{ id: string }>();
    const id = over?.id ?? String((await db.prepare("INSERT INTO bills (workspace_id, id, property_id, owner_entity_id, vendor_id, invoice_number, bill_date, due_on, amount_cents, status) VALUES (?, 'b-over-limit', 'p01', 'oe01', 'v01', 'LSP-BIG', '2026-11-01', '2026-11-20', 600000, 'Approved') RETURNING id").bind(WS).first<{ id: string }>())!.id);
    for (const persona of ["marcus", "tom", "lena"]) expect((await payBill({ ...w, actor: await resolveActor(db, getPersona(persona)!, WS) }, id)).status).toBe(403);
    expect(await db.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND key = ?").bind(WS, `vendor:${id}`).first()).toMatchObject({ n: 0 });
  });

  it("refuses to create a bill in any status but Draft", async () => {
    const schema = writeSchema(getDef("bills"), "accountant", "create");
    const body = { vendor_id: "v01", property_id: "p01", owner_entity_id: "oe01", invoice_number: "X", bill_date: "2026-11-03", due_on: "2026-12-03", amount: 10 };
    expect(schema.safeParse({ ...body, status: "Paid" }).success).toBe(false);
    expect(schema.safeParse({ ...body, status: "Draft" }).success).toBe(true);
  });

  it("holds approval while a vendor's bank change is unverified, until someone confirms it", async () => {
    const w = write();
    await db.prepare("INSERT INTO vendors (workspace_id, id, company, trade, bank_last4, bank_changed_at, status) SELECT ?, id, company, trade, '0001', '2026-10-30T12:00:00Z', status FROM vendors WHERE workspace_id = 'base' AND id = 'v02'").bind(WS).run();
    const draft = await createRecord(w, "bills", { vendor_id: "v02", property_id: "p01", owner_entity_id: "oe01", invoice_number: "HCH-TEST-9", bill_date: "2026-11-03", due_on: "2026-12-03", amount: 900, status: "Draft" });
    const id = String(draft.id);
    await runAction(w, getAction("bills.submit")!, id, { lines: [{ description: "Compressor", gl_account_id: "gl-6000", amount: 900 }] });
    const refused = await runAction(w, getAction("bills.approve")!, id, {});
    expect(refused.status).toBe(409);
    expect(await runAction(w, getAction("bills.confirm_vendor_bank")!, id, { spoke_with: "Dana Whitaker", phone_on_file: true })).toMatchObject({ status: 200 });
    const daniel = { ...w, actor: await resolveActor(db, getPersona("daniel")!, WS) };
    expect((await runAction(daniel, getAction("bills.approve")!, id, {})).status).toBe(200);
  });

  it("recodes a line and records the before and after", async () => {
    const w = write();
    const bill = await db.prepare("SELECT b.id, l.id AS line FROM bills b JOIN bill_lines l ON l.bill_id = b.id AND l.workspace_id = 'base' WHERE b.workspace_id = 'base' AND l.gl_account_id = 'gl-6100' AND b.property_id = 'p01' LIMIT 1").first<{ id: string; line: string }>();
    const r = await runAction(w, getAction("bills.recode")!, bill!.id, { line_id: bill!.line, gl_account_id: "gl-6000" });
    expect(r.status).toBe(200);
    const line = await db.prepare("SELECT gl_account_id FROM bill_lines WHERE workspace_id = ? AND id = ?").bind(WS, bill!.line).first<{ gl_account_id: string }>();
    expect(line?.gl_account_id).toBe("gl-6000");
  });
});

describe("vendor bank account changes", () => {
  it("holds payments after a change until a different person verifies it by callback", async () => {
    const grace = write();
    const daniel = { ...grace, actor: await resolveActor(db, getPersona("daniel")!, WS) };
    const marcus = { ...grace, actor: await resolveActor(db, getPersona("marcus")!, WS) };
    const change = getAction("vendors.change_bank_account")!;
    const input = { bank_last4: "7781", received_via: "Email", requested_by: "Office manager" };
    await expect(runAction(marcus, change, "v03", input)).rejects.toThrow(/can't/);
    expect((await runAction(grace, change, "v03", input)).status).toBe(200);
    const draft = await createRecord(grace, "bills", { vendor_id: "v03", property_id: "p01", owner_entity_id: "oe01", invoice_number: "CCE-TEST-3", bill_date: "2026-11-03", due_on: "2026-12-03", amount: 300, status: "Draft" });
    await runAction(grace, getAction("bills.submit")!, String(draft.id), { lines: [{ description: "Breaker", gl_account_id: "gl-6000", amount: 300 }] });
    expect((await runAction(grace, getAction("bills.approve")!, String(draft.id), {})).status).toBe(409);
    const confirm = getAction("vendors.confirm_bank_change")!;
    expect((await runAction(grace, confirm, "v03", { spoke_with: "Ana Ruiz", phone_on_file: true })).status).toBe(403);
    // Dismissing the flag from Data Health doesn't let the same person verify their own change.
    await db.prepare("UPDATE data_issues SET status = 'dismissed' WHERE workspace_id = ? AND entity_id = 'v03' AND rule_id = 'vendors.unverified_bank_change'").bind(WS).run();
    expect((await runAction(grace, getAction("bills.approve")!, String(draft.id), {})).status).toBe(409);
    expect((await runAction(grace, confirm, "v03", { spoke_with: "Ana Ruiz", phone_on_file: true })).status).toBe(403);
    expect((await runAction(daniel, confirm, "v03", { spoke_with: "Ana Ruiz", phone_on_file: true })).status).toBe(200);
    expect((await runAction(daniel, getAction("bills.approve")!, String(draft.id), {})).status).toBe(200);
  });
});

describe("1099 preparation", () => {
  it("totals vendor payouts per payer and finds reportable vendors", async () => {
    const { prepare1099 } = await import("./tax");
    const r = await prepare1099(db, WS, ctx.actor, 2025);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.some((x) => x.state === "Reportable")).toBe(true);
    const r26 = await prepare1099(db, WS, ctx.actor, 2026);
    expect(r26.rows.length).toBeGreaterThan(0);
  });
});
