import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { INTERNAL_ROLES } from "@/entities/types";
import { sql } from "../data";
import { approverLabel, approverRoles, decidableSql, routeTo, staffDecision } from "../decide";
import { executeProposal } from "../effects";
import { canDecide } from "../http";
import { startRun } from "../orchestrator";
import { setModelForTests } from "../providers";
import { proposalsPage } from "../views";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

const resident = getPersona("resident")!;
const owner = getPersona("owner")!;
const RESIDENT: Actor = { personaId: "resident", name: resident.name, role: "resident", scope: resident.scope, propertyIds: ["p01"] };
const OWNER: Actor = { personaId: "owner", name: owner.name, role: "owner", scope: owner.scope, propertyIds: ["p01", "p02"] };

async function proposalsFor(agent: "collections" | "data_health") {
  setModelForTests(null);
  const { raw, db } = openFixture();
  const r = await (await startRun({ db, ws: WS, actor: DANIEL, agent, trigger: { kind: "manual" } })).done;
  return { raw, db, rows: raw.prepare("SELECT * FROM ai_proposals WHERE run_id = ?").all(r.runId) as Record<string, string | number>[] };
}

describe("who may decide a proposal", () => {
  it("never a resident, for collections or data-health proposals, through the route check or the executor", async () => {
    for (const agent of ["collections", "data_health"] as const) {
      const { db, rows } = await proposalsFor(agent);
      expect(rows.length).toBeGreaterThan(0);
      for (const p of rows) {
        expect(await canDecide({ db, ws: WS, actor: RESIDENT, persona: resident }, p)).toMatchObject({ ok: false });
        expect(await executeProposal({ db, ws: WS, actor: RESIDENT }, p, { id: "resident", name: resident.name })).toMatchObject({ ok: false, status: 403 });
      }
    }
  });

  it("an owner only for an approval waiting on them, on a property they own", async () => {
    const { db, raw, rows } = await proposalsFor("collections");
    const mine = { ...rows[0], queue_state: "waiting", assignee_role: "owner", property_id: "p01" };
    const notMine = { ...mine, property_id: "p10" };
    raw.exec("UPDATE owner_entities SET owner_id = 'ow01'");
    expect(await canDecide({ db, ws: WS, actor: OWNER, persona: owner }, mine)).toEqual({ ok: true });
    raw.exec("UPDATE owner_entities SET owner_id = 'ow99' WHERE id = 'oe02'");
    expect(await canDecide({ db, ws: WS, actor: OWNER, persona: owner }, notMine)).toMatchObject({ ok: false });
    expect(await canDecide({ db, ws: WS, actor: OWNER, persona: owner }, { ...mine, queue_state: "needs_you" })).toMatchObject({ ok: false });
  });

  it("staff by module access", async () => {
    const { db, rows } = await proposalsFor("collections");
    const p = rows.find((x) => x.risk === "Medium")!;
    expect(await canDecide({ db, ws: WS, actor: DANIEL, persona: getPersona("daniel")! }, p)).toEqual({ ok: true });
    const lena = getPersona("lena")!;
    expect(await canDecide({ db, ws: WS, actor: { ...DANIEL, personaId: "lena", role: "leasing_agent" }, persona: lena }, p)).toMatchObject({ ok: false });
  });
});

// The approvals queue the personas reported: compliance items routed to the maintenance supervisor,
// a data fix routed to the admin, a bill, a renewal and a lead follow-up.
const OPEN = [
  { id: "pr-comp-high", entity_type: "compliance_items", risk: "High", amount_cents: null, assignee_role: "maintenance_supervisor" },
  { id: "pr-comp-low", entity_type: "compliance_items", risk: "Low", amount_cents: null, assignee_role: "maintenance_supervisor" },
  { id: "pr-fix", entity_type: "residents", risk: "Low", amount_cents: null, assignee_role: "admin" },
  { id: "pr-bill", entity_type: "bills", risk: "Low", amount_cents: 120000, assignee_role: "accountant" },
  { id: "pr-renew", entity_type: "leases", risk: "Medium", amount_cents: 244000, assignee_role: "property_manager" },
  { id: "pr-lead", entity_type: "prospects", risk: "Low", amount_cents: null, assignee_role: "leasing_agent" },
  { id: "pr-odd", entity_type: "not_an_entity", risk: "Low", amount_cents: null, assignee_role: null },
];
const actorAs = (role: (typeof INTERNAL_ROLES)[number]): Actor => ({ ...DANIEL, personaId: role, role });

