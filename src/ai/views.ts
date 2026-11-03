import { getEntity } from "@/entities";
import type { AgentKey, Row } from "@/entities/types";
import { AGENT_ORDER, getAgent } from "./agents";
import { computeFix } from "./agents/data-health";
import { nextRun } from "./cron";
import { eff, get, isTable, parseJson, scopeClause, sql, type DataCtx } from "./data";
import { agentConfigs, lastSweep, loadPolicies } from "./orchestrator";
import { modelInfo } from "./providers";

// Read models for the AI pages (agents command center, runs, approvals inbox, data health). Server
// components call these directly; the /api/ai routes return the same shapes.

export type AgentCard = {
  key: AgentKey; name: string; goal: string; ownerRole: string; enabled: boolean; autonomy: string; schedule: string | null; events: string[];
  lastRun: { id: string; status: string; started_at: string; summary: string | null; model: string | null; trigger_kind: string } | null;
  nextRunAt: string | null; runs30: number; successRate: number | null; proposed: number; approved: number; auto: number; pending: number; tools: string[]; actions: string[];
};

export async function agentCards(data: DataCtx, nowMs = Date.now()): Promise<AgentCard[]> {
  const configs = await agentConfigs(data.db, data.ws);
  const since = new Date(nowMs - 30 * 86_400_000).toISOString();
  const [runs, props, last] = await Promise.all([
    sql<{ agent_key: string; n: number; ok: number }>(data, "SELECT agent_key, count(*) AS n, sum(status IN ('done', 'waiting_approval')) AS ok FROM {agent_runs} WHERE started_at >= ? GROUP BY agent_key", [since], { unscoped: true }),
    sql<{ agent: string; n: number; approved: number; auto: number; pending: number }>(data,
      `SELECT p.agent, count(*) AS n, sum(d.decision IN ('Approved', 'Edited') AND p.queue_state <> 'auto_handled') AS approved, sum(p.queue_state = 'auto_handled') AS auto, sum(d.id IS NULL AND p.queue_state <> 'auto_handled') AS pending
       FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id GROUP BY p.agent`),
    sql<Row>(data, "SELECT r.* FROM {agent_runs} r WHERE r.seq IN (SELECT max(seq) FROM {agent_runs} GROUP BY agent_key)", [], { unscoped: true }),
  ]);
  return AGENT_ORDER.map((key) => {
    const def = getAgent(key)!;
    const cfg = configs.get(key)!;
    const r = runs.find((x) => x.agent_key === key);
    const p = props.find((x) => x.agent === key);
    const l = last.filter((x) => x.agent_key === key).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
    const next = cfg.enabled && cfg.schedule ? nextRun(cfg.schedule, nowMs) : null;
    return {
      key, name: def.name, goal: def.goal, ownerRole: def.ownerRole, enabled: cfg.enabled, autonomy: cfg.autonomy, schedule: cfg.schedule ?? null, events: cfg.events,
      lastRun: l ? { id: String(l.id), status: String(l.status), started_at: String(l.started_at), summary: (l.summary as string) ?? null, model: (l.model as string) ?? null, trigger_kind: String(l.trigger_kind) } : null,
      nextRunAt: next ? new Date(next).toISOString() : null, runs30: r?.n ?? 0, successRate: r?.n ? Math.round((Number(r.ok) / r.n) * 100) : null,
      proposed: p?.n ?? 0, approved: Number(p?.approved ?? 0), auto: Number(p?.auto ?? 0), pending: Number(p?.pending ?? 0), tools: def.tools, actions: def.actions,
    };
  });
}

export async function aiStatus(data: DataCtx) {
  const m = modelInfo();
  const [last, policies] = await Promise.all([lastSweep(data.db), loadPolicies(data.db, data.ws)]);
  return { provider: m.provider, model: m.model, label: m.label, live: m.provider !== "rules", lastSweepAt: last ? new Date(last).toISOString() : null, policies };
}

