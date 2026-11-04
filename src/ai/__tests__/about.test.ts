import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { aboutCard, aboutQuestions } from "../about";
import { ask } from "../assistant";
import { setModelForTests, type ChatModel } from "../providers";
import type { Turn } from "../providers/types";
import { MARCUS, openFixture, WS } from "./fixture";

// "Ask about this": the panel opens on a record with a card and questions for its type, and sends
// nothing until one is chosen. A question asked about the record gets the record's facts (names,
// not ids) up front, and the answer is plain sentences: no field dumps, tables or internal ids.

afterEach(() => setModelForTests(undefined));

const marcus = getPersona("marcus")!;
const usage = { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 };
const CONTEXT = { entity: "work_orders", id: "WO-10001", title: "Kitchen sink leaking under cabinet" };

// A model that answers at once and records what it was given.
function scripted(text: string) {
  const seen: { system: string; turns: Turn[] }[] = [];
  const model: ChatModel = {
    info: { provider: "anthropic", model: "claude-opus-5", label: "Scripted", native: true },
    chat: async (system, turns) => { seen.push({ system, turns: [...turns] }); return { text, calls: [], usage }; },
    structured: async (schema) => ({ value: schema.parse({ suggestions: [] }), usage }),
  };
  return { model, seen };
}

function fixture() {
  const f = openFixture();
  f.raw.exec("UPDATE work_orders SET vendor_id = 'v01', estimate_cents = 57800 WHERE id = 'WO-10001'");
  return { ...f, data: { db: f.db, ws: WS, actor: MARCUS } };
}

describe("suggested questions", () => {
  it("fit the record type, with the work order's estimate in the wording", () => {
    expect(aboutQuestions("work_orders", { estimate: 578 })).toEqual(["Why is this taking long?", "Which vendor should handle this?", "Is the $578 estimate normal for this job?"]);
    expect(aboutQuestions("work_orders", {})).toEqual(["Why is this taking long?", "Which vendor should handle this?", "What's the next step on this job?"]);
    for (const e of ["leases", "residents", "properties", "bills", "vendors", "applications", "units"]) {
      const q = aboutQuestions(e, {});
      expect(q.length, e).toBeGreaterThanOrEqual(3);
      expect(q.length, e).toBeLessThanOrEqual(4);
      expect(new Set(q).size, e).toBe(q.length);
    }
    expect(aboutQuestions("leases", {})).not.toEqual(aboutQuestions("vendors", {}));
    expect(aboutQuestions("audit", {})).toEqual(["Summarize this record", "What needs attention here?", "What happened here recently?"]);
  });
});

describe("record card", () => {
  it("names the record, its status and key facts with names, not ids", async () => {
    const { data } = fixture();
    const c = (await aboutCard(data, "work_orders", "WO-10001"))!;
    expect(c).toMatchObject({ entity: "work_orders", id: "WO-10001", type: "Work order", title: "Kitchen sink leaking under cabinet", status: "New", href: "/app/maintenance/work-orders/WO-10001" });
    expect(c.facts.length).toBeGreaterThanOrEqual(3);
    expect(c.facts.length).toBeLessThanOrEqual(4);
    const text = JSON.stringify(c.facts);
    expect(text).toContain("The Lofts at Riverside");
    expect(text).not.toMatch(/"(p01|u1|v01)"/);
    // No stored summary and no rules sentence for work orders: the card shows none, like the record page.
    expect(c.summary).toBeUndefined();
    expect(c.questions).toContain("Is the $578 estimate normal for this job?");
  });

  it("is null for a record outside the persona's scope or missing", async () => {
    const { data } = fixture();
    expect(await aboutCard(data, "work_orders", "WO-missing")).toBeNull();
    expect(await aboutCard({ ...data, actor: { ...MARCUS, propertyIds: ["p10"], scope: { kind: "property", ids: ["p10"], label: "Inman Park" } } }, "work_orders", "WO-10001")).toBeNull();
  });
});

