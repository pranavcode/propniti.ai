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
  if (override !== undefined) return override;
  const p = configuredProvider();
  if (!p) return null;
  if (p.source === "anthropic") return anthropicModel();
  if (p.source === "openai") return openaiModel();
  const ai = getPlatform().ai;
  return ai ? workersModel(ai) : null;
}

export const modelInfo = () => currentModel()?.info ?? RULES;
