import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedBriefing, generateBriefing } from "../summaries";
import { setModelForTests } from "../providers";
import { DANIEL, openFixture, TODAY } from "./fixture";

afterEach(() => {
  setModelForTests(undefined);
  vi.restoreAllMocks();
});

// Production QA: /api/ai/briefing served a rules briefing stored the day before, with old counts
// and "$10,89,793" from a server whose default locale groups digits the Indian way.
function setup() {
  const f = openFixture();
  // A $1,000,000 charge, so digit grouping differs between en-US and en-IN.
  f.raw.prepare("INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents) VALUES ('base', 'c-big', 'l1', 'h1', 'p01', 'u1', 'gl-4000', 'Damages', '2026-10', '2026-10-01', 100000000)").run();
  const store = (facts: unknown, at: string, model = "claude-opus-5") =>
    f.raw.prepare("INSERT INTO ai_summaries (workspace_id, id, entity_type, entity_id, summary, facts, model, generated_at) VALUES ('base', 'sum-briefing-daniel', 'briefing', 'daniel', 'Stored briefing.', ?, ?, ?)").run(JSON.stringify(facts), model, at);
  return { ...f, data: { db: f.db, ws: "base", actor: DANIEL }, store };
}

describe("home briefing", () => {
  it("recomputes a briefing stored on an earlier day, in en-US digits whatever the server locale", async () => {
    setModelForTests(null);
    const toLocale = Number.prototype.toLocaleString;
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (this: number, locales?: Intl.LocalesArgument, o?: Intl.NumberFormatOptions) {
      return toLocale.call(this, locales ?? "en-IN", o);
    });
    const { data, store } = setup();
    const { facts } = await generateBriefing(data, "daniel", { writeTo: "none" });
    store({ ...facts, residents_late: 371 }, "2026-11-03T21:38:24.896Z", "rules");
    const b = (await cachedBriefing(data, "daniel"))!;
    expect(b.source).toBe("rules");
    expect(b.facts).toEqual(facts);
    expect(b.generated_at.slice(0, 10)).toBe(TODAY);
    expect(b.summary).toContain(`${facts.residents_late} residents owe $1,0`);
    expect(b.summary).toMatch(/\$\d{1,3}(,\d{3})+ in rent/);
  });

  it("keeps a model briefing written today from the same figures, and drops it once they change", async () => {
    setModelForTests(null);
    const { data, store, raw } = setup();
    const { facts } = await generateBriefing(data, "daniel", { writeTo: "none" });
    store(facts, `${TODAY}T08:00:00Z`);
    expect(await cachedBriefing(data, "daniel")).toMatchObject({ summary: "Stored briefing.", source: "precomputed" });
    raw.prepare("UPDATE charges SET paid_cents = amount_cents WHERE id = 'c-big'").run();
    expect(await cachedBriefing(data, "daniel")).toMatchObject({ source: "rules" });
  });
});
