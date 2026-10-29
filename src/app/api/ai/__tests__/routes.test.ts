import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ getPlatform: () => ({}) }));
const validate = await import("../validate/route");
const ask = await import("../ask/route");
const extract = await import("../extract/route");

const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://x/api", { method: "POST", body, headers: { "cf-connecting-ip": `t-${Math.random()}`, ...headers } });

describe("AI routes", () => {
  it("return 400 for bad JSON and wrong shapes", async () => {
    expect((await validate.POST(post("{"))).status).toBe(400);
    expect((await validate.POST(post(JSON.stringify({ workOrder: { id: 1 } })))).status).toBe(400);
    expect((await ask.POST(post(JSON.stringify({ question: "hi", state: { invoices: [null] } })))).status).toBe(400);
  });

  it("returns 413 for an oversized body and 415 for an unknown file type", async () => {
    expect((await validate.POST(post("x".repeat(300 * 1024)))).status).toBe(413);
    const big = new FormData();
    big.append("file", new File([new Uint8Array(5 * 1024 * 1024)], "big.png"));
    expect((await extract.POST(post(big))).status).toBe(413);
    const txt = new FormData();
    txt.append("file", new File(["hello"], "a.png"));
    expect((await extract.POST(post(txt))).status).toBe(415);
  });

  it("answers a valid request with a mock result when no provider is configured", async () => {
    const { seed } = await import("@/lib/seed");
    const res = await validate.POST(post(JSON.stringify({ workOrder: seed().workOrders[0] })));
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("mock");
  });
});
