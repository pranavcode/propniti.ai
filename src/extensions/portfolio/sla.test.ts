import { beforeAll, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { metrics } from "@/server/query";
import { emptyDb, seed } from "@/server/query.fixture";

// The per-property SLA split (comparison column, chart, Explain) must add up to the scope figure
// every home shows: one formula, two groupings.

let db: Db;
const ctx = async (p: string) => ({ db, ws: null, actor: await actorFor(db, null, getPersona(p)!) });

// [property, sla_due_at, completed_at] across months, properties and outcomes.
const WOS: [string, string, string | null][] = [
  ["p01", "2026-09-10T12:00:00Z", "2026-09-09T10:00:00Z"], ["p01", "2026-09-12T12:00:00Z", "2026-09-15T10:00:00Z"],
  ["p01", "2026-10-02T12:00:00Z", "2026-10-01T10:00:00Z"], ["p02", "2026-10-03T12:00:00Z", "2026-10-02T09:00:00Z"],
  ["p02", "2026-10-05T12:00:00Z", null], ["p03", "2026-10-07T12:00:00Z", "2026-10-09T12:00:00Z"],
  ["p05", "2026-10-20T12:00:00Z", "2026-10-20T08:00:00Z"], ["p05", "2026-10-21T12:00:00Z", null], ["p12", "2026-10-22T12:00:00Z", "2026-10-22T08:00:00Z"],
];

beforeAll(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch(WOS.map(([p, due, done], i) => db.prepare(
    "INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, sla_due_at, completed_at, opened_at) VALUES ('base', ?, ?, 'Job', 'Plumbing', 'Normal', ?, ?, ?, '2026-08-01T00:00:00Z')",
  ).bind(`WO-S${i}`, p, done ? "Completed" : "In progress", due, done)));
});

describe("maintenance.sla_by_property", () => {
  for (const persona of ["daniel", "priya", "marcus"]) {
    it(`sums to maintenance.sla for ${persona}'s scope`, async () => {
      const c = await ctx(persona);
      for (const month of ["2026-09", "2026-10"]) {
        const total = (await metrics(c, "maintenance.sla", { month, months: 1 })).points.at(-1)!;
        const split = (await metrics(c, "maintenance.sla_by_property", { month })).points;
        expect(split.reduce((s, p) => s + Number(p.due), 0)).toBe(total.due);
        expect(split.reduce((s, p) => s + Number(p.met), 0)).toBe(total.met);
        for (const p of split) expect(Number(p.value)).toBeCloseTo(Number(p.met) / Number(p.due));
      }
    });
  }

  it("has data to compare", async () => {
    const split = (await metrics(await ctx("daniel"), "maintenance.sla_by_property", { month: "2026-10" })).points;
    expect(split.map((p) => p.property_id).sort()).toEqual(["p01", "p02", "p03", "p05", "p12"]);
  });
});
