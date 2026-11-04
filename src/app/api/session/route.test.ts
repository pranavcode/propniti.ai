import { describe, expect, it, vi } from "vitest";
import { DEMO_PASSWORD, demoEmail, personaByEmail, safeNext } from "@/auth/personas";
import { POST } from "./route";

// No Workers rate limiter here, so rateLimit() uses its in-memory window ("shared" key: 300 a minute).
vi.mock("@/lib/platform", () => ({ getPlatform: () => ({}) }));

const host = "propniti.test";
const post = (body: Record<string, string>, { json = false, origin = `http://${host}` }: { json?: boolean; origin?: string | null } = {}) => {
  const headers = new Headers({ host, "content-type": json ? "application/json" : "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  return POST(new Request(`http://${host}/api/session`, { method: "POST", headers, body: json ? JSON.stringify(body) : new URLSearchParams(body) }));
};

describe("demo accounts", () => {
  it("derives one email per persona and matches it case-insensitively", () => {
    expect(demoEmail("marcus")).toBe("marcus@propniti.demo");
    expect(personaByEmail("  Marcus@Propniti.demo ")?.id).toBe("marcus");
    expect(personaByEmail("marcus@example.com")).toBeUndefined();
    expect(personaByEmail("")).toBeUndefined();
  });

  it("keeps next to /app and /portal paths", () => {
    expect(safeNext("/app/properties/p01")).toBe("/app/properties/p01");
    expect(safeNext("/portal/owner?x=1")).toBe("/portal/owner?x=1");
    expect(safeNext("/app")).toBe("/app");
    for (const bad of ["https://evil.example", "//evil.example", "/apples", "/login", "/app\r\nSet-Cookie: x=1", "/app/\nx", "", undefined, null]) expect(safeNext(bad)).toBeUndefined();
  });
});

describe("POST /api/session with email and password", () => {
  it("signs in with the demo password and lands on the persona's home", async () => {
    const res = await post({ email: "marcus@propniti.demo", password: DEMO_PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/app/today");
    expect(res.headers.get("set-cookie")).toContain("pn_as=marcus");
  });

  it("answers JSON with the landing page, honouring a safe next", async () => {
    const res = await post({ email: "GRACE@propniti.demo", password: DEMO_PASSWORD, next: "/app/payables/bills" }, { json: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, persona: "grace", href: "/app/payables/bills" });
    expect(res.headers.get("set-cookie")).toContain("pn_as=grace");
  });

  it("ignores an off-site next", async () => {
    for (const next of ["https://evil.example", "//evil.example/app", "/login"]) {
      const res = await post({ email: "owner@propniti.demo", password: DEMO_PASSWORD, next });
      expect(res.headers.get("location")).toBe("/portal/owner");
    }
  });

  it("says which field is wrong and sets no cookie", async () => {
    const unknown = await post({ email: "mallory@propniti.demo", password: DEMO_PASSWORD }, { json: true });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ field: "email", error: "No demo account with that email — pick a person from the list." });
    expect(unknown.headers.get("set-cookie")).toBeNull();

    const wrong = await post({ email: "marcus@propniti.demo", password: "propniti-dem" }, { json: true });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ field: "password", error: "Wrong password — the demo password is shown above." });
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const empty = await post({ email: "marcus@propniti.demo" }, { json: true });
    expect((await empty.json()).field).toBe("password");
  });

  it("sends a plain form post back to the sign-in page with the error, the email and a safe next", async () => {
    const res = await post({ email: "marcus@propniti.demo", password: "nope", next: "/app/leases" });
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!, "http://x");
    expect(to.pathname).toBe("/login");
    expect(Object.fromEntries(to.searchParams)).toEqual({ error: "password", email: "marcus@propniti.demo", next: "/app/leases" });
    expect(res.headers.get("set-cookie")).toBeNull();

    const evil = new URL((await post({ email: "x@y.z", password: "nope", next: "https://evil.example" })).headers.get("location")!, "http://x");
    expect(evil.searchParams.get("error")).toBe("email");
    expect(evil.searchParams.has("next")).toBe(false);
  });

  it("refuses cross-site posts", async () => {
    expect((await post({ email: "marcus@propniti.demo", password: DEMO_PASSWORD }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ email: "marcus@propniti.demo", password: DEMO_PASSWORD }, { origin: null })).status).toBe(403);
  });
});

describe("POST /api/session with a persona (the cards)", () => {
  it("still signs in with one click", async () => {
    const res = await post({ persona: "tom", next: "/app/maintenance/turnovers" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/app/maintenance/turnovers");
    expect(res.headers.get("set-cookie")).toContain("pn_as=tom");
    expect((await post({ persona: "mallory" })).status).toBe(400);
  });
});

// Last: it spends the in-memory budget for this file.
describe("rate limit", () => {
  it("answers 429 once the write budget is spent", async () => {
    let last = 0;
    for (let i = 0; i < 310 && last !== 429; i++) last = (await post({ email: "marcus@propniti.demo", password: "wrong" }, { json: true })).status;
    expect(last).toBe(429);
  });
});
