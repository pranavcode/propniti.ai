import { beforeAll, describe, expect, it } from "vitest";
import type { ActionContext, Actor, Row } from "@/entities/types";
import { getAction } from "@/extensions/actions";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { chargeOpenSql, chargeStatusSql, trustBalances } from "@/server/data";
import { effective } from "@/server/effective";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import "./actions";

// Receivables actions end to end on the generated base, each in its own visitor overlay. Ports the
// v1 money guarantees: a double click moves money once, and the management fee is exactly the rate.

const T0 = Date.parse("2026-11-04T17:00:00Z");
const grace: Actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" };
const resident: Actor = { personaId: "resident", name: "Jordan Lee", role: "resident", scope: { kind: "self", label: "Own lease" }, propertyIds: ["p01"] };

let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 180_000);

async function ctx(actor: Actor = grace): Promise<ActionContext> {
  const id = randomId();
  const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return { db, ws: id, actor, nowMs: T0 };
}
const one = <T = Row>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
const n = (sql: string, ...params: unknown[]) => one<{ n: number }>(sql, ...params).then((r) => Number(r!.n));
const act = (key: string) => {
  const a = getAction(key);
  if (!a) throw new Error(`action ${key} not registered`);
  return (c: ActionContext, row: Row, input: unknown = {}) => a.handler(c, row, a.input ? a.input.parse(input) : input);
};
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();
const overdue = (ws: string, where = "1 = 1") =>
  one<{ id: string; household_id: string; property_id: string; amount_cents: number; open: number }>(
    `SELECT c.id, c.household_id, c.property_id, c.amount_cents, ${chargeOpenSql("c")} AS open FROM ${effective("charges")} AS c WHERE c.gl_account_id = 'gl-4000' AND ${chargeStatusSql("c")} = 'Overdue' AND ${where} ORDER BY c.id LIMIT 1`, ws);

