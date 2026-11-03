import { afterEach, describe, expect, it } from "vitest";
import { setModelForTests, type ChatModel, type Reply, type Turn } from "../providers";
import { startRun, sweep, drainEvents, claimSweep } from "../orchestrator";
import { executeProposal } from "../effects";
import { normalizeStreet } from "../agents/data-health";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";
import "../agents";

afterEach(() => setModelForTests(undefined));

const steps = (raw: ReturnType<typeof openFixture>["raw"], runId: string) => raw.prepare("SELECT kind, tool_key, ok, output FROM agent_steps WHERE run_id = ? ORDER BY idx").all(runId) as { kind: string; tool_key: string | null; ok: number; output: string }[];
const proposals = (raw: ReturnType<typeof openFixture>["raw"], runId: string) => raw.prepare("SELECT * FROM ai_proposals WHERE run_id = ? ORDER BY seq").all(runId) as Record<string, string | number>[];

describe("orchestrator, rules only", () => {
  it("Collections run records its steps and proposes within the persona's scope", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const { runId, done } = await startRun({ db, ws: WS, actor: MARCUS, agent: "collections", trigger: { kind: "manual" } });
    const r = await done;
    expect(r.status).toBe("waiting_approval");
    const run = raw.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as Record<string, unknown>;
    expect(run).toMatchObject({ workspace_id: WS, status: "waiting_approval", model: "rules", trigger_kind: "manual", started_by: "marcus" });
    const s = steps(raw, runId);
    expect(s.map((x) => x.kind)).toEqual(["plan", "tool_call", "tool_result", "plan", "proposal", "proposal"]);
    expect(s[1].tool_key).toBe("ledger.delinquency");
    const p = proposals(raw, runId);
    // l3 is in Atlanta, outside Marcus's three Austin properties.
    expect(p.map((x) => x.entity_id).sort()).toEqual(["l1", "l2"]);
    const l1 = p.find((x) => x.entity_id === "l1")!;
    expect(l1.action).toBe("leases.offer_payment_plan");
    expect(l1.title).toContain("$4,200");
    expect(l1.step_id).toBeTruthy();
    // The NSF payment doesn't count: Ana Ruiz owes October and November.
    expect(p.find((x) => x.entity_id === "l2")!.title).toContain("$2,400");
    expect(JSON.parse(String(p.find((x) => x.entity_id === "l2")!.payload)).effects[0].body).toMatch(/^Hola Ana/);
  });

  it("refers 90+ day balances to legal, always for a person, and doesn't duplicate on re-run", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const first = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "collections", trigger: { kind: "manual" } })).done;
    const legal = proposals(raw, first.runId).find((x) => x.entity_id === "l3")!;
    expect(legal).toMatchObject({ action: "leases.refer_to_legal", risk: "High", queue_state: "needs_you", assignee_role: "property_manager" });
    const again = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "collections", trigger: { kind: "manual" } })).done;
    expect(again.proposals).toBe(0);
    expect(again.status).toBe("done");
  });

  it("Maintenance triage auto-applies within the spend limit", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const r = await (await startRun({ db, ws: WS, actor: MARCUS, agent: "maintenance_triage", trigger: { kind: "manual" } })).done;
    const [p] = proposals(raw, r.runId);
    expect(p).toMatchObject({ entity_id: "WO-10001", queue_state: "auto_handled", amount_cents: 22000 });
    expect(p.title).toContain("Plumbing, Urgent → Lone Star Plumbing");
    const wo = raw.prepare("SELECT category, priority, vendor_id, status FROM work_orders WHERE workspace_id = ? AND id = 'WO-10001'").get(WS);
    expect(wo).toEqual({ category: "Plumbing", priority: "Urgent", vendor_id: "v01", status: "Assigned" });
    expect(raw.prepare("SELECT count(*) AS n FROM audit WHERE workspace_id = ?").get(WS)!.n).toBe(1);
    expect(r.status).toBe("done");
  });

  it("Payables stops a vendor whose bank changed and proposes the clean bill", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const r = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "ap", trigger: { kind: "manual" } })).done;
    const p = proposals(raw, r.runId);
    expect(p.map((x) => x.action)).toEqual(["vendors.verify_bank_change", "bills.hold", "bills.approve"]);
    expect(p[0]).toMatchObject({ risk: "High", entity_id: "v02" });
    expect(p[2]).toMatchObject({ entity_id: "b2", amount_cents: 22000, assignee_role: "accountant" });
  });

  it("Data Health fills a missing fix and applying it writes the overlay, fix log and issue status", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const r = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "data_health", trigger: { kind: "manual" } })).done;
    const [p] = proposals(raw, r.runId);
    expect(p.action).toBe("data_issues.apply_fix");
    const res = await executeProposal({ db, ws: WS, actor: DANIEL }, p, { id: "daniel", name: "Daniel Reyes" });
    expect(res.ok).toBe(true);
    expect(raw.prepare("SELECT street FROM properties WHERE workspace_id = ? AND id = 'p02'").get(WS)!.street).toBe("123 Main St");
    expect(raw.prepare("SELECT status FROM data_issues WHERE workspace_id = ? AND id = 'di1'").get(WS)!.status).toBe("fixed");
    expect(raw.prepare("SELECT count(*) AS n FROM data_fix_log WHERE workspace_id = ?").get(WS)!.n).toBe(1);
    // A second approval of the same proposal is refused.
    expect((await executeProposal({ db, ws: WS, actor: DANIEL }, p, { id: "daniel", name: "Daniel Reyes" })).status).toBe(409);
  });

  it("double approval runs a proposal once", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const r = await (await startRun({ db, ws: WS, actor: MARCUS, agent: "collections", trigger: { kind: "manual" } })).done;
    const [p] = proposals(raw, r.runId);
    const data = { db, ws: WS, actor: MARCUS };
    const results = await Promise.all([executeProposal(data, p, { id: "marcus", name: "Marcus Bell" }), executeProposal(data, p, { id: "marcus", name: "Marcus Bell" })]);
    expect(results.map((x) => x.ok).sort()).toEqual([false, true]);
    expect(raw.prepare("SELECT count(*) AS n FROM messages WHERE workspace_id = ?").get(WS)!.n).toBe(1);
  });
});

