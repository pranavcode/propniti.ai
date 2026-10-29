import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SETTLE_MS, TRUST, addTransfer, approveWorkOrder as ledgerApprove, disburse as ledgerDisburse, ownerStatement, settle as ledgerSettle, trustBalance, vendorPaidYtd } from "@/lib/ledger";
import { applyMigrations, openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { submissionKey } from "@/lib/names";
import { seed } from "@/lib/seed";
import type { DemoState } from "@/lib/types";
import { attachDocument, importRows, reportIssue, setValidation, submitInvoice, updateJob } from "./actions";
import { approveWorkOrder, disburseOwner, payInvoice, settle } from "./money";
import { loadState, randomId } from "./repo";
import { nextMidnight, resetWorkspace, resolveWorkspace } from "./workspace";

// 10:00 in Los Angeles on the demo's date.
const T0 = Date.parse("2026-10-28T17:00:00Z");

const req = (ws?: string) => new Request("http://localhost/api/state", { headers: ws ? { cookie: `pn_ws=${ws}` } : {} });

async function setup(now = T0) {
  const db = openSqlite(":memory:");
  const ws = await newWorkspace(db, now);
  return { db, ws };
}
async function newWorkspace(db: Db, now = T0) {
  const id = randomId();
  const r = await resolveWorkspace(db, req(id), now, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return id;
}
// What a request sees: due transfers settled first, then the state.
async function view(db: Db, ws: string, now: number) {
  await settle(db, ws, now);
  return loadState(db, ws);
}
const count = (db: Db, sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<{ n: number }>().then((r) => r!.n);

describe("migrations", () => {
  it("apply to an empty database, and running them again changes nothing", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw);
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["workspaces", "users", "properties", "vendors", "tenancies", "invoices", "work_orders", "transfers", "ratings", "notifications", "audit", "d1_migrations"]));
    const before = raw.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    applyMigrations(raw);
    expect(raw.prepare("SELECT count(*) AS n FROM sqlite_master").get()).toEqual(before);
    expect(raw.prepare("SELECT count(*) AS n FROM d1_migrations").get()!.n).toBe(1);
  });
});

describe("workspace data", () => {
  it("round-trips the seed exactly: a new workspace reads back as seed()", async () => {
    const { db, ws } = await setup();
    expect(await loadState(db, ws)).toEqual(seed());
  });
});

