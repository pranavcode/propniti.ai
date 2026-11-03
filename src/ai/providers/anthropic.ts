import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaContentBlockParam, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatModel, Turn } from "./types";
import { usageOf } from "./types";

// Native tool use on the Messages API. Server-side fallbacks re-run a refused request on the
// default fallback model inside the same call.
export function anthropicModel(): ChatModel {
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5";
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const toMessages = (turns: Turn[]): BetaMessageParam[] =>
    turns.map((t): BetaMessageParam => {
      if (t.role === "user") return { role: "user", content: t.text };
      if (t.role === "assistant") {
        if (t.raw) return { role: "assistant", content: t.raw as BetaContentBlockParam[] };
        return { role: "assistant", content: [...(t.text ? [{ type: "text" as const, text: t.text }] : []), ...t.calls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input }))] };
      }
      return { role: "user", content: t.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.output, is_error: r.isError })) };
    });

  return {
    info: { provider: "anthropic", model, label: `Anthropic ${model}`, native: true },
    async chat(system, turns, tools, opts) {
      const t0 = Date.now();
      const res = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          system,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium" },
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as { type: "object" } })),
          messages: toMessages(turns),
        },
        { timeout: opts?.timeoutMs ?? 60_000 },
      );
      if (res.stop_reason === "refusal") throw new Error("model declined the request");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      const calls = res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : []));
      return { text, calls, raw: res.content, usage: usageOf(model, res.usage.input_tokens, res.usage.output_tokens, Date.now() - t0) };
    },
    async structured(schema, system, user, opts) {
      const t0 = Date.now();
      const res = await client.messages.parse(
        { model, max_tokens: 16000, system, messages: [{ role: "user", content: user }], output_config: { effort: "low", format: zodOutputFormat(schema) } },
        { timeout: opts?.timeoutMs ?? 60_000 },
      );
      if (res.stop_reason === "refusal") throw new Error("model declined the request");
      if (!res.parsed_output) throw new Error("model returned no structured output");
      return { value: res.parsed_output, usage: usageOf(model, res.usage.input_tokens, res.usage.output_tokens, Date.now() - t0) };
    },
  };
}
