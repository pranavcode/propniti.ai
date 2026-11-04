import { describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { autonomyLevel, automationsView, describeCron, sweepTiming } from "../automations";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

const SAM: Actor = { personaId: "sam", name: "Sam Okafor", role: "admin", scope: { kind: "org", label: "All" }, propertyIds: "all" };
const NOW = Date.parse("2026-11-04T18:07:30Z");

function seedRuns(raw: ReturnType<typeof openFixture>["raw"]) {
  const run = (id: string, agent: string, status: string, at: string) =>
    raw.prepare("INSERT INTO agent_runs (workspace_id, id, agent_key, trigger_kind, status, started_at) VALUES (?, ?, ?, 'schedule', ?, ?)").run(WS, id, agent, status, at);
  run("run-c1", "collections", "done", "2026-11-03T14:00:00Z");
  run("run-c2", "collections", "failed", "2026-11-04T14:00:00Z");
  run("run-a1", "ap", "waiting_approval", "2026-11-04T12:00:00Z");
  const ev = (id: string, type: string, pid: string | null, processed: string | null) =>
    raw.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, created_at, processed_at) VALUES (?, ?, ?, 'leases', 'l1', ?, '2026-11-04T09:00:00Z', ?)").run(WS, id, type, pid, processed);
  ev("e1", "charge.overdue", "p01", null);
  ev("e2", "charge.overdue", "p10", null);
  ev("e3", "payment.failed", "p01", "2026-11-04T10:00:00Z");
}

describe("schedule wording", () => {
  it("says common cron schedules in plain words and falls back to the expression", () => {
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("*/30 13-23 * * *")).toBe("Every 30 minutes, 13:00–23:59");
    expect(describeCron("0 */4 * * *")).toBe("Every 4 hours");
    expect(describeCron("0 14 * * *")).toBe("Daily at 14:00");
    expect(describeCron("0 13 * * 1")).toBe("Mondays at 13:00");
    expect(describeCron("0 12 1 * *")).toBe("Monthly on day 1 at 12:00");
    expect(describeCron("5 1 * 6 *")).toBe("5 1 * 6 *");
  });

  it("shows two autonomy levels: a saved suggest is approve first", () => {
    expect(autonomyLevel("suggest").label).toBe("Approve first");
    expect(autonomyLevel("act_with_approval").label).toBe("Approve first");
    expect(autonomyLevel("auto_within_policy").label).toBe("Auto within policy");
  });

  it("times the sweep on real 15-minute ticks", () => {
    expect(sweepTiming(NOW, NOW - 8 * 60_000)).toEqual({ nextInMin: 8, lastAgoMin: 8, late: false });
    expect(sweepTiming(NOW, null)).toEqual({ nextInMin: 8, lastAgoMin: null, late: false });
    expect(sweepTiming(NOW, NOW - 40 * 60_000).late).toBe(true);
  });
});

