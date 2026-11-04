import { afterEach, describe, expect, it, vi } from "vitest";
import { setModelForTests, type ChatModel } from "@/ai/providers";
import { workersModel } from "@/ai/providers/workers";
import { AI_CAPS, AiRequest, suggest, userMessage } from "./ai";
import { buildAiRequest } from "./airequest";
import { assemble, type ImportFile } from "./assemble";
import { detect } from "./mapping";
import { parseDelimited, toSheet } from "./parse";

afterEach(() => {
  setModelForTests(undefined);
  vi.useRealTimers();
});

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
    setModelForTests(scripted(null, new Error("Request timed out.")));
    expect(await suggest(req)).toMatchObject({ live: false, source: "Rules", mappings: [], suggestions: [], note: expect.stringMatching(/took too long/) });
    setModelForTests(scripted(null, new Error("401 invalid x-api-key req_abc123")));
    const failed = await suggest(req);
    expect(failed.note).toMatch(/AI service returned an error/);
    expect(failed.note).not.toContain("req_abc123");
    setModelForTests(null);
    expect(await suggest(req)).toMatchObject({ live: false, source: "Rules", note: expect.stringMatching(/No AI model is configured/) });
  });
});

// A four-file Yardi Voyager import gets a 950-token reply from Workers AI in 17 to 90 s; the old 20 s
// limit sent it to rules almost every time.
describe("AI suggestions on Workers AI", () => {
  const reply = { mappings: [], cleanups: [{ file: "f1", field: "tenant", kind: "replace", from: "JOHN SMITH", to: "John Smith", line: null, confidence: 0.9, reason: "Name in all capitals" }], notes: [] };
  const slowAi = (ms: number, response: unknown) => ({
    run: () => new Promise((resolve) => setTimeout(() => resolve({ response, usage: { prompt_tokens: 2389, completion_tokens: 977 } }), ms)),
    toMarkdown: async () => [],
  });

  it("waits for a reply that takes 45 seconds", async () => {
    vi.useFakeTimers();
    setModelForTests(workersModel(slowAi(45_000, JSON.stringify(reply))));
    const { req } = setup();
    const pending = suggest(req);
    await vi.advanceTimersByTimeAsync(45_000);
    const r = await pending;
    expect(r).toMatchObject({ live: true, model: "@cf/meta/llama-4-scout-17b-16e-instruct", usage: { tokensOut: 977 } });
    expect(r.suggestions.map((s) => s.to)).toEqual(["John Smith"]);
  });

  it("says the model took too long when Workers AI never answers", async () => {
    vi.useFakeTimers();
    setModelForTests(workersModel(slowAi(10 * 60_000, "{}")));
    const { req } = setup();
    const pending = suggest(req);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await pending).toMatchObject({ live: false, source: "Rules", note: expect.stringMatching(/took too long/) });
  });

  it("says the reply couldn't be used when it doesn't match the schema", async () => {
    setModelForTests(workersModel(slowAi(0, '{"mappings": "none"}')));
    const { req } = setup();
    expect(await suggest(req)).toMatchObject({ live: false, source: "Rules", note: expect.stringMatching(/answer couldn't be used/) });
    setModelForTests(workersModel(slowAi(0, '{"mappings": [')));
    expect((await suggest(req)).note).toMatch(/answer couldn't be used/);
  });
});

describe("AI request budget", () => {
  it("drops flagged cells and sample rows to fit the budget, and still sends valid JSON", () => {
    const wide = Array.from({ length: 60 }, (_, i) => `Column ${i}`);
    const files = Array.from({ length: 6 }, (_, k) => ({
      id: `f${k}`, kind: "rent_roll" as const, headers: wide, unmapped: wide.map((_, i) => i).slice(3), mapped: { property: 0, unit: 1, rent: 2 },
      samples: Array.from({ length: 5 }, (_, r) => ({ line: r + 2, cells: wide.map(() => "x".repeat(60)) })),
      flagged: Array.from({ length: 30 }, (_, r) => ({ line: r + 2, field: "rent", value: "9".repeat(60), why: "w".repeat(120) })),
    }));
    const msg = userMessage(AiRequest.parse({ files }));
    expect(msg.length).toBeLessThanOrEqual(AI_CAPS.totalChars);
    const body = JSON.parse(msg) as { files: { file: string; headers: string[] }[] };
    expect(body.files.map((f) => f.file)).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
    expect(body.files[0]!.headers).toHaveLength(60);
  });

  it("ignores fields named like object prototype keys", async () => {
    setModelForTests(scripted({ mappings: [], cleanups: [{ file: "f1", field: "constructor", kind: "replace", from: "x", to: "y", line: null, confidence: 1, reason: "r" }], notes: [] }));
    const { req } = setup();
    expect((await suggest(req)).suggestions).toEqual([]);
  });
});
