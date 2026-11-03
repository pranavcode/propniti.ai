import { getEntity } from "@/entities";
import type { AgentKey, Row } from "@/entities/types";
import { AGENT_ORDER, getAgent } from "./agents";
import { computeFix } from "./agents/data-health";
import { nextRun } from "./cron";
import { eff, get, isTable, parseJson, scopeClause, sql, TABLES, type DataCtx } from "./data";
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

// Data Health score: 100 − the weighted share of affected records. Each open issue weighs by
// severity (critical 3, warn 1, info 0.25) and is divided by the records of its entity in scope;
// entities combine by record count, so a big table with a few typos doesn't sink the score.
export const SEVERITY_WEIGHT: Record<string, number> = { critical: 3, warn: 1, info: 0.25 };
export const HEALTH_FORMULA = "100 − 100 × Σ(open issues × severity weight) ÷ Σ(records checked). Weights: critical 3, warning 1, info 0.25. Records checked are the rows of every table a data rule covers, in your scope.";

export function healthScore(parts: { weighted: number; records: number }[]) {
  const records = parts.reduce((s, p) => s + p.records, 0);
  const weighted = parts.reduce((s, p) => s + p.weighted, 0);
  if (!records) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (100 * weighted) / records)));
}

export async function dataHealth(data: DataCtx) {
  const [issues, rules, props] = await Promise.all([
    sql<{ entity_type: string; property_id: string | null; severity: string; n: number }>(data, "SELECT entity_type, property_id, severity, count(*) AS n FROM {data_issues} WHERE status = 'open' GROUP BY entity_type, property_id, severity"),
    sql<{ id: string; name: string; severity: string; entity_type: string; open: number; fixed: number }>(data,
      "SELECT r.id, r.name, r.severity, r.entity_type, (SELECT count(*) FROM {data_issues} i WHERE i.rule_id = r.id AND i.status = 'open') AS open, (SELECT count(*) FROM {data_issues} i WHERE i.rule_id = r.id AND i.status IN ('fixed', 'auto-fixed')) AS fixed FROM {data_rules} r ORDER BY open DESC", [], { unscoped: true }),
    sql<{ id: string; name: string; metro: string }>(data, "SELECT id, name, metro FROM {properties} ORDER BY id"),
  ]);
  const entities = [...new Set([...rules.map((r) => r.entity_type), ...issues.map((i) => i.entity_type)])].filter(isTable);
  // Records checked per entity, in total and per property (for tables scoped by property).
  const counts = await Promise.all(entities.map(async (t) => {
    const col = TABLES[t];
    const total = (await sql<{ n: number }>(data, `SELECT count(*) AS n FROM {${t}}`))[0]?.n ?? 0;
    const byProp = col ? await sql<{ p: string; n: number }>(data, `SELECT ${col} AS p, count(*) AS n FROM {${t}} GROUP BY ${col}`) : [];
    return { entity: t, total, byProp: new Map(byProp.map((r) => [r.p, r.n])), scoped: !!col };
  }));
  const weightOf = (rows: typeof issues) => rows.reduce((s, r) => s + (SEVERITY_WEIGHT[r.severity] ?? 1) * r.n, 0);
  const count = (rows: typeof issues) => rows.reduce((s, r) => s + r.n, 0);

  const properties = props.map((p) => {
    const parts = counts.filter((c) => c.scoped).map((c) => ({ weighted: weightOf(issues.filter((i) => i.entity_type === c.entity && i.property_id === p.id)), records: c.byProp.get(p.id) ?? 0 }));
    const mine = issues.filter((i) => i.property_id === p.id);
    return { id: p.id, name: p.name, metro: p.metro, open: count(mine), critical: count(mine.filter((i) => i.severity === "critical")), score: healthScore(parts) };
  });
  const modules = new Map<string, { module: string; parts: { weighted: number; records: number }[]; open: number; entities: string[] }>();
  for (const c of counts) {
    const mod = getEntity(c.entity)?.module ?? c.entity;
    const mine = issues.filter((i) => i.entity_type === c.entity);
    const m = modules.get(mod) ?? { module: mod, parts: [], open: 0, entities: [] };
    m.parts.push({ weighted: weightOf(mine), records: c.total });
    m.open += count(mine);
    if (mine.length) m.entities.push(c.entity);
    modules.set(mod, m);
  }
  return {
    score: healthScore(counts.map((c) => ({ weighted: weightOf(issues.filter((i) => i.entity_type === c.entity)), records: c.total }))),
    open: count(issues), formula: HEALTH_FORMULA, properties,
    modules: [...modules.values()].filter((m) => m.open).map((m) => ({ module: m.module, open: m.open, entities: m.entities, score: healthScore(m.parts) })).sort((a, b) => a.score - b.score),
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
