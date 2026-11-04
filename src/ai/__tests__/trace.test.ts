import { describe, expect, it } from "vitest";
import { describeSteps, NO_REFS, plainError, sentenceText, wantedRefs, type TraceRefs, type TraceStepLike } from "../trace";

// The run trace in plain words: each row is a sentence built from the step data, with records
// linked by name when the viewer may see them.

const at = "2026-11-04T09:00:00Z";
const step = (idx: number, kind: TraceStepLike["kind"], s: Partial<TraceStepLike> = {}): TraceStepLike => ({ idx, kind, ok: true, at, ...s });

const refs: TraceRefs = {
  records: {
    "prospects:pr-p01-0014": { type: "Prospect", name: "Isaiah Shah", href: "/app/leasing/prospects/pr-p01-0014", property: "The Lofts at Riverside" },
    "prospects:pr-p09-0001": { type: "Prospect" },
    "leases:L-10494": { type: "Lease", name: "L-10494 · Liam Price", href: "/app/leases/L-10494", property: "Barton Creek Commons" },
  },
  entities: { prospects: { one: "Prospect", many: "Prospects" }, leases: { one: "Lease", many: "Leases" }, work_orders: { one: "Work order", many: "Work orders" } },
  actions: { "prospects.send_follow_up": "Send follow-up", "leases.refer_to_legal": "Refer for legal review" },
  proposals: { prop_1: "leases:L-10494" },
};

const one = (steps: TraceStepLike[], r: TraceRefs = refs, model?: string) => {
  const rows = describeSteps(steps, r, { model });
  expect(rows).toHaveLength(1);
  return rows[0];
};

