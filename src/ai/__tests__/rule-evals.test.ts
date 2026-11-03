import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeFix } from "../agents/data-health";
import { scoreApplicant } from "../agents/leasing";
import { triage } from "../agents/maintenance";
import { checkDraft, fixProposal } from "../tools/write";

// The rule-side eval cases (evals/cases/{triage,draft,data-fix,applicant-scoring}.json): what the
// agents compute without a model, and what any model output is checked against.
const cases = <T>(name: string): T[] => JSON.parse(readFileSync(`evals/cases/${name}.json`, "utf8"));

describe("eval cases: rules", () => {
  for (const c of cases<{ id: string; text: string; month: number; expect: { trade: string; priority: string; safety?: boolean } }>("triage")) {
    it(c.id, () => {
      const t = triage(c.text, c.month);
      expect({ trade: t.trade, priority: t.priority, ...(c.expect.safety ? { safety: t.safety } : {}) }).toEqual(c.expect);
    });
  }
  for (const c of cases<{ id: string; facts: Record<string, number>; body: string; expect: { ok: boolean } }>("draft")) {
    it(c.id, () => expect(checkDraft(c.body, c.facts).length === 0).toBe(c.expect.ok));
  }
  for (const c of cases<{ id: string; rule: string; row?: Record<string, unknown>; table?: string; issue?: boolean; expect: { changes?: Record<string, unknown>; alwaysHuman?: boolean; risk?: string; effectKinds?: string[] } }>("data-fix")) {
    it(c.id, () => {
      if (c.row) return expect(computeFix(c.rule, c.row)?.changes).toEqual(c.expect.changes);
      const p = fixProposal({ id: "i1", rule_id: c.rule, entity_type: c.table ?? c.rule.split(".")[0], entity_id: "x1", severity: "critical", suggested_fix: JSON.stringify({ why: ["planted"], confidence: 0.9 }), evidence: "{}" });
      expect(p.alwaysHuman).toBe(c.expect.alwaysHuman);
      if (c.expect.risk) expect(p.risk).toBe(c.expect.risk);
      if (c.expect.effectKinds) expect((p.payload as { effects: { kind: string }[] }).effects.map((e) => e.kind)).toEqual(c.expect.effectKinds);
    });
  }
  for (const c of cases<{ id: string; input: Parameters<typeof scoreApplicant>[0]; expect: { recommendation: string; minScore?: number; hasFor?: string; hasAgainst?: string; review?: boolean } }>("applicant-scoring")) {
    it(c.id, () => {
      const s = scoreApplicant(c.input);
      expect(s.recommendation).toBe(c.expect.recommendation);
      if (c.expect.minScore) expect(s.score).toBeGreaterThanOrEqual(c.expect.minScore);
      if (c.expect.hasFor) expect(s.factors.some((f) => f.direction === "+" && f.detail.includes(c.expect.hasFor!))).toBe(true);
      if (c.expect.hasAgainst) expect(s.factors.some((f) => f.direction === "-" && f.detail.includes(c.expect.hasAgainst!))).toBe(true);
      if (c.expect.review) expect(s.review).toBe(true);
    });
  }
});

describe("data health score", () => {
  it("is 100 minus the weighted share of affected records", async () => {
    const { healthScore } = await import("../views");
    // 4% of 1,000 records with warnings, and 10 critical: 100 − (40 + 30) / 1000 × 100 = 93.
    expect(healthScore([{ weighted: 40 * 1 + 10 * 3, records: 1000 }])).toBe(93);
    // Entities combine by record count: a small table with many problems moves it only a little.
    expect(healthScore([{ weighted: 5, records: 1000 }, { weighted: 5, records: 20 }])).toBe(99);
    expect(healthScore([])).toBe(100);
    expect(healthScore([{ weighted: 500, records: 100 }])).toBe(0);
  });
});
