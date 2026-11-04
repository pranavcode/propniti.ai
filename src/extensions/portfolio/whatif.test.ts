import { describe, expect, it } from "vitest";
import { NO_CHANGE, simulate, simulateAll, type Baseline } from "./whatif";

const base = (over: Partial<Baseline> = {}): Baseline => ({
  property_id: "p01", name: "The Lofts", metro: "Austin", units: 100, occupancy: 0.94,
  gpr_cents: 300_000_000, collected_cents: 280_000_000, vacancy_loss_cents: 18_000_000, concessions_cents: 2_000_000,
  opex_cents: 120_000_000, noi_cents: 161_000_000, ...over,
});

describe("what-if engine", () => {
  it("returns the baseline exactly when nothing changes", () => {
    const r = simulate(base(), NO_CHANGE);
    expect(r.scenario_noi_cents).toBe(161_000_000);
    expect(r.scenario_revenue_cents).toBe(280_000_000);
    expect(r.scenario_opex_cents).toBe(120_000_000);
    expect(r.delta_cents).toBe(0);
    expect(r.delta_pct).toBe(0);
    expect(r.scenario_occupancy).toBe(0.94);
  });

  it("raises NOI monotonically with rent", () => {
    const nois = [0, 1, 3, 5, 10].map((rentPct) => simulate(base(), { ...NO_CHANGE, rentPct }).scenario_noi_cents);
    for (let i = 1; i < nois.length; i++) expect(nois[i]).toBeGreaterThan(nois[i - 1]);
    expect(simulate(base(), { ...NO_CHANGE, rentPct: 3 }).delta_cents).toBe(8_400_000);
  });

  it("caps occupancy at 100% and floors it at 0%", () => {
    expect(simulate(base(), { ...NO_CHANGE, occTarget: 120 }).scenario_occupancy).toBe(1);
    expect(simulate(base(), { ...NO_CHANGE, occDeltaPts: 20 }).scenario_occupancy).toBe(1);
    expect(simulate(base(), { ...NO_CHANGE, occDeltaPts: -200 }).scenario_occupancy).toBe(0);
    const full = simulate(base(), { ...NO_CHANGE, occTarget: 100 });
    expect(full.scenario_revenue_cents).toBe(Math.round(280_000_000 / 0.94));
  });

  it("prefers an occupancy target over a points change", () => {
    expect(simulate(base(), { ...NO_CHANGE, occTarget: 90, occDeltaPts: 5 }).scenario_occupancy).toBe(0.9);
  });

  it("scales opex and lowers NOI by exactly the added expense", () => {
    const r = simulate(base(), { ...NO_CHANGE, opexPct: 5 });
    expect(r.scenario_opex_cents).toBe(126_000_000);
    expect(r.delta_cents).toBe(-6_000_000);
  });

  it("keeps income outside rent and opex in NOI", () => {
    const r = simulate(base(), NO_CHANGE);
    // baseline other = 161M − (280M − 120M) = 1M, carried through
    expect(r.scenario_noi_cents - (r.scenario_revenue_cents - r.scenario_opex_cents)).toBe(1_000_000);
  });

  it("finds the break-even occupancy where NOI is zero", () => {
    const r = simulate(base(), NO_CHANGE);
    const atBe = simulate(base(), { ...NO_CHANGE, occTarget: r.break_even_occupancy! * 100 });
    expect(Math.abs(atBe.scenario_noi_cents)).toBeLessThanOrEqual(1);
  });

  it("totals equal the sum of properties", () => {
    const list = [base(), base({ property_id: "p02", units: 40, occupancy: 0.9, collected_cents: 90_000_000, opex_cents: 40_000_000, noi_cents: 50_000_000 })];
    const { rows, totals } = simulateAll(list, { rentPct: 2, opexPct: 4, occTarget: null, occDeltaPts: -1 });
    expect(totals.scenario_noi_cents).toBe(rows[0].scenario_noi_cents + rows[1].scenario_noi_cents);
    expect(totals.noi_cents).toBe(211_000_000);
    expect(totals.delta_cents).toBe(rows[0].delta_cents + rows[1].delta_cents);
    expect(totals.properties).toBe(2);
  });

  it("handles a property with no occupancy history", () => {
    const r = simulate(base({ occupancy: 0, collected_cents: 0, noi_cents: -5_000_000, opex_cents: 5_000_000 }), { ...NO_CHANGE, rentPct: 5 });
    expect(r.scenario_noi_cents).toBe(-5_000_000);
    expect(r.break_even_occupancy).toBeNull();
  });
});
