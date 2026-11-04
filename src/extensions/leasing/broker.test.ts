import { describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { DANIEL, openFixture, WS } from "@/ai/__tests__/fixture";
import { DECIDE_ACTIONS, leasingProposals, waitingApplications, type LeasingCtx } from "./data";

describe("broker desk", () => {
  it("lists the Leasing Agent's open recommendations on waiting applications, whichever decide action they carry", async () => {
    const { raw, db } = openFixture();
    const add = raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, confidence, queue_state, assignee_role, created_at) VALUES ('base', ?, 'leasing', 'applications', ?, 'p01', ?, ?, 0.8, 'needs_you', 'broker', '2026-11-03T10:00:00Z')");
    add.run("ap-1", "app-old-0", "applications.approve", "Approve application app-old-0");
    add.run("ap-2", "app-old-1", "applications.deny", "Deny application app-old-1");
    add.run("ap-3", "app-old-2", "applications.decide", "Approve application app-old-2");
    const rachel = getPersona("rachel")!;
    const c = { db, ws: WS, actor: { ...DANIEL, personaId: "rachel", name: rachel.name, role: rachel.role }, persona: rachel } as LeasingCtx;
    const [apps, queue] = await Promise.all([waitingApplications(c, 12), leasingProposals(c, { actions: DECIDE_ACTIONS, limit: 6 })]);
    const recommended = apps.rows.filter((a) => a.proposalId).map((a) => a.proposalId);
    expect(recommended.sort()).toEqual(["ap-1", "ap-2", "ap-3"]);
    expect(queue.map((p) => p.id).sort()).toEqual(recommended);
  });
});
