import { demoIsoIn, demoNow, demoNowIso } from "@/lib/clock";
import type { ActionKey, Actor, AgentKey } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { allAgents, getAgent } from "./agents/registry";
import { dueBetween } from "./cron";
import { eff, insert, newId, parseJson, type DataCtx } from "./data";
import { executeProposal } from "./effects";
import { createRunContext, errText, type AgentCtx } from "./runtime";
import type { ApprovalPolicy, AgentDef, Autonomy, EventType, RunContext, TriggerKind } from "./types";

// The orchestrator: turns a trigger (schedule, event, a person's "Run now", chat) into an
// agent_runs row, runs the agent loop with a time and cost limit, records every step, and applies
// the agent's autonomy and the approval policies. Work runs in the background through waitUntil
// (Cloudflare ctx.waitUntil, reached via next/server after() in route handlers).

// The scheduler reads like an org-wide principal, so no field an agent needs is hidden from it.
export const SYSTEM_ACTOR: Actor = { personaId: "scheduler", name: "Scheduler", role: "principal", scope: { kind: "org", label: "All properties" }, propertyIds: "all" };
export const SWEEP_EVERY_MS = 15 * 60_000;

export type AgentConfig = { key: AgentKey; enabled: boolean; autonomy: Autonomy; schedule?: string; events: EventType[]; approvalPolicyId: string | null; model: string | null };

// The agent modules load on first use, not at import: extensions import the orchestrator, and agent
// modules reach @/entities, so a static import here would be an import cycle.
export const loadAgents = () => import("./agents");

export async function agentConfigs(db: Db, ws: string): Promise<Map<AgentKey, AgentConfig>> {
  await loadAgents();
  const e = eff("agent_definitions", ws);
  const { results } = await db.prepare(`SELECT * FROM ${e.sql} t`).bind(...e.params).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const rows = new Map(results.map((r) => [String(r.id), r]));
  const out = new Map<AgentKey, AgentConfig>();
  for (const a of allAgents()) {
    const r = rows.get(a.key);
    const t = parseJson<{ schedule?: string; events?: EventType[] }>(r?.triggers, {});
    out.set(a.key, {
      key: a.key, enabled: r ? Number(r.enabled) === 1 : true, autonomy: (r?.autonomy as Autonomy) ?? a.autonomy,
      schedule: t.schedule ?? a.triggers.schedule, events: t.events ?? a.triggers.events ?? [], approvalPolicyId: (r?.approval_policy_id as string) ?? null, model: (r?.model as string) ?? null,
    });
  }
  return out;
}

export async function loadPolicies(db: Db, ws: string): Promise<(ApprovalPolicy & { id: string })[]> {
  const e = eff("approval_policies", ws);
  const { results } = await db.prepare(`SELECT * FROM ${e.sql} t WHERE t.owner_entity_id IS NULL`).bind(...e.params).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return results.map((r) => ({
    id: String(r.id), category: String(r.category), limitCents: r.limit_cents == null ? null : Number(r.limit_cents), approverRole: r.approver_role as ApprovalPolicy["approverRole"],
    ownerApprovalOverCents: r.owner_approval_over_cents == null ? null : Number(r.owner_approval_over_cents), alwaysHuman: Number(r.always_human) === 1,
  }));
}

export type StartOpts = {
  db: Db; ws: string; actor: Actor; agent: AgentKey; trigger: { kind: TriggerKind; eventId?: string; input?: unknown };
  waitUntil?: (p: Promise<unknown>) => void; deadlineMs?: number; nowMs?: number;
};

// Creates the run row right away (so the UI can open its trace) and runs it in the background
// when waitUntil is given; otherwise the returned promise finishes the run.
export async function startRun(o: StartOpts): Promise<{ runId: string; done: Promise<RunResult> }> {
  await loadAgents();
  const def = getAgent(o.agent);
  if (!def) throw new Error(`Unknown agent ${o.agent}`);
  const runId = newId("run");
  const nowMs = o.nowMs ?? Date.now();
  await (await insert(o.db, o.ws, "agent_runs", {
    id: runId, agent_key: o.agent, trigger_kind: o.trigger.kind, event_id: o.trigger.eventId ?? null, started_by: o.trigger.kind === "manual" || o.trigger.kind === "chat" ? o.actor.personaId : null,
    status: "running", started_at: demoNowIso(nowMs), model: null,
  })).run();
  const done = executeRun(def, runId, o, nowMs);
  if (o.waitUntil) o.waitUntil(done);
  return { runId, done };
}