describe("automations view", () => {
  it("lists the eight agents with triggers, counts, status and drill-downs", async () => {
    const { raw, db } = openFixture();
    seedRuns(raw);
    const v = await automationsView({ db, ws: WS, actor: DANIEL }, NOW);
    expect(v.agents.map((a) => a.key)).toEqual(["collections", "leasing", "renewals", "maintenance_triage", "ap", "data_health", "owner_reporting", "compliance"]);
    const c = v.agents.find((a) => a.key === "collections")!;
    expect(c).toMatchObject({ schedule: "0 14 * * *", scheduleText: "Daily at 14:00", ok30: 1, failed30: 1, runs30: 2, status: { label: "Last run failed", tone: "danger" } });
    expect(c.events.map((e) => e.label)).toEqual(["Payment returned", "Rent overdue"]);
    expect(c.lastRun).toMatchObject({ id: "run-c2", status: "failed", href: "/app/ai/runs/run-c2" });
    expect(c.nextDueAt).toBeTruthy();
    expect(c.scope).toContain("Leases");
    expect(c.href).toBe("/app/ai/activity?agent=collections");
    expect(v.agents.find((a) => a.key === "maintenance_triage")!.autonomy).toMatchObject({ value: "auto_within_policy", label: "Auto within policy" });
    expect(v.can).toMatchObject({ editAutonomy: true, settings: true, editPolicies: true, policiesHref: "/app/agents" });
  });

  it("an agent turned off shows Off and no next run", async () => {
    const { raw, db } = openFixture();
    raw.prepare("INSERT INTO agent_definitions (workspace_id, id, name, owner_role, goal, tools, triggers, autonomy, enabled) VALUES (?, 'renewals', 'Renewals agent', 'property_manager', 'x', '[]', ?, 'suggest', 0)").run(WS, JSON.stringify({ schedule: "0 13 * * 1", events: ["lease.expiring"] }));
    const r = (await automationsView({ db, ws: WS, actor: DANIEL }, NOW)).agents.find((a) => a.key === "renewals")!;
    expect(r).toMatchObject({ enabled: false, nextDueAt: null, status: { label: "Off" }, autonomy: { value: "act_with_approval" } });
  });

  it("maps every listened-to event to its source and listeners, with queued counts in the actor's scope", async () => {
    const { raw, db } = openFixture();
    seedRuns(raw);
    const org = await automationsView({ db, ws: WS, actor: DANIEL }, NOW);
    const overdue = org.events.find((e) => e.type === "charge.overdue")!;
    expect(overdue).toMatchObject({ label: "Rent overdue", queued: 2, agents: [{ key: "collections", name: "Collections agent" }] });
    expect(overdue.source).toMatch(/sweep/);
    expect(org.events.find((e) => e.type === "payment.failed")!.queued).toBe(0);
    // Listened to, but nothing in the product raises it.
    expect(org.events.find((e) => e.type === "coi.expiring")!.source).toBeNull();
    const mine = await automationsView({ db, ws: WS, actor: MARCUS }, NOW);
    expect(mine.events.find((e) => e.type === "charge.overdue")!.queued).toBe(1);
  });

  it("a property-scoped manager drills into the agent's runs, not a trace outside their scope", async () => {
    const { raw, db } = openFixture();
    seedRuns(raw);
    const v = await automationsView({ db, ws: WS, actor: MARCUS }, NOW);
    expect(v.agents.find((a) => a.key === "collections")!.lastRun!.href).toBe("/app/ai/activity?agent=collections");
    expect(v.can).toMatchObject({ editAutonomy: true, settings: false, editPolicies: false, policiesHref: null });
  });

  it("an admin reads agents but can't change autonomy, and edits approval policies in settings", async () => {
    const { db } = openFixture();
    const v = await automationsView({ db, ws: WS, actor: SAM }, NOW);
    expect(getPersona("sam")!.role).toBe("admin");
    expect(v.can).toMatchObject({ editAutonomy: false, settings: true, editPolicies: true, policiesHref: "/app/settings/approvals" });
  });

  it("lists the org approval policies in decision order with what always needs a person", async () => {
    const { db } = openFixture();
    const v = await automationsView({ db, ws: WS, actor: DANIEL }, NOW);
    expect(v.policies.map((p) => p.category)).toEqual(["Maintenance spend", "Bill payment", "Legal", "Safety"]);
    expect(v.policies[0]).toMatchObject({ limit: 500, ownerOver: 2500, approver: "Maintenance supervisor", alwaysHuman: false });
    expect(v.policies.find((p) => p.category === "Legal")).toMatchObject({ limit: null, alwaysHuman: true });
    expect(v.policiesOk).toBe(true);
  });

  it("counts the data-health rules the agent checks and lists the state fee caps", async () => {
    const { raw, db } = openFixture();
    raw.prepare("INSERT INTO state_rules (workspace_id, id, state, rule, value, effective_from) VALUES ('base', 'sr1', 'TX', 'late_fee_cap_pct', '10', '2015-01-01'), ('base', 'sr2', 'TX', 'late_fee_cap_pct', '12', '2027-01-01'), ('base', 'sr3', 'AZ', 'nsf_fee_cap_cents', '2500', '2015-01-01')").run();
    const v = await automationsView({ db, ws: WS, actor: DANIEL }, NOW);
    expect(v.dataRules).toBe(1);
    expect(v.stateCaps).toEqual({ lateFeePct: [{ state: "TX", value: 10 }], nsfCents: [{ state: "AZ", value: 2500 }] });
  });
});
