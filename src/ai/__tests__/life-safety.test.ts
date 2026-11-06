import { afterEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { deleteRecord, updateRecord } from "@/server/query";
import { sql } from "../data";
import { approverRoles, decidableSql } from "../decide";
import { vendorsTurnedOff } from "../life-safety";
import { applyFixes } from "../datafix";
import { executeProposal } from "../effects";
import { get } from "../data";
import { getAction } from "@/extensions/actions";
import { runAction } from "@/app/api/e/_lib/actions";
import { canDecide } from "../http";
import { startRun } from "../orchestrator";
import { setModelForTests } from "../providers";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

// Taking a vendor off work while it still has open emergency or life-safety jobs follows the
// life-safety approval rule (principal or regional manager), whether an agent proposes it or a
// person changes the vendor's status.

afterEach(() => setModelForTests(undefined));

const TOM: Actor = { personaId: "tom", name: "Tom Alvarez", role: "maintenance_supervisor", scope: { kind: "org", label: "All" }, propertyIds: "all" };
type F = ReturnType<typeof openFixture>;
type P = Record<string, string | number>;

// v02's certificate has expired and it has one open job of the given priority.
function setup(priority: string, category = "HVAC") {
  setModelForTests(null);
  const f = openFixture();
  f.raw.prepare("UPDATE vendor_cois SET expires_on = '2026-10-01' WHERE id = 'coi2'").run();
  f.raw.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at) VALUES ('base', 'WO-7001', 'p01', 'No heat in building B', ?, ?, 'Assigned', 'v02', '2026-11-03T08:00:00Z')").run(category, priority);
  return f;
}
async function stopAssigning(f: F) {
  const r = await (await startRun({ db: f.db, ws: WS, actor: DANIEL, agent: "compliance", trigger: { kind: "manual" } })).done;
  return f.raw.prepare("SELECT * FROM ai_proposals WHERE run_id = ? AND action = 'vendors.stop_assigning'").get(r.runId) as P;
}
const decide = (f: F, persona: string, actor: Actor, p: P) => canDecide({ db: f.db, ws: WS, actor, persona: getPersona(persona)! }, p);
const decidable = async (f: F, actor: Actor) => {
  const d = decidableSql(actor.role);
  return (await sql<{ id: string }>({ db: f.db, ws: WS, actor }, `SELECT p.id FROM {ai_proposals} p WHERE ${d.sql}`, d.params)).map((r) => r.id);
};