export type RunResult = { runId: string; status: "done" | "failed" | "waiting_approval"; summary: string; proposals: number };

async function executeRun(def: AgentDef, runId: string, o: StartOpts, nowMs: number): Promise<RunResult> {
  const r = await runWithContext(runId, o, nowMs, def.key, def.autonomy, def.actions, async (ctx) => ({ summary: (await def.run(ctx as unknown as RunContext, o.trigger)).summary, result: null }));
  return { runId, status: r.status, summary: r.summary, proposals: r.proposals };
}

// Shared by agent runs and the assistant: builds the run context, records the opening step, runs
// `body` under the time limit, then closes the run row with status, model, tokens and cost.
export async function runWithContext<T>(
  runId: string, o: StartOpts, nowMs: number, agent: AgentKey, defaultAutonomy: Autonomy, actions: ActionKey[],
  body: (ctx: AgentCtx) => Promise<{ summary: string; result: T }>,
): Promise<{ status: RunResult["status"]; summary: string; proposals: number; result: T | null; ctx?: AgentCtx }> {
  const { db, ws } = o;
  let ctx: AgentCtx | undefined;
  try {
    const [configs, policies] = await Promise.all([agentConfigs(db, ws), loadPolicies(db, ws)]);
    ctx = await createRunContext({
      db, ws, actor: o.actor, runId, agent, policies, autonomy: configs.get(agent)?.autonomy ?? defaultAutonomy, nowMs,
      deadlineMs: nowMs + (o.deadlineMs ?? 25_000), waitUntil: o.waitUntil, allowedActions: actions,
      execute: (data, proposal, by, payload) => executeProposal(data, proposal, by, payload),
    });
    await ctx.step({ kind: "plan", ok: true, output: { trigger: o.trigger.kind, event_id: o.trigger.eventId ?? null, autonomy: ctx.autonomy, model: ctx.model?.info.label ?? "Rules (no model configured)", as_of: ctx.today } });
    const c = ctx;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hardStop = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("Run timed out")), Math.max(5_000, c.deadline - Date.now() + 10_000))));
    const { summary, result } = await Promise.race([body(ctx), hardStop]).finally(() => clearTimeout(timer));
    const waiting = ctx.proposals.some((p) => !p.duplicate && p.queueState !== "auto_handled");
    const status = waiting ? "waiting_approval" : "done";
    await finish(db, ws, runId, { status, summary, ctx });
    return { status, summary, proposals: ctx.proposals.filter((p) => !p.duplicate).length, result, ctx };
  } catch (err) {
    console.error(`[ai] run ${runId} (${agent}) failed:`, errText(err));
    await ctx?.step({ kind: "message", output: { error: errText(err) }, ok: false }).catch(() => {});
    await finish(db, ws, runId, { status: "failed", error: errText(err), ctx });
    return { status: "failed", summary: errText(err), proposals: ctx?.proposals.length ?? 0, result: null, ctx };
  }
}

// Creates a run row for work that isn't a registered agent loop (the assistant's chat turns).
export async function openRun(o: StartOpts, nowMs = Date.now()) {
  const runId = newId("run");
  await (await insert(o.db, o.ws, "agent_runs", {
    id: runId, agent_key: o.agent, trigger_kind: o.trigger.kind, event_id: o.trigger.eventId ?? null, started_by: o.actor.personaId, status: "running", started_at: demoNowIso(nowMs),
  })).run();
  return runId;
}