// A scripted model: proves the loop runs tools, rejects a draft with a made-up figure, and keeps
// the rules' amounts when the model proposes.
function scripted(script: ((turns: Turn[]) => Reply)[]): ChatModel {
  let i = 0;
  const usage = { tokensIn: 100, tokensOut: 50, costCents: 0.1, latencyMs: 5 };
  return {
    info: { provider: "anthropic", model: "claude-opus-5", label: "Scripted", native: true },
    chat: async (_s, turns) => ({ ...script[Math.min(i++, script.length - 1)](turns), usage }),
    structured: async () => {
      throw new Error("not used");
    },
  };
}

describe("orchestrator with a model", () => {
  it("runs the tool loop, rejects invented figures and records model usage", async () => {
    const lastResult = (t: Turn[]) => {
      const last = t[t.length - 1];
      return last.role === "tool" ? last.results[0].output : "";
    };
    setModelForTests(scripted([
      () => ({ text: "Checking the ledger.", calls: [{ id: "a", name: "ledger__lookup", input: { lease_id: "l1" } }], usage: undefined! }),
      () => ({ text: "", calls: [{ id: "b", name: "messages__draft", input: { entity_id: "l1", subject: "Your balance", body: "Hi Jordan, you owe $9,999. Please pay." } }], usage: undefined! }),
      (t) => {
        expect(lastResult(t)).toContain("Draft rejected");
        return { text: "", calls: [{ id: "c", name: "messages__draft", input: { entity_id: "l1", subject: "Your balance", body: "Hi Jordan, your balance is $4,200. We can split it into three payments of $1,400." } }], usage: undefined! };
      },
      () => ({ text: "", calls: [{ id: "d", name: "actions__propose", input: { entity: "leases", entity_id: "l1", action: "leases.offer_payment_plan", title: "Offer a plan", why: ["Two months behind, steady payer before"], confidence: 0.99 } }], usage: undefined! }),
      () => ({ text: "Proposed a plan for Jordan Lee; Ana Ruiz looks like a bank error, skipped.", calls: [], usage: undefined! }),
    ]));
    const { raw, db } = openFixture();
    const r = await (await startRun({ db, ws: WS, actor: MARCUS, agent: "collections", trigger: { kind: "manual" } })).done;
    const run = raw.prepare("SELECT model, tokens_in, tokens_out, summary FROM agent_runs WHERE id = ?").get(r.runId) as Record<string, unknown>;
    expect(run.model).toBe("claude-opus-5");
    expect(run.tokens_in).toBe(500);
    expect(String(run.summary)).toContain("Ana Ruiz looks like a bank error");
    const p = proposals(raw, r.runId);
    expect(p).toHaveLength(1);
    expect(p[0].title).toContain("$4,200");
    expect(p[0].confidence).toBe(0.8);
    expect(String(p[0].why)).toContain("AI: Two months behind");
    expect(JSON.parse(String(p[0].payload)).effects[0].body).toContain("three payments of $1,400");
    const kinds = steps(raw, r.runId).map((s) => `${s.kind}${s.tool_key ? ":" + s.tool_key : ""}${s.ok ? "" : "!"}`);
    expect(kinds).toContain("tool_result:messages.draft!");
    expect(kinds).toContain("reasoning_summary");
  });

  it("falls back to rules when the model fails", async () => {
    setModelForTests(scripted([() => {
      throw new Error("upstream 529");
    }]));
    const { raw, db } = openFixture();
    const r = await (await startRun({ db, ws: WS, actor: MARCUS, agent: "collections", trigger: { kind: "manual" } })).done;
    expect(proposals(raw, r.runId)).toHaveLength(2);
    expect(steps(raw, r.runId).some((s) => s.output?.includes("upstream 529"))).toBe(true);
  });
});

