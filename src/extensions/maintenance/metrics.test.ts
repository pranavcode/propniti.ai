import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { metrics } from "@/server/query";
import { emptyDb, seed } from "@/server/query.fixture";

let db: Db;
const ctx = async (p = "daniel") => ({ db, ws: null, actor: await actorFor(db, null, getPersona(p)!) });

// [id, property, status, sla_due_at, completed_at]
const WOS: [string, string, string, string, string | null][] = [
  ["WO-1", "p01", "Completed", "2026-09-10T12:00:00Z", "2026-09-09T10:00:00Z"],   // met
  ["WO-2", "p01", "Paid", "2026-09-12T12:00:00Z", "2026-09-15T10:00:00Z"],        // missed (late)
  ["WO-3", "p02", "Completed", "2026-10-03T12:00:00Z", "2026-10-02T09:00:00Z"],   // met
  ["WO-4", "p02", "In progress", "2026-10-05T12:00:00Z", null],                    // missed (open, past due)
  ["WO-5", "p05", "Completed", "2026-10-20T12:00:00Z", "2026-10-20T08:00:00Z"],   // met
  ["WO-6", "p05", "Assigned", "2026-11-30T12:00:00Z", null],                       // not due yet: excluded
  ["WO-7", "p05", "Cancelled", "2026-10-06T12:00:00Z", null],                      // cancelled: excluded
  // Many opened in one month and breached later must not push the rate below 0 (the old bug).
  ...Array.from({ length: 12 }, (_, i): [string, string, string, string, string | null] => [`WO-B${i}`, "p04", "In progress", `2026-08-0${(i % 9) + 1}T12:00:00Z`, null]),
];

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch(WOS.map(([id, p, status, due, done]) => db.prepare(
    "INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, sla_due_at, completed_at, opened_at) VALUES ('base', ?, ?, 'Job', 'Plumbing', 'Normal', ?, ?, ?, '2026-08-01T00:00:00Z')",
  ).bind(id, p, status, due, done)));
});

describe("maintenance.sla (SLA met rate)", () => {
  it("is completed-within-SLA over due in the month, and always between 0 and 1", async () => {
    const m = await metrics(await ctx(), "maintenance.sla", { months: 4 });
    const byMonth = Object.fromEntries(m.points.map((p) => [p.month, p]));
    expect(byMonth["2026-09"]).toMatchObject({ due: 2, met: 1, value: 0.5 });
    expect(byMonth["2026-10"]).toMatchObject({ due: 3, met: 2 });
    expect(byMonth["2026-08"]).toMatchObject({ due: 12, met: 0, value: 0 });
    expect(m.value).toBeCloseTo(2 / 3);
    for (const p of m.points.filter((x) => x.value != null)) {
      expect(Number(p.value)).toBeGreaterThanOrEqual(0);
      expect(Number(p.value)).toBeLessThanOrEqual(1);
    }
  });

  it("follows the persona's scope", async () => {
    const m = await metrics(await ctx("marcus"), "maintenance.sla", { months: 4 });
    const oct = m.points.find((p) => p.month === "2026-10")!;
    expect(oct).toMatchObject({ due: 2, met: 1 });
  });
});
