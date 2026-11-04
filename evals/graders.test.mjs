import { describe, expect, it } from "vitest";
import { gradeExtract, gradeMap, gradeParse, gradeSummary, isFallback, unknownNames } from "./graders.mjs";

const pass = (g) => g.pass ?? g.checks.every((c) => c.ok);
const checks = (overrides = {}) =>
  ["Document is an invoice or bill", "Vendor and invoice number present", "Line items add up to the stated total", "Amounts in US dollars", "Legible enough to trust (confidence 70%+)"].map((label) => ({ label, ok: overrides[label] ?? true }));

describe("eval graders", () => {
  it("matches app checks by part of their label and totals to the cent", () => {
    const c = { expect: { vendor: "coolair", invoiceNumber: "CA-88342", total: 600, checksOk: ["US dollars"] } };
    const res = { invoice: { vendor: "CoolAir HVAC", invoiceNumber: "ca 88342".replace(" ", "-"), total: 600.004 }, checks: checks() };
    expect(pass(gradeExtract(c, res))).toBe(true);
    expect(pass(gradeExtract(c, { ...res, invoice: { ...res.invoice, total: 600.01 } }))).toBe(false);
    expect(pass(gradeExtract(c, { ...res, checks: checks({ "Amounts in US dollars": false }) }))).toBe(false);
  });

  it("passes an unreadable invoice when flagged, and fails a confident wrong read", () => {
    const c = { expect: { flaggedOrCorrect: { vendor: "BrightSpark", total: 177.5 } } };
    expect(pass(gradeExtract(c, { invoice: { vendor: "BrightSpark", total: 177.58 }, checks: checks({ "Legible enough to trust (confidence 70%+)": false }) }))).toBe(true);
    expect(pass(gradeExtract(c, { invoice: { vendor: "BrightSpark", total: 177.58 }, checks: checks() }))).toBe(false);
  });

  it("treats mock responses as fallback", () => {
    expect(isFallback({ source: "mock" })).toBe(true);
    expect(isFallback({ source: "workers-ai", note: "Real AI API not configured: the Workers AI call failed." })).toBe(true);
    expect(isFallback({ source: "workers-ai", note: "Figures computed from your data; suggestions by AI." })).toBe(false);
  });

  it("flags capitalised names that appear nowhere in the data", () => {
    const state = { users: [{ name: "Marcus Lee" }], properties: [{ name: "Harbor View Commercial" }] };
    expect(unknownNames("Marcus Lee owes rent at Harbor View. Consider John Smith.", state)).toEqual(["John Smith"]);
  });

  it("needs 90% of fields and every required field for a mapping pass", () => {
    const expectMap = { property: "A", address: "B", unit: "C", tenant: "D", rent: "E", email: null, phone: null, leaseStart: null, leaseEnd: null, owner: null };
    expect(gradeMap({ expect: expectMap }, { mapping: { ...expectMap, owner: "X" } }).pass).toBe(true);
    expect(gradeMap({ expect: expectMap }, { mapping: { ...expectMap, property: "B", address: null } }).pass).toBe(false);
  });

  it("normalises units and rent when grading parsed rows", () => {
    const c = { expect: [{ tenant: "Mia Wong", unit: "2", rent: 2050, property: "Cedar" }] };
    expect(pass(gradeParse(c, { rows: [{ tenant: "Mia Wong", unit: "#2", rent: "$2,050", property: "Cedar House" }] }))).toBe(true);
    expect(pass(gradeParse(c, { rows: [{ tenant: "Mia Wong", unit: "Unit 3", rent: "2050", property: "Cedar House" }] }))).toBe(false);
  });

  it("summary numbers may come from a fact key such as spend_12m", () => {
    const res = { summary: { summary: "Lone Star Plumbing billed $117,031 over the last 12 months.", facts: { spend_12m: 117031 } } };
    expect(pass(gradeSummary({ expect: {} }, res))).toBe(true);
    expect(pass(gradeSummary({ expect: {} }, { summary: { ...res.summary, summary: "Billed $117,031 over 18 months." } }))).toBe(false);
  });
});
