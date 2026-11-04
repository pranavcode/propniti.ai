import type { ActionKey, Actor, AgentKey } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { getAction } from "@/extensions";
import { asOf, parseJson, type DataCtx } from "../data";
import { getAgent } from "../agents/registry";
import { agentConfigs, loadAgents, startRun } from "../orchestrator";
import type { Autonomy } from "../types";
import type { PlanInput } from "../agents/framework";
import { delinquencyImprover } from "./delinquency";
import { vacancyImprover } from "./vacancy";
import { slaImprover } from "./sla";
import { IMPROVERS, type ExecuteResult, type ImproveKey, type PlanStep, type PlanSummary, type Preview, type Routing } from "./meta";
import { plural, type Improver, type StepDraft } from "./shared";

// "Improve with AI": a registry of improvers (metric → drivers, plan, outcome). A plan is stored as
// the agent runs it starts: run ids are plan-<metric>-<scope>-<n>[.<i>], and each run's opening
// step keeps its input ({ plan, improve, ids, steps }), so the trace, the proposals (run_id) and the
// outcome all hang off the same records. No table of its own.

export const REGISTRY: Record<ImproveKey, Improver> = { delinquency: delinquencyImprover, vacancy: vacancyImprover, sla: slaImprover };

export type ImproveSession = { db: Db; ws: string; actor: Actor };

// Short cache per workspace, persona and card: the drivers and plan are read on click, and a second
// click within a minute reuses them. Executing a plan clears the workspace's entries.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Omit<Preview, "plan"> }>();
const cacheKey = (s: ImproveSession, key: ImproveKey, property: string | null) => `${s.ws}|${s.actor.personaId}|${key}|${property ?? ""}`;
export function clearImproveCache(ws?: string) {
  for (const k of cache.keys()) if (!ws || k.startsWith(`${ws}|`)) cache.delete(k);
}

// Plans are per scope: one property, everything, or the actor's set of properties.
export function scopeKey(actor: Actor, property: string | null) {
  if (property) return property;
  if (actor.propertyIds === "all") return "all";
  let h = 5381;
  for (const ch of [...actor.propertyIds].sort().join(",")) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `s${h.toString(36)}`;
}
const planPrefix = (key: ImproveKey, actor: Actor, property: string | null) => `plan-${key}-${scopeKey(actor, property)}-`;

function routing(step: StepDraft, autonomy: Autonomy | undefined): Routing {
  if (!step.agent) return "person";
  if (step.alwaysHuman || step.risk === "High") return "always_person";
  if (autonomy !== "auto_within_policy" || step.risk !== "Low") return "approvals";
  return step.spend || step.mixedRisk ? "auto_some" : "auto";
}

async function analyze(s: ImproveSession, key: ImproveKey, property: string | null): Promise<Omit<Preview, "plan">> {
  await loadAgents();
  const data: DataCtx = { db: s.db, ws: s.ws, actor: s.actor };
  const today = await asOf(s.db);
  const a = await REGISTRY[key].analyze({ data, today, property });
  const configs = await agentConfigs(s.db, s.ws);
  const steps = a.steps.map((st): PlanStep => ({
    key: st.key, title: st.title, detail: st.detail, agent: st.agent, action: st.action, ids: st.ids, records: st.records, eligible: st.eligible, waiting: st.waiting,
    href: st.href, risk: st.risk, estimate: st.estimate, atStakeCents: st.atStakeCents,
    routing: routing(st, st.agent ? configs.get(st.agent)?.autonomy : undefined),
    agentName: st.agent ? getAgent(st.agent)?.name ?? st.agent : null,
    actionLabel: st.action ? getAction(st.action)?.label ?? st.action : "You decide",
  }));
  const scope = property ? await propertyName(data, property) : s.actor.scope.label.split(" · ")[0];
  return { key, title: IMPROVERS[key].title, scope, property, asOf: today, headline: a.headline, reasons: a.reasons, drivers: a.drivers, steps };
}

async function propertyName(data: DataCtx, id: string) {
  const r = await data.db.prepare("SELECT name FROM properties WHERE workspace_id = 'base' AND id = ?").bind(id).first<{ name: string }>();
  return r?.name ?? id;
}

export async function preview(s: ImproveSession, key: ImproveKey, property: string | null, opts: { fresh?: boolean } = {}): Promise<Preview> {
  const k = cacheKey(s, key, property);
  const hit = cache.get(k);
  let value = !opts.fresh && hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
  if (!value) {
    value = await analyze(s, key, property);
    cache.set(k, { at: Date.now(), value });
  }
  return { ...value, plan: await planSummary(s, key, property) };
}

type PlanRun = { id: string; agent_key: string; started_at: string; input: string | null };

async function planRuns(s: ImproveSession, key: ImproveKey, property: string | null): Promise<PlanRun[]> {
  // Plan runs live only in the visitor's workspace (the shared base never gets runs).
  if (s.ws === "base") return [];
  const prefix = planPrefix(key, s.actor, property);
  const { results } = await s.db
    .prepare("SELECT r.id, r.agent_key, r.started_at, st.input FROM agent_runs r LEFT JOIN agent_steps st ON st.workspace_id = r.workspace_id AND st.id = r.id || '-s0' WHERE r.workspace_id = ? AND r.id > ? AND r.id < ? ORDER BY r.started_at LIMIT 40")
    .bind(s.ws, prefix, `${prefix}~`)
    .all<PlanRun>();
  return results;
}

