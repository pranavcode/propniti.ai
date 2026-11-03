import type { AgentKey } from "@/entities/types";
import type { AgentDef } from "../types";

// Agent implementations. Their configuration rows live in agent_definitions (base, editable in
// the overlay); this registry holds the code that runs them.
const agents = new Map<AgentKey, AgentDef>();

export const registerAgent = (a: AgentDef) => (agents.set(a.key, a), a);
export const getAgent = (key: string) => agents.get(key as AgentKey);
export const allAgents = () => [...agents.values()];
