import { afterEach, describe, expect, it } from "vitest";
import { setModelForTests, type ChatModel } from "@/ai/providers";
import { AiRequest, suggest } from "./ai";
import { buildAiRequest } from "./airequest";
import { assemble, type ImportFile } from "./assemble";
import { detect } from "./mapping";
import { parseDelimited, toSheet } from "./parse";

afterEach(() => setModelForTests(undefined));

const rows = Array.from({ length: 40 }, (_, i) => `Maple Court,${i === 2 ? "#4B" : 100 + i},${i === 1 ? "JOHN SMITH" : `Tenant ${i} Person`},${i === 3 ? 14500 : 1450},2026-01-01,2026-12-31,${i === 39 ? "SECRET-LAST-ROW" : "note"}`);
const TEXT = `Property,Unit,Tenant,Rent,Lease Start,Lease End,Remarks\n${rows.join("\n")}`;
function setup() {
  const sheet = toSheet(parseDelimited(TEXT));
  const d = detect(sheet.headers);
  const f: ImportFile = { id: "f1", name: "roll.csv", kind: d.kind, sheet, mapping: d.mapping, excluded: [] };
  return { f, req: AiRequest.parse(buildAiRequest([f], assemble([f], [], "2026-11-04"))) };
}

let seen = "";
const scripted = (reply: unknown, fail?: Error): ChatModel => ({
  info: { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet", native: true },
  chat: async () => { throw new Error("not used"); },
  structured: async (schema, _system, user) => {
    seen = user;
    if (fail) throw fail;
    return { value: schema.parse(reply), usage: { tokensIn: 1800, tokensOut: 300, costCents: 0.66, latencyMs: 900 } };
  },
});

describe("AI request", () => {
  it("carries headers, five sample rows and flagged cells only, each cell capped", () => {
    const { req } = setup();
    const f = req.files[0]!;
    expect(f.samples.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
    expect(f.unmapped).toEqual([6]); // Remarks
    expect(f.flagged).toEqual(expect.arrayContaining([
      { line: 3, field: "tenant", value: "JOHN SMITH", why: "Name casing" },
      { line: 4, field: "unit", value: "#4B", why: "Unit written with a prefix or symbol" },
      expect.objectContaining({ line: 5, field: "rent", value: "14500" }),
    ]));
    expect(JSON.stringify(req)).not.toContain("SECRET-LAST-ROW");
  });
});

describe("AI suggestions", () => {
  it("keeps valid suggestions with source and confidence; drops ones that point outside what was sent", async () => {
    setModelForTests(scripted({
      mappings: [
        { file: "f1", column: "Remarks", field: "leaseStatus", confidence: 0.4, reason: "Free-text notes" },
        { file: "f1", column: "Tenant", field: "email", confidence: 0.9, reason: "already mapped column" },
        { file: "f1", column: "Remarks", field: "company", confidence: 0.9, reason: "not a rent roll field" },
      ],
      cleanups: [
        { file: "f1", field: "tenant", kind: "replace", from: "JOHN SMITH", to: "John Smith", line: null, confidence: 0.92, reason: "Name in all capitals" },
        { file: "f1", field: "rent", kind: "replace", from: "14500", to: "1450", line: 5, confidence: 1.4, reason: "Extra zero; other units rent for about the same" },
        { file: "f1", field: "tenant", kind: "replace", from: "Somebody Not Sent", to: "X", line: null, confidence: 0.9, reason: "invented" },
        { file: "f1", field: "unit", kind: "exclude", from: "#4B", to: null, line: null, confidence: 0.5, reason: "no line" },
      ],
      notes: ["Unit labels are mostly consistent.", "There are 40 rows and $58,000 in rent."],
    }));
    const { req } = setup();
    const r = await suggest(req);
    expect(r).toMatchObject({ live: true, source: "Claude Sonnet", model: "claude-sonnet-5", usage: { tokensIn: 1800, costCents: 0.66 } });
    expect(r.estimate.tokensIn).toBeGreaterThan(200);
    expect(r.mappings).toEqual([{ file: "f1", field: "leaseStatus", col: 6, confidence: 0.4, reason: "Free-text notes" }]);
    expect(r.suggestions.map((s) => [s.kind, s.from, s.to, s.line, s.confidence, s.source])).toEqual([["replace", "JOHN SMITH", "John Smith", undefined, 0.92, "ai"], ["replace", "14500", "1450", 5, 1, "ai"]]);
    expect(r.notes).toEqual(["Unit labels are mostly consistent."]);
    expect(seen).toContain("JOHN SMITH");
    expect(seen).not.toContain("SECRET-LAST-ROW");
  });

  it("falls back to rules when the model fails or none is configured", async () => {
    const { req } = setup();
    setModelForTests(scripted(null, new Error("Request timeout after 20000ms")));
    expect(await suggest(req)).toMatchObject({ live: false, source: "Rules", mappings: [], suggestions: [], note: expect.stringMatching(/timed out/) });
    setModelForTests(null);
    expect(await suggest(req)).toMatchObject({ live: false, source: "Rules", note: expect.stringMatching(/No AI model is configured/) });
  });
});
