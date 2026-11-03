import type { z } from "zod";

// One shape for every model provider, so the agent loop, the assistant and the precompute script
// don't care which company answers. "rules" means no model: deterministic code, labelled as such.

export type ProviderKey = "anthropic" | "openai" | "workers-ai" | "rules";
export type ModelInfo = { provider: ProviderKey; model: string; label: string; native: boolean };

export type ToolSpec = { name: string; description: string; schema: Record<string, unknown> };
export type ToolCall = { id: string; name: string; input: unknown };
export type Turn =
  | { role: "user"; text: string }
  // raw: the provider's own assistant content (Anthropic thinking blocks must be sent back unchanged).
  | { role: "assistant"; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: { id: string; name: string; output: string; isError?: boolean }[] };

export type Usage = { tokensIn: number; tokensOut: number; costCents: number; latencyMs: number };
export type Reply = { text: string; calls: ToolCall[]; raw?: unknown; usage: Usage };

export interface ChatModel {
  info: ModelInfo;
  chat(system: string, turns: Turn[], tools: ToolSpec[], opts?: { timeoutMs?: number }): Promise<Reply>;
  structured<T extends z.ZodType>(schema: T, system: string, user: string, opts?: { timeoutMs?: number }): Promise<{ value: z.infer<T>; usage: Usage }>;
}

// USD per million tokens. Unknown models cost 0 and the UI says "cost not tracked".
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "@cf/meta/llama-4-scout-17b-16e-instruct": [0.27, 0.85],
};

export function usageOf(model: string, tokensIn: number, tokensOut: number, latencyMs: number): Usage {
  const p = PRICES[model];
  return { tokensIn, tokensOut, latencyMs, costCents: p ? ((tokensIn * p[0] + tokensOut * p[1]) / 1_000_000) * 100 : 0 };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({ tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut, costCents: a.costCents + b.costCents, latencyMs: a.latencyMs + b.latencyMs });
export const ZERO: Usage = { tokensIn: 0, tokensOut: 0, costCents: 0, latencyMs: 0 };

// Tool keys use dots ("records.search"); provider tool names allow [A-Za-z0-9_-] only.
export const toWire = (key: string) => key.replace(/\./g, "__");
export const fromWire = (name: string) => name.replace(/__/g, ".");
