import { beforeAll, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { openSqlite } from "@/lib/platform/sqlite";
import { resolveActor } from "@/server/permissions";
import { runSpec, scopeProperties, type Ctx } from "./run";
import { rulesSpec, validateSpec } from "./spec";
import { arAging, noiByProperty, pnl, rentRoll } from "./standard";

// Every report and every measure × grouping runs on the generated base without SQL errors.

let ctx: Ctx;
beforeAll(async () => {
  const db = openSqlite(":memory:");
  ctx = { db, ws: null, actor: await resolveActor(db, getPersona("grace")!, null) };
}, 120_000);

describe("reports on the generated base", () => {
  it("runs the standard reports", async () => {
    const p = await pnl(ctx, "2026-01", "2026-10");
    expect(p.income).toBeGreaterThan(0);
    expect(Math.round(p.noi)).toBe(Math.round(p.income - p.expense));
    const rr = await rentRoll(ctx, 1, 50);
    expect(rr.rows).toHaveLength(50);
    expect(rr.total).toBeGreaterThan(3000);
    expect((await arAging(ctx)).rows.length).toBeGreaterThan(0);
    expect((await noiByProperty(ctx, "2025-11", "2026-10")).rows).toHaveLength(30);
  }, 60_000);

  it("answers the example question with utilities by property vs budget", async () => {
    const scope = await scopeProperties(ctx);
    const { spec } = validateSpec(rulesSpec("show me utilities by property for Q3 vs budget", scope, "2026-10"), scope, "2026-10");
    const r = await runSpec(ctx, spec);
    expect(r.rows.length).toBe(30);
    expect(r.total).toBeGreaterThan(0);
    expect(r.compareTotal).toBeGreaterThan(0);
  }, 60_000);

  it.each(["expense", "utilities", "noi", "income", "collections", "delinquency", "vacancy_loss", "bills_paid"])("runs %s by every allowed grouping", async (measure) => {
    const scope = await scopeProperties(ctx);
    for (const groupBy of ["property", "metro", "gl", "month", "vendor"]) {
      for (const compareTo of ["none", "budget", "prior_year"]) {
        const { spec, dropped } = validateSpec({ measure, groupBy, from: "2026-04", to: "2026-09", compareTo, properties: null, metros: null, chart: null, title: null }, scope, "2026-10");
        if (dropped.length) continue;
        const r = await runSpec(ctx, spec);
        expect(Number.isFinite(r.total)).toBe(true);
      }
    }
  }, 120_000);
});
