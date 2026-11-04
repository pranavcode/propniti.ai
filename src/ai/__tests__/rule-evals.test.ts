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
  it("is 100 minus 300 × the average weighted share of affected records per record type", async () => {
    const { healthScore, issueWeight } = await import("../views");
    // 3% of one table: 100 − 300 × 0.03 = 91.
    expect(healthScore([{ weighted: 30, records: 1000 }])).toBe(91);
    // Each record type has an equal say: a huge clean table doesn't hide a bad small one.
    expect(healthScore([{ weighted: 0, records: 134_000 }, { weighted: 10, records: 100 }])).toBe(85);
    // Above property level small tables get 300 extra records: two flags on 44 vendors.
    expect(healthScore([{ weighted: 2 * issueWeight("vendors.unverified_bank_change", "critical"), records: 44 }], 300)).toBe(93);
    expect(issueWeight("payments.wrong_lease", "warn")).toBe(4);
    expect(issueWeight("leases.end_before_start", "critical")).toBe(2.5);
    expect(healthScore([])).toBe(100);
    expect(healthScore([{ weighted: 500, records: 100 }])).toBe(0);
  });
});

describe("collections drafts", () => {
  const d = { lease_id: "l1", property_id: "p01", property: "The Lofts at Riverside", metro: "Austin", unit: "412", household_id: "h1", resident: "Jordan Lee", resident_id: "r1", phone: "", email: "", language: "en", balance_cents: 125000, days_late: 34, oldest_due_on: "2026-10-01", aging: { d0_30: 0, d31_60: 125000, d61_90: 0, d90p: 0 }, lease_status: "Active", risk_score: null, open_plan: false, manager: "Marcus Bell" };
  it("use exact ledger figures, letter-style dates and a sign-off, in English and Spanish", async () => {
    const { planMessage, planSplit, reminder } = await import("../rules");
    const split = planSplit(125000);
    expect(split).toEqual({ installment_cents: 41666, final_installment_cents: 41668 });
    for (const lang of ["en", "es"]) {
      const facts = { balance_cents: 125000, ...split };
      for (const m of [reminder({ ...d, language: lang }), planMessage({ ...d, language: lang })]) {
        expect(checkDraft(m.body, facts)).toEqual([]);
        expect(m.body).toContain("Marcus Bell");
        expect(m.body).not.toMatch(/\d{4}-\d{2}-\d{2}|(about|aproximadamente) \$/);
      }
    }
    expect(reminder(d).body).toContain("past due since Oct 1");
    expect(reminder({ ...d, language: "es" }).body).toContain("vencido desde el 1 de octubre");
    expect(planMessage(d).body).toContain("two of $416.66 and a final one of $416.68");
  });
});

describe("draft dates", () => {
  it("become letter style before the check, in English and Spanish", async () => {
    const { letterDates } = await import("../rules");
    const model = "Hi Ana, your lease ends on 2026-11-07. We can renew at $1,250.";
    expect(checkDraft(model, { offer_rent_cents: 125000 })).not.toEqual([]);
    expect(letterDates(model)).toBe("Hi Ana, your lease ends on Nov 7, 2026. We can renew at $1,250.");
    expect(checkDraft(letterDates(model), { offer_rent_cents: 125000 })).toEqual([]);
    expect(letterDates("vence el 2026-11-07.", "es")).toBe("vence el 7 de noviembre de 2026.");
  });
});
