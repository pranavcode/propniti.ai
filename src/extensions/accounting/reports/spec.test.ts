import { describe, expect, it } from "vitest";
import { addMonths, monthsBetween, rulesSpec, validateSpec, type RawSpec } from "./spec";

const SCOPE = [
  { id: "p01", name: "The Lofts at Riverside", metro: "Austin" },
  { id: "p12", name: "Camelback Terrace", metro: "Phoenix" },
];
const raw = (r: Partial<RawSpec>): RawSpec => ({ measure: "expense", groupBy: null, from: null, to: null, compareTo: null, properties: null, metros: null, chart: null, title: null, ...r });

describe("rules parser", () => {
  it("reads the example question", () => {
    const r = rulesSpec("show me utilities by property for Q3 vs budget", SCOPE, "2026-10");
    expect(r).toMatchObject({ measure: "utilities", groupBy: "property", from: "2026-07", to: "2026-09", compareTo: "budget" });
  });
  it("reads a named year, metros and property names", () => {
    const r = rulesSpec("repairs at the lofts at riverside in Q1 2026 vs last year", SCOPE, "2026-10");
    expect(r).toMatchObject({ measure: "repairs", from: "2026-01", to: "2026-03", compareTo: "prior_year", properties: ["p01"] });
    expect(rulesSpec("delinquency in Phoenix and DFW", SCOPE, "2026-10").metros).toEqual(["Dallas", "Phoenix"]);
  });
  it("handles last month, YTD and trailing twelve", () => {
    expect(rulesSpec("NOI last month", SCOPE, "2026-10")).toMatchObject({ measure: "noi", from: "2026-10", to: "2026-10" });
    expect(rulesSpec("income YTD", SCOPE, "2026-10")).toMatchObject({ measure: "income", from: "2026-01", to: "2026-10" });
    expect(rulesSpec("expense T12 by month", SCOPE, "2026-10")).toMatchObject({ from: "2025-11", to: "2026-10", groupBy: "month" });
  });
});

describe("validator", () => {
  it("drops unknown measures and invalid groupings and reports them", () => {
    const { spec, dropped } = validateSpec(raw({ measure: "DROP TABLE bills", groupBy: "vendor" }), SCOPE, "2026-10");
    expect(spec.measure).toBe("expense");
    expect(spec.groupBy).toBe("property");
    expect(dropped.length).toBe(2);
  });
  it("clamps periods to closed books and 24 months", () => {
    const { spec } = validateSpec(raw({ from: "2020-01", to: "2027-06" }), SCOPE, "2026-10");
    expect(spec.to).toBe("2026-10");
    expect(monthsBetween(spec.from, spec.to)).toBeLessThanOrEqual(24);
    expect(spec.from >= "2025-05").toBe(true);
  });
  it("keeps only in-scope properties and known metros", () => {
    const { spec, dropped } = validateSpec(raw({ properties: ["p01", "p29"], metros: ["austin", "Boston"] }), SCOPE, "2026-10");
    expect(spec.properties).toEqual(["p01"]);
    expect(spec.metros).toEqual(["Austin"]);
    expect(dropped.some((d) => d.includes("p29"))).toBe(true);
  });
  it("refuses a comparison the measure doesn't have", () => {
    const { spec, dropped } = validateSpec(raw({ measure: "collections", compareTo: "budget" }), SCOPE, "2026-10");
    expect(spec.compareTo).toBe("none");
    expect(dropped).toHaveLength(1);
  });
  it("defaults to the last 12 closed months and a fitting chart", () => {
    const { spec } = validateSpec(raw({ groupBy: "month" }), SCOPE, "2026-10");
    expect([spec.from, spec.to, spec.chart]).toEqual([addMonths("2026-10", -11), "2026-10", "line"]);
  });
});