describe("deactivating a vendor with open emergency or life-safety jobs", () => {
  it("finds the vendors a proposal takes off work: stop assigning and data fixes, not payment holds", () => {
    const off = (changes: object) => JSON.stringify({ effects: [{ kind: "update", table: "vendors", id: "v09", changes }, { kind: "task", title: "Call" }] });
    expect(vendorsTurnedOff({ entity_type: "vendors", entity_id: "v02", action: "vendors.stop_assigning", payload: "{}" })).toEqual(["v02"]);
    expect(vendorsTurnedOff({ entity_type: "vendors", entity_id: "v09", action: "vendors.verify_bank_change", payload: off({ status: "Inactive" }) })).toEqual([]);
    expect(vendorsTurnedOff({ entity_type: "data_issues", entity_id: "di1", action: "data_issues.apply_fix", payload: off({ status: "Do not use" }) })).toEqual(["v09"]);
    expect(vendorsTurnedOff({ entity_type: "vendors", entity_id: "v09", action: "vendors.request_coi", payload: off({ email: "a@b.example" }) })).toEqual([]);
  });

  it("routes the agent's proposal to the principal or regional manager only", async () => {
    for (const [priority, category] of [["Emergency", "HVAC"], ["Normal", "Life safety"]]) {
      const f = setup(priority, category);
      const p = await stopAssigning(f);
      expect(p).toMatchObject({ risk: "High", assignee_role: "principal", title: "Hill Country Grounds has 1 open jobs with insurance expired Oct 1, 2026" });
      expect(JSON.parse(String(p.payload))._life_safety).toBe(true);
      expect(JSON.parse(String(p.why))).toContain("1 open emergency or life-safety work order still assigned");
      expect(approverRoles(p)).toEqual(["principal", "regional_manager"]);
      expect(await decide(f, "marcus", MARCUS, p)).toMatchObject({ ok: false });
      expect(await decide(f, "tom", TOM, p)).toMatchObject({ ok: false });
      expect(await decide(f, "daniel", DANIEL, p)).toEqual({ ok: true });
      expect(await decidable(f, TOM)).not.toContain(p.id);
      expect(await decidable(f, DANIEL)).toContain(p.id);
    }
  });

  it("leaves routine open jobs with the usual approvers", async () => {
    const f = setup("Normal");
    const p = await stopAssigning(f);
    expect(JSON.parse(String(p.payload))._life_safety).toBeUndefined();
    expect(approverRoles(p)).toContain("maintenance_supervisor");
    expect(await decide(f, "tom", TOM, p)).toEqual({ ok: true });
  });

  it("checks again at decision time, when an emergency reached the vendor after the proposal", async () => {
    const f = setup("Normal");
    const p = await stopAssigning(f);
    f.raw.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at) VALUES (?, 'WO-7002', 'p01', 'Gas smell in unit 412', 'Plumbing', 'Emergency', 'Assigned', 'v02', '2026-11-04T08:00:00Z')").run(WS);
    expect(await decide(f, "tom", TOM, p)).toMatchObject({ ok: false, error: expect.stringMatching(/principal or regional manager/) });
    expect(await decide(f, "daniel", DANIEL, p)).toEqual({ ok: true });
  });

  it("refuses a direct status change from other roles, and allows it once the job is reassigned", async () => {
    const f = setup("Emergency");
    const ctx = (actor: Actor) => ({ db: f.db, ws: WS, nowMs: Date.now(), actor });
    await expect(updateRecord(ctx(MARCUS), "vendors", "v02", { status: "Do not use" })).rejects.toThrow(/1 open emergency or life-safety work order/);
    // A vendor without such jobs is unaffected.
    await expect(updateRecord(ctx(MARCUS), "vendors", "v01", { status: "Inactive" })).resolves.toMatchObject({ status: "Inactive" });
    await expect(updateRecord(ctx(DANIEL), "vendors", "v02", { status: "Inactive" })).resolves.toMatchObject({ status: "Inactive" });
    f.raw.prepare("UPDATE vendors SET status = 'Active' WHERE workspace_id = ? AND id = 'v02'").run(WS);
    f.raw.prepare("UPDATE work_orders SET status = 'Completed' WHERE id = 'WO-7001'").run();
    await expect(updateRecord(ctx(MARCUS), "vendors", "v02", { status: "Inactive" })).resolves.toMatchObject({ status: "Inactive" });
  });

  // Only the principal and regional managers may delete vendors today; the life-safety check backs
  // that up if delete rights ever widen.
  it("lets only the life-safety roles delete the vendor", async () => {
    const f = setup("Emergency");
    const ctx = (actor: Actor) => ({ db: f.db, ws: WS, nowMs: Date.now(), actor });
    await expect(deleteRecord(ctx(TOM), "vendors", "v02")).rejects.toThrow();
    await expect(deleteRecord(ctx(DANIEL), "vendors", "v02")).resolves.toBeUndefined();
  });
});

