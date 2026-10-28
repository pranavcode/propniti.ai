import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ getPlatform: () => ({}) }));
const { rateLimit } = await import("./guard");

const req = (ip: string) => new Request("http://x/api", { method: "POST", headers: { "cf-connecting-ip": ip } });

describe("rateLimit (in-memory fallback)", () => {
  it("allows 20 requests a minute per client, then returns 429", async () => {
    for (let i = 0; i < 20; i++) expect(await rateLimit(req("10.0.0.1"))).toBeNull();
    const blocked = await rateLimit(req("10.0.0.1"));
    expect(blocked?.status).toBe(429);
    expect(await rateLimit(req("10.0.0.2"))).toBeNull(); // other clients unaffected
  });
});
