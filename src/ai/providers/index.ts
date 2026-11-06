import { configuredProvider } from "@/lib/llm";
import { getPlatform } from "@/lib/platform";
import { anthropicModel } from "./anthropic";
import { openaiModel } from "./openai";
import type { ChatModel, ModelInfo } from "./types";
import { workersModel } from "./workers";

export * from "./types";

export const RULES: ModelInfo = { provider: "rules", model: "rules", label: "Rules (no model)", native: false };

// The model the AI runtime uses, chosen exactly like the v1 routes (src/lib/llm.ts): AI_PROVIDER
// wins, then an Anthropic or OpenAI key, then Workers AI on Cloudflare. null = rules only.
// Tests swap in a scripted model with setModelForTests.
let override: ChatModel | null | undefined;
export function setModelForTests(m: ChatModel | null | undefined) {
  override = m;
}

export function currentModel(): ChatModel | null {
  return plain(pick());
}

function pick(): ChatModel | null {
  if (override !== undefined) return override;
  const p = configuredProvider();
  if (!p) return null;
  if (p.source === "anthropic") return anthropicModel();
  if (p.source === "openai") return openaiModel();
  const ai = getPlatform().ai;
  return ai ? workersModel(ai) : null;
}

// What people see when the model fails. Provider errors can carry request ids, key fragments and
// raw replies, so they go to the server log only; callers, run traces and routes get ModelError,
// whose message is a short reason ("model timed out").
export const MODEL_FALLBACK = "The AI service didn't respond, so this uses the rule-based answer.";
export const MODEL_DOWN = "The AI service didn't respond. Try again in a minute.";
export class ModelError extends Error {
  name = "ModelError";
}

export function modelReason(err: unknown): string {
  if (err instanceof ModelError) return err.message;
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/timed? ?out|timeout|abort/i.test(m)) return "model timed out";
  if (/\b(429|529)\b|rate.?limit|overloaded|too many requests|capacity/i.test(m)) return "model busy (rate limited)";
  if (/ZodError|SyntaxError|JSON|no structured output|declined/i.test(m)) return "model reply wasn't in the expected format";
  return "model unavailable";
}

function plain(m: ChatModel | null): ChatModel | null {
  if (!m) return null;
  const fail = (err: unknown): never => {
    if (!(err instanceof ModelError)) console.error(`[ai] ${m.info.label} call failed:`, err);
    throw new ModelError(modelReason(err));
  };
  return {
    info: m.info,
    chat: (system, turns, tools, opts) => m.chat(system, turns, tools, opts).catch(fail),
    structured: (schema, system, user, opts) => m.structured(schema, system, user, opts).catch(fail),
  };
}

export const modelInfo = () => currentModel()?.info ?? RULES;
