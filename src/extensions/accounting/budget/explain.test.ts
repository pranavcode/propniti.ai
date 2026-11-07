import { afterEach, describe, expect, it, vi } from "vitest";
import { MARCUS, openFixture, WS } from "@/ai/__tests__/fixture";
import { setModelForTests, type ChatModel } from "@/ai/providers";
import type { Session } from "@/auth/session";
import type { Db } from "@/lib/platform/types";

// "Explain a variance" calls the model only from an explicit POST, never while a page renders
// (a link prefetch would otherwise spend model calls), and keeps only bullets whose figures are facts.

const platform: { db?: Db } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const { Bva } = await import("./Bva");
const { bvaData, explainVariance } = await import("./data");

afterEach(() => setModelForTests(undefined));

function model(bullets: string[]) {
  const calls: string[] = [];
  const m: ChatModel = {
    info: { provider: "anthropic", model: "claude-test", label: "Test", native: true },
    chat: async () => { throw new Error("unused"); },
    structured: async (_schema, _system, user) => { calls.push(user); return { value: { bullets } } as never; },
  };
  setModelForTests(m);
  return calls;
}

describe("budget variance explanations", () => {
  it("never call the model while the budget page renders, whatever the URL says", async () => {
    platform.db = openFixture().db;
    const calls = model(["Expense came in under budget."]);
    const session = { ws: WS, actor: MARCUS } as unknown as Session;
    await Bva({ session, year: 2026, type: "Expense", property: null, explain: "total", params: {} } as Parameters<typeof Bva>[0]);
    expect(calls).toEqual([]);
  });

  it("use the model's bullets only when every figure in them is in the facts", async () => {
    const { db } = openFixture();
    const ctx = { db, ws: WS, actor: MARCUS };
    const data = await bvaData(ctx, { year: 2026, type: "Expense" });
    model(["Expense came in on budget; check the largest bills next."]);
    expect((await explainVariance(ctx, data, "total"))?.source).toBe("live");
    model(["Spend ran $98,765 over budget because of a roof repair."]);
    const e = await explainVariance(ctx, data, "total");
    expect(e?.source).toBe("rules");
    expect(e?.bullets.join(" ")).not.toMatch(/98,765|roof/);
  });
});
