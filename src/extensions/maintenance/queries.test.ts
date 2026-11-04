import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { emptyDb, seed } from "@/server/query.fixture";
import { homeData, rankVendors } from "./queries";

// A property manager (Marcus: p01–p03) sees vendor history and certificate alerts from his own
// properties only, not from the rest of the organisation.
let db: Db;

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch([
    db.prepare("INSERT INTO meta (key, value) VALUES ('as_of', '2026-11-04') ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
    db.prepare("INSERT INTO vendors (workspace_id, id, company, trade, metros, status, rating) VALUES ('base', 'v01', 'Lone Star Plumbing', 'Plumbing', '[\"Austin\"]', 'Active', 4.6), ('base', 'v09', 'Peach Plumbing', 'Plumbing', '[\"Atlanta\",\"Austin\"]', 'Active', 4.1)"),
    db.prepare("INSERT INTO vendor_cois (workspace_id, id, vendor_id, carrier, gl_limit_cents, expires_on, status) VALUES ('base', 'c1', 'v01', 'H', 1, '2026-11-20', 'Expiring'), ('base', 'c9', 'v09', 'H', 1, '2026-11-15', 'Expiring')"),
    // v01 works in Austin (p01, in scope); v09 only in Atlanta (p05, out of scope), at a very different cost.
    db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, vendor_id, title, category, priority, status, cost_cents, opened_at, completed_at, sla_due_at) VALUES ('base', 'W1', 'p01', 'v01', 'Leak', 'Plumbing', 'Normal', 'Completed', 20000, '2026-09-01', '2026-09-02', '2026-09-04'), ('base', 'W9', 'p05', 'v09', 'Leak', 'Plumbing', 'Normal', 'Completed', 90000, '2026-09-01', '2026-09-09', '2026-09-04')"),
  ]);
});

describe("maintenance reads stay inside the manager's properties", () => {
  it("lists expiring certificates only for vendors who worked at in-scope properties", async () => {
    const marcus = await actorFor(db, null, getPersona("marcus")!);
    expect((await homeData(db, null, marcus)).cois.map((c) => c.vendor_id)).toEqual(["v01"]);
    const daniel = await actorFor(db, null, getPersona("daniel")!);
    expect((await homeData(db, null, daniel)).cois.map((c) => c.vendor_id).sort()).toEqual(["v01", "v09"]);
  });

  it("ranks vendors on track record from in-scope jobs only", async () => {
    const marcus = await actorFor(db, null, getPersona("marcus")!);
    const ranked = await rankVendors(db, null, "Plumbing", "p01", marcus.propertyIds);
    const v09 = ranked.find((v) => v.id === "v09")!;
    expect(v09).toMatchObject({ median_cents: null, on_time: null });
    expect(ranked.find((v) => v.id === "v01")).toMatchObject({ median_cents: 20000, on_time: 1 });
    const all = await rankVendors(db, null, "Plumbing", "p01", "all");
    expect(all.find((v) => v.id === "v09")).toMatchObject({ median_cents: 90000, on_time: 0 });
  });
});
