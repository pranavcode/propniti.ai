import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "./seed";

// Stand-ins for the provider SDKs: each test sets what the "model" returns.
const anthropicParse = vi.fn();
const openaiParse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse: anthropicParse }; } }));
vi.mock("openai", () => ({ default: class { responses = { parse: openaiParse }; } }));
const platform: { ai?: { run: ReturnType<typeof vi.fn>; toMarkdown: ReturnType<typeof vi.fn> } } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));

const { askAssistant, configuredProvider, extractInvoice, validateWorkOrder } = await import("./llm");
const wo = (id: string) => seed().workOrders.find((w) => w.id === id)!;

beforeEach(() => {
  for (const k of ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(k, "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  delete platform.ai;
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

  it("uses Workers AI on Cloudflare when no API key is set", () => {
    platform.ai = { run: vi.fn(), toMarkdown: vi.fn() };
    expect(configuredProvider()?.source).toBe("workers-ai");
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    expect(configuredProvider()?.source).toBe("anthropic");
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
    expect(r.note).toBe("Real AI API not configured: the Anthropic call failed. Showing mock result.");
    expect(r.note).not.toContain("401"); // provider details stay in server logs
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
    const answer = "Marcus Lee and Aisha Khan are overdue.";
    anthropicParse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { answer, suggested_actions: ["Nudge"] } });
    expect(await askAssistant("who is late?", seed())).toEqual({ answer, suggestedActions: ["Nudge"], source: "anthropic" });

    anthropicParse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { answer: "Marcus Lee is late.", suggested_actions: [] } });
    const partial = await askAssistant("who is late on rent?", seed());
    expect(partial.source).toBe("mock");
    expect(partial.note).toMatch(/left out Aisha Khan/);
    expect(partial.answer).toContain("Aisha Khan");

    anthropicParse.mockRejectedValueOnce(new Error("timeout"));
    const r = await askAssistant("who is late?", seed());
    expect(r.source).toBe("mock");
    expect(r.answer).toContain("Marcus Lee");
  });
});

describe("extractInvoice", () => {
  const png = { mime: "image/png", base64: "iVBORw0KGgo=" };
  const invoice = {
    is_invoice: true, vendor: "CoolAir HVAC", invoice_number: "CA-88342", invoice_date: "2026-10-27",
    line_items: [{ description: "Quarterly rooftop unit service", amount: 600 }], total: 600, currency: "USD", confidence: 0.93, issues: [],
  };

  it("explains it can't read documents without a real model", async () => {
    const r = await extractInvoice(png);
    expect(r.invoice).toBeUndefined();
    expect(r.note).toMatch(/can't be read/);
  });

  it("reads an image with Workers AI and passes the consistency checks", async () => {
    platform.ai = { run: vi.fn().mockResolvedValue({ response: JSON.stringify(invoice) }), toMarkdown: vi.fn() };
    const r = await extractInvoice(png);
    expect(r.source).toBe("workers-ai");
    expect(r.invoice?.total).toBe(600);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    const [, input] = platform.ai.run.mock.calls[0];
    expect(JSON.stringify(input)).toContain("data:image/png;base64,");
  });

  it("flags a total that doesn't match its line items", async () => {
    platform.ai = { run: vi.fn().mockResolvedValue({ response: { ...invoice, total: 880 } }), toMarkdown: vi.fn() };
    const r = await extractInvoice(png);
    expect(r.checks.find((c) => c.label.includes("add up"))?.ok).toBe(false);
  });

  it("converts PDFs to text before asking the model", async () => {
    platform.ai = {
      run: vi.fn().mockResolvedValue({ response: invoice }),
      toMarkdown: vi.fn().mockResolvedValue([{ data: "# INVOICE CA-88342 ... Total $600.00" }]),
    };
    const r = await extractInvoice({ mime: "application/pdf", base64: btoa("%PDF-1.7") });
    expect(platform.ai.toMarkdown).toHaveBeenCalled();
    expect(r.invoice?.invoiceNumber).toBe("CA-88342");
  });

  it("falls back when the model returns malformed output", async () => {
    platform.ai = { run: vi.fn().mockResolvedValue({ response: "sorry, I can't" }), toMarkdown: vi.fn() };
    const r = await extractInvoice(png);
    expect(r.source).toBe("mock");
    expect(r.invoice).toBeUndefined();
  });
});