describe("money", () => {
  it("rent: pending until 8 s pass, then trust gains the rent, the 8% fee is taken and the invoice is Paid", async () => {
    const { db, ws } = await setup();
    const before = await view(db, ws, T0);
    expect(await payInvoice(db, ws, before, "INV-2611-01", T0)).toEqual({ status: 200 });
    const paying = await view(db, ws, T0 + SETTLE_MS - 1);
    expect(paying.invoices.find((i) => i.id === "INV-2611-01")?.status).toBe("Processing");
    expect(trustBalance(paying).pendingIn).toBe(1850);
    const after = await view(db, ws, T0 + SETTLE_MS);
    expect(after.invoices.find((i) => i.id === "INV-2611-01")?.status).toBe("Paid");
    expect(after.transfers.find((t) => t.key === "fee:INV-2611-01")).toMatchObject({ amount: 148, status: "Cleared", kind: "Management fee" });
    expect(trustBalance(after).cleared).toBe(trustBalance(before).cleared + 1850 - 148);
    expect(after.notifications[0]).toMatchObject({ userId: "u-t1", message: "Payment received: $1,850 for INV-2611-01. Thank you!" });
    // Settling again does nothing more.
    await settle(db, ws, T0 + SETTLE_MS * 3);
    expect(await count(db, "SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = 'fee:INV-2611-01'", ws)).toBe(1);
  });

  it("vendor approval: Payment pending, then Paid when it clears; year-to-date counts cleared payouts only", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    expect(await approveWorkOrder(db, ws, s, "WO-1041", T0)).toEqual({ status: 200 });
    const pending = await view(db, ws, T0 + 1);
    expect(pending.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Payment pending");
    // Seed: 3,620 before the ledger plus September's cleared 1,240.
    expect(vendorPaidYtd(pending, "v1")).toBe(4860);
    const paid = await view(db, ws, T0 + SETTLE_MS);
    expect(paid.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Paid");
    expect(vendorPaidYtd(paid, "v1")).toBe(4860 + 635);
    expect(paid.notifications.some((n) => n.userId === "u-v1" && n.message === "$635 for WO-1041 has arrived in your account.")).toBe(true);
  });

  it("only approves submitted work", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    expect(await approveWorkOrder(db, ws, s, "WO-1043", T0)).toMatchObject({ status: 409, error: expect.stringContaining("in progress") });
    expect(await count(db, "SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = 'vendor:WO-1043'", ws)).toBe(0);
  });

  it("disburse pays exactly the owner's net, stamps the items, and refuses a second payout with nothing owed", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    const { net, items } = ownerStatement(s, "u-owner1");
    expect(net).toBe(4784);
    expect(await disburseOwner(db, ws, s, "u-owner1", "key-aaaaaaaa", T0)).toEqual({ status: 200 });
    const after = await view(db, ws, T0 + 1);
    const payout = after.transfers.find((t) => t.kind === "Owner payout" && t.status === "Pending")!;
    expect(payout).toMatchObject({ amount: 4784, key: "owner:key-aaaaaaaa", to: { id: "u-owner1" } });
    expect(after.transfers.filter((t) => t.statement === payout.id).map((t) => t.id).sort()).toEqual(items.map((t) => t.id).sort());
    expect(ownerStatement(after, "u-owner1").net).toBe(0);
    expect(await disburseOwner(db, ws, after, "u-owner1", "key-bbbbbbbb", T0 + 2)).toMatchObject({ status: 409, error: expect.stringContaining("Nothing is owed") });
    // A retry with the first key is answered as done, without paying again.
    expect(await disburseOwner(db, ws, after, "u-owner1", "key-aaaaaaaa", T0 + 3)).toEqual({ status: 200 });
    expect(await count(db, "SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND kind = 'Owner payout' AND status = 'Pending'", ws)).toBe(1);
  });

  it("refuses a vendor payout trust can't cover: no transfer, a refusal in the audit log", async () => {
    const { db, ws } = await setup();
    let s = await view(db, ws, T0);
    await disburseOwner(db, ws, s, "u-owner1", "key-owner-1", T0);
    s = await view(db, ws, T0);
    await disburseOwner(db, ws, s, "u-owner2", "key-owner-2", T0);
    s = await view(db, ws, T0);
    expect(trustBalance(s).available).toBe(160);
    const r = await approveWorkOrder(db, ws, s, "WO-1041", T0);
    expect(r).toMatchObject({ status: 409, error: "Trust account can't cover 635.00 (available 160.00)" });
    expect(await count(db, "SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = 'vendor:WO-1041'", ws)).toBe(0);
    const after = await loadState(db, ws);
    expect(after.audit[0]).toMatchObject({ action: "Approval refused", detail: "WO-1041: Trust account can't cover 635.00 (available 160.00)" });
    expect(after.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Submitted");
  });

  it("double clicks move money once: approve, pay and disburse", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    const approvals = await Promise.all([approveWorkOrder(db, ws, s, "WO-1041", T0), approveWorkOrder(db, ws, s, "WO-1041", T0)]);
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    const pays = await Promise.all([payInvoice(db, ws, s, "INV-2611-02", T0), payInvoice(db, ws, s, "INV-2611-02", T0)]);
    expect(pays.map((r) => r.status).sort()).toEqual([200, 409]);
    const s2 = await view(db, ws, T0);
    await Promise.all([
      disburseOwner(db, ws, s2, "u-owner2", "same-key-1234", T0),
      disburseOwner(db, ws, s2, "u-owner2", "same-key-1234", T0),
      disburseOwner(db, ws, s2, "u-owner2", "other-key-1234", T0),
    ]);
    const n = (key: string) => count(db, "SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key LIKE ?2", ws, key);
    expect(await n("vendor:WO-1041")).toBe(1);
    expect(await n("rent:INV-2611-02")).toBe(1);
    expect(await n("owner:%-key-1234")).toBe(1);
    const after = await loadState(db, ws);
    expect(after.audit.filter((a) => a.action === "Payment approved")).toHaveLength(1);
    expect(trustBalance(after).available).toBeGreaterThanOrEqual(0);
  });

  it("matches the pure ledger after the same flows", async () => {
    const { db, ws } = await setup();
    let s = await view(db, ws, T0);
    await payInvoice(db, ws, s, "INV-2611-01", T0);
    await approveWorkOrder(db, ws, s, "WO-1041", T0);
    s = await view(db, ws, T0 + SETTLE_MS);
    await disburseOwner(db, ws, s, "u-owner1", "parity-key-1", T0 + SETTLE_MS);
    const server = await view(db, ws, T0 + SETTLE_MS * 2);

    let n = 0;
    const id = () => `x${++n}`;
    let p: DemoState = seed();
    const inv = p.invoices.find((i) => i.id === "INV-2611-01")!;
    p = addTransfer(p, { key: "rent:INV-2611-01", kind: "Rent", from: { kind: "tenant", id: "u-t1", name: "Jasmine Brooks" }, to: TRUST, amount: inv.amount, propertyId: "p1", ref: inv.id, created: "now" }, T0, id());
    p = ledgerApprove(p, "WO-1041", T0, "now", id()).state;
    p = ledgerSettle(p, T0 + SETTLE_MS, "now", id).state;
    p = ledgerDisburse(p, "u-owner1", T0 + SETTLE_MS, "now", id()).state;
    p = ledgerSettle(p, T0 + SETTLE_MS * 2, "now", id).state;

    expect(trustBalance(server)).toEqual(trustBalance(p));
    for (const o of ["u-owner1", "u-owner2"]) expect({ ...ownerStatement(server, o), items: undefined }).toEqual({ ...ownerStatement(p, o), items: undefined });
    for (const v of ["v1", "v2", "v3"]) expect(vendorPaidYtd(server, v)).toBe(vendorPaidYtd(p, v));
    expect(server.invoices.map((i) => i.status)).toEqual(p.invoices.map((i) => i.status));
    expect(server.workOrders.map((w) => [w.id, w.status])).toEqual(p.workOrders.map((w) => [w.id, w.status]));
    expect(server.transfers.map((t) => [t.kind, t.amount, t.status]).sort()).toEqual(p.transfers.map((t) => [t.kind, t.amount, t.status]).sort());
  });
});

