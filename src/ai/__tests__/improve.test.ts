import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import type { Actor } from "@/entities/types";
import { getAction } from "@/extensions";
import { setModelForTests } from "../providers";
import { startRun } from "../orchestrator";
import { getAgent } from "../agents/registry";
import { delinquency } from "../facts";
import { clearImproveCache, executePlan, PlanConflict, planSummary, preview, REGISTRY } from "../improve";
import { canImprove, improveKeyFor, isRed, type ImproveKey } from "../improve/meta";
import "../agents";
import { DANIEL, MARCUS, openFixture, TODAY, WS } from "./fixture";

// "Improve with AI": drivers add up to the data, every plan step is a real agent action, estimates
// come from history in scope (or there is none), plans respect scope, run through the agent runtime
// with its approval rules, and a second click never doubles the proposals.

type Raw = ReturnType<typeof openFixture>["raw"];
type R = Record<string, string | number | null>;
function ins(raw: Raw, table: string, rows: R[], ws = "base") {
  for (const r of rows) {
    const row = { workspace_id: ws, ...r };
    const k = Object.keys(row);
    raw.prepare(`INSERT INTO ${table} (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).run(...Object.values(row));
  }
}

// Extra base data: a lease 15 days late (a reminder), reminder history in scope (12 approved more than
// 30 days ago, 9 followed by a payment), a vacant unit with a paused listing, a quiet prospect,
// renewal history, and a late job with an overloaded vendor next to one with capacity.
function setup() {
  const f = openFixture();
  const { raw } = f;
  ins(raw, "units", [
    { id: "u4", property_id: "p02", number: "220", market_rent_cents: 130000, status: "Occupied" },
    { id: "u5", property_id: "p01", number: "305", market_rent_cents: 140000, status: "Vacant", available_on: "2026-09-01" },
    { id: "u6", property_id: "p10", number: "110", market_rent_cents: 100000, status: "Vacant", available_on: "2026-10-20" },
  ]);
  ins(raw, "households", [{ id: "h4", property_id: "p02", name: "Park household" }]);
  ins(raw, "residents", [{ id: "r4", household_id: "h4", property_id: "p02", first_name: "Min", last_name: "Park", email: "min@park.example" }]);
  ins(raw, "leases", [{ id: "l4", property_id: "p02", unit_id: "u4", household_id: "h4", status: "Active", start_on: "2026-01-01", end_on: "2027-06-30", rent_cents: 130000 }]);
  ins(raw, "charges", [{ id: "c4", lease_id: "l4", household_id: "h4", property_id: "p02", unit_id: "u4", gl_account_id: "gl-4000", description: "Utilities", period: "2026-10", due_on: "2026-10-20", amount_cents: 9000 }]);
  // Reminder history on l1 and l2 (Austin): decided Aug–Sep, 9 of 12 paid within 30 days.
  for (let i = 0; i < 12; i++) {
    const day = `2026-0${8 + Math.floor(i / 6)}-${String(1 + (i % 6) * 4).padStart(2, "0")}`;
    const lease = i % 2 ? "l1" : "l2";
    ins(raw, "ai_proposals", [{ id: `hist-${i}`, agent: "collections", entity_type: "leases", entity_id: lease, property_id: "p01", action: "leases.send_reminder", title: "Reminder", confidence: 0.9, created_at: `${day}T15:00:00Z`, run_id: "run-hist" }]);
    ins(raw, "ai_decisions", [{ id: `hist-dec-${i}`, proposal_id: `hist-${i}`, decision: "Approved", decided_by: "marcus", decided_at: `${day}T15:00:00Z` }]);
    if (i < 9) ins(raw, "payments", [{ id: `hist-pay-${i}`, lease_id: lease, household_id: lease === "l1" ? "h1" : "h2", property_id: "p01", method: "ACH", received_on: `${day.slice(0, 8)}${String(Number(day.slice(8)) + 3).padStart(2, "0")}`, amount_cents: 1000 }]);
  }
  ins(raw, "listings", [
    { id: "lst5", property_id: "p01", unit_id: "u5", headline: "Sunny 2-bed at The Lofts", description: "Two bedrooms, updated kitchen, close to the trail.", rent_cents: 140000, status: "Paused", listed_on: "2026-09-05" },
    { id: "lst6", property_id: "p10", unit_id: "u6", headline: "1-bed at Inman Park", description: "One bedroom near the park.", rent_cents: 100000, status: "Paused", listed_on: "2026-10-21" },
  ]);
  ins(raw, "prospects", [
    { id: "pr1", property_id: "p01", name: "Dana Cole", stage: "Contacted", last_contact_at: "2026-10-25T10:00:00Z", created_at: "2026-10-20" },
    { id: "pr2", property_id: "p01", name: "Eli Fox", stage: "Contacted", last_contact_at: "2026-11-03T10:00:00Z", created_at: "2026-11-01" },
  ]);
  // Renewal history: 12 offers sent more than 30 days ago, 9 accepted.
  ins(raw, "renewal_offers", Array.from({ length: 12 }, (_, i) => ({ id: `ro-${i}`, lease_id: `old-${i}`, property_id: "p01", term_months: 12, rent_cents: 150000, current_rent_cents: 145000, status: i < 9 ? "Accepted" : "Countered", sent_at: "2026-08-01T10:00:00Z" })));
  ins(raw, "vendors", [
    { id: "v03", company: "Capital City Plumbing", trade: "Plumbing", metros: '["Austin"]', rating: 4.5, status: "Active" },
  ]);
  ins(raw, "vendor_cois", [{ id: "coi3", vendor_id: "v03", carrier: "Travelers", gl_limit_cents: 100000000, expires_on: "2027-06-01" }]);
  ins(raw, "work_orders", [
    { id: "WO-20001", property_id: "p01", unit_id: "u1", title: "Toilet running", category: "Plumbing", priority: "Normal", status: "Assigned", vendor_id: "v01", opened_at: "2026-10-25T10:00:00Z", sla_due_at: "2026-10-28T10:00:00Z" },
    ...[1, 2, 3].map((i) => ({ id: `WO-2100${i}`, property_id: "p02", title: `Leak ${i}`, category: "Plumbing", priority: "Normal", status: "Scheduled", vendor_id: "v01", opened_at: "2026-11-02T10:00:00Z", sla_due_at: "2026-11-05T10:00:00Z" })),
    { id: "WO-20002", property_id: "p10", title: "Door sticks", category: "General", priority: "Low", status: "On hold", opened_at: "2026-10-01T10:00:00Z", sla_due_at: "2026-10-04T10:00:00Z" },
  ]);
  return f;
}

const s = (f: ReturnType<typeof setup>, actor: Actor, ws = WS) => ({ db: f.db, ws, actor });
const proposals = (raw: Raw, where = "1 = 1") => raw.prepare(`SELECT * FROM ai_proposals WHERE workspace_id = ? AND ${where} ORDER BY seq`).all(WS) as R[];

beforeEach(() => {
  setModelForTests(null);
  clearImproveCache();
});
afterEach(() => setModelForTests(undefined));

describe("improve: who sees it and when", () => {
  it("maps KPI metrics to improvers", () => {
    expect(improveKeyFor("receivables.delinquency")).toBe("delinquency");
    expect(improveKeyFor("receivables.aging_live")).toBe("delinquency");
    expect(improveKeyFor("portfolio.occupancy")).toBe("vacancy");
    expect(improveKeyFor("maintenance.sla")).toBe("sla");
    expect(improveKeyFor("portfolio.noi")).toBeNull();
  });

  it("shows only to roles that can run agents and act on the metric's module", () => {
    const can = (role: Parameters<typeof canImprove>[0], k: ImproveKey, portal = false) => canImprove(role, k, portal);
    expect(can("principal", "delinquency")).toBe(true);
    expect(can("property_manager", "sla")).toBe(true);
    expect(can("accountant", "delinquency")).toBe(true);
    expect(can("accountant", "sla")).toBe(false);
    expect(can("leasing_agent", "vacancy")).toBe(true);
    expect(can("leasing_agent", "delinquency")).toBe(false);
    expect(can("maintenance_supervisor", "sla")).toBe(true);
    expect(can("maintenance_supervisor", "vacancy")).toBe(false);
    expect(can("admin", "delinquency")).toBe(false);
    expect(can("owner", "vacancy", true)).toBe(false);
  });

  it("is red when the KPI moved the wrong way or crossed its line", () => {
    expect(isRed("delinquency", { value: 170, previous: 160, goodWhen: "down" })).toBe(true);
    expect(isRed("delinquency", { value: 150, previous: 160, goodWhen: "down" })).toBe(false);
    expect(isRed("vacancy", { value: 0.963, previous: 0.964 })).toBe(true);
    expect(isRed("vacancy", { value: 0.97, previous: 0.96 })).toBe(false);
    expect(isRed("vacancy", { value: 0.93, previous: 0.92 })).toBe(true);
    expect(isRed("sla", { value: 0.85, previous: 0.8 })).toBe(true);
    expect(isRed("sla", { value: null, previous: 0.8 })).toBe(false);
  });
});

describe("improve: past-due rent", () => {
  it("drivers add up to the ledger, and the plan uses the Collections agent's rule", async () => {
    const f = setup();
    const p = await preview(s(f, DANIEL), "delinquency", null);
    const { rows } = await delinquency({ db: f.db, ws: WS, actor: DANIEL }, TODAY, { minDays: 1, limit: 1000 });
    const total = rows.reduce((a, d) => a + d.balance_cents, 0);
    expect(total).toBe(420000 + 240000 + 300000 + 9000);
    expect(p.headline).toContain("$9,690 past due across 4 households");
    // 30+ days: l1 Sep+Oct ($2,800), l2 Oct ($1,200), l3 all ($3,000).
    expect(p.drivers[0].text).toContain("$7,000 across 3 households");
    expect(p.drivers[0].share).toBeCloseTo(700000 / 969000, 5);
    const props = p.drivers.filter((d) => d.text.includes("of the 30+ day balance"));
    expect(props.reduce((a, d) => a + d.share!, 0)).toBeLessThanOrEqual(1);
    expect(props[0].text).toMatch(/57% of the 30\+ day balance is 2 households at The Lofts at Riverside \(\$4,000\)/);
    const step = (k: string) => p.steps.find((x) => x.key === k)!;
    expect(step("remind").ids).toEqual(["l4"]);
    expect(step("plan").ids.sort()).toEqual(["l1", "l2"]);
    expect(step("legal").ids).toEqual(["l3"]);
    expect(step("legal").routing).toBe("always_person");
    expect(step("plan").routing).toBe("approvals");
  });

  it("every agent step names a registered action the agent declares", async () => {
    const f = setup();
    for (const key of Object.keys(REGISTRY) as ImproveKey[]) {
      const p = await preview(s(f, DANIEL), key, null);
      for (const st of p.steps.filter((x) => x.agent)) {
        expect(getAction(st.action!), `${key}: ${st.action}`).toBeTruthy();
        expect(getAgent(st.agent!)!.actions, `${key}: ${st.agent}`).toContain(st.action);
      }
      for (const st of p.steps.filter((x) => !x.agent)) expect(st.routing).toBe("person");
    }
  });

  it("estimates from approved history in scope, or none when the sample is too small", async () => {
    const f = setup();
    const p = await preview(s(f, MARCUS), "delinquency", null);
    const remind = p.steps.find((x) => x.key === "remind")!;
    expect(remind.estimate).toMatchObject({ kind: "count", value: 1, sample: 12, confidence: "Low" });
    expect(remind.estimate!.basis).toContain("75% of 12 reminders");
    // No payment-plan history: the step shows its records and the balance at stake, no estimate.
    const plan = p.steps.find((x) => x.key === "plan")!;
    expect(plan.estimate).toBeNull();
    expect(plan.atStakeCents).toBe(660000);
  });

  it("keeps to the actor's scope and the card's property", async () => {
    const f = setup();
    const m = await preview(s(f, MARCUS), "delinquency", null);
    const ids = m.steps.flatMap((x) => x.ids);
    expect(ids).not.toContain("l3");
    expect(m.steps.find((x) => x.key === "legal")).toBeUndefined();
    const one = await preview(s(f, DANIEL), "delinquency", "p02");
    expect(one.steps.flatMap((x) => x.ids)).toEqual(["l4"]);
    expect(one.scope).toBe("Barton Creek Commons");
  });

  it("creates proposals through agent runs, money and legal to Approvals, and never twice", async () => {
    const f = setup();
    const r = await executePlan(s(f, DANIEL), "delinquency", null);
    expect(r.planId).toBe("plan-delinquency-all-0");
    expect(r.created).toBe(4);
    expect(r.waiting).toBe(4);
    const run = f.raw.prepare("SELECT agent_key, trigger_kind, started_by, status FROM agent_runs WHERE workspace_id = ? AND id = ?").get(WS, r.planId);
    expect(run).toMatchObject({ agent_key: "collections", trigger_kind: "manual", started_by: "daniel", status: "waiting_approval" });
    const ps = proposals(f.raw);
    expect(ps.every((x) => x.run_id === r.planId)).toBe(true);
    expect(ps.map((x) => `${x.entity_id}:${x.action}:${x.queue_state}`).sort()).toEqual([
      "l1:leases.offer_payment_plan:needs_you", "l2:leases.offer_payment_plan:needs_you", "l3:leases.refer_to_legal:needs_you", "l4:leases.send_reminder:needs_you",
    ]);
    expect(ps.find((x) => x.entity_id === "l3")).toMatchObject({ risk: "High", assignee_role: "property_manager" });
    // A second click finds nothing new and makes no plan.
    await expect(executePlan(s(f, DANIEL), "delinquency", null)).rejects.toThrow(PlanConflict);
    expect(proposals(f.raw)).toHaveLength(4);
  });

  it("two clicks at once: one plan, one proposal per record and action", async () => {
    const f = setup();
    const out = await Promise.allSettled([executePlan(s(f, DANIEL), "delinquency", null), executePlan(s(f, DANIEL), "delinquency", null)]);
    expect(out.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(PlanConflict);
    const keys = proposals(f.raw).map((x) => `${x.entity_id}|${x.action}`);
    expect(keys.length).toBe(4);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("low-risk reminders run on their own only when the agent is set to auto within policy", async () => {
    const f = setup();
    ins(f.raw, "agent_definitions", [{ id: "collections", name: "Collections agent", owner_role: "property_manager", goal: "x", autonomy: "auto_within_policy" }], WS);
    const p = await preview(s(f, DANIEL), "delinquency", null);
    expect(p.steps.find((x) => x.key === "remind")!.routing).toBe("auto");
    const r = await executePlan(s(f, DANIEL), "delinquency", null);
    expect(r.auto).toBe(1);
    const q = Object.fromEntries(proposals(f.raw).map((x) => [String(x.action), x.queue_state]));
    expect(q).toEqual({ "leases.send_reminder": "auto_handled", "leases.offer_payment_plan": "needs_you", "leases.refer_to_legal": "needs_you" });
  });

  it("tracks the outcome from payments on the plan's leases", async () => {
    const f = setup();
    const r = await executePlan(s(f, DANIEL), "delinquency", null);
    ins(f.raw, "payments", [{ id: "pay-new", lease_id: "l1", household_id: "h1", property_id: "p01", method: "ACH", received_on: TODAY, amount_cents: 140000 }], WS);
    const plan = await planSummary(s(f, DANIEL), "delinquency", null);
    expect(plan).toMatchObject({ id: r.planId, plans: 1, records: 4, proposals: { created: 4, waiting: 4, approved: 0 } });
    expect(plan!.outcome).toEqual(["$1,400 paid by 1 of 4 households in the plan"]);
    // Another scope has no plan.
    expect(await planSummary(s(f, MARCUS), "delinquency", null)).toBeNull();
  });
});

describe("improve: occupancy", () => {
  it("finds empty units, paused listings, quiet prospects and leases without offers, in scope", async () => {
    const f = setup();
    const p = await preview(s(f, MARCUS), "vacancy", null);
    expect(p.headline).toContain("1 empty unit");
    const step = (k: string) => p.steps.find((x) => x.key === k);
    expect(step("follow_up")!.ids).toEqual(["pr1"]);
    expect(step("relist")!.ids).toEqual(["lst5"]);
    expect(step("renew")!.ids).toEqual(["l1"]);
    expect(step("renew")!.estimate).toMatchObject({ kind: "count", value: 1, sample: 12 });
    expect(step("price")).toMatchObject({ agent: null, routing: "person", records: 1 });
  });

  it("runs the Leasing and Renewals agents for the plan's records only", async () => {
    const f = setup();
    const r = await executePlan(s(f, MARCUS), "vacancy", null);
    expect(r.runs.map((x) => x.agent)).toEqual(["leasing", "renewals"]);
    const ps = proposals(f.raw);
    expect(ps.map((x) => `${x.agent}:${x.entity_id}:${x.action}`).sort()).toEqual(["leasing:lst5:listings.publish", "leasing:pr1:prospects.send_follow_up", "renewals:l1:leases.send_renewal_offer"]);
    // No applications were scored: plan runs only touch the plan's records.
    expect(ps.some((x) => x.action === "applications.decide")).toBe(false);
  });
});

describe("improve: work orders past SLA", () => {
  it("triages new jobs and proposes moving late jobs to a vendor with capacity", async () => {
    const f = setup();
    const p = await preview(s(f, MARCUS), "sla", null);
    expect(p.drivers[0].text).toContain("1 open work order is past its SLA due day");
    expect(p.steps.find((x) => x.key === "reassign")!.ids).toEqual(["WO-20001"]);
    expect(p.steps.find((x) => x.key === "triage")!.routing).toBe("auto_some");
    const r = await executePlan(s(f, MARCUS), "sla", null);
    const ps = proposals(f.raw);
    expect(ps.find((x) => x.action === "work_orders.assign_vendor")).toMatchObject({ entity_id: "WO-20001", queue_state: "needs_you", risk: "Medium" });
    expect(JSON.parse(String(ps.find((x) => x.action === "work_orders.assign_vendor")!.payload)).effects[0].changes).toEqual({ vendor_id: "v03", status: "Assigned" });
    expect(ps.find((x) => x.action === "work_orders.triage")).toMatchObject({ entity_id: "WO-10001", queue_state: "auto_handled" });
    expect(r.auto).toBe(1);
    // The On-hold job in Atlanta is outside Marcus's scope.
    expect(p.steps.find((x) => x.key === "on_hold")).toBeUndefined();
  });
});

describe("improve: review fixes", () => {
  it("only a person's manual run is limited to a plan's records, never an event's payload", async () => {
    const f = setup();
    const r = await (await startRun({ db: f.db, ws: WS, actor: DANIEL, agent: "collections", trigger: { kind: "event", input: { plan: "x", improve: "delinquency", steps: [{ action: "leases.send_reminder", ids: ["l4"] }], ids: ["l4"] } } })).done;
    expect(r.proposals).toBeGreaterThan(1);
  });
});
