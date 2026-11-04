import { beforeAll, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { ActionContext } from "@/entities/types";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { resolveActor } from "@/server/permissions";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import { payRun, paymentRunCandidates, type RunBill } from "./paymentRun";

// Payment run: approved past-due bills in scope, grouped by vendor; paying the selection goes
// through payBill (trust guard, one transfer per bill), held vendors are skipped and bills over the
// bill-payment limit go to the approvals inbox instead of being paid.

const T0 = Date.parse("2026-11-04T17:00:00Z");
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 600_000);

async function ctx(persona: string): Promise<ActionContext> {
  const id = randomId();
  const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return { db, ws: id, actor: await resolveActor(db, getPersona(persona)!, id), nowMs: T0 };
}
const count = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).first<{ n: number }>().then((r) => Number(r!.n));
const bills = (v: { bills: RunBill[] }[]) => v.flatMap((x) => x.bills);

// An unverified bank change on a vendor that has approved past-due bills puts the vendor on hold.
async function holdVendor(ws: string, vendorId: string) {
  await db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, detected_at, severity, evidence, status) VALUES (?, ?, 'vendors.unverified_bank_change', 'vendors', ?, '2026-11-03T12:00:00Z', 'critical', '{}', 'open')").bind(ws, `di-test-${vendorId}`, vendorId).run();
}

describe("payment run selection", () => {
  it("lists approved, unpaid, past-due bills in scope, grouped by vendor with totals", async () => {
    const c = await ctx("grace");
    const run = await paymentRunCandidates(c);
    const all = bills(run.vendors);
    expect(all.length).toBeGreaterThan(0);
    const base = await count("SELECT count(*) AS n FROM bills WHERE workspace_id = 'base' AND deleted = 0 AND status = 'Approved' AND due_on < '2026-11-04' AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.workspace_id = 'base' AND t.key = 'vendor:' || bills.id AND t.status <> 'Returned')");
    expect(all.length).toBe(base);
    for (const v of run.vendors) expect(v.total_cents).toBe(v.bills.reduce((s, b) => s + b.amount_cents, 0));
    expect(all.every((b) => b.due_on < "2026-11-04")).toBe(true);
    expect(run.pendingApproval.n).toBeGreaterThan(0);
  });

  it("only shows a regional manager the bills in their region", async () => {
    const c = await ctx("priya");
    const ids = c.actor.propertyIds as string[];
    const all = bills((await paymentRunCandidates(c)).vendors);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((b) => ids.includes(b.property_id))).toBe(true);
  });

  it("flags a vendor with an unverified bank change and every bill over the limit", async () => {
    const c = await ctx("grace");
    const first = (await paymentRunCandidates(c)).vendors.find((v) => !v.hold)!;
    await holdVendor(c.ws, first.vendor_id);
    const run = await paymentRunCandidates(c);
    const held = run.vendors.find((v) => v.vendor_id === first.vendor_id)!;
    expect(held.hold).toMatch(/bank details/);
    const over = bills(run.vendors).filter((b) => b.over_limit);
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((b) => b.amount_cents > (b.over_limit!.limit_cents ?? 0))).toBe(true);
  });
});

describe("paying a payment run", () => {
  it("pays each ready bill once on a double click and sends over-limit bills to approvals once", async () => {
    const c = await ctx("grace");
    const all = bills((await paymentRunCandidates(c)).vendors);
    const ready = all.filter((b) => !b.hold && !b.over_limit).slice(0, 3);
    const over = all.filter((b) => !b.hold && b.over_limit).slice(0, 1);
    expect(ready.length).toBe(3);
    expect(over.length).toBe(1);
    const ids = [...ready, ...over].map((b) => b.id);
    const [a, b] = await Promise.all([payRun(c, ids), payRun(c, ids)]);
    for (const id of ids) expect(await count("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND key = ?", c.ws, `vendor:${id}`)).toBe(over.some((o) => o.id === id) ? 0 : 1);
    const paid = [...a.results, ...b.results].filter((r) => r.outcome === "paid").map((r) => r.id).sort();
    // Trust may not cover every bill; whatever was paid was paid exactly once across both runs.
    expect(new Set(paid).size).toBe(paid.length);
    expect(paid.length).toBe(await count("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND kind = 'Vendor payout'", c.ws));
    expect(await count("SELECT count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND entity_id = ? AND action = 'bills.pay' AND queue_state IN ('needs_you', 'waiting')", c.ws, over[0].id)).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("skips a held vendor's bills without paying them", async () => {
    const c = await ctx("grace");
    const v = (await paymentRunCandidates(c)).vendors.find((x) => !x.hold && x.bills.some((b) => !b.over_limit))!;
    await holdVendor(c.ws, v.vendor_id);
    const id = v.bills.find((b) => !b.over_limit)!.id;
    const r = await payRun(c, [id]);
    expect(r.results[0].outcome).toBe("held");
    expect(r.status).toBe(409);
    expect(await count("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?", c.ws)).toBe(0);
  });

  it("refuses roles that can't pay bills and bills outside the actor's scope", async () => {
    const pm = await ctx("marcus");
    expect((await payRun(pm, ["b-anything"])).status).toBe(403);
    const priya = await ctx("priya");
    const ids = priya.actor.propertyIds as string[];
    const outside = await db.prepare("SELECT id FROM bills WHERE workspace_id = 'base' AND status = 'Approved' AND property_id NOT IN (SELECT value FROM json_each(?)) LIMIT 1").bind(JSON.stringify(ids)).first<{ id: string }>();
    const r = await payRun(priya, [outside!.id]);
    expect(r.results[0].outcome).toBe("skipped");
    expect(await count("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?", priya.ws)).toBe(0);
  });
});
