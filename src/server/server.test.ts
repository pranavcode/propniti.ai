import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/entities/types";
import { SETTLE_MS } from "@/lib/ledger";
import { applyMigrations, openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { chargeStatusSql, get, list, ownerStatement, trustBalances } from "./data";
import { effective } from "./effective";
import { approveAndPayWorkOrder, approveBill, distributeOwner, payBill, payRent, postLateFees, recordPayment, settle } from "./money";
import { randomId } from "./repo";
import { nextMidnight, resetWorkspace, resolveWorkspace } from "./workspace";

// v2 storage on node:sqlite: the generated base plus a per-visitor overlay. One database holds
// the base for the whole file; each test gets its own workspace (an overlay), which is the point.

const T0 = Date.parse("2026-11-04T17:00:00Z"); // 9:00 in Los Angeles on the demo's date
const req = (ws?: string) => new Request("http://localhost/app", { headers: ws ? { cookie: `pn_ws=${ws}` } : {} });
const marcus: Actor = { personaId: "marcus", name: "Marcus Bell", role: "property_manager", scope: { kind: "property", ids: ["p01", "p02", "p03"], label: "3 Austin properties" }, propertyIds: ["p01", "p02", "p03"] };
const grace: Actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" };

let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 240_000);

async function newWorkspace(now = T0) {
  const id = randomId();
  const r = await resolveWorkspace(db, req(id), now, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return id;
}
const ctx = async (actor = marcus, now = T0) => ({ db, ws: await newWorkspace(now), actor, nowMs: now });
const n = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<{ n: number }>().then((r) => Number(r!.n));
const one = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
const chargeStatus = (ws: string, id: string) => one<{ s: string }>(`SELECT ${chargeStatusSql("c")} AS s FROM ${effective("charges")} AS c WHERE c.id = ?2`, ws, id).then((r) => r!.s);
const available = (ws: string, account: string) => trustBalances({ db, ws }).then((rows) => rows.find((r) => r.id === account)!.available_cents);
const overlayRows = async (ws: string) => {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('workspaces', 'meta', 'base_balances', 'd1_migrations', 'sqlite_sequence')").all<{ name: string }>()).results;
  let total = 0;
  for (const t of tables) total += await n(`SELECT count(*) AS n FROM ${t.name} WHERE workspace_id = ?1`, ws);
  return total;
};

describe("migrations and base", () => {
  it("apply to an empty database, and running them again changes nothing", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw);
    const before = raw.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    applyMigrations(raw);
    expect(raw.prepare("SELECT count(*) AS n FROM sqlite_master").get()).toEqual(before);
    expect(raw.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((r) => r.name)).toEqual(["0001_init.sql", "0002_v2.sql", "0003_read_indexes.sql"]);
  });

  it("loads the base once, with its version, as-of date and trust constants", async () => {
    expect(await one("SELECT value FROM meta WHERE key = 'as_of'")).toEqual({ value: "2026-11-04" });
    expect(await n("SELECT count(*) AS n FROM properties WHERE workspace_id = 'base'")).toBe(30);
    expect(await n("SELECT count(*) AS n FROM base_balances")).toBe(16);
  });
});

describe("data health", { timeout: 120_000 }, () => {
  it("every planted corrupted record is caught by its rule's SQL", async () => {
    const rules = (await db.prepare("SELECT id, check_sql FROM data_rules WHERE workspace_id = 'base' AND check_kind = 'sql'").all<{ id: string; check_sql: string }>()).results;
    expect(rules.length).toBeGreaterThan(15);
    for (const r of rules) {
      const sql = r.check_sql.replace(/\{\{(\w+)\}\}/g, (_, t) => `(SELECT * FROM ${t} WHERE workspace_id = 'base' AND deleted = 0)`);
      const found = new Set((await db.prepare(sql).all<{ id: string }>()).results.map((x) => x.id));
      const planted = (await db.prepare("SELECT entity_id FROM data_issues WHERE workspace_id = 'base' AND rule_id = ?1 AND status = 'open'").bind(r.id).all<{ entity_id: string }>()).results;
      for (const p of planted) expect(found.has(p.entity_id), `${r.id} misses ${p.entity_id}`).toBe(true);
    }
  });
});

