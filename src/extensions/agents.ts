// Agents are an extension point (plan §4); the registry and AgentDef live with the AI code.
export { registerAgent, getAgent, allAgents } from "@/ai/agents/registry";
export type { AgentDef } from "@/ai/types";
