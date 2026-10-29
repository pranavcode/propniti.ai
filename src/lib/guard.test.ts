import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ getPlatform: () => ({}) }));
const { clientKey, rateLimit, readBodyLimited } = await import("./guard");

const req = (ip: string) => new Request("http://x/api", { method: "POST", headers: { "cf-connecting-ip": ip } });

describe("clientKey", () => {
  it("trusts cf-connecting-ip only on Cloudflare, and other headers only when configured", () => {
    expect(clientKey(req("1.1.1.1"), true)).toBe("1.1.1.1");
    expect(clientKey(req("1.1.1.1"), false, undefined)).toBe("shared"); // spoofable off Cloudflare
    const viaProxy = new Request("http://x", { headers: { "x-forwarded-for": "2.2.2.2, 10.0.0.1" } });
    expect(clientKey(viaProxy, false, "x-forwarded-for")).toBe("2.2.2.2");
  });
});

describe("rateLimit (in-memory fallback)", () => {
  it("caps a trusted client at 20 a minute and keeps clients separate", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "cf-connecting-ip");
    for (let i = 0; i < 20; i++) expect(await rateLimit(req("10.0.0.1"))).toBeNull();
    expect((await rateLimit(req("10.0.0.1")))?.status).toBe(429);
    expect(await rateLimit(req("10.0.0.2"))).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("readBodyLimited", () => {
  it("counts bytes, not characters, and stops at the cap", async () => {
    const body = "é".repeat(600); // 1,200 bytes
    expect(await readBodyLimited(new Request("http://x", { method: "POST", body }), 1_000)).toBeInstanceOf(Response);
    const ok = await readBodyLimited(new Request("http://x", { method: "POST", body }), 2_000);
    expect(ok).toBeInstanceOf(Uint8Array);
    expect((ok as Uint8Array).byteLength).toBe(1_200);
  });
});
