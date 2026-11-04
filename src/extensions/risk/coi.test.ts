import { beforeAll, describe, expect, it, vi } from "vitest";
import "@/entities";
import { getPlatform } from "@/lib/platform";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { runAction } from "@/app/api/e/_lib/actions";
import { getAction } from "@/extensions/actions";
import type { WriteCtx } from "@/server/query";
import * as listRoute from "@/app/api/e/[entity]/route";

// Vendors can submit a certificate of insurance but can't make it count: it stays pending until
// staff verify it, and dispatch only accepts a verified, unexpired certificate.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const db = () => getPlatform().db;
const host = "propniti.test";
const post = (path: string, body: unknown, persona: string) => new Request(`http://${host}${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { host, origin: `http://${host}`, "content-type": "application/json", cookie: `pn_as=${persona}; pn_ws=${WS}` },
});
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });
const wctx = async (persona: string): Promise<WriteCtx> => ({ db: db(), ws: WS, nowMs: Date.parse("2026-11-04T15:00:00Z"), actor: await actorFor(db(), WS, getPersona(persona)!) });
const coi = { vendor_id: "v01", carrier: "Hartford", gl_limit: 2_000_000, workers_comp: true, expires_on: "2027-06-30" };
const dispatch = { vendor_id: "v01", priority: "Normal", category: "Plumbing" };

beforeAll(async () => {
  await seed(db());
  for (const s of [
    `INSERT INTO vendors (workspace_id, id, company, trade, status, metros) VALUES ('base', 'v01', 'Lone Star Plumbing', 'Plumbing', 'Active', '["Austin"]')`,
    "INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', 'WO-9', 'p01', 'Kitchen leak', 'Plumbing', 'Normal', 'New', '2026-11-03T10:00:00Z')",
  ]) await db().prepare(s).run();
});

describe("vendor certificates", () => {
  let created = "";

  it("won't let a vendor submit a certificate as verified or valid", async () => {
    for (const extra of [{ review: "Verified" }, { review: "Valid" }, { status: "Valid" }]) {
      expect((await listRoute.POST(post("/api/e/vendor_cois", { ...coi, ...extra }, "vendor"), p({ entity: "vendor_cois" }))).status).toBe(400);
    }
  });

  it("stores a vendor's submission as pending verification", async () => {
    const res = await listRoute.POST(post("/api/e/vendor_cois", coi, "vendor"), p({ entity: "vendor_cois" }));
    expect(res.status).toBe(201);
    created = (await res.json()).row.id;
    const row = await db().prepare("SELECT status FROM vendor_cois WHERE workspace_id = ? AND id = ?").bind(WS, created).first<{ status: string }>();
    expect(row!.status).toBe("Pending verification");
  });

  it("dispatch ignores a pending certificate", async () => {
    const r = await runAction(await wctx("tom"), getAction("work_orders.dispatch")!, "WO-9", dispatch);
    expect(r.status).toBe(409);
    expect(r).toMatchObject({ error: expect.stringContaining("waiting for verification") });
  });

  it("lets only staff verify, once, and then dispatch accepts it", async () => {
    const verify = getAction("vendor_cois.verify")!;
    const input = { expires_on: "2027-06-30", gl_limit: 2_000_000, workers_comp: true };
    await expect(runAction(await wctx("vendor"), verify, created, input)).rejects.toMatchObject({ status: 403 });
    const ctx = await wctx("tom");
    const results = await Promise.all([runAction(ctx, verify, created, input), runAction(ctx, verify, created, input)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await runAction(ctx, getAction("work_orders.dispatch")!, "WO-9", dispatch)).status).toBe(200);
  });

  it("refuses vendor edits to a certificate", async () => {
    const { PATCH } = await import("@/app/api/e/[entity]/[id]/route");
    const req = new Request(`http://${host}/api/e/vendor_cois/${created}`, { method: "PATCH", body: JSON.stringify({ expires_on: "2030-01-01" }), headers: { host, origin: `http://${host}`, "content-type": "application/json", cookie: `pn_as=vendor; pn_ws=${WS}` } });
    expect((await PATCH(req, p({ entity: "vendor_cois", id: created }))).status).toBe(403);
  });
});