describe("proposal steps", () => {
  it("names the record, its type and property, the reason and the confidence", () => {
    const row = one([step(0, "proposal", { input: { action: "prospects.send_follow_up", entity: "prospects", id: "pr-p01-0014" }, output: { title: "Follow up with Isaiah Shah: no contact in 22 days", confidence: 0.88 } })]);
    expect(sentenceText(row.sentence)).toBe("Proposed “Send follow-up” for Isaiah Shah (prospect at The Lofts at Riverside): no contact in 22 days · 88% confidence");
    expect(row.sentence.parts).toContainEqual({ text: "Isaiah Shah", href: "/app/leasing/prospects/pr-p01-0014" });
  });

  it("shows only the record type for a record outside the viewer's scope", () => {
    const row = one([step(0, "proposal", { input: { action: "prospects.send_follow_up", entity: "prospects", id: "pr-p09-0001" }, output: { title: "Follow up with Ana Ruiz: no contact in 9 days", confidence: 0.9 } })]);
    const text = sentenceText(row.sentence);
    expect(text).toBe("Proposed “Send follow-up” for a prospect · 90% confidence");
    expect(text).not.toContain("Ana Ruiz");
    expect(row.sentence.parts.some((p) => typeof p !== "string" && p.href)).toBe(false);
  });

  it("finds the record of a live proposal through its proposal id, and flags high risk", () => {
    const row = one([step(0, "proposal", { output: { proposal_id: "prop_1", title: "Review Liam Price for legal action — $15,906.20, 307 days late", action: "leases.refer_to_legal", confidence: 0.85, risk: "High", queue_state: "needs_you" } })]);
    expect(sentenceText(row.sentence)).toBe("Proposed “Refer for legal review” for L-10494 · Liam Price (lease at Barton Creek Commons): $15,906.20, 307 days late · 85% confidence · high risk");
  });

  it("folds the actions.propose call and result into the proposal it made", () => {
    const rows = describeSteps([
      step(0, "tool_call", { toolKey: "actions.propose", input: { action: "leases.refer_to_legal", entity: "leases", entity_id: "L-10494", title: "Review Liam Price for legal action — $15,906.20, 307 days late", confidence: 1 } }),
      step(1, "proposal", { output: { proposal_id: "prop_x", title: "Review Liam Price for legal action — $15,906.20, 307 days late", action: "leases.refer_to_legal", confidence: 0.85, risk: "High" } }),
      step(2, "tool_result", { toolKey: "actions.propose", output: { proposal_id: "prop_x", queue_state: "needs_you", duplicate: false }, latencyMs: 22 }),
    ], refs);
    expect(rows).toHaveLength(1);
    expect(rows[0].steps.map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(sentenceText(rows[0].sentence)).toContain("Proposed “Refer for legal review” for L-10494 · Liam Price");
  });

  it("says when the proposal was already waiting", () => {
    const row = one([step(0, "proposal", { output: { proposal_id: "prop_old", title: "Send a past-due reminder to the Lee household", duplicate: true, note: "Already waiting in the approvals inbox" } })]);
    expect(sentenceText(row.sentence)).toBe("Already waiting for approval: Send a past-due reminder to the Lee household");
  });
});

describe("tool steps", () => {
  it("pairs a call with its result and counts what came back", () => {
    const rows = describeSteps([
      step(0, "tool_call", { toolKey: "prospects.list", input: { scope: "p01", as_of: "2026-11-04" } }),
      step(1, "tool_result", { toolKey: "prospects.list", output: { rows: 14, truncated: false }, latencyMs: 90 }),
    ], refs);
    expect(rows).toHaveLength(1);
    expect(sentenceText(rows[0].sentence)).toBe("Looked up 14 prospects");
    expect(rows[0].status).toBe("done");
  });

  it("describes known tools from their input and output", () => {
    const delinquency = describeSteps([
      step(0, "tool_call", { toolKey: "ledger.delinquency", input: { min_days: 31, limit: 25 } }),
      step(1, "tool_result", { toolKey: "ledger.delinquency", output: { rows: [{ lease_id: "L-1" }, { lease_id: "L-2" }], total: 2, total_balance_cents: 1000 } }),
    ], refs);
    expect(sentenceText(delinquency[0].sentence)).toBe("Looked up 2 residents who owe rent (31+ days late)");

    const ledger = describeSteps([step(0, "tool_call", { toolKey: "ledger.lookup", input: { lease_id: "L-10494" } }), step(1, "tool_result", { toolKey: "ledger.lookup", output: { balance_cents: 100 } })], refs);
    expect(sentenceText(ledger[0].sentence)).toBe("Read the ledger for L-10494 · Liam Price (lease at Barton Creek Commons)");

    const draft = describeSteps([step(0, "tool_call", { toolKey: "messages.draft", input: { entity_id: "L-10494", channel: "Email", subject: "Your balance", body: "…" } }), step(1, "tool_result", { toolKey: "messages.draft", output: { saved: true } })], refs, { index: new Map([["L-10494", "leases"]]) });
    expect(sentenceText(draft[0].sentence)).toBe("Drafted an email for L-10494 · Liam Price (lease at Barton Creek Commons): “Your balance”");
  });

  it("finds a record's type from the plan's candidate list", () => {
    const rows = describeSteps([
      step(0, "plan", { output: { goal: "…", found: 1, considering: 1, candidates: [{ record: "L-10494", action: "leases.refer_to_legal", title: "…" }] } }),
      step(1, "tool_call", { toolKey: "messages.draft", input: { entity_id: "L-10494", channel: "SMS", subject: "Balance" } }),
      step(2, "tool_result", { toolKey: "messages.draft", output: { saved: true } }),
    ], refs);
    expect(sentenceText(rows[0].sentence)).toBe("Found 1 candidate to review");
    expect(sentenceText(rows[1].sentence)).toBe("Drafted a text for L-10494 · Liam Price (lease at Barton Creek Commons): “Balance”");
  });

  it("shows a call still waiting for its result as in progress", () => {
    const rows = describeSteps([step(0, "tool_call", { toolKey: "ledger.delinquency", input: { min_days: 5 } })], refs, { live: true });
    expect(rows[0].status).toBe("running");
    expect(sentenceText(rows[0].sentence)).toBe("Looking up residents who owe rent (5+ days late)…");
  });

  it("leaves the count out when a long result was cut short", () => {
    const rows = describeSteps([step(0, "tool_call", { toolKey: "ledger.delinquency", input: {} }), step(1, "tool_result", { toolKey: "ledger.delinquency", output: "{\"rows\":[{\"lease_id\":\"L-1\"…(900 more chars)" })], refs);
    expect(sentenceText(rows[0].sentence)).toBe("Looked up residents who owe rent");
  });

  it("names model calls with the friendly model name", () => {
    const rows = describeSteps([
      step(0, "tool_call", { toolKey: "model.draft_reply" as TraceStepLike["toolKey"], input: { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", chars: 900 } }),
      step(1, "tool_result", { toolKey: "model.draft_reply" as TraceStepLike["toolKey"], output: { body: "Hi", confidence: 0.8 }, latencyMs: 1200 }),
    ], refs);
    expect(sentenceText(rows[0].sentence)).toBe("Asked Llama 3.3 70B to draft a reply");
  });
});

describe("model, plan and message steps", () => {
  it("quotes the model's own words apart from the sentence", () => {
    const row = one([step(0, "reasoning_summary", { output: "Liam owes the most; I'll check his ledger first." })], refs, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(sentenceText(row.sentence)).toBe("Llama 3.3 70B explained its next step");
    expect(row.sentence.quote).toBe("Liam owes the most; I'll check his ledger first.");
  });

  it("describes how a run started", () => {
    const row = one([step(0, "plan", { output: { trigger: "manual", event_id: null, autonomy: "act_with_approval", model: "Workers AI Llama 4 Scout", as_of: "2026-11-04" } })]);
    expect(sentenceText(row.sentence)).toBe("Started by a person, using Workers AI Llama 4 Scout; every action waits for approval");
  });

  it("describes auto-applied actions and data rule checks", () => {
    expect(sentenceText(one([step(0, "message", { output: { auto_applied: "prop_1", ok: true, message: "Reminder sent to the Lee household" } })]).sentence)).toBe("Applied automatically within policy: Reminder sent to the Lee household");
    expect(sentenceText(one([step(0, "reasoning_summary", { output: { rule_checks: { "a.x": 3, "b.y": 0, "c.z": "check failed" } } })]).sentence)).toBe("Ran 3 data rules: 3 issues found, 1 rule couldn't run");
  });
});

describe("errors", () => {
  it("masks database internals", () => {
    const row = one([step(0, "message", { ok: false, output: { error: "D1_ERROR: no such column: foo.bar at offset 12: SQLITE_ERROR" } })]);
    expect(row.status).toBe("failed");
    const text = sentenceText(row.sentence);
    expect(text).toBe("Stopped: a database error interrupted this step");
    expect(text).not.toMatch(/D1|SQLITE|column/);
  });

  it("explains a failed tool in plain words", () => {
    const rows = describeSteps([
      step(0, "tool_call", { toolKey: "ledger.lookup", input: { lease_id: "L-10494" } }),
      step(1, "tool_result", { toolKey: "ledger.lookup", ok: false, output: { error: "TypeError: Cannot read properties of undefined (reading 'id')" } }),
    ], refs);
    expect(rows[0].status).toBe("failed");
    expect(sentenceText(rows[0].sentence)).toBe("Couldn't read the ledger for L-10494 · Liam Price (lease at Barton Creek Commons): something went wrong on our side");
  });

  it("says when the model failed and the rules took over", () => {
    expect(sentenceText(one([step(0, "message", { ok: false, output: { model_error: "429 Too Many Requests", fallback: "rules" } })]).sentence)).toBe("The model service was busy, so the rules took over");
  });

  it("maps common failures to plain words", () => {
    expect(plainError("SQLITE_BUSY: database is locked")).toBe("a database error interrupted this step");
    expect(plainError("The operation was aborted due to timeout")).toBe("it took too long and was stopped");
    expect(plainError("fetch failed")).toBe("the service couldn't be reached");
    expect(plainError("leases L-1 not found or outside your scope")).toBe("the record wasn't found or is outside your access");
    expect(plainError("Nothing to send: the household has no email")).toBe("Nothing to send: the household has no email");
  });
});

describe("unknown shapes", () => {
  it("falls back to a generic sentence by kind", () => {
    expect(sentenceText(one([step(0, "message", { output: { weird: [1, 2] } })]).sentence)).toBe("Recorded a note");
    expect(sentenceText(one([step(0, "plan", { output: 42 })]).sentence)).toBe("Planned the run");
    expect(sentenceText(one([step(0, "tool_result", { toolKey: "vendors.rank" as TraceStepLike["toolKey"], output: null })]).sentence)).toBe("Ran “vendors rank”");
    expect(sentenceText(one([step(0, "mystery" as TraceStepLike["kind"], { output: { a: 1 } })]).sentence)).toBe("Did a step");
  });

  it("works with no refs at all, showing types only", () => {
    const row = one([step(0, "proposal", { input: { action: "prospects.send_follow_up", entity: "prospects", id: "pr-p01-0014" }, output: { title: "Follow up with Isaiah Shah: no contact in 22 days", confidence: 0.88 } })], NO_REFS);
    expect(sentenceText(row.sentence)).toBe("Proposed “Send follow up” for a prospect · 88% confidence");
  });
});

describe("wantedRefs", () => {
  it("lists the records, entity types, actions and proposals the sentences need", () => {
    const w = wantedRefs([
      step(0, "plan", { output: { candidates: [{ record: "L-10494", action: "leases.refer_to_legal" }] } }),
      step(1, "tool_call", { toolKey: "messages.draft", input: { entity_id: "L-10494" } }),
      step(2, "proposal", { input: { action: "prospects.send_follow_up", entity: "prospects", id: "pr-p01-0014" }, output: {} }),
      step(3, "proposal", { output: { proposal_id: "prop_1", action: "leases.refer_to_legal" } }),
      step(4, "tool_call", { toolKey: "work_orders.get" as TraceStepLike["toolKey"], input: {} }),
    ]);
    expect(w.records).toEqual(expect.arrayContaining([["leases", "L-10494"], ["prospects", "pr-p01-0014"]]));
    expect(w.entities).toEqual(expect.arrayContaining(["leases", "prospects", "work_orders"]));
    expect(w.actions).toEqual(expect.arrayContaining(["leases.refer_to_legal", "prospects.send_follow_up"]));
    expect(w.proposals).toEqual(["prop_1"]);
  });
});
