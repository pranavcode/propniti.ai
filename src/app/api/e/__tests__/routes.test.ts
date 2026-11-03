import { beforeAll, describe, expect, it } from "vitest";
import { getPlatform } from "@/lib/platform";
import { registerAction } from "@/extensions/actions";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { runAction, resolveAction } from "../_lib/actions";
import * as listRoute from "../[entity]/route";
import * as recordRoute from "../[entity]/[id]/route";
import * as exportRoute from "../[entity]/export.csv/route";
import * as notesRoute from "../[entity]/[id]/notes/route";
import * as metricRoute from "../../metrics/[key]/route";
import * as sessionRoute from "../../session/route";

// The generic entity API over HTTP. getPlatform() opens DATABASE_PATH, so tests run on a
// fresh in-memory database with the shared fixture.
process.env.DATABASE_PATH = ":memory:";

const host = "propniti.test";
const req = (path: string, init: RequestInit & { persona?: string; origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  headers.set("cookie", `pn_as=${init.persona ?? "daniel"}; pn_ws=${WS}`);
  if (init.origin !== null && init.method && init.method !== "GET") headers.set("origin", init.origin ?? `http://${host}`);
  return new Request(`http://${host}${path}`, { ...init, headers });
};
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

beforeAll(async () => {
  await seed(getPlatform().db);
});

describe("GET /api/e/[entity]", () => {
  it("lists with filters, sort, totals and status-tab counts", async () => {
    const res = await listRoute.GET(req("/api/e/units?f.status=Vacant&sort=-number&size=4"), p({ entity: "units" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 6, page: 1, size: 4 });
    expect(body.rows).toHaveLength(4);
    expect(body.counts.Occupied).toBe(12);
  });

  it("applies the persona's scope from pn_as", async () => {
    const body = await (await listRoute.GET(req("/api/e/properties", { persona: "marcus" }), p({ entity: "properties" }))).json();
    expect(body.total).toBe(3);
  });

  it("answers 400 for unknown fields, 403 for unreadable entities and 404 for unknown ones", async () => {
    expect((await listRoute.GET(req("/api/e/properties?f.bogus=1"), p({ entity: "properties" }))).status).toBe(400);
    expect((await listRoute.GET(req("/api/e/charges", { persona: "lena" }), p({ entity: "charges" }))).status).toBe(403);
    expect((await listRoute.GET(req("/api/e/nope"), p({ entity: "nope" }))).status).toBe(404);
  });
});

describe("GET /api/e/[entity]/[id]", () => {
  it("returns the record with relations, and 404 outside scope", async () => {
    const body = await (await recordRoute.GET(req("/api/e/leases/l-p01-u1"), p({ entity: "leases", id: "l-p01-u1" }))).json();
    expect(body.row).toMatchObject({ id: "l-p01-u1", rent: 1450 });
    expect(body.relations.unit.rows[0].id).toBe("p01-u1");
    expect(body.relations.charges.total).toBe(1);
    expect((await recordRoute.GET(req("/api/e/properties/p06", { persona: "marcus" }), p({ entity: "properties", id: "p06" }))).status).toBe(404);
  });
});

describe("writes", () => {
  it("answers 405 for generic writes to money tables, before reading the body", async () => {
    const post = await listRoute.POST(req("/api/e/charges", { method: "POST", body: "{}", persona: "grace" }), p({ entity: "charges" }));
    expect(post.status).toBe(405);
    const patch = await recordRoute.PATCH(req("/api/e/payments/pay-p01-u1", { method: "PATCH", body: "{}", persona: "grace" }), p({ entity: "payments", id: "pay-p01-u1" }));
    expect(patch.status).toBe(405);
    const del = await recordRoute.DELETE(req("/api/e/charges/c-p01-u1", { method: "DELETE", persona: "grace" }), p({ entity: "charges", id: "c-p01-u1" }));
    expect(del.status).toBe(405);
  });

  it("refuses cross-site writes", async () => {
    const res = await recordRoute.PATCH(req("/api/e/units/p01-u1", { method: "PATCH", body: JSON.stringify({ sqft: 900 }), origin: "https://evil.example" }), p({ entity: "units", id: "p01-u1" }));
    expect(res.status).toBe(403);
    const none = await listRoute.POST(req("/api/e/units", { method: "POST", body: "{}", origin: null }), p({ entity: "units" }));
    expect(none.status).toBe(403);
  });

  it("caps the body size", async () => {
    const res = await recordRoute.PATCH(req("/api/e/units/p01-u1", { method: "PATCH", body: JSON.stringify({ number: "x".repeat(70_000) }), headers: { "content-length": "70020" } }), p({ entity: "units", id: "p01-u1" }));
    expect(res.status).toBe(413);
  });

  it("rejects fields the role may not edit", async () => {
    const res = await recordRoute.PATCH(req("/api/e/properties/p01", { method: "PATCH", persona: "marcus", body: JSON.stringify({ status: "Renovation" }) }), p({ entity: "properties", id: "p01" }));
    expect(res.status).toBe(400);
  });
});

describe("export and metrics", () => {
  it("streams CSV for the list's URL state", async () => {
    const res = await exportRoute.GET(req("/api/e/properties/export.csv?f.metro=Austin"), p({ entity: "properties" }));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect((await res.text()).trim().split("\r\n")).toHaveLength(4);
  });

  it("serves metrics within scope", async () => {
    const res = await metricRoute.GET(req("/api/metrics/portfolio.noi", { persona: "marcus" }), p({ key: "portfolio.noi" }));
    expect((await res.json()).value).toBe(2850);
    expect((await metricRoute.GET(req("/api/metrics/nope.x"), p({ key: "nope.x" }))).status).toBe(404);
  });

  it("reads notes for a record the persona can see, 404 otherwise", async () => {
    expect((await notesRoute.GET(req("/api/e/units/p01-u1/notes"), p({ entity: "units", id: "p01-u1" }))).status).toBe(200);
    expect((await notesRoute.GET(req("/api/e/units/p05-u1/notes", { persona: "marcus" }), p({ entity: "units", id: "p05-u1" }))).status).toBe(404);
  });
});

describe("actions", () => {
  registerAction({
    key: "units.mark_down", label: "Mark unit down", entity: "units", roles: ["property_manager", "maintenance_supervisor"],
    when: (r) => r.status !== "Down",
    handler: async () => ({ status: 200, message: "Unit marked down" }),
  });

  it("checks the action's roles, the row's scope and when(), then audits", async () => {
    const db = getPlatform().db;
    const a = resolveAction("units", "mark_down");
    const ctx = async (id: string) => ({ db, ws: WS, actor: await actorFor(db, WS, getPersona(id)!), nowMs: 0 });
    await expect(runAction(await ctx("lena"), a, "p01-u1", {})).rejects.toMatchObject({ status: 403 });
    await expect(runAction(await ctx("marcus"), a, "p05-u1", {})).rejects.toMatchObject({ status: 404 });
    expect(await runAction(await ctx("marcus"), a, "p01-u1", {})).toMatchObject({ status: 200 });
    expect((await db.prepare("SELECT count(*) AS n FROM audit WHERE action = 'units.mark_down'").first())!.n).toBe(1);
    expect(() => resolveAction("units", "nope")).toThrow();
    expect(() => resolveAction("properties", "units.mark_down")).toThrow();
  });
});

describe("POST /api/session", () => {
  it("sets pn_as and lands on the persona's home; refuses unknown personas and off-site next", async () => {
    const form = (data: Record<string, string>) => req("/api/session", { method: "POST", body: new URLSearchParams(data), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const ok = await sessionRoute.POST(form({ persona: "grace" }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/app/payables/bills");
    expect(ok.headers.get("set-cookie")).toContain("pn_as=grace");
    expect((await sessionRoute.POST(form({ persona: "mallory" }))).status).toBe(400);
    expect((await sessionRoute.POST(form({ persona: "grace", next: "https://evil.example" }))).headers.get("location")).toBe("/app/payables/bills");
    expect((await sessionRoute.POST(form({ persona: "grace", next: "/app/properties/p01" }))).headers.get("location")).toBe("/app/properties/p01");
  });
});
