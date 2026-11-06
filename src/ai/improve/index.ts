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
export const CACHE_MAX = 200;
const cache = new Map<string, { at: number; value: Omit<Preview, "plan"> }>();
export const improveCacheSize = () => cache.size;
// Expired entries go on every write; past CACHE_MAX the oldest goes (a Map keeps insertion order).
function remember(k: string, value: Omit<Preview, "plan">) {
  const now = Date.now();
  for (const [key, e] of cache) if (now - e.at >= TTL_MS) cache.delete(key);
  cache.delete(k);
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(k, { at: now, value });
}
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
    remember(k, value);
  }
  return { ...value, plan: await planSummary(s, key, property) };
}

type PlanRun = { id: string; agent_key: string; started_at: string; input: string | null };
const RECENT_RUNS = 40;
const range = (s: ImproveSession, key: ImproveKey, property: string | null) => {
  const prefix = planPrefix(key, s.actor, property);
  return { prefix, binds: [s.ws, prefix, `${prefix}~`] };
};

// The newest plan runs for this card and scope, oldest first. Plan runs live only in the visitor's
// workspace (the shared base never gets runs).
async function planRuns(s: ImproveSession, key: ImproveKey, property: string | null): Promise<PlanRun[]> {
  if (s.ws === "base") return [];
  const { binds } = range(s, key, property);
  const { results } = await s.db
    .prepare(`SELECT r.id, r.agent_key, r.started_at, st.input FROM agent_runs r LEFT JOIN agent_steps st ON st.workspace_id = r.workspace_id AND st.id = r.id || '-s0' WHERE r.workspace_id = ? AND r.id > ? AND r.id < ? ORDER BY r.started_at DESC LIMIT ${RECENT_RUNS}`)
    .bind(...binds)
    .all<PlanRun>();
  return results.reverse();
}

// Every plan so far: how many, when the first started, and the highest number (ids have no ".<i>").
async function planTotals(s: ImproveSession, key: ImproveKey, property: string | null) {
  if (s.ws === "base") return { plans: 0, first: null as string | null, last: -1 };
  const { prefix, binds } = range(s, key, property);
  const r = await s.db
    .prepare("SELECT count(*) AS plans, min(started_at) AS first, max(CAST(substr(id, ?) AS INTEGER)) AS last FROM agent_runs WHERE workspace_id = ? AND id > ? AND id < ? AND instr(id, '.') = 0")
    .bind(prefix.length + 1, ...binds)
    .first<{ plans: number; first: string | null; last: number | null }>();
  return { plans: Number(r?.plans ?? 0), first: r?.first ?? null, last: r?.last == null ? -1 : Number(r.last) };
}

// The plans for this card and scope, rolled up: how many there have been, and for the newest runs'
// records, proposals by state and what changed on them since the first plan started.
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
  const totals = await planTotals(s, key, property);
  const since = totals.first ?? runs[0].started_at;
  const today = await asOf(s.db);
  const outcome = await REGISTRY[key].outcome({ data: { db: s.db, ws: s.ws, actor: s.actor }, today, property }, since, ids);
  return {
    id: runs.at(-1)!.id.replace(/\.\d+$/, ""), since, plans: totals.plans,
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
// `shown` is what the panel showed the person: the plan only acts on those records, and only on the
// ones the fresh plan still includes (balances get paid, prospects reply, someone else proposes).
export type Shown = { action: ActionKey; ids: string[] }[];
export async function executePlan(s: ImproveSession, key: ImproveKey, property: string | null, shown: Shown): Promise<ExecuteResult> {
  // One plan at a time per card (metric) in the workspace, whatever the scope: the home card's plan
  // ("all") and a property page's plan cover the same records, so a click on either while agents are
  // still proposing would race the open-proposal check. The lock is a guarded insert into meta; one
  // older than LOCK_MS (a crashed request) expires. It is refreshed before each agent's run, so a
  // plan with several runs (each up to its deadline) keeps it.
  const lock = `improve-lock:${s.ws}:${key}`;
  let token = String(Date.now());
  const claimed = await s.db
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) < ?")
    .bind(lock, token, Date.now() - LOCK_MS)
    .run();
  if (!claimed.meta.changes) throw new PlanConflict("Agents are already running a plan for this number, here or on another page; it will show here in a moment.");
  const refresh = async () => {
    const next = String(Math.max(Date.now(), Number(token) + 1));
    const r = await s.db.prepare("UPDATE meta SET value = ? WHERE key = ? AND value = ?").bind(next, lock, token).run();
    // Lost the lock (it expired and another click took it): stop before starting another run.
    if (!r.meta.changes) throw new PlanConflict("Another plan for this number started while this one was running; it will show here in a moment.");
    token = next;
  };
  try {
    return await runPlan(s, key, property, shown, refresh);
  } finally {
    await s.db.prepare("DELETE FROM meta WHERE key = ? AND value = ?").bind(lock, token).run();
  }
}

const LOCK_MS = 2 * 60_000;

async function runPlan(s: ImproveSession, key: ImproveKey, property: string | null, shown: Shown, refresh: () => Promise<void>): Promise<ExecuteResult> {
  // The plan number is read first, so two clicks racing each other pick the same id.
  const planId = `${planPrefix(key, s.actor, property)}${(await planTotals(s, key, property)).last + 1}`;
  const pv = await analyze(s, key, property);
  const seen = new Set(shown.flatMap((st) => st.ids.map((id) => `${st.action}|${id}`)));
  const steps = pv.steps
    .map((st) => ({ ...st, ids: st.ids.filter((id) => seen.has(`${st.action}|${id}`)) }))
    .filter((st) => st.agent && st.action && st.ids.length);
  const dropped = seen.size - steps.reduce((a, st) => a + st.ids.length, 0);
  if (!steps.length) {
    if (dropped) throw new PlanConflict(`The records shown changed: ${plural(dropped, "no longer qualifies", "no longer qualify")} or already ${dropped === 1 ? "has" : "have"} a proposal. Review the updated plan.`);
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
    await refresh();
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
    ? `Agents proposed ${plural(created, "action")}: ${waiting} waiting for approval${auto ? `, ${auto} done within policy` : ""}.${already ? ` ${already} skipped (changed or already proposed).` : ""}${dropped ? ` ${dropped} no longer qualified and ${dropped === 1 ? "was" : "were"} left out.` : ""}`
    : "Agents found nothing new to propose; the records changed since the plan was shown.";
  return { planId, created, waiting, auto, already, dropped, runs, approvalsHref: `/app/ai/approvals${agents.length === 1 ? `?agent=${agents[0]}` : ""}`, runHref: `/app/ai/runs/${planId}`, message };
}
