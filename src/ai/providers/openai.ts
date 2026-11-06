import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { ChatModel, Turn } from "./types";
import { usageOf } from "./types";

// Native function calling on Chat Completions.
export function openaiModel(): ChatModel {
  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  const client = new OpenAI({ timeout: 60_000, maxRetries: 1 });
  const toMessages = (system: string, turns: Turn[]): ChatCompletionMessageParam[] => [
    { role: "system", content: system },
    ...turns.flatMap((t): ChatCompletionMessageParam[] => {
      if (t.role === "user") return [{ role: "user", content: t.text }];
      if (t.role === "assistant") {
        return [{ role: "assistant", content: t.text || null, ...(t.calls.length ? { tool_calls: t.calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}) }];
      }
      return t.results.map((r) => ({ role: "tool" as const, tool_call_id: r.id, content: r.output }));
    }),
  ];

  return {
    info: { provider: "openai", model, label: `OpenAI ${model}`, native: true },
    async chat(system, turns, tools, opts) {
      const t0 = Date.now();
      const res = await client.chat.completions.create(
        { model, messages: toMessages(system, turns), tools: tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.schema } })) },
        { timeout: opts?.timeoutMs ?? 60_000, ...(opts?.timeoutMs ? { maxRetries: 0 } : {}) },
      );
      const msg = res.choices[0]?.message;
      const calls = (msg?.tool_calls ?? []).flatMap((c) => {
        if (c.type !== "function") return [];
        let input: unknown = {};
        try {
          input = JSON.parse(c.function.arguments || "{}");
        } catch {
          input = { _invalid: c.function.arguments };
        }
        return [{ id: c.id, name: c.function.name, input }];
      });
      return { text: msg?.content ?? "", calls, usage: usageOf(model, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0, Date.now() - t0) };
    },
    async structured(schema, system, user, opts) {
      const t0 = Date.now();
      const res = await client.chat.completions.parse(
        { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: zodResponseFormat(schema, "result") },
        { timeout: opts?.timeoutMs ?? 60_000, ...(opts?.timeoutMs ? { maxRetries: 0 } : {}) },
      );
      const value = res.choices[0]?.message.parsed;
      if (value == null) throw new Error("model returned no structured output");
      return { value: value as z.infer<typeof schema>, usage: usageOf(model, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0, Date.now() - t0) };
    },
  };
}