describe("asking about a record", () => {
  it("gives the model the record's facts with names, so it can answer without looking it up", async () => {
    const { data } = fixture();
    const { model, seen } = scripted("The kitchen sink leak at The Lofts at Riverside is still New and hasn't been dispatched to Lone Star Plumbing yet.");
    setModelForTests(model);
    const status: string[] = [];
    const r = await ask({ data, persona: marcus, question: "Why is this taking long?", context: CONTEXT, onStatus: (s) => status.push(s) });
    expect(seen).toHaveLength(1);
    const given = seen[0].system + JSON.stringify(seen[0].turns);
    expect(given).toContain("Kitchen sink leaking under cabinet");
    expect(given).toContain("The Lofts at Riverside");
    expect(given).toContain("Lone Star Plumbing");
    expect(given).toContain("$578");
    expect(given).not.toMatch(/\b(p01|u1|v01)\b/);
    expect(r.live).toBe(true);
    expect(r.answer).toMatch(/^The kitchen sink leak/);
    expect(r.trace).toEqual([]);
    expect(r.citations[0]).toMatchObject({ entity_type: "work_orders", entity_id: "WO-10001", href: "/app/maintenance/work-orders/WO-10001" });
    expect(status[0]).toBe("Reading WO-10001…");
  });

  it("accepts the record's own dollar figures from the preloaded facts", async () => {
    const { data } = fixture();
    setModelForTests(scripted("The estimate is $578, which is in line for a sink repair.").model);
    const r = await ask({ data, persona: marcus, question: "Is the $578 estimate normal for this job?", context: CONTEXT });
    expect(r.live).toBe(true);
    expect(r.answer).toContain("$578");
  });

  it("answers whether an estimate is normal from finished jobs of the same trade, not the model", async () => {
    const { data, raw } = fixture();
    raw.exec("UPDATE work_orders SET category = 'Plumbing' WHERE id = 'WO-10001'");
    const { model, seen } = scripted("Suggested next steps are not used here.");
    setModelForTests(model);
    const r = await ask({ data, persona: marcus, question: "Is the $578 estimate normal for this job?", context: CONTEXT });
    expect(r.answer).toMatch(/^The \$578\.00 estimate is above the most expensive of them: 2 finished plumbing jobs cost \$180\.00 to \$220\.00, \$200\.00 on average\./);
    expect(seen).toHaveLength(0);
    expect(r.citations[0]).toMatchObject({ href: "/app/maintenance/work-orders/WO-10001" });
  });

  it("replaces a field dump, a table or raw ids with the rules answer", async () => {
    for (const text of ["| Field | Value |\n| --- | --- |\n| status | New |", "WO-10001 is at property p01, unit u1, vendor v01."]) {
      const { data } = fixture();
      setModelForTests(scripted(text).model);
      const r = await ask({ data, persona: marcus, question: "Tell me about this", context: CONTEXT });
      expect(r.live, text).toBe(false);
      expect(r.answer).not.toContain("|");
      expect(r.answer).not.toMatch(/\b(p01|u1|v01)\b/);
      expect(r.note).toMatch(/plain answer/);
    }
  });

  it("without a model, answers in sentences with names", async () => {
    const { data } = fixture();
    setModelForTests(null);
    const r = await ask({ data, persona: marcus, question: "Why is this taking long?", context: CONTEXT });
    expect(r.mode).toBe("chat");
    expect(r.answer).toContain("Kitchen sink leaking under cabinet");
    expect(r.answer).toContain("The Lofts at Riverside");
    expect(r.answer).toContain("Lone Star Plumbing");
    expect(r.answer).not.toMatch(/\b(p01|u1|v01)\b|_id\b|\||: [^ ]+;/);
    expect(r.citations[0]).toMatchObject({ href: "/app/maintenance/work-orders/WO-10001" });
  });

  it("still answers general questions from the rules when they don't refer to the record", async () => {
    const { data } = fixture();
    setModelForTests(null);
    const r = await ask({ data, persona: marcus, question: "Who is late on rent?", context: CONTEXT });
    expect(r.answer).toMatch(/residents are\s+late/);
  });
});