describe("other actions", () => {
  it("keeps a validation only for the invoice it was run on", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    const wo = s.workOrders.find((w) => w.id === "WO-1042")!;
    const stale = submissionKey(wo);
    await submitInvoice(db, ws, s, "WO-1042", [{ description: "Valve", amount: 120 }], [], "QF-1", T0);
    const v = { decision: "approve" as const, confidence: 0.9, matched: [], issues: [], summary: "ok", source: "mock" as const };
    await setValidation(db, ws, await loadState(db, ws), "WO-1042", v, stale, T0);
    expect((await loadState(db, ws)).workOrders.find((w) => w.id === "WO-1042")?.validation).toBeUndefined();
    const current = await loadState(db, ws);
    await setValidation(db, ws, current, "WO-1042", v, submissionKey(current.workOrders.find((w) => w.id === "WO-1042")!), T0);
    expect((await loadState(db, ws)).workOrders.find((w) => w.id === "WO-1042")?.validation).toEqual(v);
  });

  it("refuses to attach a scanned invoice whose lines don't add up", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    const inv = { isInvoice: true, vendor: "QuickFix", invoiceNumber: "Q-1", invoiceDate: "", lineItems: [{ description: "Valve", amount: 120 }], total: 500, currency: "USD", confidence: 0.9, issues: [] };
    expect(await attachDocument(db, ws, s, "WO-1042", inv, T0)).toMatchObject({ status: 409 });
    expect(await attachDocument(db, ws, s, "WO-1042", { ...inv, total: 120 }, T0)).toEqual({ status: 200 });
  });

  it("completes in-house jobs without a payout", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    expect(await updateJob(db, ws, s, "WO-1045", "Completed", undefined, T0)).toEqual({ status: 200 });
    await db.prepare("UPDATE work_orders SET status = 'Submitted' WHERE workspace_id = ?1 AND id = 'WO-1044'").bind(ws).run();
    expect(await approveWorkOrder(db, ws, await loadState(db, ws), "WO-1044", T0)).toEqual({ status: 200 });
    const after = await loadState(db, ws);
    expect(after.workOrders.filter((w) => ["WO-1044", "WO-1045"].includes(w.id)).map((w) => w.status)).toEqual(["Completed", "Completed"]);
    expect(after.transfers.some((t) => t.ref === "WO-1044" || t.ref === "WO-1045")).toBe(false);
  });

  it("numbers new jobs from the workspace counter, even when reported at once", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    await Promise.all([reportIssue(db, ws, s, "u-t1", "Sink leaking", T0), reportIssue(db, ws, s, "u-t1", "Door sticks", T0)]);
    const ids = (await loadState(db, ws)).workOrders.slice(0, 2).map((w) => w.id).sort();
    expect(ids).toEqual(["WO-1050", "WO-1051"]);
  });

  it("imports a rent roll once, even when the same file is imported twice at once", async () => {
    const { db, ws } = await setup();
    const s = await view(db, ws, T0);
    const rows = [
      { property: "Maple Court", unit: "1A", tenant: "Ana Ruiz", rent: "1500", owner: "Robert Chen" },
      { property: "Maple Court", unit: "1B", tenant: "Ben Ode", rent: "1450" },
    ];
    const results = await Promise.all([importRows(db, ws, s, rows, "test.csv", T0), importRows(db, ws, s, rows, "test.csv", T0)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await loadState(db, ws);
    expect(after.tenancies.filter((t) => t.unit === "1A" || t.unit === "1B")).toHaveLength(2);
    expect(after.properties.find((p) => p.name === "Maple Court")).toMatchObject({ units: 2, occupied: 2, ownerId: "u-owner1" });
    expect(new Set(after.users.map((u) => u.id)).size).toBe(after.users.length);
    expect(await importRows(db, ws, after, rows, "test.csv", T0)).toEqual({ status: 200 });
    expect((await loadState(db, ws)).tenancies).toHaveLength(after.tenancies.length);
    expect((await loadState(db, ws)).setup?.importedRows).toBe(2);
  });
});

