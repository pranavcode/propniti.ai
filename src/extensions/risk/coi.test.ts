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
