import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { approveSafe, safeMatching } from "../bulk";
import { applyFixes } from "../datafix";
import { approvalFilters } from "../filters";
import { setModelForTests } from "../providers";
import { proposalsPage } from "../views";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

const who = (id: string, propertyIds: Actor["propertyIds"]) => {
  const p = getPersona(id)!;
  return { persona: p, actor: { personaId: id, name: p.name, role: p.role, scope: p.scope, propertyIds } as Actor };
};
const LENA = who("lena", ["p01", "p02", "p03"]);

// 30 low-risk address fixes queued by a leasing agent (who may not apply them): 20 at p02, 10 at
// p10 (outside Marcus's scope), plus a rent fix (money, High) and a Medium spend with an amount.
async function seed() {
  setModelForTests(null);
  const f = openFixture();
  const add = f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', ?, 'properties.address_format', 'properties', ?, ?, '2026-11-01', 'info', '{}', ?)");
  const ids: string[] = [];
  for (let i = 0; i < 30; i++) {
    const p = i < 20 ? "p02" : "p10";
    add.run(`di-a${i}`, p, p, JSON.stringify({ changes: { street: `${i} Main St` } }));
    ids.push(`di-a${i}`);
  }
  f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', 'di-rent', 'leases.rent_outlier', 'leases', 'l1', 'p01', '2026-11-01', 'warn', '{}', ?)").run(JSON.stringify({ changes: { rent_cents: 150000 } }));
  await applyFixes({ db: f.db, ws: WS, actor: { ...LENA.actor, propertyIds: "all" } }, LENA.persona, [...ids, "di-rent"], { safeOnly: false });
  f.raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, confidence, risk, amount_cents, queue_state, created_at) VALUES (?, 'prop-spend', 'maintenance_triage', 'work_orders', 'WO-10001', 'p01', 'work_orders.approve_spend', 'Approve spend', 0.8, 'Low', 40000, 'needs_you', '2026-11-03T10:00:00Z')").run(WS);
  return f;
}
const decisions = (f: Awaited<ReturnType<typeof seed>>) => (f.raw.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ?").get(WS) as { n: number }).n;

describe("approvals inbox filters", () => {
  it("reads the short names and the f.<column> links, and drops unknown risks", () => {
    expect(approvalFilters({ "f.risk": "high", agent: "data_health" })).toEqual({ risk: "High", agent: "data_health" });
    expect(approvalFilters(new URLSearchParams("risk=Severe&f.property_id=p02&f.entity_type=leases"))).toEqual({ property: "p02", entity: "leases" });
    expect(approvalFilters({ agent: ["a", "b"], property: "x".repeat(200) })).toEqual({});
  });

  it("keep every page inside the filter, and list the options with counts", async () => {
    const f = await seed();
    const data = { db: f.db, ws: WS, actor: DANIEL };
    const p2 = await proposalsPage(data, { queue: "needs_you", property: "p02", size: 15, page: 2, facets: true });
    expect(p2.total).toBe(20);
    expect(p2.rows).toHaveLength(5);
    expect(p2.rows.every((r) => r.property_id === "p02")).toBe(true);
    const high = await proposalsPage(data, { queue: "needs_you", risk: "High" });
    expect(high.rows.map((r) => r.entity_id)).toEqual(["di-rent"]);
    const leases = await proposalsPage(data, { queue: "needs_you", entity: "work_orders" });
    expect(leases.rows.map((r) => r.id)).toEqual(["prop-spend"]);
    expect(p2.facets!.property).toEqual(expect.arrayContaining([{ key: "p02", label: "Barton Creek Commons", n: 20 }, { key: "p10", label: "Inman Park Flats", n: 10 }]));
    expect(p2.facets!.risk.find((x) => x.key === "Low")?.n).toBe(31);
    expect(p2.facets!.agent.map((x) => x.key).sort()).toEqual(["data_health", "maintenance_triage"]);
  });
});

describe("approve all low-risk matching", () => {
  it("counts every page, only low-risk items with no amount that this persona may decide, in scope", async () => {
    const f = await seed();
    const marcus = { db: f.db, ws: WS, actor: MARCUS, persona: getPersona("marcus")! };
    expect(await safeMatching(marcus, {})).toMatchObject({ count: 20, more: false });
    expect(await safeMatching({ ...marcus, actor: DANIEL, persona: getPersona("daniel")! }, {})).toMatchObject({ count: 30 });
    expect(await safeMatching({ ...marcus, actor: DANIEL, persona: getPersona("daniel")! }, { property: "p10" })).toMatchObject({ count: 10 });
    expect(await safeMatching(marcus, { risk: "High" })).toMatchObject({ count: 0 });
    // A leasing agent can see these but may not decide data fixes.
    expect(await safeMatching({ ...marcus, ...LENA }, {})).toMatchObject({ count: 0 });
  });

  it("caps one click and says more remain", async () => {
    const f = await seed();
    const s = { db: f.db, ws: WS, actor: MARCUS, persona: getPersona("marcus")! };
    const m = await safeMatching(s, {}, 8);
    expect(m).toMatchObject({ count: 8, more: true });
    expect(m.ids).toHaveLength(8);
  });

  it("approves each matching item once, even on a double click, and re-checks each one", async () => {
    const f = await seed();
    const s = { db: f.db, ws: WS, actor: MARCUS, persona: getPersona("marcus")! };
    const { ids } = await safeMatching(s, {});
    const [a, b] = await Promise.all([approveSafe(s, ids), approveSafe(s, ids)]);
    expect(a.approved + b.approved).toBe(20);
    expect(decisions(f)).toBe(20);
    expect(await safeMatching(s, {})).toMatchObject({ count: 0 });
    const refused = await approveSafe(s, ["prop-spend"]);
    expect(refused.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/individual review/) });
    const lena = await approveSafe({ ...s, ...LENA }, ids);
    expect(lena.approved).toBe(0);
  });
});
