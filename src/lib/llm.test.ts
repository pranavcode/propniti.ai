import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "./seed";

// Stand-ins for the provider SDKs: each test sets what the "model" returns.
const anthropicParse = vi.fn();
const openaiParse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse: anthropicParse }; } }));
vi.mock("openai", () => ({ default: class { responses = { parse: openaiParse }; } }));

const { askAssistant, configuredProvider, validateWorkOrder } = await import("./llm");
const wo = (id: string) => seed().workOrders.find((w) => w.id === id)!;

beforeEach(() => {
  for (const k of ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(k, "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  anthropicParse.mockReset();
  openaiParse.mockReset();
});

describe("configuredProvider", () => {
  it("is null with no keys or with the 'unset' placeholder", () => {
    expect(configuredProvider()).toBeNull();
    vi.stubEnv("ANTHROPIC_API_KEY", "unset");
    expect(configuredProvider()).toBeNull();
  });

  it("prefers Anthropic, honours AI_PROVIDER, and AI_PROVIDER=mock wins", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(configuredProvider()?.source).toBe("anthropic");
    vi.stubEnv("AI_PROVIDER", "openai");
    expect(configuredProvider()?.source).toBe("openai");
    vi.stubEnv("AI_PROVIDER", "mock");
    expect(configuredProvider()).toBeNull();
  });
});

describe("validateWorkOrder", () => {
  it("uses mock with a 'not configured' note when no key is set", async () => {
    const r = await validateWorkOrder(wo("WO-1041"));
    expect(r.source).toBe("mock");
    expect(r.note).toMatch(/not configured/);
    expect(anthropicParse).not.toHaveBeenCalled();
  });

  it("falls back to mock and says why when the configured provider fails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "bad");
    anthropicParse.mockRejectedValue(new Error("401 invalid x-api-key"));
    const r = await validateWorkOrder(wo("WO-1041"));
    expect(r.source).toBe("mock");
    expect(r.note).toMatch(/Anthropic call failed \(401 invalid x-api-key\)/);
    expect(r.decision).toBe("approve"); // rule-based result still served
  });

  it("falls back when the model refuses", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    anthropicParse.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    expect((await validateWorkOrder(wo("WO-1041"))).source).toBe("mock");
  });

  it("returns the model's answer, with confidence clamped to 0..1", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    openaiParse.mockResolvedValue({ output_parsed: { decision: "approve", confidence: 1.4, matched: ["ok"], issues: [], summary: "fine" } });
    const r = await validateWorkOrder(wo("WO-1041"));
    expect(r).toMatchObject({ source: "openai", decision: "approve", confidence: 1 });
  });

  it("never lets the model approve what the rule check flags", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    anthropicParse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { decision: "approve", confidence: 0.95, matched: [], issues: [], summary: "looks fine" },
    });
    const r = await validateWorkOrder(wo("WO-1042")); // $275 over PO, missing photo
    expect(r.source).toBe("anthropic");
    expect(r.decision).toBe("review");
    expect(r.confidence).toBeLessThanOrEqual(0.6);
    expect(r.issues.some((i) => i.startsWith("Policy check:"))).toBe(true);
  });
});

describe("askAssistant", () => {
  it("maps the model's answer and falls back on failure", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    anthropicParse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { answer: "Two tenants.", suggested_actions: ["Nudge"] } });
    expect(await askAssistant("who is late?", seed())).toEqual({ answer: "Two tenants.", suggestedActions: ["Nudge"], source: "anthropic" });

    anthropicParse.mockRejectedValueOnce(new Error("timeout"));
    const r = await askAssistant("who is late?", seed());
    expect(r.source).toBe("mock");
    expect(r.answer).toContain("Marcus Lee");
  });
});
