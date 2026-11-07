import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { registerAction } from "@/extensions/actions";
import { currentModel, setModelForTests } from "@/ai/providers";
import type { RateLimiter } from "@/lib/platform/types";
import { seed, WS } from "@/server/query.fixture";
import * as bulkRoute from "../[entity]/actions/[action]/route";

// A bulk action that calls a model takes one AI allowance per record. Records past the limit
// still run, on the rules, so one request can't buy up to 25 model calls with one allowance.

let allowance = 0;
const limiter: RateLimiter = { limit: async () => ({ success: allowance-- > 0 }) };
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db, limiter, writeLimiter: { limit: async () => ({ success: true }) } }) };
});

beforeAll(async () => {
  await seed(getPlatform().db);
});
afterEach(() => setModelForTests(undefined));

registerAction({
  key: "units.ai_probe", label: "Probe", entity: "units", roles: ["property_manager"], ai: true, bulk: true,
  handler: async () => ({ status: 200, message: currentModel() ? "model" : "rules" }),
});

const post = (ids: string[]) =>
  bulkRoute.POST(
    new Request("http://propniti.test/api/e/units/actions/ai_probe", { method: "POST", body: JSON.stringify({ ids }), headers: { host: "propniti.test", origin: "http://propniti.test", "cf-connecting-ip": "1.2.3.4", cookie: `pn_as=marcus; pn_ws=${WS}` } }),
    { params: Promise.resolve({ entity: "units", action: "ai_probe" }) },
  );

describe("bulk AI actions", () => {
  it("charge one AI allowance per record and run the rest on the rules", async () => {
    setModelForTests({ info: { provider: "anthropic", model: "m", label: "M", native: true }, chat: async () => { throw new Error("unused"); }, structured: async () => { throw new Error("unused"); } });
    allowance = 2;
    const res = await post(["p01-u1", "p01-u2", "p01-u3", "p02-u1"]);
    expect(res.status).toBe(200);
    expect((await res.json()).results.map((r: { message: string }) => r.message)).toEqual(["model", "model", "rules", "rules"]);
    allowance = 0;
    expect((await post(["p01-u1"])).status).toBe(429);
  });
});