async function finish(db: Db, ws: string, runId: string, r: { status: string; summary?: string; error?: string; ctx?: AgentCtx }) {
  const u = r.ctx?.usage;
  await db
    .prepare("UPDATE agent_runs SET status = ?, ended_at = ?, model = ?, tokens_in = ?, tokens_out = ?, cost_cents = ?, summary = ?, error = ? WHERE workspace_id = ? AND id = ?")
    .bind(r.status, demoNowIso(), r.ctx?.modelUsed.model ?? "rules", u?.tokensIn ?? 0, u?.tokensOut ?? 0, Math.round(u?.costCents ?? 0), r.summary ?? null, r.error ?? null, ws, runId)
    .run();
}

// Claims the next 15-minute sweep slot. One statement, so two cron invocations (or a cron and a
// visit) can't both run it.
export async function claimSweep(db: Db, nowMs: number, everyMs = SWEEP_EVERY_MS): Promise<boolean> {
  await db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('ai_last_sweep', '0')").run();
  const r = await db.prepare("UPDATE meta SET value = ? WHERE key = 'ai_last_sweep' AND CAST(value AS INTEGER) <= ?").bind(String(nowMs), nowMs - everyMs + 30_000).run();
  return r.meta.changes > 0;
}

export async function lastSweep(db: Db): Promise<number | null> {
  const r = await db.prepare("SELECT value FROM meta WHERE key = 'ai_last_sweep'").first<{ value: string }>().catch(() => null);
  return r ? Number(r.value) || null : null;
}

export type SweepReport = { at: string; reaped: number; scheduled: { ws: string; agent: AgentKey; runId: string }[]; events: { ws: string; processed: number; runs: string[] }[] };

export const STALE_RUN_MS = 10 * 60_000;
const ACTIVE_WS = 10;

// Runs whose isolate was stopped before they finished stay "running" forever; mark them failed.
export async function reapStaleRuns(db: Db, nowMs: number) {
  const r = await db
    .prepare("UPDATE agent_runs SET status = 'failed', ended_at = ?, error = 'Stopped before it finished (the worker hit its time limit); nothing after the last step ran.' WHERE status = 'running' AND started_at < ?")
    .bind(demoNowIso(nowMs), demoIsoIn(-STALE_RUN_MS, nowMs))
    .run();
  // Earlier builds ran schedules into the shared base; remove those runs (generated ids start
  // "run_"; the seed's history uses "run-").
  await db.batch([
    db.prepare("DELETE FROM ai_proposals WHERE workspace_id = 'base' AND run_id LIKE 'run\\_%' ESCAPE '\\'"),
    db.prepare("DELETE FROM agent_steps WHERE workspace_id = 'base' AND run_id LIKE 'run\\_%' ESCAPE '\\'"),
    db.prepare("DELETE FROM agent_runs WHERE workspace_id = 'base' AND id LIKE 'run\\_%' ESCAPE '\\'"),
  ]);
  return r.meta.changes;
}

// The 15-minute sweep, per recently active workspace (the shared base is read-only and never
// gets runs): agents whose schedule fell due run in that visitor's workspace, and its events
// outbox (its own events and the seeded pending ones) is drained.
export async function sweep(db: Db, nowMs: number, waitUntil?: (p: Promise<unknown>) => void, opts: { force?: boolean; deadlineMs?: number; workspaces?: string[] } = {}): Promise<SweepReport | null> {
  if (!opts.force && !(await claimSweep(db, nowMs))) return null;
  const report: SweepReport = { at: demoNowIso(nowMs), reaped: await reapStaleRuns(db, nowMs), scheduled: [], events: [] };
  const active = opts.workspaces ?? (await db.prepare("SELECT id FROM workspaces WHERE id <> 'base' AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT ?").bind(nowMs - 30 * 60_000, ACTIVE_WS).all<{ id: string }>()).results.map((a) => a.id);
  const runs: Promise<unknown>[] = [];
  // Run times are stamped on the demo clock, so schedules are checked against it too.
  const demoMs = demoNow(nowMs).getTime();
  for (const ws of active) {
    const configs = await agentConfigs(db, ws);
    const { results: last } = await db
      .prepare("SELECT agent_key, max(started_at) AS at FROM agent_runs WHERE workspace_id IN (?, 'base') AND trigger_kind = 'schedule' GROUP BY agent_key")
      .bind(ws)
      .all<{ agent_key: string; at: string }>();
    const lastAt = new Map(last.map((l) => [l.agent_key, Date.parse(l.at)]));
    for (const cfg of configs.values()) {
      if (!cfg.enabled || !cfg.schedule) continue;
      let due = false;
      try {
        due = dueBetween(cfg.schedule, lastAt.get(cfg.key) ?? demoMs - SWEEP_EVERY_MS, demoMs);
      } catch {
        continue;
      }
      if (!due) continue;
      const { runId, done } = await startRun({ db, ws, actor: SYSTEM_ACTOR, agent: cfg.key, trigger: { kind: "schedule" }, deadlineMs: opts.deadlineMs ?? 120_000, nowMs });
      report.scheduled.push({ ws, agent: cfg.key, runId });
      runs.push(done);
    }
    const r = await drainEvents(db, ws, nowMs, 25, opts.deadlineMs);
    if (r.processed) report.events.push({ ws, processed: r.processed, runs: r.runs.map((x) => x.runId) });
    runs.push(...r.runs.map((x) => x.done));
  }
  const all = Promise.allSettled(runs);
  if (waitUntil) waitUntil(all);
  else await all;
  return report;
}

