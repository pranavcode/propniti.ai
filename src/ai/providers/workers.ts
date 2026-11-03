import { z } from "zod";
import type { WorkersAI } from "@/lib/platform/types";
import type { ChatModel, ToolCall, Turn } from "./types";
import { usageOf } from "./types";

export const WORKERS_AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

type Out = { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };

// Pulls the first complete JSON object out of a model reply. Models sometimes wrap it in prose or
// fences, or run on and write a second step; only the first counts.
export function firstJson(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  const s = String(raw ?? "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("model reply had no JSON");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("model reply had incomplete JSON");
}

const Step = z.union([
  z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ final: z.string() }),
]);

// JSON-plan loop: this model gets the tool list in the prompt and answers with one JSON step at a
// time, either a tool call or the final answer. The runtime treats it exactly like native tool use.
export function workersModel(ai: WorkersAI): ChatModel {
  const model = WORKERS_AI_MODEL;
  const run = async (messages: { role: string; content: string }[], json?: Record<string, unknown>) => {
    const t0 = Date.now();
    const out = (await ai.run(model, { messages, max_tokens: 2048, ...(json ? { response_format: { type: "json_schema", json_schema: json } } : {}) })) as Out;
    return { out, usage: usageOf(model, out.usage?.prompt_tokens ?? 0, out.usage?.completion_tokens ?? 0, Date.now() - t0) };
  };
  const transcript = (turns: Turn[]) =>
    turns.map((t) => {
      if (t.role === "user") return { role: "user", content: t.text };
      if (t.role === "assistant") return { role: "assistant", content: JSON.stringify(t.calls.length ? { tool: t.calls[0].name, input: t.calls[0].input } : { final: t.text }) };
      return { role: "user", content: t.results.map((r) => `Result of ${r.name}${r.isError ? " (error)" : ""}:\n${r.output}`).join("\n\n") };
    });

  return {
    info: { provider: "workers-ai", model, label: "Workers AI Llama 4 Scout", native: false },
    async chat(system, turns, tools) {
      const toolList = tools.map((t) => `- ${t.name}: ${t.description}\n  input JSON schema: ${JSON.stringify(t.schema)}`).join("\n");
      const sys =
        `${system}\n\nTools:\n${toolList}\n\n` +
        'Reply with exactly one JSON object and nothing else: {"tool": "<tool name>", "input": {...}} to call a tool, ' +
        'or {"final": "<your answer>"} when you are done. Call one tool at a time.';
      const { out, usage } = await run([{ role: "system", content: sys }, ...transcript(turns)]);
      let step: z.infer<typeof Step>;
      try {
        step = Step.parse(firstJson(out.response));
      } catch {
        return { text: String(out.response ?? ""), calls: [], usage };
      }
      if ("final" in step) return { text: step.final, calls: [], usage };
      const call: ToolCall = { id: `c${turns.length}`, name: step.tool, input: step.input };
      return { text: "", calls: [call], usage };
    },
    async structured(schema, system, user) {
      const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
      const { out, usage } = await run(
        [
          { role: "system", content: `${system}\nReply with JSON only, matching this schema: ${JSON.stringify(jsonSchema)}` },
          { role: "user", content: user },
        ],
        jsonSchema,
      );
      return { value: schema.parse(firstJson(out.response)), usage };
    },
  };
}
