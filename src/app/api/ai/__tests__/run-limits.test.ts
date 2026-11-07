import { describe, expect, it, vi } from "vitest";
import { openFixture, WS } from "@/ai/__tests__/fixture";
import type { Db, RateLimiter } from "@/lib/platform/types";

// Routes that start agent runs count against the AI rate limit, not the write limit.

const platform: { db?: Db; limiter?: RateLimiter; writeLimiter?: RateLimiter } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const events = await import("../events/route");
const sweep = await import("../sweep/route");

const deny: RateLimiter = { limit: async () => ({ success: false }) };
const allow: RateLimiter = { limit: async () => ({ success: true }) };
const post = (body: unknown) =>
  new Request("http://x/api/ai", { method: "POST", body: JSON.stringify(body), headers: { origin: "http://x", host: "x", "cf-connecting-ip": "1.2.3.4", cookie: `pn_as=daniel; pn_ws=${WS}` } });

describe("agent-starting routes use the AI limit", () => {
  it("refuses events and a manual sweep once the AI limit is spent, with writes still allowed", async () => {
    platform.db = openFixture().db;
    platform.limiter = deny;
    platform.writeLimiter = allow;
    expect((await events.POST(post({ type: "import.completed", payload: { properties: 1 } }))).status).toBe(429);
    expect((await sweep.POST(post({}))).status).toBe(429);
  });
});