// Consumes the workspace's events outbox (overlay over base). Each event is claimed with one
// guarded statement (an overlay copy, or an update of the overlay row, only while unprocessed), then
// every enabled agent that listens for its type runs once for the batch.
export async function drainEvents(db: Db, ws: string, nowMs: number, limit = 25, deadlineMs = 60_000) {
  const e = eff("events", ws);
  const { results } = await db.prepare(`SELECT t.* FROM ${e.sql} t WHERE t.processed_at IS NULL ORDER BY t.created_at LIMIT ?`).bind(...e.params, limit).all<Record<string, unknown>>();
  if (!results.length) return { processed: 0, runs: [] as { runId: string; done: Promise<RunResult> }[] };
  const configs = await agentConfigs(db, ws);
  const byAgent = new Map<AgentKey, Record<string, unknown>[]>();
  const at = demoNowIso(nowMs);
  let processed = 0;
  for (const ev of results) {
    const claimed = await db
      .prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO UPDATE SET processed_at = excluded.processed_at WHERE events.processed_at IS NULL")
      .bind(ws, ev.id, ev.type, ev.entity_type ?? null, ev.entity_id ?? null, ev.property_id ?? null, ev.payload ?? "{}", ev.created_at, at)
      .run();
    if (!claimed.meta.changes) continue;
    processed++;
    for (const cfg of configs.values()) if (cfg.enabled && cfg.events.includes(ev.type as EventType)) (byAgent.get(cfg.key) ?? byAgent.set(cfg.key, []).get(cfg.key)!).push(ev);
  }
  const runs: { runId: string; done: Promise<RunResult> }[] = [];
  for (const [agent, evs] of byAgent) {
    const one = evs.length === 1 ? evs[0] : null;
    const input = one ? { ...parseJson<Record<string, unknown>>(one.payload, {}), [`${String(one.entity_type ?? "").replace(/s$/, "")}_id`]: one.entity_id, events: [one.id] } : { events: evs.map((x) => x.id) };
    const r = await startRun({ db, ws, actor: SYSTEM_ACTOR, agent, trigger: { kind: "event", eventId: String(evs[0].id), input }, deadlineMs, nowMs });
    await db.prepare("UPDATE events SET run_id = ? WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?))").bind(r.runId, ws, JSON.stringify(evs.map((x) => x.id))).run();
    runs.push(r);
  }
  return { processed, runs };
}

// Writes an event to the outbox (module actions call this after money, imports, work orders and
// data checks); the next sweep, or the visit that follows, hands it to the listening agents.
export async function emitEvent(data: DataCtx, e: { type: EventType; entityType?: string; entityId?: string; propertyId?: string; payload?: unknown }) {
  await (await insert(data.db, data.ws, "events", { id: newId("evt"), type: e.type, entity_type: e.entityType ?? null, entity_id: e.entityId ?? null, property_id: e.propertyId ?? null, payload: JSON.stringify(e.payload ?? {}), created_at: demoNowIso() })).run();
}