// Every plan for this card and scope, rolled up: records, proposals by state, and what changed on
// those records since the first plan started.
export async function planSummary(s: ImproveSession, key: ImproveKey, property: string | null): Promise<PlanSummary | null> {
  const runs = await planRuns(s, key, property);
  if (!runs.length) return null;
  const ids: Partial<Record<ActionKey, string[]>> = {};
  for (const r of runs) {
    for (const st of parseJson<{ steps?: { action: ActionKey; ids: string[] }[] }>(r.input, {}).steps ?? []) {
      ids[st.action] = [...new Set([...(ids[st.action] ?? []), ...st.ids])];
    }
  }
  const { results } = await s.db
    .prepare("SELECT p.queue_state, d.decision, count(*) AS n FROM ai_proposals p LEFT JOIN ai_decisions d ON d.workspace_id = p.workspace_id AND d.proposal_id = p.id WHERE p.workspace_id = ? AND p.run_id IN (SELECT value FROM json_each(?)) GROUP BY p.queue_state, d.decision")
    .bind(s.ws, JSON.stringify(runs.map((r) => r.id)))
    .all<{ queue_state: string; decision: string | null; n: number }>();
  const count = (f: (r: { queue_state: string; decision: string | null }) => boolean) => results.filter(f).reduce((a, r) => a + Number(r.n), 0);
  const since = runs[0].started_at;
  const today = await asOf(s.db);
  const outcome = await REGISTRY[key].outcome({ data: { db: s.db, ws: s.ws, actor: s.actor }, today, property }, since, ids);
  return {
    id: runs.at(-1)!.id.replace(/\.\d+$/, ""), since, plans: new Set(runs.map((r) => r.id.replace(/\.\d+$/, ""))).size,
    runs: runs.map((r) => ({ id: r.id, agent: r.agent_key })),
    records: new Set(Object.values(ids).flat()).size,
    proposals: {
      created: count(() => true),
      waiting: count((r) => !r.decision && r.queue_state !== "auto_handled"),
      approved: count((r) => r.decision === "Approved" || r.decision === "Edited"),
      auto: count((r) => r.queue_state === "auto_handled"),
      rejected: count((r) => r.decision === "Rejected"),
    },
    outcome,
  };
}

export class PlanConflict extends Error {}

export const planInput = (plan: string, improve: ImproveKey, property: string | null, steps: PlanInput["steps"]): PlanInput => ({ plan, improve, property, steps });

// "Have agents do this": one run per agent, each limited to the plan's records, through the normal
// runtime (policies, autonomy, one open proposal per record and action, the run trace). The first
// run's id is the plan id; a second click racing the first collides on it and gets a 409.
export async function executePlan(s: ImproveSession, key: ImproveKey, property: string | null): Promise<ExecuteResult> {
  // The plan number is read first, so two clicks racing each other pick the same id.
  const existing = await planRuns(s, key, property);
  const n = new Set(existing.map((r) => r.id.replace(/\.\d+$/, ""))).size;
  const planId = `${planPrefix(key, s.actor, property)}${n}`;
  const pv = await analyze(s, key, property);
  const steps = pv.steps.filter((st) => st.agent && st.action && st.ids.length);
  if (!steps.length) {
    const waiting = pv.steps.reduce((a, st) => a + st.waiting, 0);
    throw new PlanConflict(waiting ? `Nothing new for agents to do: ${plural(waiting, "proposal")} from earlier ${waiting === 1 ? "is" : "are"} already waiting in Approvals.` : "Nothing for agents to do in this scope right now.");
  }
  const byAgent = new Map<AgentKey, PlanStep[]>();
  for (const st of steps) byAgent.set(st.agent!, [...(byAgent.get(st.agent!) ?? []), st]);

  const runs: { id: string; agent: string }[] = [];
  let i = 0;
  for (const [agent, group] of byAgent) {
    const runId = i ? `${planId}.${i}` : planId;
    const input = planInput(planId, key, property, group.map((g) => ({ action: g.action!, ids: g.ids })));
    let started;
    try {
      started = await startRun({ db: s.db, ws: s.ws, actor: s.actor, agent, runId, trigger: { kind: "manual", input } });
    } catch (err) {
      if (i === 0 && /unique|constraint/i.test(String((err as Error)?.message ?? err))) throw new PlanConflict("This plan is already being created; it will show here in a moment.");
      throw err;
    }
    await started.done;
    runs.push({ id: runId, agent });
    i++;
  }
  clearImproveCache(s.ws);

  const { results } = await s.db
    .prepare("SELECT queue_state, count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND run_id IN (SELECT value FROM json_each(?)) GROUP BY queue_state")
    .bind(s.ws, JSON.stringify(runs.map((r) => r.id)))
    .all<{ queue_state: string; n: number }>();
  const by = (q: string) => Number(results.find((r) => r.queue_state === q)?.n ?? 0);
  const created = results.reduce((a, r) => a + Number(r.n), 0);
  const waiting = by("needs_you") + by("waiting");
  const auto = by("auto_handled");
  const targeted = steps.reduce((a, st) => a + st.ids.length, 0);
  const already = Math.max(0, targeted - created);
  const agents = [...byAgent.keys()];
  const message = created
    ? `Agents proposed ${plural(created, "action")}: ${waiting} waiting for approval${auto ? `, ${auto} done within policy` : ""}.${already ? ` ${already} skipped (changed or already proposed).` : ""}`
    : "Agents found nothing new to propose; the records changed since the plan was shown.";
  return { planId, created, waiting, auto, already, runs, approvalsHref: `/app/ai/approvals${agents.length === 1 ? `?agent=${agents[0]}` : ""}`, runHref: `/app/ai/runs/${planId}`, message };
}
