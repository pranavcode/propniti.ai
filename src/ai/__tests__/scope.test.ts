import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { portalRefused } from "../http";
import { startRun } from "../orchestrator";
import { setModelForTests } from "../providers";
import type { AiSession } from "../session";
import { runDetail, runsPage } from "../views";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

describe("staff AI routes and run scope", () => {
  it("refuses every portal persona", () => {
    for (const id of ["resident", "owner", "vendor", "applicant"]) expect(portalRefused({ persona: getPersona(id)! } as AiSession)?.status).toBe(403);
    expect(portalRefused({ persona: getPersona("marcus")! } as AiSession)).toBeNull();
  });

  it("shows a property-scoped manager only runs they started or that proposed in their scope, without other properties' traces", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const everyone = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "collections", trigger: { kind: "manual" } })).done;
    const atlantaOnly = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "compliance", trigger: { kind: "manual" } })).done;
    raw.prepare("DELETE FROM ai_proposals WHERE run_id = ? AND (property_id IS NULL OR property_id <> 'p10')").run(atlantaOnly.runId);
    const own = await (await startRun({ db, ws: WS, actor: MARCUS, agent: "data_health", trigger: { kind: "manual" } })).done;
    const m = { db, ws: WS, actor: MARCUS };

    const ids = (await runsPage(m, {})).rows.map((r) => r.id);
    expect(ids).toContain(everyone.runId);
    expect(ids).toContain(own.runId);
    expect(ids).not.toContain(atlantaOnly.runId);

    const shared = await runDetail(m, everyone.runId);
    expect(shared).toMatchObject({ traceHidden: true, steps: [] });
    expect(shared!.proposals.map((p) => p.entity_id).sort()).toEqual(["l1", "l2"]);
    expect(await runDetail(m, atlantaOnly.runId)).toBeNull();
    expect((await runDetail(m, own.runId))!.steps.length).toBeGreaterThan(2);
    expect((await runDetail({ db, ws: WS, actor: DANIEL }, everyone.runId))!.steps.length).toBeGreaterThan(2);
  });
});

describe("AI reads follow the entity rules", () => {
  it("hide fields the role can't see and scope messages through their thread", async () => {
    const { list } = await import("../data");
    const { raw, db } = openFixture();
    const admin = { ...DANIEL, personaId: "sam", role: "admin" as const };
    const apps = await list({ db, ws: WS, actor: admin }, "applications", { size: 5 });
    expect(apps.rows.length).toBeGreaterThan(0);
    expect(apps.rows.every((r) => !("score" in r) && !("recommendation" in r))).toBe(true);
    expect((await list({ db, ws: WS, actor: DANIEL }, "applications", { size: 1 })).rows[0]).toHaveProperty("score");
    raw.exec(`INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, last_message_at) VALUES ('base', 't-atl', 'p10', 'resident', 'r3', 'Hi', '2026-11-01'), ('base', 't-aus', 'p01', 'resident', 'r1', 'Hi', '2026-11-01')`);
    raw.exec(`INSERT INTO messages (workspace_id, id, thread_id, channel, direction, sender_kind, sender_id, body, sent_at) VALUES ('base', 'm1', 't-atl', 'Email', 'in', 'resident', 'r3', 'Atlanta', '2026-11-01'), ('base', 'm2', 't-aus', 'Email', 'in', 'resident', 'r1', 'Austin', '2026-11-01')`);
    expect((await list({ db, ws: WS, actor: MARCUS }, "messages", {})).rows.map((r) => r.id)).toEqual(["m2"]);
  });
});
