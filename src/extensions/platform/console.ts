import "server-only";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/query";

// Read models for the platform-admin console (Settings → Platform). These read across every
// workspace on purpose: the operator sees the whole platform, not one visitor's overlay.

type R = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0) || 0;
const all = async <T = R>(db: Db, sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;

export async function orgSummary(db: Db, ws: string | null) {
  const orgs = effective("orgs", ws);
  const [tot, plans, top] = await Promise.all([
    db.prepare(`SELECT count(*) AS orgs, sum(status = 'Active') AS active, sum(status = 'Trial') AS trial, sum(status IN ('Past due', 'Suspended')) AS attention, coalesce(sum(seats), 0) AS seats, coalesce(sum(units_managed), 0) AS units FROM ${orgs}`).first<R>(),
    all<{ plan: string; orgs: number; units: number }>(db, `SELECT plan, count(*) AS orgs, coalesce(sum(units_managed), 0) AS units FROM ${orgs} GROUP BY plan ORDER BY units DESC`),
    all<{ id: string; name: string; units: number; seats: number; users: number }>(db, `SELECT o.id, o.name, o.units_managed AS units, o.seats, (SELECT count(*) FROM ${effective("staff", ws)} s WHERE s.org_id = o.id AND s.active = 1) AS users FROM ${orgs} o ORDER BY o.units_managed DESC LIMIT 12`),
  ]);
  return {
    orgs: n(tot?.orgs), active: n(tot?.active), trial: n(tot?.trial), attention: n(tot?.attention), seats: n(tot?.seats), units: n(tot?.units),
    plans: plans.map((p) => ({ plan: p.plan, orgs: n(p.orgs), units: n(p.units) })),
    top: top.map((o) => ({ id: o.id, name: o.name, units: n(o.units), seats: n(o.seats), users: n(o.users) })),
  };
}

const hasTable = async (db: Db, name: string) => !!(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first().catch(() => null));

// Agent usage from agent_runs (every workspace), plus per-org monthly usage when the seed provides it.
export async function usage(db: Db, asOf: string) {
  const since = `${addDays(asOf, -29)}`;
  const [tot, byAgent, byDay, byModel] = await Promise.all([
    db.prepare("SELECT count(*) AS runs, sum(status = 'failed') AS failed, coalesce(sum(tokens_in), 0) AS tin, coalesce(sum(tokens_out), 0) AS tout, coalesce(sum(cost_cents), 0) AS cost, count(DISTINCT workspace_id) AS workspaces FROM agent_runs WHERE substr(started_at, 1, 10) >= ?").bind(since).first<R>(),
    all<R>(db, "SELECT agent_key AS agent, count(*) AS runs, coalesce(sum(tokens_in + tokens_out), 0) AS tokens, coalesce(sum(cost_cents), 0) AS cost FROM agent_runs WHERE substr(started_at, 1, 10) >= ? GROUP BY agent_key ORDER BY runs DESC", since),
    all<R>(db, "SELECT substr(started_at, 1, 10) AS day, count(*) AS runs, coalesce(sum(tokens_in + tokens_out), 0) AS tokens, coalesce(sum(cost_cents), 0) AS cost FROM agent_runs WHERE substr(started_at, 1, 10) >= ? GROUP BY day ORDER BY day", since),
    all<R>(db, "SELECT coalesce(model, 'rules') AS model, count(*) AS runs, coalesce(sum(tokens_in), 0) AS tin, coalesce(sum(tokens_out), 0) AS tout, coalesce(sum(cost_cents), 0) AS cost FROM agent_runs WHERE substr(started_at, 1, 10) >= ? GROUP BY 1 ORDER BY runs DESC", since),
  ]);
  let orgs: { org_id: string; name: string; runs: number; tokens: number; cost: number; users: number }[] | null = null;
  let orgMonths: { month: string; runs: number; cost: number }[] = [];
  if (await hasTable(db, "org_usage_monthly")) {
    const o = effective("orgs", null);
    orgs = (await all<R>(db, `SELECT u.org_id, coalesce(o.name, u.org_id) AS name, sum(u.agent_runs) AS runs, sum(u.tokens_in + u.tokens_out) AS tokens, sum(u.cost_cents) AS cost, max(u.active_users) AS users FROM org_usage_monthly u LEFT JOIN ${o} o ON o.id = u.org_id WHERE u.workspace_id = 'base' AND u.deleted = 0 AND u.month >= ? GROUP BY u.org_id ORDER BY runs DESC`, addMonths(asOf.slice(0, 7), -11)))
      .map((r) => ({ org_id: String(r.org_id), name: String(r.name), runs: n(r.runs), tokens: n(r.tokens), cost: n(r.cost) / 100, users: n(r.users) }));
    orgMonths = (await all<R>(db, "SELECT month, sum(agent_runs) AS runs, sum(cost_cents) AS cost FROM org_usage_monthly WHERE workspace_id = 'base' AND deleted = 0 AND month >= ? GROUP BY month ORDER BY month", addMonths(asOf.slice(0, 7), -11)))
      .map((r) => ({ month: String(r.month), runs: n(r.runs), cost: n(r.cost) / 100 }));
  }
  const days = Array.from({ length: 30 }, (_, i) => addDays(asOf, i - 29));
  return {
    since,
    runs: n(tot?.runs), failed: n(tot?.failed), tokensIn: n(tot?.tin), tokensOut: n(tot?.tout), cost: n(tot?.cost) / 100, workspaces: n(tot?.workspaces),
    byAgent: byAgent.map((r) => ({ agent: String(r.agent), runs: n(r.runs), tokens: n(r.tokens), cost: n(r.cost) / 100 })),
    // Every day in the window, including days with no runs, so the bars keep their spacing.
    byDay: days.map((day) => {
      const r = byDay.find((x) => x.day === day);
      return { day: day.slice(5), date: day, runs: n(r?.runs), tokens: n(r?.tokens), cost: n(r?.cost) / 100 };
    }),
    byModel: byModel.map((r) => ({ model: String(r.model), runs: n(r.runs), tokensIn: n(r.tin), tokensOut: n(r.tout), cost: n(r.cost) / 100 })),
    orgs, orgMonths,
  };
}

export async function health(db: Db) {
  const [events, proposals, runs, workspaces, failed] = await Promise.all([
    db.prepare("SELECT count(*) AS n, min(created_at) AS oldest FROM events WHERE processed_at IS NULL AND deleted = 0").first<R>().catch(() => null),
    db.prepare("SELECT count(*) AS n FROM ai_proposals p WHERE p.queue_state = 'needs_you' AND p.deleted = 0 AND NOT EXISTS (SELECT 1 FROM ai_decisions d WHERE d.proposal_id = p.id AND d.workspace_id = p.workspace_id)").first<R>().catch(() => null),
    all<R>(db, "SELECT status, count(*) AS n FROM agent_runs WHERE status IN ('queued', 'running', 'waiting_approval') GROUP BY status").catch(() => []),
    db.prepare("SELECT count(*) AS n, max(last_seen_at) AS last FROM workspaces WHERE kind = 'demo'").first<R>().catch(() => null),
    all<R>(db, "SELECT id, agent_key, started_at, error FROM agent_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 5").catch(() => []),
  ]);
  let bytes: number | null = null;
  try {
    bytes = n((await db.prepare("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()").first<R>())?.bytes) || null;
  } catch {
    bytes = null;
  }
  const tables = await biggestTables(db);
  return {
    events: { pending: n(events?.n), oldest: (events?.oldest as string) ?? null },
    needsYou: n(proposals?.n),
    runs: Object.fromEntries(runs.map((r) => [String(r.status), n(r.n)])) as Record<string, number>,
    workspaces: { count: n(workspaces?.n), lastSeen: workspaces?.last ? Number(workspaces.last) : null },
    failed: failed.map((r) => ({ id: String(r.id), agent: String(r.agent_key), at: String(r.started_at), error: (r.error as string) ?? null })),
    bytes, tables, checkedAt: Date.now(),
  };
}

const COUNTED = ["charges", "payments", "audit", "activity_events", "transfers", "notes", "messages", "work_orders", "units", "residents", "leases", "agent_steps", "agent_runs", "documents", "tasks", "bank_transactions", "journal_entries"];

async function biggestTables(db: Db) {
  const rows = await Promise.all(COUNTED.map(async (t) => {
    const r = await db.prepare(`SELECT count(*) AS n, sum(workspace_id NOT IN ('base', 'base-lakeside')) AS overlay FROM ${t}`).first<R>().catch(() => null);
    return { table: t, rows: n(r?.n), overlay: n(r?.overlay) };
  }));
  return rows.sort((a, b) => b.rows - a.rows).slice(0, 10);
}

function addDays(ymd: string, d: number) {
  const t = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
function addMonths(ym: string, m: number) {
  const [y, mo] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + m, 1)).toISOString().slice(0, 7);
}
