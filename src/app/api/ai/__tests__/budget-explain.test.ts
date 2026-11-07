import { afterEach, describe, expect, it, vi } from "vitest";
import { openFixture, WS } from "@/ai/__tests__/fixture";
import { setModelForTests } from "@/ai/providers";
import type { Db, RateLimiter } from "@/lib/platform/types";

// POST /api/ai/budget-explain: the budget page's "Explain a variance", under the AI rate limit.

const platform: { db?: Db; limiter?: RateLimiter; writeLimiter?: RateLimiter } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const route = await import("../budget-explain/route");

const allow: RateLimiter = { limit: async () => ({ success: true }) };
const deny: RateLimiter = { limit: async () => ({ success: false }) };
const post = (persona: string, body: unknown, origin = "http://x") =>
  route.POST(new Request("http://x/api/ai/budget-explain", { method: "POST", body: JSON.stringify(body), headers: { origin, host: "x", "cf-connecting-ip": "1.2.3.4", cookie: `pn_as=${persona}; pn_ws=${WS}` } }));
const ask = { year: 2026, type: "Expense", property: null, key: "total" };

afterEach(() => setModelForTests(undefined));

describe("budget explain route", () => {
  it("explains a variance for a role that can read budgets", async () => {
    setModelForTests(null);
    platform.db = openFixture().db;
    platform.limiter = allow;
    platform.writeLimiter = allow;
    const res = await post("marcus", ask);
    expect(res.status).toBe(200);
    expect((await res.json()).explanation).toMatchObject({ source: "rules", title: expect.stringMatching(/All properties/) });
  });

  it("refuses past the AI limit, from another site, for portal personas and for roles without budgets", async () => {
    setModelForTests(null);
    platform.db = openFixture().db;
    platform.writeLimiter = allow;
    platform.limiter = deny;
    expect((await post("marcus", ask)).status).toBe(429);
    platform.limiter = allow;
    expect((await post("marcus", ask, "https://evil.example")).status).toBe(403);
    expect((await post("resident", ask)).status).toBe(403);
    expect((await post("lena", ask)).status).toBe(403);
    expect((await post("marcus", { ...ask, key: "x".repeat(200) })).status).toBe(400);
  });
});