describe("record payment", () => {
  it("double click with one dialog key records one payment; the fee is exactly the management rate", async () => {
    const c = await ctx();
    const ch = (await overdue(c.ws, "c.property_id = 'p02'"))!;
    const amount = 1234.56;
    const input = { amount, method: "Check", reference: "Check #4471", idempotencyKey: "dialog-key-0001" };
    const rs = await Promise.all([act("charges.record_payment")(c, ch, input), act("charges.record_payment")(c, ch, input)]);
    expect(statuses(rs)).toEqual([200, 200]); // the replay answers "Already recorded."
    expect(await n("SELECT count(*) AS n FROM payments WHERE workspace_id = ?1", c.ws)).toBe(1);
    expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = 'pmt:dialog-key-0001'", c.ws)).toBe(1);
    const fee = await one<{ amount_cents: number }>("SELECT amount_cents FROM transfers WHERE workspace_id = ?1 AND kind = 'Management fee'", c.ws);
    // 123,456 cents × 8% = 9,876.48 → 9,876 cents, the same whole-percent rounding SQL uses.
    expect(fee!.amount_cents).toBe(Math.floor((123_456 * Math.round(MANAGEMENT_FEE_RATE * 100) + 50) / 100));
    expect(fee!.amount_cents).toBe(9876);
  });

  it("two dialogs paying the full balance at once: one succeeds, the other is refused", async () => {
    const c = await ctx();
    const ch = (await overdue(c.ws, "c.property_id = 'p04'"))!;
    const full = (key: string) => act("charges.record_payment")(c, ch, { amount: ch.open / 100, method: "Money order", reference: "", idempotencyKey: key });
    expect(statuses(await Promise.all([full("dialog-a-00001"), full("dialog-b-00002")]))).toEqual([200, 409]);
    expect(await n(`SELECT ${chargeOpenSql("c")} AS n FROM ${effective("charges")} AS c WHERE c.id = ?2`, c.ws, ch.id)).toBe(0);
  });

  it("rejects bad input before any SQL runs", () => {
    const a = getAction("charges.record_payment")!;
    expect(a.input!.safeParse({ amount: -5, method: "Check", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(a.input!.safeParse({ amount: 5, method: "Bitcoin", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(a.input!.safeParse({ amount: 5, method: "Check", idempotencyKey: "bad key!" }).success).toBe(false);
  });
});

describe("pay rent (resident)", () => {
  it("pays once on a double click, and only the resident's own charges", async () => {
    const c = await ctx(resident);
    const hh = (await one<{ household_id: string }>(`SELECT household_id FROM ${effective("residents")} AS r WHERE r.id = 'res-p01-0001'`, c.ws))!.household_id;
    const own = await overdue(c.ws, `c.household_id = '${hh}'`) ?? (await one<Row>(`SELECT c.id, c.household_id FROM ${effective("charges")} AS c WHERE c.household_id = ?2 AND ${chargeOpenSql("c")} > 0 LIMIT 1`, c.ws, hh));
    const other = (await overdue(c.ws, `c.property_id = 'p01' AND c.household_id <> '${hh}'`))!;
    expect(await act("charges.pay_rent")(c, other)).toMatchObject({ status: 403 });
    if (own) {
      expect(statuses(await Promise.all([act("charges.pay_rent")(c, own), act("charges.pay_rent")(c, own)]))).toEqual([200, 409]);
      expect(await n("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = ?2", c.ws, `rent:${own.id}`)).toBe(1);
    }
  });
});

describe("late fees", () => {
  it("cap at the state limit, post once per lease and month", async () => {
    const c = await ctx();
    // A generous policy that the Texas cap (10% of rent) must cut down.
    await db.batch([
      db.prepare("INSERT INTO late_fee_policies (workspace_id, id, property_id, grace_days, kind, flat_cents, max_cents) VALUES (?1, 'lfp-test', 'p02', 1, 'Flat', 90000, NULL)").bind(c.ws),
      db.prepare("INSERT INTO state_rules (workspace_id, id, state, rule, value, note, effective_from) VALUES (?1, 'sr-test', 'TX', 'late_fee_cap_pct', '10', 'test', '2020-01-01')").bind(c.ws),
    ]);
    const policy = { id: "lfp-test", property_id: "p02" };
    const rs = await Promise.all([act("late_fee_policies.post_late_fees")(c, policy, { period: "2026-11" }), act("late_fee_policies.post_late_fees")(c, policy, { period: "2026-11" })]);
    expect(statuses(rs)).toEqual([200, 409]);
    const fees = (await db.prepare("SELECT f.lease_id, f.amount_cents, r.amount_cents AS rent FROM charges AS f JOIN charges AS r ON r.lease_id = f.lease_id AND r.period = f.period AND r.gl_account_id = 'gl-4000' WHERE f.workspace_id = ?1 AND f.gl_account_id = 'gl-4100'").bind(c.ws).all<{ lease_id: string; amount_cents: number; rent: number }>()).results;
    expect(fees.length).toBeGreaterThan(0);
    for (const f of fees) expect(f.amount_cents).toBeLessThanOrEqual(Math.floor((f.rent * 10 + 50) / 100));
    expect(new Set(fees.map((f) => f.lease_id)).size).toBe(fees.length);
  });
});

describe("deposit disposition", () => {
  it("applies deductions, refunds the rest, settles once on a double click", async () => {
    const c = await ctx();
    const dep = (await one<{ id: string; lease_id: string; amount_cents: number; bank_account_id: string }>(
      `SELECT d.id, d.lease_id, d.amount_cents, d.bank_account_id FROM ${effective("deposits")} AS d WHERE d.status = 'Disposition due' AND d.amount_cents > 30000 ORDER BY d.id LIMIT 1`, c.ws))!;
    const before = (await trustBalances({ db, ws: c.ws })).find((b) => b.id === dep.bank_account_id)!.available_cents;
    const input = { lines: [{ label: "Carpet cleaning, bedroom 2", amount: 125 }, { label: "Replace blinds", amount: 60.5 }] };
    const send = () => act("deposits.send_disposition")(c, dep, input);
    expect(statuses(await Promise.all([send(), send()]))).toEqual([200, 409]);
    const refund = await one<{ amount_cents: number }>("SELECT amount_cents FROM transfers WHERE workspace_id = ?1 AND key = ?2", c.ws, `refund:${dep.lease_id}`);
    expect(refund!.amount_cents).toBe(dep.amount_cents - 18_550);
    expect(await n("SELECT amount_cents AS n FROM transfers WHERE workspace_id = ?1 AND key = ?2", c.ws, `depreceipt:${dep.lease_id}`)).toBe(18_550);
    // The deposit account pays out exactly the deposit; the damage charges are fully credited.
    expect(before - (await trustBalances({ db, ws: c.ws })).find((b) => b.id === dep.bank_account_id)!.available_cents).toBe(dep.amount_cents);
    expect(await n(`SELECT sum(${chargeOpenSql("c")}) AS n FROM ${effective("charges")} AS c WHERE c.id LIKE ?2`, c.ws, `mo-${dep.lease_id}-%`)).toBe(0);
    expect((await one<{ status: string }>(`SELECT d.status FROM ${effective("deposits")} AS d WHERE d.id = ?2`, c.ws, dep.id))!.status).toBe("Settled");
    expect((await one<{ status: string }>(`SELECT x.status FROM ${effective("deposit_dispositions")} AS x WHERE x.id = ?2`, c.ws, `dd-${dep.lease_id}`))!.status).toBe("Sent");
  });

  it("refuses deductions above the deposit", async () => {
    const c = await ctx();
    const dep = (await one<Row>(`SELECT d.id, d.amount_cents FROM ${effective("deposits")} AS d WHERE d.status = 'Disposition due' ORDER BY d.id DESC LIMIT 1`, c.ws))!;
    expect(await act("deposits.send_disposition")(c, dep, { lines: [{ label: "Everything", amount: Number(dep.amount_cents) / 100 + 1 }] })).toMatchObject({ status: 400 });
  });
});

describe("payment posted to the wrong lease", () => {
  it("refuses to close any other issue, so a vendor bank-change fraud hold stays", async () => {
    const c = await ctx();
    const target = (await overdue(c.ws, "c.property_id = 'p01'"))!;
    const pay = (await one<Row>(`SELECT p.* FROM ${effective("payments")} AS p WHERE p.property_id = 'p01' AND p.nsf = 0 AND p.lease_id <> (SELECT lease_id FROM ${effective("charges")} AS x WHERE x.id = ?2) AND p.amount_cents <= ?3 LIMIT 1`, c.ws, target.id, target.open))!;
    await db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, detected_at, severity, status) VALUES (?1, 'di-fraud', 'vendors.unverified_bank_change', 'vendors', 'v01', '2026-11-04', 'critical', 'open')").bind(c.ws).run();
    expect(await act("payments.move_to_lease")(c, pay, { to_charge_id: target.id, issue_id: "di-fraud" })).toMatchObject({ status: 400 });
    expect((await one<{ status: string }>(`SELECT i.status FROM ${effective("data_issues")} AS i WHERE i.id = ?2`, c.ws, "di-fraud"))!.status).toBe("open");
    expect((await one<{ lease_id: string }>(`SELECT p.lease_id FROM ${effective("payments")} AS p WHERE p.id = ?2`, c.ws, pay.id))!.lease_id).toBe(pay.lease_id);
    expect(await n("SELECT count(*) AS n FROM data_fix_log WHERE workspace_id = ?1", c.ws)).toBe(0);
  });

  it("fixes a seeded case: the payment already pays the right charge, only its lease is wrong", async () => {
    const c = await ctx();
    const issue = await one<{ id: string; entity_id: string; evidence: string }>(`SELECT i.id, i.entity_id, i.evidence FROM ${effective("data_issues")} AS i WHERE i.rule_id = 'payments.wrong_lease' AND i.status = 'open' ORDER BY i.id LIMIT 1`, c.ws);
    if (!issue) return; // older base without the planted case
    const ev = JSON.parse(issue.evidence) as { charge_id: string; charge_lease: string };
    const pay = (await one<Row>(`SELECT p.* FROM ${effective("payments")} AS p WHERE p.id = ?2`, c.ws, issue.entity_id))!;
    const move = () => act("payments.move_to_lease")(c, pay, { to_charge_id: ev.charge_id, issue_id: issue.id });
    expect(statuses(await Promise.all([move(), move()]))).toEqual([200, 409]);
    expect((await one<{ lease_id: string }>(`SELECT p.lease_id FROM ${effective("payments")} AS p WHERE p.id = ?2`, c.ws, pay.id))!.lease_id).toBe(ev.charge_lease);
    expect((await one<{ status: string }>(`SELECT i.status FROM ${effective("data_issues")} AS i WHERE i.id = ?2`, c.ws, issue.id))!.status).toBe("fixed");
  });

  it("moves to the intended charge once, logs the fix and closes the issue", async () => {
    const c = await ctx();
    const target = (await overdue(c.ws, "c.property_id = 'p03'"))!;
    const pay = (await one<{ id: string; lease_id: string; amount_cents: number }>(
      `SELECT p.id, p.lease_id, p.amount_cents FROM ${effective("payments")} AS p WHERE p.property_id = 'p03' AND p.nsf = 0 AND p.lease_id <> ?2 AND p.amount_cents <= ?3 ORDER BY p.amount_cents DESC LIMIT 1`, c.ws, (await one<{ lease_id: string }>(`SELECT lease_id FROM ${effective("charges")} AS c WHERE c.id = ?2`, c.ws, target.id))!.lease_id, target.open))!;
    await db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, status) VALUES (?1, 'di-test', 'payments.wrong_lease', 'payments', ?2, 'p03', '2026-11-04', 'critical', 'open')").bind(c.ws, pay.id).run();
    const move = () => act("payments.move_to_lease")(c, pay, { to_charge_id: target.id, issue_id: "di-test" });
    expect(statuses(await Promise.all([move(), move()]))).toEqual([200, 409]);
    const moved = (await one<{ charge_id: string }>(`SELECT p.charge_id FROM ${effective("payments")} AS p WHERE p.id = ?2`, c.ws, pay.id))!;
    expect(moved.charge_id).toBe(target.id);
    expect(await n(`SELECT ${chargeOpenSql("c")} AS n FROM ${effective("charges")} AS c WHERE c.id = ?2`, c.ws, target.id)).toBe(target.open - pay.amount_cents);
    expect(await n("SELECT count(*) AS n FROM data_fix_log WHERE workspace_id = ?1 AND issue_id = 'di-test'", c.ws)).toBe(1);
    expect((await one<{ status: string }>(`SELECT i.status FROM ${effective("data_issues")} AS i WHERE i.id = ?2`, c.ws, "di-test"))!.status).toBe("fixed");
  });
});
