import type { ZodType } from "zod";
import type { ActionContext, ActionKey, AgentKey, EntityKey, Role } from "@/entities/types";

// Agent orchestration contract. Tables: agent_definitions, agent_runs, agent_steps, events,
// ai_proposals (run_id, step_id). A run is started by a schedule, an event, a person, or chat; each
// step is recorded so the UI can show the live trace; anything that changes data either becomes an
// ai_proposals row for a person, or (autonomy auto_within_policy, below the policy limit) runs a
// named action. Write tools never move money directly: they propose, or call the guarded actions
// in src/server/money.ts after approval.

export type ToolKey = `${string}.${string}`;   // "charges.list_overdue", "messages.draft", "bills.propose_approval"
export type EventType = `${string}.${string}`; // "payment.failed", "lease.expiring", "wo.created", "invoice.received", "coi.expiring", "data_issue.detected"
export type Autonomy = "suggest" | "act_with_approval" | "auto_within_policy";
export type TriggerKind = "schedule" | "event" | "manual" | "chat";
export type RunStatus = "queued" | "running" | "waiting_approval" | "done" | "failed";
export type StepKind = "plan" | "tool_call" | "tool_result" | "reasoning_summary" | "proposal" | "message";

// A row of approval_policies, as tools see it.
export type ApprovalPolicy = { category: string; limitCents: number | null; approverRole: Role; ownerApprovalOverCents: number | null; alwaysHuman: boolean };

export type Step = { idx: number; kind: StepKind; toolKey?: ToolKey; input?: unknown; output?: unknown; latencyMs?: number; ok: boolean; at: string };

export type RunContext = ActionContext & {
  runId: string;
  agent: AgentKey;
  policies: ApprovalPolicy[];
  // Appends an agent_steps row (output is truncated to a bounded size) and returns its id.
  step(step: Omit<Step, "idx" | "at">): Promise<string>;
  // Creates an ai_proposals row linked to this run and the current step; returns its id.
  propose(p: { entity: EntityKey; entityId: string; action: ActionKey; title: string; payload: unknown; why: string[]; confidence: number; amountCents?: number }): Promise<string>;
  // Cloudflare ctx.waitUntil when available, so runs can finish after the response.
  waitUntil?: (p: Promise<unknown>) => void;
};

export type ToolDef<I = unknown, O = unknown> = {
  key: ToolKey;
  description: string;                    // shown to the model; plain and specific
  input: ZodType<I>;
  output: ZodType<O>;
  mode: "read" | "write";
  roles: Role[];                          // personas whose agents/chat may call it
  // The entity a tool reads with its own SQL (not through list/get, which check it): the caller's
  // role must be able to read it, as on the entity API.
  reads?: EntityKey;
  // True when this call must become a proposal for a person (money, legal, safety, over limit).
  requiresApproval: (input: I, policies: ApprovalPolicy[]) => boolean;
  run: (ctx: RunContext, input: I) => Promise<O>;
};

export type AgentDef = {
  key: AgentKey;
  name: string;                           // "Collections Agent"
  ownerRole: Role;
  goal: string;
  tools: ToolKey[];                       // allow-list
  triggers: { schedule?: string /* cron */; events?: EventType[] };
  autonomy: Autonomy;
  entities: EntityKey[];                  // what it watches
  actions: ActionKey[];                   // what its proposals run on approval
  model?: string;
  run: (ctx: RunContext, trigger: { kind: TriggerKind; eventId?: string; input?: unknown }) => Promise<{ summary: string }>;
};
