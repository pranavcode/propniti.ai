import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { emptyDb, seed, WS } from "@/server/query.fixture";
import { list, metrics, type QueryCtx } from "@/server/query";
import { runAction } from "@/app/api/e/_lib/actions";
import { getAction } from "@/extensions/actions";
import { expiries } from "./timeline";

// Derived statuses follow the demo's today (meta.as_of = 2026-10-28 in the fixture), not the
// stored status column.

let db: Db;
const ctx = async (personaId: string, ws: string | null = null): Promise<QueryCtx> => ({ db, ws, actor: await actorFor(db, ws, getPersona(personaId)!) });

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  const rows = [
    "INSERT INTO vendors (workspace_id, id, company, trade) VALUES ('base', 'v1', 'Lone Star Plumbing', 'Plumbing'), ('base', 'v2', 'Hill Country HVAC', 'HVAC'), ('base', 'v3', 'Bluebonnet Roofing', 'Roofing')",
    // v1: an old expired row (history) and a current one expiring in 18 days.
    "INSERT INTO vendor_cois (workspace_id, id, vendor_id, carrier, gl_limit_cents, expires_on, status) VALUES ('base', 'coi-v1-old', 'v1', 'Hartwell', 100000000, '2025-11-15', 'Expired'), ('base', 'coi-v1', 'v1', 'Hartwell', 100000000, '2026-11-15', 'Valid'), ('base', 'coi-v2', 'v2', 'Summit', 200000000, '2026-10-01', 'Valid'), ('base', 'coi-v3', 'v3', 'Summit', 100000000, '2027-05-01', 'Missing')",
    "INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', 'WO-1', 'p01', 'Leak', 'HVAC', 'Normal', 'Assigned', '2026-10-20T10:00:00Z'), ('base', 'WO-2', 'p05', 'Roof', 'Roofing', 'Normal', 'Scheduled', '2026-10-20T10:00:00Z')",
    "UPDATE work_orders SET vendor_id = 'v2' WHERE id = 'WO-1'",
    "UPDATE work_orders SET vendor_id = 'v3' WHERE id = 'WO-2'",
    `INSERT INTO compliance_items (workspace_id, id, property_id, kind, title, due_on, completed_on, status) VALUES
      ('base', 'c1', 'p01', 'Fire inspection', 'Fire inspection — Lofts', '2026-10-01', NULL, 'Open'),
      ('base', 'c2', 'p01', 'Backflow', 'Backflow test — Lofts', '2026-11-10', NULL, 'Open'),
      ('base', 'c3', 'p05', 'Permit', 'Permit — Inman', '2027-03-01', NULL, 'Overdue'),
      ('base', 'c4', 'p02', 'Fire inspection', 'Fire inspection — Barton', '2026-09-01', '2026-08-30', 'Open'),
      ('base', 'c5', 'p02', 'Pool license', 'Pool — Barton', '2026-10-15', NULL, 'Done')`,
    "INSERT INTO insurance_policies (workspace_id, id, property_id, kind, carrier, policy_number, coverage_cents, premium_cents, starts_on, expires_on) VALUES ('base', 'ins-1', 'p01', 'General liability', 'Great Plains', 'GPM-1', 200000000, 2000000, '2025-11-20', '2026-11-20'), ('base', 'ins-2', 'p05', 'Property', 'Sentinel', 'SPI-1', 900000000, 7000000, '2026-03-01', '2027-02-28')",
    "INSERT INTO legal_cases (workspace_id, id, property_id, kind, stage, balance_cents, opened_on) VALUES ('base', 'lc-1', 'p01', 'Eviction', 'Hearing set', 412550, '2026-09-20'), ('base', 'lc-2', 'p05', 'Small claims', 'Closed', 90000, '2026-01-10')",
  ];
  for (const s of rows) await db.prepare(s).run();
});