describe("a payment hold after a suspicious bank change", () => {
  const GRACE: Actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" };
  // v02 has an unverified bank change; with `job`, it also has an open emergency work order.
  function bankChange(job: boolean) {
    setModelForTests(null);
    const f = openFixture();
    if (job) f.raw.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at) VALUES ('base', 'WO-7001', 'p01', 'Burst pipe', 'Plumbing', 'Emergency', 'Assigned', 'v02', '2026-11-03T08:00:00Z')").run();
    f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', 'di-bank', 'vendors.unverified_bank_change', 'vendors', 'v02', NULL, '2026-11-01', 'critical', '{}', ?)")
      .run(JSON.stringify({ action: "vendors.hold_payments", why: ["Bank details changed 3 days ago"], confidence: 0.95 }));
    return f;
  }
  const hold = async (f: F) => {
    const r = await applyFixes({ db: f.db, ws: WS, actor: GRACE }, getPersona("grace")!, ["di-bank"], { safeOnly: false });
    return f.raw.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND id = ?").get(WS, r.results[0].proposalId!) as P;
  };
  const status = async (f: F) => (await get({ db: f.db, ws: WS, actor: DANIEL }, "vendors", "v02"))?.status;
  // The hold is the open issue: approving the hold leaves it open, so v02's bill b1 can't be approved
  // or paid until a callback on the number on file closes it.
  async function stillHeld(f: F) {
    const w = (actor: Actor) => ({ db: f.db, ws: WS, nowMs: Date.now(), actor });
    expect((await get({ db: f.db, ws: WS, actor: DANIEL }, "data_issues", "di-bank"))?.status).toBe("open");
    expect((await runAction(w(GRACE), getAction("bills.approve")!, "b1", {})).status).toBe(409);
    expect((await runAction(w(DANIEL), getAction("vendors.confirm_bank_change")!, "v02", { spoke_with: "Dana Hill", phone_on_file: true })).status).toBe(200);
    expect((await get({ db: f.db, ws: WS, actor: DANIEL }, "data_issues", "di-bank"))?.status).toBe("fixed");
    expect((await runAction(w(GRACE), getAction("bills.approve")!, "b1", {})).status).toBe(200);
  }

  it("stays with the accountant while the vendor has emergency jobs; taking it off work is split out to the principal", async () => {
    const f = bankChange(true);
    const p = await hold(f);
    expect(p.assignee_role).toBe("accountant");
    expect(JSON.parse(String(p.payload))._life_safety).toBeUndefined();
    expect(JSON.parse(String(p.payload)).effects.map((e: { kind: string }) => e.kind)).toEqual(["task"]);
    expect(JSON.parse(String(p.why)).at(-1)).toMatch(/^The vendor stays on work: 1 open emergency/);
    expect(await decide(f, "grace", GRACE, p)).toEqual({ ok: true });
    expect(await executeProposal({ db: f.db, ws: WS, actor: GRACE }, p, { id: "grace", name: "Grace Kim", role: "accountant" })).toMatchObject({ ok: true });
    expect(await status(f)).toBe("Active");

    const off = f.raw.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND action = 'vendors.stop_assigning' AND entity_id = 'v02'").get(WS) as P;
    expect(off).toMatchObject({ risk: "High", assignee_role: "principal" });
    expect(JSON.parse(String(off.payload))._life_safety).toBe(true);
    expect(await decide(f, "grace", GRACE, off)).toMatchObject({ ok: false });
    expect(await decide(f, "daniel", DANIEL, off)).toEqual({ ok: true });
    await stillHeld(f);
  });

  it("with no emergency jobs, holds payments and takes the vendor off work in one proposal", async () => {
    const f = bankChange(false);
    const p = await hold(f);
    expect(JSON.parse(String(p.payload)).effects.map((e: { kind: string }) => e.kind)).toEqual(["update", "task"]);
    expect(f.raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND action = 'vendors.stop_assigning'").get(WS)).toMatchObject({ n: 0 });
    expect(await executeProposal({ db: f.db, ws: WS, actor: GRACE }, p, { id: "grace", name: "Grace Kim", role: "accountant" })).toMatchObject({ ok: true });
    expect(await status(f)).toBe("Inactive");
    // The issue stays open as the hold, but the Data Health agent doesn't propose the hold again.
    await (await startRun({ db: f.db, ws: WS, actor: DANIEL, agent: "data_health", trigger: { kind: "manual" } })).done;
    expect(f.raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND entity_id = 'di-bank'").get(WS)).toMatchObject({ n: 1 });
    await stillHeld(f);
    // The callback puts the vendor back on work.
    expect(await status(f)).toBe("Active");
  });

  it("keeps the vendor on work when an emergency job arrives after the hold was proposed, unless the principal approves", async () => {
    for (const [actor, by, expected] of [[GRACE, { id: "grace", name: "Grace Kim", role: "accountant" }, "Active"], [DANIEL, { id: "daniel", name: "Daniel Reyes", role: "principal" }, "Inactive"]] as const) {
      const f = bankChange(false);
      const p = await hold(f);
      f.raw.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at) VALUES (?, 'WO-7002', 'p01', 'Gas smell', 'Plumbing', 'Emergency', 'Assigned', 'v02', '2026-11-04T08:00:00Z')").run(WS);
      expect(await decide(f, by.id, actor, p)).toEqual({ ok: true });
      const r = await executeProposal({ db: f.db, ws: WS, actor }, p, by);
      expect(r).toMatchObject({ ok: true });
      const off = f.raw.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND action = 'vendors.stop_assigning' AND entity_id = 'v02'").all(WS) as P[];
      if (expected === "Active") {
        expect(r.message).toMatch(/Vendor kept on work.*separate proposal/);
        expect(off).toHaveLength(1);
        expect(off[0]).toMatchObject({ risk: "High", assignee_role: "principal" });
        expect(await decide(f, "grace", GRACE, off[0])).toMatchObject({ ok: false });
      } else expect(off).toHaveLength(0);
      expect(await status(f)).toBe(expected);
    }
  });
});
