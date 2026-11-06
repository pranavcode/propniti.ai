import { afterEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { updateRecord } from "@/server/query";
import { sql } from "../data";
import { approverRoles, decidableSql } from "../decide";
import { vendorsTurnedOff } from "../life-safety";
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
  it("finds the vendors a proposal takes off work: stop assigning, bank-change holds and data fixes", () => {
    const off = (changes: object) => JSON.stringify({ effects: [{ kind: "update", table: "vendors", id: "v09", changes }, { kind: "task", title: "Call" }] });
    expect(vendorsTurnedOff({ entity_type: "vendors", entity_id: "v02", action: "vendors.stop_assigning", payload: "{}" })).toEqual(["v02"]);
    expect(vendorsTurnedOff({ entity_type: "vendors", entity_id: "v09", action: "vendors.verify_bank_change", payload: off({ status: "Inactive" }) })).toEqual(["v09"]);
    expect(vendorsTurnedOff({ entity_type: "data_issues", entity_id: "di1", action: "data_issues.apply_fix", payload: off({ status: "Do not use" }) })).toEqual(["v09"]);
    expect(vendorsTurnedOff({ entity_type: "vendors", entity_id: "v09", action: "vendors.request_coi", payload: off({ email: "a@b.example" }) })).toEqual([]);
  });

  it("routes the agent's proposal to the principal or regional manager only", async () => {
    for (const [priority, category] of [["Emergency", "HVAC"], ["Normal", "Life safety"]]) {
      const f = setup(priority, category);
      const p = await stopAssigning(f);
      expect(p).toMatchObject({ risk: "High", assignee_role: "principal" });
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
});