describe("requesting a current certificate", () => {
  const count = async (sql: string, ...b: unknown[]) => (await db().prepare(sql).bind(WS, ...b).first<{ n: number }>())?.n;
  const asked = (vendor: string) => count("SELECT count(*) AS n FROM notifications WHERE workspace_id = ? AND user_id = ? AND title LIKE 'Upload a current certificate%'", vendor);

  beforeAll(async () => {
    for (const s of [
      `INSERT INTO vendors (workspace_id, id, company, trade, status, metros) VALUES ('base', 'v02', 'Hill Country HVAC', 'HVAC', 'Active', '["Austin"]')`,
      `INSERT INTO vendors (workspace_id, id, company, trade, status, metros) VALUES ('base', 'v03', 'Bright Turn Services', 'Turns', 'Active', '["Austin"]')`,
      `INSERT INTO vendors (workspace_id, id, company, trade, status, metros) VALUES ('base', 'v04', 'Green Lawn Co', 'Landscaping', 'Active', '["Austin"]')`,
      "INSERT INTO vendor_cois (workspace_id, id, vendor_id, carrier, gl_limit_cents, workers_comp, expires_on, status) VALUES ('base', 'coi-v02', 'v02', 'Travelers', 200000000, 1, '2026-09-30', 'Expired')",
      "INSERT INTO vendor_cois (workspace_id, id, vendor_id, carrier, gl_limit_cents, workers_comp, expires_on, status) VALUES ('base', 'coi-v03', 'v03', 'Hartford', 100000000, 0, '2026-08-31', 'Expired')",
      // Asked two weeks ago: that's outside the window, so v04 can be asked again.
      "INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, at) VALUES ('base', 'n-old', 'v04', 'In-app', 'Upload a current certificate of insurance', '', '2026-10-15T10:00:00Z')",
    ]) await db().prepare(s).run();
  });

  it("asks once on a double click, audited, and refuses a repeat inside the window", async () => {
    const a = getAction("vendor_cois.request_certificate")!;
    const ctx = await wctx("tom");
    const statuses = (await Promise.all([runAction(ctx, a, "coi-v02", {}), runAction(ctx, a, "coi-v02", {})])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await asked("v02")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'vendor_cois.request_certificate' AND entity_id = 'coi-v02'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE workspace_id = ? AND verb = 'requested' AND entity_id IN ('v02', 'coi-v02')")).toBe(2);
    // The same vendor from its record is the same request.
    const again = await runAction(ctx, getAction("vendors.request_certificate")!, "v02", {});
    expect(again).toMatchObject({ status: 409, error: expect.stringContaining("already asked") });
    expect(await asked("v02")).toBe(1);
  });

  it("asks a vendor from its record when the last request is older than the window", async () => {
    const r = await runAction(await wctx("tom"), getAction("vendors.request_certificate")!, "v04", {});
    expect(r.status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM notifications WHERE workspace_id = ? AND user_id = 'v04'")).toBe(1);
  });

  it("requests all in one call, reporting each certificate", async () => {
    const { POST } = await import("@/app/api/e/[entity]/actions/[action]/route");
    const res = await POST(post("/api/e/vendor_cois/actions/request_certificate", { ids: ["coi-v02", "coi-v03"] }, "tom"), p({ entity: "vendor_cois", action: "request_certificate" }));
    const out = await res.json();
    expect(out).toMatchObject({ ok: 1, failed: 1 });
    expect(out.results.find((x: { id: string }) => x.id === "coi-v03")).toMatchObject({ status: 200 });
    expect(await asked("v03")).toBe(1);
  });

  it("is staff-only", async () => {
    await expect(runAction(await wctx("vendor"), getAction("vendor_cois.request_certificate")!, "coi-v03", {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("vendor upload with an AI read", () => {
  it("records that AI read the file and the vendor confirmed, and still waits for staff", async () => {
    const a = getAction("vendors.upload_coi")!;
    const input = a.input!.parse({ carrier: "Travelers", glLimitCents: 200_000_000, workersComp: false, expiresOn: "2027-08-31", fileName: "coi.pdf", read: { source: "live", confidence: 0.93, fields: ["carrier", "glLimit", "workersComp", "expiresOn"] } });
    expect((await runAction(await wctx("vendor"), a, "v01", input)).status).toBe(200);
    const coi = await db().prepare("SELECT status, gl_limit_cents FROM vendor_cois WHERE workspace_id = ? AND vendor_id = 'v01' AND carrier = 'Travelers'").bind(WS).first();
    expect(coi).toEqual({ status: "Pending verification", gl_limit_cents: 200_000_000 });
    const ev = await db().prepare("SELECT payload FROM events WHERE workspace_id = ? AND type = 'coi.uploaded' ORDER BY created_at DESC LIMIT 1").bind(WS).first<{ payload: string }>();
    expect(JSON.parse(ev!.payload).read).toMatchObject({ source: "live", confidence: 0.93 });
    // A typed upload needs no read at all.
    expect(a.input!.parse({ carrier: "Travelers", glLimitCents: 200_000_000, workersComp: false, expiresOn: "2027-08-31", fileName: "coi.pdf" })).toMatchObject({ read: { source: "manual" } });
  });
});