describe("workspaces", () => {
  it("are isolated from each other", async () => {
    const db = openSqlite(":memory:");
    const a = await newWorkspace(db);
    const b = await newWorkspace(db);
    await payInvoice(db, a, await loadState(db, a), "INV-2611-01", T0);
    expect((await loadState(db, a)).invoices.find((i) => i.id === "INV-2611-01")?.status).toBe("Processing");
    expect(await loadState(db, b)).toEqual(seed());
  });

  it("reset puts the seed back under the same id", async () => {
    const { db, ws } = await setup();
    await payInvoice(db, ws, await loadState(db, ws), "INV-2611-01", T0);
    await resetWorkspace(db, ws, T0 + 1);
    expect(await loadState(db, ws)).toEqual(seed());
  });

  it("are wiped and started fresh after midnight, and old ones are swept", async () => {
    const db = openSqlite(":memory:");
    const ws = await newWorkspace(db);
    const other = await newWorkspace(db);
    await payInvoice(db, ws, await loadState(db, ws), "INV-2611-01", T0);
    const midnight = nextMidnight(T0);
    expect(await resolveWorkspace(db, req(ws), midnight - 1, false, false)).toEqual({ ws });
    expect((await loadState(db, ws)).invoices.find((i) => i.id === "INV-2611-01")?.status).toBe("Processing");
    expect(await resolveWorkspace(db, req(ws), midnight, false, false)).toEqual({ ws });
    expect(await loadState(db, ws)).toEqual(seed());
    expect(await count(db, "SELECT count(*) AS n FROM workspaces WHERE id = ?1", other)).toBe(0);
    expect(await count(db, "SELECT count(*) AS n FROM users WHERE workspace_id = ?1", other)).toBe(0);
  });

  it("aren't created for a reader that never sends the cookie back", async () => {
    const db = openSqlite(":memory:");
    const r = await resolveWorkspace(db, req(), T0, false, false);
    expect(r).toMatchObject({ ws: null, setCookie: expect.any(String) });
    expect(await count(db, "SELECT count(*) AS n FROM workspaces")).toBe(0);
  });

  it("limits how many a network can create in an hour", async () => {
    const db = openSqlite(":memory:");
    const make = () => resolveWorkspace(db, new Request("http://x", { headers: { "cf-connecting-ip": "9.9.9.9" } }), T0, true, true);
    for (let i = 0; i < 5; i++) expect(await make()).not.toBeInstanceOf(Response);
    expect(((await make()) as Response).status).toBe(429);
  });
});

describe("nextMidnight", () => {
  const wall = (ms: number, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", dateStyle: "short", timeStyle: "short" }).format(ms);

  it("finds the next local midnight in UTC and in New York", () => {
    expect(nextMidnight(Date.parse("2026-10-28T23:59:00Z"), "UTC")).toBe(Date.parse("2026-10-29T00:00:00Z"));
    // 11 pm on Oct 28 in New York (UTC-4) is already Oct 29 in UTC.
    expect(nextMidnight(Date.parse("2026-10-29T03:00:00Z"), "America/New_York")).toBe(Date.parse("2026-10-29T04:00:00Z"));
  });

  it("lands on 00:00 Los Angeles time across daylight saving changes", () => {
    const la = "America/Los_Angeles";
    // Fall back (Nov 1, 2026): 1:30 am PDT → midnight starting Nov 2, now PST (UTC-8).
    expect(nextMidnight(Date.parse("2026-11-01T08:30:00Z"), la)).toBe(Date.parse("2026-11-02T08:00:00Z"));
    // 11 pm PDT on Oct 31 → midnight Nov 1, still PDT (UTC-7).
    expect(nextMidnight(Date.parse("2026-11-01T06:00:00Z"), la)).toBe(Date.parse("2026-11-01T07:00:00Z"));
    // Spring forward (Mar 14, 2027): 1 am PST → midnight Mar 15, now PDT (UTC-7).
    expect(nextMidnight(Date.parse("2027-03-14T09:00:00Z"), la)).toBe(Date.parse("2027-03-15T07:00:00Z"));
    // 11 pm PST on Mar 13 → midnight Mar 14, still PST.
    expect(nextMidnight(Date.parse("2027-03-14T07:00:00Z"), la)).toBe(Date.parse("2027-03-14T08:00:00Z"));
    for (const t of ["2026-11-01T08:30:00Z", "2027-03-14T09:00:00Z", "2026-10-28T17:00:00Z"]) expect(wall(nextMidnight(Date.parse(t), la), la)).toMatch(/, 00:00$/);
  });
});
