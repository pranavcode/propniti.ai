import type { ToolDef, ToolKey } from "../types";

// Tools agents and the copilot may call. Register from src/ai/tools/<area>.ts.
const tools = new Map<ToolKey, ToolDef<unknown, unknown>>();

export function registerTool<I, O>(def: ToolDef<I, O>) {
  tools.set(def.key, def as unknown as ToolDef<unknown, unknown>);
  return def;
}

export const getTool = (key: string) => tools.get(key as ToolKey);
export const allTools = () => [...tools.values()];
