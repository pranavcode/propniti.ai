import { beforeAll, describe, expect, it } from "vitest";
import { delinquency } from "@/ai/facts";
import type { Actor } from "@/entities/types";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { AS_OF } from "@/seed/constants";
import { homeMetrics } from "@/extensions/portfolio/home/data";
import { metrics } from "@/server/query";
import "@/extensions";
import { workbench } from "./collections";
import { agingByProperty, delinquentLeases } from "./queries";

// "Every number explained": the receivables pages (aging grid, delinquent leases) and the Collections
// agent's facts (the workbench and the agent's proposals both read delinquency()) must agree on what
// is past due, how old it is, and who owes it.

let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 180_000);

const actor = (propertyIds: string[] | "all"): Actor => ({ personaId: "grace", name: "Grace Kim", role: "accountant", scope: propertyIds === "all" ? { kind: "org", label: "All" } : { kind: "property", ids: propertyIds, label: "" }, propertyIds });

describe.each([["one Austin property", ["p02"]], ["org-wide", "all"]] as const)("receivables pages and the Collections Agent agree: %s", (_label, scope) => {
  it("on total past due, aging buckets and the leases owing", { timeout: 120_000 }, async () => {
    const a = actor(scope === "all" ? "all" : [...scope]);
    const ctx = { db, ws: null, actor: a };
    const props = scope === "all" ? undefined : [...scope];
    const [aging, leases, agent, wb] = await Promise.all([
      agingByProperty(ctx),
      delinquentLeases(ctx, { page: 1, size: 5000 }),
      delinquency({ db, ws: "~", actor: a }, AS_OF, { minDays: 1, propertyIds: props, limit: 5000 }),
      workbench(ctx, { page: 1, size: 5000 }),
    ]);
    const pages = { total: aging.reduce((s, r) => s + r.total, 0), b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
    for (const r of aging) {
      pages.b0_30 += r.b0_30;
      pages.b31_60 += r.b31_60;
      pages.b61_90 += r.b61_90;
      pages.b90p += r.b90p;
    }
    const ag = { total: agent.total_balance_cents, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
    for (const r of agent.rows) {
      ag.b0_30 += r.aging.d0_30;
      ag.b31_60 += r.aging.d31_60;
      ag.b61_90 += r.aging.d61_90;
      ag.b90p += r.aging.d90p;
    }

    expect(pages.total).toBeGreaterThan(0);
    expect(pages).toEqual(ag);
    expect(leases.totalCents).toBe(ag.total);
    expect(new Set(leases.rows.map((r) => r.lease_id))).toEqual(new Set(agent.rows.map((r) => r.lease_id)));
    const perLease = new Map(agent.rows.map((r) => [r.lease_id, r.balance_cents]));
    for (const r of leases.rows) expect([r.lease_id, r.total]).toEqual([r.lease_id, perLease.get(r.lease_id)]);
    expect(wb.total).toBe(agent.total);
    expect(wb.balance).toBe(ag.total);
  });

  it("the home Delinquent KPI and Finance's delinquency aging card show the same past-due total", { timeout: 120_000 }, async () => {
    const ctx = { db, ws: null, actor: actor(scope === "all" ? "all" : [...scope]) };
    const [home, aging, pages] = await Promise.all([homeMetrics(ctx), metrics(ctx, "receivables.aging_live"), agingByProperty(ctx)]);
    expect(home.kpis.delinquency.value).toBeGreaterThan(0);
    expect(home.kpis.delinquency.value).toBe(aging.value);
    expect(Math.round(home.kpis.delinquency.value! * 100)).toBe(pages.reduce((s, r) => s + r.total, 0));
  });
});
