import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { executeProposal } from "../effects";
import { canDecide } from "../http";
import { startRun } from "../orchestrator";
import { setModelForTests } from "../providers";
import { DANIEL, openFixture, WS } from "./fixture";

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
