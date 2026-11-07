import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { ask } from "@/ai/assistant";
import { list } from "@/ai/data";
import { setModelForTests } from "@/ai/providers";
import { aiActor } from "@/ai/session";
import { cachedBriefing } from "@/ai/summaries";
import { MARCUS, openFixture, WS } from "@/ai/__tests__/fixture";
import type { Db } from "@/lib/platform/types";

// Portal personas (resident, owner, vendor, applicant) get no property-wide AI reads: a resident
// once saw "2 residents owe $6,600" in the staff briefing. Their portals answer from their own records.

const platform: { db?: Db } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const briefing = await import("../briefing/route");

const PORTALS = ["resident", "owner", "vendor", "applicant"];
// A resident actor as the entity API resolves it: self scope, with their property id.
const RESIDENT: Actor = { personaId: "resident", name: "Jordan Lee", role: "resident", scope: { kind: "self", label: "Own lease" }, propertyIds: ["p01"] };
const req = (persona: string, method = "GET") => new Request("http://x/api/ai/briefing", { method, headers: { origin: "http://x", host: "x", "cf-connecting-ip": "1.2.3.4", cookie: `pn_as=${persona}; pn_ws=${WS}` } });

afterEach(() => setModelForTests(undefined));

describe("AI reads for portal personas", () => {
  it("give every portal persona no property-wide scope", async () => {
    const { db } = openFixture();
    for (const id of PORTALS) expect((await aiActor(db, WS, getPersona(id)!)).propertyIds, id).toEqual([]);
    expect((await aiActor(db, WS, getPersona("marcus")!)).propertyIds).toEqual(["p01", "p02", "p03"]);
  });

  it("fail closed for a self-scoped actor even when it carries property ids", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    const data = { db, ws: WS, actor: RESIDENT };
    expect((await list(data, "leases")).rows).toEqual([]);
    const b = await cachedBriefing(data, "resident");
    expect(b.facts).toMatchObject({ residents_late: 0, late_balance: 0 });
    const r = await ask({ data, persona: getPersona("resident")!, question: "What did the agents do today?" });
    expect(r.answer).not.toMatch(/Agents ran \d/);
    expect((await cachedBriefing({ db, ws: WS, actor: MARCUS }, "marcus")).facts.residents_late).toBeGreaterThan(0);
  });

  it("refuse the staff briefing to portal personas", async () => {
    setModelForTests(null);
    platform.db = openFixture().db;
    for (const id of PORTALS) {
      expect((await briefing.GET(req(id))).status, id).toBe(403);
      expect((await briefing.POST(req(id, "POST"))).status, id).toBe(403);
    }
    expect((await briefing.GET(req("marcus"))).status).toBe(200);
  });
});
