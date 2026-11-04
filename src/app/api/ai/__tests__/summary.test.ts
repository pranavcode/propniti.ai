import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { seed, WS } from "@/server/query.fixture";
import { setModelForTests, type ChatModel } from "@/ai/providers";
import { rulesSummary } from "@/ai/summaries";
import * as route from "../summary/route";

// "Summarize with AI" on a record with no stored summary: POST /api/ai/summary writes one now
// (model, or the rules sentence when the model fails), in the persona's scope, and GET then returns it.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const host = "propniti.test";
const req = (path: string, persona: string, body?: object) => {
  const headers = new Headers({ host, cookie: `pn_as=${persona}; pn_ws=${WS}`, "cf-connecting-ip": `t-${Math.random()}` });
  if (body) headers.set("origin", `http://${host}`);
  return new Request(`http://${host}${path}`, body ? { method: "POST", body: JSON.stringify(body), headers } : { headers });
};
const get = async (persona: string, id: string) => (await (await route.GET(req(`/api/ai/summary?entity=work_orders&id=${id}`, persona))).json()).summary;
const post = (persona: string, id: string) => route.POST(req("/api/ai/summary", persona, { entity: "work_orders", id }));
const stored = async (id: string) => (await getPlatform().db.prepare("SELECT workspace_id, model, summary FROM ai_summaries WHERE entity_type = 'work_orders' AND entity_id = ?").bind(id).all()).results;

// A scripted model: writes `text`, or fails (as a timeout would) when text is null.
const model = (text: string | null): ChatModel => ({
  info: { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", native: true },
  chat: () => Promise.reject(new Error("unused")),
  structured: async (schema) => {
    if (text == null) throw new Error("timed out");
    return { value: schema.parse({ summary: text }), usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 } };
  },
});

beforeAll(async () => {
  const db = getPlatform().db;
  await seed(db);
  await db.batch(["wo-1", "wo-2", "wo-3"].map((id, i) => db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, unit_id, title, category, priority, status, opened_at) VALUES ('base', ?, ?, ?, ?, 'Plumbing', 'Urgent', 'New', '2026-10-20T09:00:00Z')")
    .bind(id, i === 2 ? "p05" : "p01", i === 2 ? "p05-u1" : "p01-u1", `Leaking kitchen faucet ${i + 1}`)));
});
afterEach(() => setModelForTests(undefined));

describe("POST /api/ai/summary for a record with no summary yet", () => {
  it("writes the rules summary when the model fails, and GET shows it after a reload", async () => {
    setModelForTests(model(null));
    expect(await get("marcus", "wo-1")).toBeNull();
    const res = await post("marcus", "wo-1");
    expect(res.status).toBe(200);
    const { summary } = await res.json();
    expect(summary).toMatchObject({ source: "rules", model: "rules" });
    expect(summary.summary).toContain("Leaking kitchen faucet 1");
    expect(await stored("wo-1")).toEqual([{ workspace_id: WS, model: "rules", summary: summary.summary }]);
    expect(await get("marcus", "wo-1")).toMatchObject({ source: "rules", summary: summary.summary });
  });

  it("keeps a model summary whose figures come from the facts, labelled with the model", async () => {
    setModelForTests(model("An urgent plumbing job at the Lofts that is still new."));
    const { summary } = await (await post("marcus", "wo-2")).json();
    expect(summary).toMatchObject({ source: "live", model: "claude-sonnet-5", summary: "An urgent plumbing job at the Lofts that is still new." });
    expect(await get("marcus", "wo-2")).toMatchObject({ source: "live", model: "claude-sonnet-5" });
  });

  it("falls back to rules when the model states a figure that isn't in the facts", async () => {
    setModelForTests(model("This job will cost $4,500."));
    const { summary } = await (await post("daniel", "wo-1")).json();
    expect(summary).toMatchObject({ source: "rules" });
    expect(summary.summary).not.toContain("4,500");
  });

  it("answers 404 for a record outside the persona's scope and stores nothing", async () => {
    setModelForTests(null);
    const res = await post("marcus", "wo-3");
    expect(res.status).toBe(404);
    expect(await stored("wo-3")).toEqual([]);
    expect(await get("marcus", "wo-3")).toBeNull();
    expect((await post("daniel", "wo-3")).status).toBe(200);
  });
});

describe("rulesSummary", () => {
  it("writes a plain sentence from the facts, and just the title when there are none", () => {
    expect(rulesSummary("Leak", { work_order: "WO-1", title: "Leak", status: "New", past_sla: false })).toBe("Leak. work order: WO-1; status: New; past sla: no.");
    expect(rulesSummary("WO-1", { note: "" })).toBe("WO-1.");
  });
});