describe("workspaces", { timeout: 60_000 }, () => {
  it("are one row: creating one writes no overlay data", async () => {
    const ws = await newWorkspace();
    expect(await n("SELECT count(*) AS n FROM workspaces WHERE id = ?1 AND base_version = (SELECT value FROM meta WHERE key = 'base_version')", ws)).toBe(1);
    expect(await overlayRows(ws)).toBe(0);
    const p01 = await n("SELECT count(*) AS n FROM units WHERE workspace_id = 'base' AND property_id = 'p01'");
    expect((await list({ db, ws }, "units", { propertyIds: ["p01"] })).total).toBe(p01);
  });

  it("read overlay rows over base rows, and a tombstone hides the base row", async () => {
    const ws = await newWorkspace();
    await db.prepare("INSERT INTO units (workspace_id, id, property_id, number, sqft, market_rent_cents, status) VALUES (?1, 'u-p01-412', 'p01', '412', 900, 999900, 'Down')").bind(ws).run();
    await db.prepare("INSERT INTO units (workspace_id, id, deleted, property_id, number) VALUES (?1, 'u-p01-101', 1, 'p01', '101')").bind(ws).run();
    expect(await get({ db, ws }, "units", "u-p01-412")).toMatchObject({ status: "Down", market_rent_cents: 999900 });
    expect(await get({ db, ws }, "units", "u-p01-101")).toBeNull();
    expect((await list({ db, ws }, "units", { propertyIds: ["p01"] })).total).toBe((await n("SELECT count(*) AS n FROM units WHERE workspace_id = 'base' AND property_id = 'p01'")) - 1);
    // Another visitor still sees the base.
    const other = await newWorkspace();
    expect(await get({ db, ws: other }, "units", "u-p01-101")).not.toBeNull();
    expect((await get<{ status: string }>({ db, ws: other }, "units", "u-p01-412"))?.status).not.toBe("Down");
  });

  it("reset and the midnight wipe delete only the overlay; base rows are never touched", async () => {
    const c = await ctx();
    const charge = await one<{ id: string }>(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p02' AND ${chargeStatusSql("c")} <> 'Paid' LIMIT 1`, c.ws);
    expect((await payRent(c, charge!.id)).status).toBe(200);
    const baseCount = await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = 'base'");
    expect(await overlayRows(c.ws)).toBeGreaterThan(0);
    await resetWorkspace(db, c.ws, T0 + 1);
    expect(await overlayRows(c.ws)).toBe(0);
    expect(await n("SELECT count(*) AS n FROM workspaces WHERE id = ?1", c.ws)).toBe(1);
    expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = 'base'")).toBe(baseCount);

    await payRent(c, charge!.id);
    const midnight = nextMidnight(T0);
    expect(await resolveWorkspace(db, req(c.ws), midnight - 1, false, false)).toEqual({ ws: c.ws });
    expect(await overlayRows(c.ws)).toBeGreaterThan(0);
    expect(await resolveWorkspace(db, req(c.ws), midnight, false, false)).toEqual({ ws: c.ws });
    expect(await overlayRows(c.ws)).toBe(0);
    expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = 'base'")).toBe(baseCount);
  });

  it("wipe an overlay built on an older base version", async () => {
    const ws = await newWorkspace();
    await db.prepare("INSERT INTO notes (workspace_id, id, entity_type, entity_id, author_id, body, created_at) VALUES (?1, 'n1', 'units', 'u-p01-412', 'marcus', 'hi', 'x')").bind(ws).run();
    await db.prepare("UPDATE workspaces SET base_version = 'old' WHERE id = ?1").bind(ws).run();
    expect(await resolveWorkspace(db, req(ws), T0 + 1, false, false)).toEqual({ ws });
    expect(await overlayRows(ws)).toBe(0);
  });

  it("can never be the base: 'base' is not a valid cookie id", async () => {
    const r = await resolveWorkspace(db, req("base"), T0, false, false);
    expect(r).toMatchObject({ ws: null });
    await resetWorkspace(db, "base", T0);
    expect(await n("SELECT count(*) AS n FROM properties WHERE workspace_id = 'base'")).toBe(30);
  });
});

describe("money", { timeout: 60_000 }, () => {
  it("pay rent: Processing until settled, then Paid with the 8% fee, and trust grows by the rent", async () => {
    const c = await ctx();
    const jordan = await one<{ id: string; amount_cents: number }>(`SELECT c.id, c.amount_cents FROM ${effective("charges")} AS c JOIN ${effective("residents")} AS r ON r.household_id = c.household_id WHERE r.id = 'res-p01-0001' AND c.period = '2026-11' AND c.gl_account_id = 'gl-4000'`, c.ws);
    expect(await chargeStatus(c.ws, jordan!.id)).toBe("Overdue");
    const before = await available(c.ws, "ba-oe01-trust");
    expect(await payRent(c, jordan!.id)).toMatchObject({ status: 200 });
    expect(await chargeStatus(c.ws, jordan!.id)).toBe("Processing");
    expect(await available(c.ws, "ba-oe01-trust")).toBe(before);
    await settle(db, c.ws, T0 + SETTLE_MS);
    expect(await chargeStatus(c.ws, jordan!.id)).toBe("Paid");
    const fee = Math.floor((jordan!.amount_cents * 8 + 50) / 100);
    expect(await available(c.ws, "ba-oe01-trust")).toBe(before + jordan!.amount_cents - fee);
    expect(await n("SELECT count(*) AS n FROM events WHERE workspace_id = ?1 AND type = 'payment.received'", c.ws)).toBe(1);
    expect(await n("SELECT count(*) AS n FROM notifications WHERE workspace_id = ?1 AND user_id = 'res-p01-0001'", c.ws)).toBe(1);
    // Settling again does nothing more.
    await settle(db, c.ws, T0 + SETTLE_MS * 3);
    expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND kind = 'Management fee'", c.ws)).toBe(1);
    expect(await payRent(c, jordan!.id)).toMatchObject({ status: 409, error: expect.stringContaining("already paid") });
  });

  it("settles a backlog of pending transfers ten per request", async () => {
    const c = await ctx();
    const due = (await db.prepare(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p02' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 12`).bind(c.ws).all<{ id: string }>()).results;
    for (const x of due) await payRent(c, x.id);
    const pending = () => n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND status = 'Pending'", c.ws);
    expect(await pending()).toBe(12);
    await settle(db, c.ws, T0 + SETTLE_MS);
    expect(await pending()).toBe(2);
    await settle(db, c.ws, T0 + SETTLE_MS);
    expect(await pending()).toBe(0);
  });

  it("record payment: partial amounts apply, a retry with the same key is a no-op, overpaying is refused", async () => {
    const c = await ctx();
    const ch = await one<{ id: string; amount_cents: number }>(`SELECT c.id, c.amount_cents FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p03' AND c.gl_account_id = 'gl-4000' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 1`, c.ws);
    const input = { chargeId: ch!.id, amountCents: 50_000, method: "Check" as const, reference: "Check #2231", idempotencyKey: "rec-key-1" };
    expect(await recordPayment(c, input)).toMatchObject({ status: 200 });
    expect(await recordPayment(c, input)).toMatchObject({ status: 200, message: "Already recorded." });
    expect(await chargeStatus(c.ws, ch!.id)).toBe("Overdue");
    expect(await recordPayment(c, { ...input, amountCents: ch!.amount_cents, idempotencyKey: "rec-key-2" })).toMatchObject({ status: 409, error: expect.stringContaining("Only") });
    expect(await recordPayment(c, { ...input, amountCents: ch!.amount_cents - 50_000, idempotencyKey: "rec-key-3" })).toMatchObject({ status: 200 });
    expect(await chargeStatus(c.ws, ch!.id)).toBe("Paid");
    expect(await n("SELECT count(*) AS n FROM payments WHERE workspace_id = ?1", c.ws)).toBe(2);
    expect(await n("SELECT count(*) AS n FROM audit WHERE workspace_id = ?1 AND action = 'Payment recorded'", c.ws)).toBe(2);
  });

  it("bills: approve, then pay from trust once; refused when trust can't cover it", async () => {
    const c = await ctx(grace);
    const bill = await one<{ id: string; amount_cents: number; owner_entity_id: string }>(`SELECT b.* FROM ${effective("bills")} AS b WHERE b.status = 'Pending approval' AND b.property_id = 'p02' ORDER BY b.amount_cents LIMIT 1`, c.ws);
    expect(await payBill(c, bill!.id)).toMatchObject({ status: 409, error: expect.stringContaining("Only approved bills") });
    // A property manager can read payables but not approve them; another region is out of scope.
    expect(await approveBill({ ...c, actor: marcus }, bill!.id)).toMatchObject({ status: 403 });
    const austinOnly: Actor = { ...grace, role: "regional_manager", propertyIds: ["p22"] };
    expect(await approveBill({ ...c, actor: austinOnly }, bill!.id)).toMatchObject({ status: 403, error: expect.stringContaining("scope") });
    expect(await distributeOwner({ ...c, actor: marcus }, "oe01", "k-forbidden")).toMatchObject({ status: 403 });
    expect(await approveBill(c, bill!.id)).toMatchObject({ status: 200 });
    const before = await available(c.ws, "ba-oe01-trust");
    expect(await payBill(c, bill!.id)).toMatchObject({ status: 200 });
    expect(await available(c.ws, "ba-oe01-trust")).toBe(before - bill!.amount_cents);
    await settle(db, c.ws, T0 + SETTLE_MS);
    expect((await get<{ status: string }>(c, "bills", bill!.id))?.status).toBe("Paid");
    expect(await payBill(c, bill!.id)).toMatchObject({ status: 409 });

    // Drain trust with a pending payout, then try a bill bigger than what's left.
    const big = await one<{ id: string; amount_cents: number }>(`SELECT b.* FROM ${effective("bills")} AS b WHERE b.status = 'Approved' AND b.owner_entity_id = 'oe01' ORDER BY b.amount_cents DESC LIMIT 1`, c.ws);
    const left = await available(c.ws, "ba-oe01-trust");
    await db.prepare("INSERT INTO transfers (workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, settles_at) VALUES (?1, 'drain', 'test:drain', 'Vendor payout', 'ba-oe01-trust', 'oe01', 'trust', 'ba-oe01-trust', 'T', 'vendor', 'v01', 'V', ?2, 'p01', 'x', 'Pending', 'x', 9e15)").bind(c.ws, left - big!.amount_cents + 1).run();
    expect(await payBill(c, big!.id)).toMatchObject({ status: 409, error: expect.stringContaining("Trust account can't cover") });
    expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = ?2", c.ws, `vendor:${big!.id}`)).toBe(0);
  });

  it("work orders: approve-and-pay a submitted vendor job, then Paid when it clears", async () => {
    const c = await ctx(grace);
    const wo = await one<{ id: string; property_id: string }>(`SELECT w.id, w.property_id FROM ${effective("work_orders")} AS w WHERE w.status = 'Submitted' AND w.vendor_id IS NOT NULL AND w.vendor_id <> 'v26' LIMIT 1`, c.ws);
    expect(await approveAndPayWorkOrder(c, wo!.id)).toMatchObject({ status: 200 });
    expect((await get<{ status: string }>(c, "work_orders", wo!.id))?.status).toBe("Completed");
    await settle(db, c.ws, T0 + SETTLE_MS);
    expect((await get<{ status: string }>(c, "work_orders", wo!.id))?.status).toBe("Paid");
    expect(await n("SELECT count(*) AS n FROM events WHERE workspace_id = ?1 AND type IN ('wo.approved', 'payment.sent')", c.ws)).toBe(2);
    const open = await one<{ id: string }>(`SELECT w.id FROM ${effective("work_orders")} AS w WHERE w.status = 'In progress' LIMIT 1`, c.ws);
    expect(await approveAndPayWorkOrder(c, open!.id)).toMatchObject({ status: 409, error: expect.stringContaining("in progress") });
    // Fraud hold: an open unverified-bank-change issue on the vendor blocks payment.
    const held = await one<{ id: string; vendor_id: string }>(`SELECT w.id, w.vendor_id FROM ${effective("work_orders")} AS w WHERE w.status = 'Submitted' AND w.vendor_id IS NOT NULL AND w.id <> ?2 LIMIT 1`, c.ws, wo!.id);
    await db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, detected_at, severity, status) VALUES (?1, 'hold-1', 'vendors.unverified_bank_change', 'vendors', ?2, 'x', 'critical', 'open')").bind(c.ws, held!.vendor_id).run();
    expect(await approveAndPayWorkOrder(c, held!.id)).toMatchObject({ status: 409, error: expect.stringContaining("payment hold") });
    expect(await n("SELECT count(*) AS n FROM audit WHERE workspace_id = ?1 AND action = 'Approval refused'", c.ws)).toBe(1);
  });

  it("owner distribution: pays exactly the open statement net, closes it by seq cutoff, and replays by key", async () => {
    const c = await ctx(grace);
    const st = await ownerStatement(c, "oe01");
    expect(st.net_cents).toBeGreaterThan(0);
    expect(await distributeOwner(c, "oe01", "key-aaaaaaaa")).toMatchObject({ status: 200 });
    expect(await one(`SELECT amount_cents, key FROM transfers WHERE workspace_id = ?1 AND kind = 'Owner payout'`, c.ws)).toEqual({ amount_cents: st.net_cents, key: "owner:key-aaaaaaaa" });
    expect((await ownerStatement(c, "oe01")).net_cents).toBe(0);
    expect(await distributeOwner(c, "oe01", "key-bbbbbbbb")).toMatchObject({ status: 409, error: expect.stringContaining("Nothing is owed") });
    expect(await distributeOwner(c, "oe01", "key-aaaaaaaa")).toMatchObject({ status: 200 });
    expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND kind = 'Owner payout'", c.ws)).toBe(1);
    expect(await n("SELECT count(*) AS n FROM owner_distributions WHERE workspace_id = ?1", c.ws)).toBe(1);
    // A new receipt after the payout opens the next statement.
    const ch = await one<{ id: string }>(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p02' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 1`, c.ws);
    await payRent(c, ch!.id);
    await settle(db, c.ws, T0 + SETTLE_MS);
    expect((await ownerStatement(c, "oe01")).net_cents).toBeGreaterThan(0);
  });

  it("late fees: posted once per lease and month, capped by the state rule", async () => {
    const c = await ctx();
    const r = await postLateFees(c, ["p01", "p02", "p03"]);
    expect(r).toMatchObject({ status: 200 });
    const fees = (await db.prepare("SELECT f.amount_cents, c.amount_cents AS rent FROM charges AS f JOIN charges AS c ON c.lease_id = f.lease_id AND c.period = f.period AND c.gl_account_id = 'gl-4000' WHERE f.workspace_id = ?1 AND f.gl_account_id = 'gl-4100'").bind(c.ws).all<{ amount_cents: number; rent: number }>()).results;
    expect(fees.length).toBe((r as { posted: number }).posted);
    // Texas: at most 10% of monthly rent for buildings with more than 4 units.
    for (const f of fees) expect(f.amount_cents).toBeLessThanOrEqual(Math.floor((f.rent * 10 + 50) / 100));
    expect(await postLateFees(c, ["p01", "p02", "p03"])).toMatchObject({ status: 409 });
    // Outside Marcus's scope (Phoenix) is refused.
    expect(await postLateFees(c, ["p22"])).toMatchObject({ status: 403 });
  });

  it("double clicks move money once: pay, record, approve, pay bill, distribute, late fees", async () => {
    const c = await ctx(grace);
    const charges = (await db.prepare(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p01' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 2`).bind(c.ws).all<{ id: string }>()).results;
    const twice = <T extends { status: number }>(f: () => Promise<T>) => Promise.all([f(), f()]).then((rs) => rs.map((r) => r.status).sort());
    expect(await twice(() => payRent(c, charges[0].id))).toEqual([200, 409]);
    const rec = { chargeId: charges[1].id, amountCents: 10_000, method: "Check" as const, reference: "Check #1", idempotencyKey: "dbl-rec" };
    expect(await twice(() => recordPayment(c, rec))).toEqual([200, 200]);
    const bill = await one<{ id: string }>(`SELECT b.id FROM ${effective("bills")} AS b WHERE b.status = 'Pending approval' AND b.owner_entity_id = 'oe01' LIMIT 1`, c.ws);
    expect(await twice(() => approveBill(c, bill!.id))).toEqual([200, 409]);
    expect(await twice(() => payBill(c, bill!.id))).toEqual([200, 409]);
    const wo = await one<{ id: string }>(`SELECT w.id FROM ${effective("work_orders")} AS w WHERE w.status = 'Submitted' AND w.vendor_id IS NOT NULL AND w.vendor_id <> 'v26' LIMIT 1`, c.ws);
    expect(await twice(() => approveAndPayWorkOrder(c, wo!.id))).toEqual([200, 409]);
    const dist = await Promise.all([distributeOwner(c, "oe02", "same-key-1234"), distributeOwner(c, "oe02", "same-key-1234"), distributeOwner(c, "oe02", "other-key-1234")]);
    expect(dist.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(2);
    expect(await twice(() => postLateFees({ ...c, actor: marcus }, ["p02"]))).toEqual([200, 409]);
    const keys = (like: string) => n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key LIKE ?2", c.ws, like);
    expect(await keys(`rent:${charges[0].id}`)).toBe(1);
    expect(await keys("pmt:dbl-rec")).toBe(1);
    expect(await keys(`vendor:${bill!.id}`)).toBe(1);
    expect(await keys(`vendor:${wo!.id}`)).toBe(1);
    expect(await keys("owner:%-key-1234")).toBe(1);
    expect(await n("SELECT count(*) AS n FROM audit WHERE workspace_id = ?1 AND action = 'Payment approved'", c.ws)).toBe(1);
    for (const b of await trustBalances(c)) expect(b.available_cents, b.id).toBeGreaterThanOrEqual(0);
  });
});
