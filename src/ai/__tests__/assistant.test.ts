import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { ask } from "../assistant";
import { setModelForTests, type ChatModel } from "../providers";
import { MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

// A model that would get the facts wrong if it were allowed to word them.
const wrongModel: ChatModel = {
  info: { provider: "anthropic", model: "claude-opus-5", label: "Scripted", native: true },
  chat: async () => ({ text: "No residents are late.", calls: [], usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 } }),
  structured: async (schema) => ({ value: schema.parse({ suggestions: ["Offer Ana Ruiz a payment plan", "Waive $500 for Jordan"] }), usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 } }),
};

describe("assistant", () => {
  it("answers fact questions from the computed result; the model only adds suggestions", async () => {
    setModelForTests(wrongModel);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Who is late on rent?" });
    expect(r.answer).toMatch(/^2 residents are\s+late, owing \$6,600 in total\. Jordan Lee/);
    expect(r.answer).not.toMatch(/No residents/);
    expect(r.answer).toContain("Offer Ana Ruiz a payment plan");
    expect(r.answer).not.toContain("Waive $500");
    expect(r.trace.map((t) => t.tool)).toEqual(["ledger.delinquency"]);
    expect(r.table?.rows).toHaveLength(2);
    expect(r.note).toMatch(/Figures computed from your data/);
  });

  it("turns an action request into proposals that wait for confirmation", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Send reminders to residents 30+ days late" });
    expect(r.mode).toBe("actions");
    expect(r.proposals.map((p) => p.queue_state)).toEqual(["needs_you", "needs_you"]);
    expect(raw.prepare("SELECT count(*) AS n FROM messages").get()!.n).toBe(0);
  });

  it("answers help questions from help articles with links", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "How do I post a late fee?" });
    expect(r.mode).toBe("help");
    expect(r.citations[0]).toMatchObject({ help: "post-late-fee" });
  });
});