describe("sweep and events", () => {
  it("claims a sweep slot once per 15 minutes", async () => {
    const { db } = openFixture();
    const now = Date.parse("2026-11-04T14:00:00Z");
    expect(await claimSweep(db, now)).toBe(true);
    expect(await claimSweep(db, now + 60_000)).toBe(false);
    expect(await claimSweep(db, now + 15 * 60_000)).toBe(true);
  });

  it("runs due scheduled agents over base and drains a workspace's events", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    raw.exec(`INSERT INTO events (workspace_id, id, type, entity_type, entity_id, payload, created_at) VALUES ('${WS}', 'e1', 'wo.created', 'work_orders', 'WO-10001', '{}', '2026-11-04')`);
    const at = Date.parse("2026-11-04T14:00:30Z");
    raw.prepare("UPDATE workspaces SET last_seen_at = ? WHERE id = ?").run(at - 60_000, WS);
    const report = await sweep(db, at);
    // 14:00 UTC: collections (0 14 * * *), payables (0 */2 * * *) and maintenance triage (*/15) are due.
    expect(report!.scheduled.map((s) => s.agent).sort()).toEqual(["ap", "collections", "maintenance_triage"]);
    expect(report!.events).toEqual([{ ws: WS, processed: 1, runs: [expect.any(String)] }]);
    const runs = raw.prepare("SELECT workspace_id, agent_key, trigger_kind, status FROM agent_runs ORDER BY seq").all();
    expect(runs).toContainEqual({ workspace_id: "base", agent_key: "collections", trigger_kind: "schedule", status: "waiting_approval" });
    expect(runs).toContainEqual({ workspace_id: WS, agent_key: "maintenance_triage", trigger_kind: "event", status: "done" });
    expect(raw.prepare("SELECT processed_at IS NOT NULL AS done, run_id IS NOT NULL AS linked FROM events WHERE id = 'e1'").get()).toEqual({ done: 1, linked: 1 });
    // Scheduled runs never change base records: the triage proposal waits for a person there.
    expect(raw.prepare("SELECT queue_state FROM ai_proposals WHERE workspace_id = 'base' AND agent = 'maintenance_triage'").get()).toEqual({ queue_state: "needs_you" });
    expect((await drainEvents(db, WS, Date.now())).processed).toBe(0);
  });
});

describe("helpers", () => {
  it("normalizes street lines to USPS style", () => {
    expect(normalizeStreet("123 MAIN STREET.")).toBe("123 Main St");
    expect(normalizeStreet("45 north lamar boulevard")).toBe("45 N Lamar Blvd");
  });
});
