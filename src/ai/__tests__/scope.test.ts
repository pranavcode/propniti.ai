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
