import { describe, expect, it, vi } from "vitest";
import { edgeGuard, sameOrigin, secureOrigin } from "./https";

const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => new Request(url, { method: init.method ?? "GET", headers: init.headers });

describe("edgeGuard: plain HTTP on the production hosts", () => {
  it("redirects http to https with 301, keeping the path and query", () => {
    for (const host of ["propniti.ai", "www.propniti.ai"]) {
      const res = edgeGuard(req(`http://${host}/app/today?view=x`))!;
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(`https://${host}/app/today?view=x`);
    }
  });

  it("redirects when Cloudflare says the visitor used http", () => {
    expect(edgeGuard(req("https://propniti.ai/", { headers: { "cf-visitor": '{"scheme":"http"}' } }))?.headers.get("location")).toBe("https://propniti.ai/");
    expect(edgeGuard(req("https://propniti.ai/", { headers: { "x-forwarded-proto": "http" } }))?.status).toBe(301);
  });

  it("passes https requests through", () => {
    expect(edgeGuard(req("https://propniti.ai/app/today", { headers: { "cf-visitor": '{"scheme":"https"}', "x-forwarded-proto": "https" } }))).toBeNull();
  });

  it("leaves localhost, dev and other hosts alone", () => {
    for (const url of ["http://localhost:3550/app", "http://127.0.0.1:3001/", "http://cron.internal/api/ai/sweep", "http://propniti.ai.evil.example/", "http://preview.example.workers.dev/"]) expect(edgeGuard(req(url))).toBeNull();
  });

  it("refuses writes from an http origin on the production hosts", () => {
    const res = edgeGuard(req("https://propniti.ai/api/e/leases", { method: "POST", headers: { origin: "http://propniti.ai" } }))!;
    expect(res.status).toBe(403);
    expect(edgeGuard(req("https://propniti.ai/api/e/leases", { method: "POST", headers: { origin: "https://propniti.ai" } }))).toBeNull();
    expect(edgeGuard(req("https://propniti.ai/app", { headers: { origin: "http://propniti.ai" } }))).toBeNull();
  });
});

describe("secureOrigin: the same-origin write check", () => {
  it("needs the origin's host to match", () => {
    expect(secureOrigin("https://propniti.ai", "propniti.ai", true)).toBe(true);
    expect(secureOrigin("https://evil.example", "propniti.ai", true)).toBe(false);
    expect(secureOrigin("not a url", "propniti.ai", false)).toBe(false);
    expect(secureOrigin(null, "propniti.ai", false)).toBe(false);
  });

  it("refuses http origins in production, except on loopback hosts", () => {
    expect(secureOrigin("http://propniti.ai", "propniti.ai", true)).toBe(false);
    expect(secureOrigin("http://propniti.ai", "propniti.ai", false)).toBe(true);
    expect(secureOrigin("http://localhost:3000", "localhost:3000", true)).toBe(true);
    expect(secureOrigin("http://127.0.0.1:3000", "127.0.0.1:3000", true)).toBe(true);
  });
});

describe("sameOrigin: one rule for the entity, session and AI routes", () => {
  it("is the same function everywhere", async () => {
    const [ai, e] = await Promise.all([import("@/ai/session"), import("@/app/api/e/_lib/http")]);
    expect(ai.sameOrigin).toBe(sameOrigin);
    expect(e.sameOrigin).toBe(sameOrigin);
  });

  it("refuses an http origin in production", () => {
    const post = (origin: string) => new Request("https://propniti.ai/api/ai/nl-filter", { method: "POST", headers: { origin, host: "propniti.ai" } });
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(sameOrigin(post("http://propniti.ai"))).toBe(false);
      expect(sameOrigin(post("https://propniti.ai"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(sameOrigin(post("http://propniti.ai"))).toBe(true);
  });
});