export async function runsPage(data: DataCtx, f: { agent?: string; status?: string; trigger?: string; page?: number; size?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.agent) { where.push("agent_key = ?"); params.push(f.agent); }
  if (f.status) { where.push("status = ?"); params.push(f.status); }
  if (f.trigger) { where.push("trigger_kind = ?"); params.push(f.trigger); }
  const size = Math.min(100, Math.max(1, f.size ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total] = await Promise.all([
    sql<Row>(data, `SELECT r.*, (SELECT count(*) FROM {agent_steps} s WHERE s.run_id = r.id) AS steps, (SELECT count(*) FROM {ai_proposals} p WHERE p.run_id = r.id) AS proposals FROM {agent_runs} r ${w} ORDER BY r.started_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params, { unscoped: true }),
    sql<{ n: number }>(data, `SELECT count(*) AS n FROM {agent_runs} ${w}`, params, { unscoped: true }),
  ]);
  return { rows, total: total[0]?.n ?? 0, page, size };
}

export type StepRow = { id: string; idx: number; kind: string; tool_key: string | null; input: unknown; output: unknown; latency_ms: number | null; ok: boolean; at: string };
export const stepOut = (s: Row): StepRow => ({ id: String(s.id), idx: Number(s.idx), kind: String(s.kind), tool_key: (s.tool_key as string) ?? null, input: parseJson(s.input, null), output: parseJson(s.output, s.output ?? null), latency_ms: (s.latency_ms as number) ?? null, ok: Number(s.ok) === 1, at: String(s.at) });

export async function runDetail(data: DataCtx, id: string, afterIdx = -1) {
  const run = await get(data, "agent_runs", id);
  if (!run) return null;
  const [steps, proposals] = await Promise.all([
    sql<Row>(data, "SELECT * FROM {agent_steps} WHERE run_id = ? AND idx > ? ORDER BY idx LIMIT 400", [id, afterIdx], { unscoped: true }),
    sql<Row>(data, "SELECT p.*, d.decision, d.decided_by, d.decided_at FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id WHERE p.run_id = ? ORDER BY p.created_at", [id]),
  ]);
  return { run, steps: steps.map(stepOut), proposals: proposals.map(proposalOut) };
}

export type ProposalOut = Row & { why: string[]; evidence: { entity_type: string; entity_id: string; label: string; href?: string }[]; payload: Record<string, unknown>; href?: string };
export function proposalOut(p: Row): ProposalOut {
  const evidence = parseJson<{ entity_type: string; entity_id: string; label: string }[]>(p.evidence, []).map((e) => ({ ...e, href: hrefOf(e.entity_type, e.entity_id) }));
  return { ...p, why: parseJson<string[]>(p.why, []), evidence, payload: parseJson<Record<string, unknown>>(p.payload, {}), href: hrefOf(String(p.entity_type), String(p.entity_id)) };
}
const hrefOf = (t: string, id: string) => {
  const d = getEntity(t);
  return d ? `${d.route}/${encodeURIComponent(id)}` : undefined;
};

export type Queue = "needs_you" | "auto_handled" | "waiting" | "decided";
const QUEUE_SQL: Record<Queue, string> = {
  needs_you: "p.queue_state = 'needs_you' AND d.id IS NULL",
  waiting: "p.queue_state = 'waiting' AND d.id IS NULL",
  auto_handled: "p.queue_state = 'auto_handled'",
  decided: "d.id IS NOT NULL AND p.queue_state <> 'auto_handled'",
};

export async function proposalsPage(data: DataCtx, f: { queue?: Queue; agent?: string; risk?: string; page?: number; size?: number }) {
  const queue = f.queue ?? "needs_you";
  const where = [QUEUE_SQL[queue]];
  const params: unknown[] = [];
  if (f.agent) { where.push("p.agent = ?"); params.push(f.agent); }
  if (f.risk) { where.push("p.risk = ?"); params.push(f.risk); }
  // Approvals assigned to a role the persona doesn't hold still show (read-only) for leaders.
  const size = Math.min(100, Math.max(1, f.size ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const from = "FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id";
  const [rows, total, counts] = await Promise.all([
    sql<Row>(data, `SELECT p.*, d.decision, d.decided_by, d.decided_at, d.note AS decision_note ${from} WHERE ${where.join(" AND ")} ORDER BY CASE p.risk WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, p.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
    sql<{ n: number }>(data, `SELECT count(*) AS n ${from} WHERE ${where.join(" AND ")}`, params),
    sql<{ q: string; n: number }>(data, `SELECT CASE WHEN p.queue_state = 'auto_handled' THEN 'auto_handled' WHEN d.id IS NOT NULL THEN 'decided' ELSE p.queue_state END AS q, count(*) AS n ${from} GROUP BY q`),
  ]);
  return { rows: rows.map(proposalOut), total: total[0]?.n ?? 0, page, size, counts: Object.fromEntries(counts.map((c) => [c.q, c.n])) as Record<Queue, number> };
}

export async function proposal(data: DataCtx, id: string) {
  const e = eff("ai_proposals", data.ws);
  const s = scopeClause(data, "ai_proposals");
  return data.db.prepare(`SELECT t.* FROM ${e.sql} t WHERE t.id = ? AND ${s.sql}`).bind(...e.params, id, ...s.params).first<Row>();
}

// Data Health: a score per property and per module from open issues weighted by severity
// (critical 8, warn 3, info 1) against the records each covers, plus the issue list with fixes.
const WEIGHT: Record<string, number> = { critical: 8, warn: 3, info: 1 };

export async function dataHealth(data: DataCtx) {
  const [byProp, byEntity, records, rules] = await Promise.all([
    sql<{ property_id: string; name: string; severity: string; n: number }>(data, "SELECT i.property_id, p.name, i.severity, count(*) AS n FROM {data_issues} i LEFT JOIN {properties} p ON p.id = i.property_id WHERE i.status = 'open' GROUP BY i.property_id, i.severity"),
    sql<{ entity_type: string; severity: string; n: number }>(data, "SELECT entity_type, severity, count(*) AS n FROM {data_issues} WHERE status = 'open' GROUP BY entity_type, severity"),
    sql<{ id: string; name: string; metro: string; units: number }>(data, "SELECT p.id, p.name, p.metro, (SELECT count(*) FROM {units} u WHERE u.property_id = p.id) AS units FROM {properties} p ORDER BY p.id"),
    sql<{ id: string; name: string; severity: string; entity_type: string; open: number; fixed: number }>(data,
      "SELECT r.id, r.name, r.severity, r.entity_type, (SELECT count(*) FROM {data_issues} i WHERE i.rule_id = r.id AND i.status = 'open') AS open, (SELECT count(*) FROM {data_issues} i WHERE i.rule_id = r.id AND i.status IN ('fixed', 'auto-fixed')) AS fixed FROM {data_rules} r ORDER BY open DESC", [], { unscoped: true }),
  ]);
  const score = (weighted: number, base: number) => Math.max(0, Math.round(100 - (weighted * 100) / Math.max(base, 20)));
  const properties = records.map((p) => {
    const rows = byProp.filter((x) => x.property_id === p.id);
    const weighted = rows.reduce((s, r) => s + (WEIGHT[r.severity] ?? 1) * r.n, 0);
    return { id: p.id, name: p.name, metro: p.metro, open: rows.reduce((s, r) => s + r.n, 0), critical: rows.filter((r) => r.severity === "critical").reduce((s, r) => s + r.n, 0), score: score(weighted, Number(p.units) * 2) };
  });
  const modules = new Map<string, { module: string; open: number; weighted: number; entities: Set<string> }>();
  for (const r of byEntity) {
    const mod = getEntity(r.entity_type)?.module ?? r.entity_type;
    const m = modules.get(mod) ?? { module: mod, open: 0, weighted: 0, entities: new Set<string>() };
    m.open += r.n;
    m.weighted += (WEIGHT[r.severity] ?? 1) * r.n;
    m.entities.add(r.entity_type);
    modules.set(mod, m);
  }
  const totalWeighted = byEntity.reduce((s, r) => s + (WEIGHT[r.severity] ?? 1) * r.n, 0);
  const totalUnits = records.reduce((s, p) => s + Number(p.units), 0);
  return {
    score: score(totalWeighted, totalUnits * 2), open: byEntity.reduce((s, r) => s + r.n, 0),
    properties, modules: [...modules.values()].map((m) => ({ module: m.module, open: m.open, entities: [...m.entities], score: score(m.weighted, Math.max(40, totalUnits / 4)) })).sort((a, b) => a.score - b.score),
    rules,
  };
}

export async function issuesPage(data: DataCtx, f: { status?: string; severity?: string; rule?: string; property?: string; entity?: string; page?: number; size?: number }) {
  const where = ["i.status = ?"];
  const params: unknown[] = [f.status ?? "open"];
  if (f.severity) { where.push("i.severity = ?"); params.push(f.severity); }
  if (f.rule) { where.push("i.rule_id = ?"); params.push(f.rule); }
  if (f.property) { where.push("i.property_id = ?"); params.push(f.property); }
  if (f.entity) { where.push("i.entity_type = ?"); params.push(f.entity); }
  const size = Math.min(100, Math.max(1, f.size ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    sql<Row>(data, `SELECT i.*, r.name AS rule_name, r.description AS rule_description, p.name AS property FROM {data_issues} i LEFT JOIN {data_rules} r ON r.id = i.rule_id LEFT JOIN {properties} p ON p.id = i.property_id WHERE ${where.join(" AND ")} ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, i.detected_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
    sql<{ n: number }>(data, `SELECT count(*) AS n FROM {data_issues} i WHERE ${where.join(" AND ")}`, params),
  ]);
  const out = await Promise.all(rows.map(async (i) => {
    let fix = parseJson<Record<string, unknown> | null>(i.suggested_fix, null);
    let before: Row | null = null;
    const table = String(i.entity_type);
    const rec = isTable(table) ? await get(data, table, String(i.entity_id)).catch(() => null) : null;
    if (!fix?.changes && !fix?.merge_into && !fix?.action && rec) {
      const c = computeFix(String(i.rule_id), rec);
      if (c) fix = { ...c, source: "data_health" };
    }
    const changes = (fix?.changes ?? {}) as Record<string, unknown>;
    if (rec) before = Object.fromEntries(Object.keys(changes).map((k) => [k, rec[k] ?? null]));
    const human = /^(payments\.|owner_distributions\.|bank_transactions\.|vendors\.unverified_bank_change|leases\.rent_outlier)/.test(String(i.rule_id));
    return { ...i, evidence: parseJson(i.evidence, {}), suggested_fix: fix, before, after: changes, needsPerson: human, href: hrefOf(table, String(i.entity_id)) };
  }));
  return { rows: out, total: total[0]?.n ?? 0, page, size };
}
