import { describe, expect, it } from "vitest";
import { checkFairHousing } from "./fairHousing";
import { columnOf, planMove } from "./pipeline";
import { proposeRenewal } from "./pricing";

describe("pipeline board", () => {
  it("places a card by the application's stage once the lead applied", () => {
    expect(columnOf("Contacted", null)).toBe("lead");
    expect(columnOf("Toured", null)).toBe("tour");
    expect(columnOf("Applied", "Submitted")).toBe("applied");
    expect(columnOf("Applied", "Review")).toBe("screening");
    expect(columnOf("Applied", "Conditional")).toBe("approved");
    expect(columnOf("Applied", "Denied")).toBeNull();
    expect(columnOf("Lost", null)).toBeNull();
  });

  it("moves one column at a time", () => {
    expect(planMove("lead", "tour", { role: "leasing_agent", hasApplication: false, toured: false })).toEqual({ ok: true, prospectStage: "Tour scheduled" });
    expect(planMove("lead", "screening", { role: "leasing_agent", hasApplication: true, toured: true }).ok).toBe(false);
  });

  it("keeps approval with the broker and approvals final", () => {
    const agent = planMove("screening", "approved", { role: "leasing_agent", hasApplication: true, toured: true });
    expect(agent).toMatchObject({ ok: false, status: 403 });
    expect(planMove("screening", "approved", { role: "broker", hasApplication: true, toured: true })).toEqual({ ok: true, appStage: "Approved", decide: true });
    expect(planMove("approved", "screening", { role: "broker", hasApplication: true, toured: true }).ok).toBe(false);
    expect(planMove("leased", "approved", { role: "broker", hasApplication: true, toured: true }).ok).toBe(false);
  });

  it("needs an application before applied or screening", () => {
    expect(planMove("tour", "applied", { role: "leasing_agent", hasApplication: false, toured: true })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("fair-housing language check", () => {
  it("flags preferences about who may live there", () => {
    const flags = checkFairHousing("Sunny unit. Perfect for young professionals; no children please. No Section 8.");
    expect(flags.map((f) => f.category)).toEqual(["Familial status", "Age", "Familial status", "Source of income"]);
    expect(flags[0].suggestion).toMatch(/Describe/);
  });

  it("passes descriptions of the home itself", () => {
    expect(checkFairHousing("Two-bedroom, third floor, no elevator. Walk to the light rail. Pool and fitness center.")).toEqual([]);
    expect(checkFairHousing("")).toEqual([]);
  });
});

describe("renewal pricing", () => {
  const base = { currentCents: 150_000, marketCents: 170_000, tenureMonths: 14, late12: 0, nsf12: 0, balanceCents: 0 };

  it("moves toward market, capped at 5%", () => {
    const p = proposeRenewal(base);
    expect(p.rentCents).toBe(157_500);
    expect(p.capPct).toBe(5);
    expect(p.reasons[0].text).toMatch(/under the \$1,700 market rent/);
  });

  it("caps long, on-time residents at 3%", () => {
    expect(proposeRenewal({ ...base, tenureMonths: 30 }).rentCents).toBe(154_500);
  });

  it("holds flat at or above market and never lowers rent", () => {
    expect(proposeRenewal({ ...base, marketCents: 140_000 }).rentCents).toBe(150_000);
    expect(proposeRenewal({ ...base, marketCents: null }).rentCents).toBe(150_000);
  });

  it("stops at market when the gap is small", () => {
    expect(proposeRenewal({ ...base, marketCents: 152_000 }).rentCents).toBe(152_000);
  });

  it("asks for a person when the resident owes money", () => {
    const p = proposeRenewal({ ...base, balanceCents: 42_500, late12: 3 });
    expect(p.needsPerson).toBe(true);
    expect(p.confidence).toBeLessThan(0.6);
    expect(p.reasons.some((r) => /Open balance of \$425/.test(r.text))).toBe(true);
  });
});
