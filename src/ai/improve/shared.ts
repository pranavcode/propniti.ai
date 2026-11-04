import type { ActionKey, AgentKey } from "@/entities/types";
import { sql, type DataCtx } from "../data";
import type { Driver, Estimate, ImproveKey, PlanStep } from "./meta";

// Shared pieces of the improvers. Every figure here is read from the records in the actor's scope
// (sql() scopes each table); nothing is estimated without the history it rests on.

export type ImproveCtx = { data: DataCtx; today: string; property: string | null };

// The step as an improver computes it; the routing (approvals or automatic) is added from the
// agent's autonomy setting when the plan is shown.
export type StepDraft = Omit<PlanStep, "routing" | "agentName" | "actionLabel"> & { alwaysHuman?: boolean; spend?: boolean; mixedRisk?: boolean };
export type Analysis = { headline: string; reasons: string[]; drivers: Driver[]; steps: StepDraft[] };

export type Improver = {
  key: ImproveKey;
  analyze(c: ImproveCtx): Promise<Analysis>;
  // What changed on the plan's records since it started, in plain lines ("$1,200 paid by 3 of 10 households").
  outcome(c: ImproveCtx, since: string, ids: Partial<Record<ActionKey, string[]>>): Promise<string[]>;
};

// "AND <alias>.property_id = ?" when the card is for one property.
export const onProperty = (c: ImproveCtx, alias: string) => (c.property ? { sql: ` AND ${alias}.property_id = ?`, params: [c.property] } : { sql: "", params: [] as unknown[] });

// Records that already have this agent's proposal open, as "id|action". A plan leaves them out:
// the agent wouldn't propose them again (one open proposal per agent, record and action).
export async function openProposals(c: ImproveCtx, agent: AgentKey, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await sql<{ entity_id: string; action: string }>(c.data,
    "SELECT p.entity_id, p.action FROM {ai_proposals} p WHERE p.agent = ? AND p.entity_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id)",
    [agent, JSON.stringify(ids)]);
  return new Set(rows.map((r) => `${r.entity_id}|${r.action}`));
}

// Splits the eligible records of one action into those already waiting and the next `cap` to plan.
export function pick<T>(rows: T[], idOf: (r: T) => string, action: ActionKey, open: Set<string>, cap: number) {
  const fresh = rows.filter((r) => !open.has(`${idOf(r)}|${action}`));
  return { chosen: fresh.slice(0, cap), waiting: rows.length - fresh.length, eligible: rows.length };
}

// History below 10 cases gives no estimate (the step shows its record count instead).
export const MIN_SAMPLE = 10;
export function rateEstimate(hits: number, sample: number): { rate: number; confidence: Estimate["confidence"] } | null {
  if (sample < MIN_SAMPLE) return null;
  return { rate: hits / sample, confidence: sample >= 100 ? "Medium" : "Low" };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
export const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
export const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
