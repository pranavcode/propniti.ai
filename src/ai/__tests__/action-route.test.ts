import { describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { getAction } from "@/extensions/actions";
import "../actions";
import { DANIEL, openFixture, WS } from "./fixture";

// The generic action route (POST /api/e/<entity>/<id>/actions/<ai action>) runs an agent's proposal.
// It must apply the approvals inbox's rule (canDecide), not just "any staff role".

const actorOf = (id: string): Actor => {
  const p = getPersona(id)!;
  return { ...DANIEL, personaId: id, name: p.name, role: p.role };
};

function setup() {
  const f = openFixture();
  const add = (id: string, action: string, entity: string, entityId: string, risk: string, assignee: string, payload: object) =>
    f.raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, payload, why, evidence, confidence, risk, queue_state, assignee_role, created_at) VALUES (?, ?, ?, ?, ?, 'p01', ?, ?, ?, '[]', '[]', 0.8, ?, 'needs_you', ?, '2026-11-04T09:00:00Z')")
      .run(WS, id, "leasing", entity, entityId, action, `${action} ${entityId}`, JSON.stringify(payload), risk, assignee);
  add("prop-app", "applications.approve", "applications", "app-new", "Medium", "broker", { application_id: "app-new" });
  add("prop-legal", "leases.refer_to_legal", "leases", "l1", "High", "property_manager", {});
  const run = (key: string, persona: string, id: string) => getAction(key as never)!.handler({ db: f.db, ws: WS, actor: actorOf(persona), nowMs: Date.now() }, { id }, {});
  const decisions = () => (f.raw.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ?").get(WS) as { n: number }).n;
  return { ...f, run, decisions };
}

describe("AI actions through the generic action route", () => {
  it("a leasing agent can't approve an application or refer a lease to legal: both stay queued", async () => {
    const f = setup();
    expect(await f.run("applications.approve", "lena", "app-new")).toMatchObject({ status: 202, proposalId: "prop-app" });
    expect(await f.run("leases.refer_to_legal", "lena", "l1")).toMatchObject({ status: 202, proposalId: "prop-legal" });
    expect(f.decisions()).toBe(0);
    expect(f.raw.prepare("SELECT stage FROM applications WHERE id = 'app-new'").get()).toMatchObject({ stage: "Started" });
  });

  it("a broker approves the application", async () => {
    const f = setup();
    expect(await f.run("applications.approve", "rachel", "app-new")).toMatchObject({ status: 200 });
    expect(f.decisions()).toBe(1);
  });

  it("a low-risk proposal is refused, not queued, for a role without write access", async () => {
    const f = setup();
    f.raw.exec("UPDATE ai_proposals SET risk = 'Low' WHERE id = 'prop-app'");
    expect(await f.run("applications.approve", "sam", "app-new")).toMatchObject({ status: 403 });
    expect(f.decisions()).toBe(0);
  });

  it("ignores an already-decided proposal instead of saying it waits in the inbox", async () => {
    const f = setup();
    f.raw.prepare("INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, decided_at) VALUES (?, 'dec-1', 'prop-legal', 'Rejected', 'marcus', '', '2026-11-04T10:00:00Z')").run(WS);
    expect(await f.run("leases.refer_to_legal", "lena", "l1")).toMatchObject({ status: 404 });
  });
});