describe("derived statuses", () => {
  it("classifies compliance items by due date and completion", async () => {
    const res = await list(await ctx("daniel"), "compliance_items", { sort: ["due_on", "asc"] });
    expect(Object.fromEntries(res.rows.map((r) => [r.id, r.status]))).toEqual({ c4: "Done", c1: "Overdue", c5: "Done", c2: "Due soon", c3: "Open" });
    expect(res.counts).toMatchObject({ Overdue: 1, "Due soon": 1, Open: 1, Done: 2 });
  });

  it("classifies certificates and marks only the latest per vendor as current", async () => {
    const res = await list(await ctx("tom"), "vendor_cois", {});
    const byId = Object.fromEntries(res.rows.map((r) => [r.id, r]));
    expect(byId["coi-v1"]).toMatchObject({ status: "Expiring", is_current: true });
    expect(byId["coi-v1-old"]).toMatchObject({ status: "Expired", is_current: false });
    expect(byId["coi-v2"].status).toBe("Expired");
    expect(byId["coi-v3"].status).toBe("Missing");
    expect((await list(await ctx("tom"), "vendor_cois", { filters: { is_current: "true" } })).total).toBe(3);
  });

  it("flags policies expiring within 60 days", async () => {
    const res = await list(await ctx("daniel"), "insurance_policies", {});
    expect(Object.fromEntries(res.rows.map((r) => [r.id, r.status]))).toEqual({ "ins-1": "Expiring", "ins-2": "Active" });
  });
});

describe("risk metrics", () => {
  it("counts org-wide for a principal", async () => {
    const c = await ctx("daniel");
    expect((await metrics(c, "risk.expiring_30")).value).toBe(3); // coi-v1, ins-1, c2
    expect((await metrics(c, "risk.overdue_items")).value).toBe(1);
    expect((await metrics(c, "risk.exposed_vendors")).value).toBe(2); // v2 (expired) and v3 (missing), both with open jobs
    expect((await metrics(c, "risk.legal_open")).value).toBe(1);
    expect((await metrics(c, "risk.legal_balance")).value).toBe(4125.5);
    expect((await metrics(c, "risk.coi_status")).points).toEqual([{ status: "Expiring", count: 1 }, { status: "Expired", count: 1 }, { status: "Missing", count: 1 }]);
  });

  it("narrows property-scoped metrics to the persona's properties", async () => {
    const c = await ctx("marcus"); // p01–p03
    expect((await metrics(c, "risk.exposed_vendors")).value).toBe(1); // v3's open job is at p05
    const kinds = (await metrics(c, "risk.items_by_kind")).points;
    expect(kinds.find((k) => k.kind === "Permit")).toBeUndefined();
    expect(kinds.find((k) => k.kind === "Fire inspection")).toMatchObject({ overdue: 1, done: 1 });
    const months = (await metrics(c, "risk.expiries_by_month")).points;
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ month: "2026-10", from: "2026-10-01", to: "2026-10-31" });
    expect(months[1]).toMatchObject({ month: "2026-11", coi: 1, policy: 1, item: 1 });
  });

  it("refuses roles without risk access", async () => {
    await expect(metrics(await ctx("lena"), "risk.overdue_items")).rejects.toThrow();
  });
});

describe("expiries timeline", () => {
  it("lists lapsed, upcoming and missing items in date order within scope", async () => {
    const t = await expiries(await ctx("marcus"), 90);
    expect(t.today).toBe("2026-10-28");
    expect(t.rows.map((r) => `${r.kind}:${r.id}`)).toEqual(["item:c1", "coi:coi-v2", "item:c2", "coi:coi-v1", "policy:ins-1", "coi:coi-v3"]);
  });
});

describe("actions", () => {
  it("marks a compliance item done once, in the overlay", async () => {
    const c = await ctx("marcus", WS);
    const a = getAction("compliance_items.mark_done")!;
    const w = { ...c, ws: WS, nowMs: Date.parse("2026-10-28T15:00:00Z") };
    expect(await runAction(w, a, "c1", { completed_on: "2026-10-27" })).toMatchObject({ status: 200 });
    expect((await list(c, "compliance_items", { filters: { status: "Done" } })).total).toBe(3);
    expect(await runAction(w, a, "c1", { completed_on: "2026-10-27" })).toMatchObject({ status: 409 });
    expect((await db.prepare("SELECT count(*) AS n FROM compliance_items WHERE workspace_id = 'base' AND completed_on IS NULL AND id = 'c1'").first<{ n: number }>())?.n).toBe(1);
  });

  it("asks the vendor for a certificate through a portal notification", async () => {
    const c = await ctx("tom", WS);
    const r = await runAction({ ...c, ws: WS, nowMs: Date.parse("2026-10-28T15:00:00Z") }, getAction("vendor_cois.request_certificate")!, "coi-v2", {});
    expect(r).toMatchObject({ status: 200 });
    const n = await db.prepare("SELECT user_id, title FROM notifications WHERE workspace_id = ?").bind(WS).first<{ user_id: string; title: string }>();
    expect(n).toEqual({ user_id: "v2", title: "Upload a current certificate of insurance" });
  });
});
