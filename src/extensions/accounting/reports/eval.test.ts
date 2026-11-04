import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askReport } from "./ask";
import { MEASURES, monthsBetween, type QuerySpec } from "./spec";

// Grades the report builder on evals/cases/report-builder.json. Without a model this checks the
// rules parser; with ANTHROPIC_API_KEY / OPENAI_API_KEY set, askReport uses the live model and the
// same cases grade it. Either way the validator has the last word, so registry checks always hold.

type Expect = { measure?: string; measureIn?: string[]; groupBy?: string; groupByIn?: string[]; compareTo?: string; from?: string; to?: string; toAtMost?: string; months?: number; metros?: string[]; droppedAny?: boolean; registryOnly?: boolean };
const CASES = JSON.parse(readFileSync(join(process.cwd(), "evals/cases/report-builder.json"), "utf8")) as { id: string; text: string; expect: Expect }[];
const SCOPE = [
  { id: "p01", name: "The Lofts at Riverside", metro: "Austin" },
  { id: "p08", name: "Deep Ellum Lofts", metro: "Dallas" },
  { id: "p15", name: "Inman Park Flats", metro: "Atlanta" },
  { id: "p22", name: "Camelback Terrace", metro: "Phoenix" },
];

function grade(spec: QuerySpec, dropped: string[], e: Expect): string[] {
  const fails: string[] = [];
  const eq = (k: keyof QuerySpec, v: unknown) => { if (v !== undefined && JSON.stringify(spec[k]) !== JSON.stringify(v)) fails.push(`${k}: got ${JSON.stringify(spec[k])}, want ${JSON.stringify(v)}`); };
  eq("measure", e.measure); eq("groupBy", e.groupBy); eq("compareTo", e.compareTo); eq("from", e.from); eq("to", e.to); eq("metros", e.metros);
  if (e.measureIn && !e.measureIn.includes(spec.measure)) fails.push(`measure ${spec.measure} not in ${e.measureIn.join("|")}`);
  if (e.groupByIn && !e.groupByIn.includes(spec.groupBy)) fails.push(`groupBy ${spec.groupBy} not in ${e.groupByIn.join("|")}`);
  if (e.toAtMost && spec.to > e.toAtMost) fails.push(`to ${spec.to} after ${e.toAtMost}`);
  if (e.months && monthsBetween(spec.from, spec.to) !== e.months) fails.push(`${monthsBetween(spec.from, spec.to)} months, want ${e.months}`);
  if (e.droppedAny && !dropped.length) fails.push("expected the validator to report a dropped part");
  if (e.registryOnly && !MEASURES.some((m) => m.key === spec.measure)) fails.push("measure outside the registry");
  return fails;
}

describe("report builder eval cases", () => {
  it.each(CASES)("$id", async (c) => {
    const r = await askReport(c.text, SCOPE, "2026-10");
    expect(grade(r.spec, r.dropped, c.expect)).toEqual([]);
  }, 30_000);
});
