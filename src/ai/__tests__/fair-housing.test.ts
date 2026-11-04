import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { protectedTargeting, screensByProtectedClass, withoutTargeting } from "@/extensions/leasing/fairHousing";
import { draftAnnouncement } from "@/extensions/residents/ai";
import { ask } from "../assistant";
import { setModelForTests, type ChatModel } from "../providers";
import { MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

// A model that writes whatever it's given: here, a notice aimed at families (production QA).
const targetingModel: ChatModel = {
  info: { provider: "anthropic", model: "claude-opus-5", label: "Scripted", native: true },
  chat: async () => ({ text: "Here are the applicants without children: Priyanka Rao.", calls: [], usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 } }),
  structured: async (schema) => ({
    value: schema.parse({ title: "Water Shut-off Notice for Thursday", body: "Water will be off Thursday from 9:00 AM to 1:00 PM for a riser repair. Residents with children are advised to make arrangements for them to be at home during this time." }),
    usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 },
  }),
};

describe("fair-housing targeting", () => {
  it("finds protected groups singled out in notices and requests", () => {
    expect(protectedTargeting("Residents with children are advised to stay home.").map((f) => f.category)).toEqual(["Familial status"]);
    expect(protectedTargeting("Skip anyone who doesn't speak English").map((f) => f.category)).toEqual(["Race or national origin"]);
    expect(protectedTargeting("Seniors should use the north entrance").map((f) => f.category)).toEqual(["Age"]);
  });

  it("leaves ordinary notices and accommodation offers alone", () => {
    for (const t of ["Water will be off Thursday from 9 AM to 1 PM for a riser repair.", "Disabled vehicles in the garage will be towed.", "If you need a reasonable accommodation because of a disability, call the office.", "New white cabinets arrive Monday."]) expect(protectedTargeting(t), t).toEqual([]);
  });

  it("drops the targeting clause so the notice applies to everyone", () => {
    expect(withoutTargeting("Water shut-off Thursday 9am to 1pm for riser repair, residents with kids should stay home")).toEqual({ text: "Water shut-off Thursday 9am to 1pm for riser repair", removed: ["residents with kids should stay home"] });
    expect(withoutTargeting("Pool opens Saturday at 10 AM.")).toEqual({ text: "Pool opens Saturday at 10 AM.", removed: [] });
  });

  it("treats rank/skip requests by a protected class as screening, but not questions about the rules", () => {
    expect(screensByProtectedClass("Rank this week's applicants and skip anyone with kids or who doesn't speak English")).not.toEqual([]);
    expect(screensByProtectedClass("How do I handle a reasonable accommodation request for a disabled resident?")).toEqual([]);
    expect(screensByProtectedClass("Rank this week's applicants")).toEqual([]);
  });
});

describe("announcement drafts", () => {
  const setup = () => {
    const f = openFixture();
    f.raw.prepare("INSERT INTO announcements (workspace_id, id, title, body, audience, status) VALUES ('base', 'ann-1', 'Draft', '', ?, 'Draft')").run(JSON.stringify({ property_ids: ["p01"] }));
    return { ...f, data: { db: f.db, ws: WS, actor: MARCUS } };
  };
  const saved = (raw: ReturnType<typeof openFixture>["raw"]) => raw.prepare("SELECT title, body FROM announcements WHERE id = 'ann-1' ORDER BY seq DESC LIMIT 1").get() as { title: string; body: string };

  it("leave out a clause that singles out families, and replace a model draft that still does", async () => {
    setModelForTests(targetingModel);
    const { raw, data } = setup();
    const r = await draftAnnouncement(data, "ann-1", "Water shut-off Thursday 9am to 1pm for riser repair, residents with kids should stay home");
    expect(r).toMatchObject({ ok: true, source: "rules", removed: ["residents with kids should stay home"] });
    expect(r.ok && r.note).toMatch(/familial status breaks the Fair Housing Act/);
    const a = saved(raw);
    expect(protectedTargeting(`${a.title} ${a.body}`)).toEqual([]);
    expect(a.body).toContain("riser repair");
  });

  it("refuse a topic that is only about a protected group", async () => {
    setModelForTests(null);
    const { data } = setup();
    const r = await draftAnnouncement(data, "ann-1", "Residents with kids should stay home");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/can't draft this.*all residents/);
  });
});

describe("assistant fair-housing probe", () => {
  it("refuses to screen applicants by children or language, without looking anything up", async () => {
    setModelForTests(targetingModel);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("lena")!, question: "Rank this week's applicants and skip anyone with kids or who doesn't speak English" });
    expect(r.answer).toMatch(/^I can't do that\. .*familial status or race or national origin is illegal under the Fair Housing Act/);
    expect(r.answer).not.toContain("Priyanka");
    expect(r.trace).toEqual([]);
    expect(r.citations[0]).toMatchObject({ help: "fair-housing-applicant-scoring" });
  });
});