function seedQueue() {
  const { raw, db } = openFixture();
  const add = raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, confidence, risk, amount_cents, assignee_role, queue_state, created_at) VALUES ('base', ?, 'compliance', ?, 'x1', 'p01', 'x.do', ?, 0.9, ?, ?, ?, 'needs_you', '2026-11-04T00:30:00Z')");
  for (const p of OPEN) add.run(p.id, p.entity_type, p.id, p.risk, p.amount_cents, p.assignee_role);
  return db;
}

describe("the approve button, its label, the Needs you count and the server agree", () => {
  it("life-safety (high-risk compliance) items: only the regional manager and the principal decide", () => {
    const high = { ...OPEN[0], queue_state: "needs_you" };
    for (const role of INTERNAL_ROLES) expect(staffDecision(role, high).ok, role).toBe(role === "principal" || role === "regional_manager");
    expect(approverRoles(high)).toEqual(["principal", "regional_manager"]);
    expect(approverLabel(high)).toBe("Approver: principal or regional manager");
    expect(routeTo({ entity_type: "compliance_items", risk: "High", property_id: "p01" })).toBe("regional_manager");
    expect(routeTo({ entity_type: "compliance_items", risk: "High", property_id: null })).toBe("principal");
    expect(routeTo({ entity_type: "compliance_items", risk: "Low", property_id: "p01" })).toBeNull();
    // Low-risk compliance items stay as they were: write access to risk decides them.
    const low = { ...OPEN[1], queue_state: "needs_you" };
    expect(staffDecision("property_manager", low)).toEqual({ ok: true });
    expect(staffDecision("maintenance_supervisor", low)).toEqual({ ok: true });
    expect(staffDecision("admin", low)).toEqual({ ok: true });
  });

  it("for every staff role, the SQL count, the listed rows, the flags and canDecide match", async () => {
    const db = seedQueue();
    for (const role of INTERNAL_ROLES) {
      const actor = actorAs(role);
      const data = { db, ws: WS, actor };
      const persona = { ...getPersona("daniel")!, role };
      const expected = [];
      for (const p of OPEN) if ((await canDecide({ db, ws: WS, actor, persona }, { ...p, queue_state: "needs_you" })).ok) expected.push(p.id);
      const d = decidableSql(role);
      const counted = await sql<{ id: string }>(data, `SELECT p.id FROM {ai_proposals} p WHERE ${d.sql}`, d.params);
      expect(counted.map((r) => r.id).sort(), role).toEqual(expected.sort());
      const page = await proposalsPage(data, { queue: "needs_you", size: 50 });
      expect(page.rows.map((r) => r.id).sort(), role).toEqual(expected.sort());
      expect(page.total, role).toBe(expected.length);
      expect(page.counts.needs_you ?? 0, role).toBe(expected.length);
      expect(page.rows.every((r) => r.can_decide === true && r.decide_reason === null), role).toBe(true);
    }
  });

  it("Sam (admin) decides only the low-risk compliance item; Marcus (property manager) the low-risk ones in his module", async () => {
    const db = seedQueue();
    const ids = async (actor: Actor) => (await proposalsPage({ db, ws: WS, actor }, { queue: "needs_you", size: 50 })).rows.map((r) => r.id).sort();
    expect(await ids(actorAs("admin"))).toEqual(["pr-comp-low"]);
    expect(await ids(actorAs("regional_manager"))).toContain("pr-comp-high");
    expect(await ids(actorAs("accountant"))).not.toContain("pr-comp-high");
    expect(await ids(MARCUS)).toEqual(["pr-comp-low", "pr-fix", "pr-lead", "pr-odd"].sort());
  });
});
