import { AS_OF } from "@/seed/constants";
import type { Actor, ListResult, Role, Row } from "@/entities/types";
import { allEntities, can } from "@/entities/registry";
import { MAX_PAGE_SIZE } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { baseOf, isLakeside, SHARED } from "@/server/effective";

// Read/write access for the AI runtime. Reads see the visitor's overlay over the shared base
// (plan §1, option B) and are always limited to the actor's properties. This mirrors the contract
// of src/server/query.ts (lane C); the AI code only reaches the database through here.

export type DataCtx = { db: Db; ws: string; actor: Actor };

// Tables the AI may read, with the column that scopes them to a property (null = org-level). A
// table with an entity def is scoped by the def's scopePath instead (see scopeClause).
// Identifiers in SQL come only from this map, from defs and from column names read back from the database.
export const TABLES = {
  properties: "id", units: "property_id", unit_types: "property_id", buildings: "property_id", residents: "property_id", households: "property_id",
  leases: "property_id", charges: "property_id", payments: "property_id", credits: "property_id",
  work_orders: "property_id", vendors: null, bills: "property_id", bill_lines: null, vendor_cois: null,
  inspections: "property_id", compliance_items: "property_id", applications: "property_id", applicants: null,
  screening_results: "property_id", renewal_offers: "property_id", prospects: "property_id", listings: "property_id",
  owner_distributions: null, owner_entities: null, owners: null, regions: null, gl_accounts: null, staff: null,
  approval_policies: null, state_rules: null, late_fee_policies: "property_id", help_articles: null,
  data_rules: null, data_issues: "property_id", ai_proposals: "property_id", ai_decisions: null, ai_summaries: null,
  agent_definitions: null, agent_runs: null, agent_steps: null, events: "property_id", tasks: "property_id",
  documents: "property_id", message_threads: "property_id", messages: null, templates: null,
  bank_transactions: null, journal_entries: "property_id", budget_lines: "property_id", legal_cases: "property_id",
  renters_insurance: "property_id", turnovers: "property_id", insurance_policies: "property_id",
  assistant_threads: null, assistant_messages: null, assistant_actions: null, data_fix_log: null, activity_events: "property_id",
} as const;
export type Table = keyof typeof TABLES;

// D1 sheds load with "overloaded" errors under bursts; a short backoff and one or two retries let a
// run continue instead of failing on its first read.
export async function retryBusy<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries - 1 || !/overloaded|too many|busy|locked/i.test(String((err as Error)?.message ?? err))) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
}

// Database errors (D1, SQLite internals) never reach the browser or a run trace; the log keeps the
// detail. Model-provider errors ("overloaded" too) are not database errors and pass through.
const DB_ERROR = /D1_[A-Z_]+|D1 DB|SQLITE_[A-Z]+|no such (table|column)/;
export const DB_BUSY = "The database is busy; try again in a moment";
export function publicError(message: string) {
  if (!DB_ERROR.test(message)) return message;
  console.error("[ai] database error:", message);
  return DB_BUSY;
}

export const isTable = (t: string): t is Table => Object.hasOwn(TABLES, t);

// Overlay rows replace base rows with the same id; tombstones (deleted = 1) hide them.
// Every placeholder is a plain `?`; eff() returns the params it needs in order.
// A Lakeside workspace (the second demo org) sits on its own base and sees 'base' rows only from
// the shared reference tables (src/server/effective.ts).
export function eff(table: Table, ws: string): { sql: string; params: unknown[] } {
  if (ws === "base") return { sql: `(SELECT * FROM ${table} WHERE workspace_id = 'base' AND deleted = 0)`, params: [] };
  // One SELECT, not a UNION ALL, so SQLite can flatten it into joins and use the (workspace_id, id) index.
  if (isLakeside(ws)) {
    const shared = SHARED[table as keyof typeof SHARED];
    return {
      sql: `(SELECT * FROM ${table} WHERE (workspace_id IN (?, ?)${shared ? ` OR (workspace_id = 'base' AND ${shared})` : ""}) AND deleted = 0 AND (workspace_id = ? OR NOT EXISTS (SELECT 1 FROM ${table} o WHERE o.workspace_id = ? AND o.id = ${table}.id)))`,
      params: [baseOf(ws), ws, ws, ws],
    };
  }
  return {
    sql: `(SELECT * FROM ${table} WHERE workspace_id IN ('base', ?) AND deleted = 0 AND (workspace_id = ? OR NOT EXISTS (SELECT 1 FROM ${table} o WHERE o.workspace_id = ? AND o.id = ${table}.id)))`,
    params: [ws, ws, ws],
  };
}

// Tables with no entity def and no property column of their own, scoped through their parent record
// as the visitor's workspace sees it (an overlay row replaces the base one).
const SCOPE_VIA: Partial<Record<Table, (alias: string, ws: string) => { sql: string; params: unknown[] }>> = {
  messages: (a, ws) => { const e = eff("message_threads", ws); return { sql: `(SELECT mt.property_id FROM ${e.sql} mt WHERE mt.id = ${a}.thread_id LIMIT 1)`, params: e.params }; },
  bill_lines: (a, ws) => { const e = eff("bills", ws); return { sql: `(SELECT b.property_id FROM ${e.sql} b WHERE b.id = ${a}.bill_id LIMIT 1)`, params: e.params }; },
};

// Tables with no def and no property that every staff role may read row by row. Other such tables
// (AI decisions, summaries, run logs, fix logs) mention records from any property, so only org-wide
// roles read their rows; internal queries still join them through sql().
const ANY_SCOPE = new Set<Table>(["help_articles", "data_rules", "agent_definitions"]);

const defOf = (table: Table) => allEntities().find((d) => d.table === table);

// The def's scopePath as SQL over `alias`, with {table} expanded to the effective rows (the same
// expression src/server/query.ts filters on).
function defScope(path: string, table: Table, alias: string, ws: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const sql = path.replace(new RegExp(`\\b${table}\\.`, "g"), `${alias}.`).replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, t: string) => {
    const e = eff(t as Table, ws);
    params.push(...e.params);
    return e.sql;
  });
  return { sql, params };
}

// Record types whose Data Health issues a property-scoped role sees whatever their property: types
// with no property link (vendors) that the role can read, as the role sees those records themselves.
// Org-level rows of a property-linked type (an org-wide compliance item) count only when the type's
// def shows its no-property rows to the role.
export function orgIssueTypes(role: Role): { any: string[]; noProperty: string[] } {
  const readable = allEntities().filter((d) => can(role, "read", d.key));
  return { any: readable.filter((d) => !d.scopePath).map((d) => d.key as string), noProperty: readable.filter((d) => d.scopePath && d.scopeNullVisible?.(role)).map((d) => d.key as string) };
}

// "property_id IN (…)" for the actor, or nothing for org-wide actors.
export function scopeClause(ctx: DataCtx, table: Table, alias = "t"): { sql: string; params: unknown[] } {
  // Portal users (self scope) read only their own rows, which the AI layer doesn't model: no rows.
  if (ctx.actor.scope.kind === "self") return { sql: "0", params: [] };
  if (ctx.actor.propertyIds === "all") return { sql: "1 = 1", params: [] };
  const def = defOf(table);
  if (def?.scopePath) {
    const e = defScope(def.scopePath, table, alias, ctx.ws);
    const ids = JSON.stringify(ctx.actor.propertyIds);
    if (def.scopeNullVisible?.(ctx.actor.role)) return { sql: `((${e.sql}) IS NULL OR (${e.sql}) IN (SELECT value FROM json_each(?)))`, params: [...e.params, ...e.params, ids] };
    return { sql: `(${e.sql}) IN (SELECT value FROM json_each(?))`, params: [...e.params, ids] };
  }
  const col = TABLES[table];
  const via = SCOPE_VIA[table];
  if (!col && !via) return { sql: "1 = 1", params: [] };
  if (table === "data_issues") {
    const org = orgIssueTypes(ctx.actor.role);
    return {
      sql: `(${alias}.property_id IN (SELECT value FROM json_each(?)) OR ${alias}.entity_type IN (SELECT value FROM json_each(?)) OR (${alias}.property_id IS NULL AND ${alias}.entity_type IN (SELECT value FROM json_each(?))))`,
      params: [JSON.stringify(ctx.actor.propertyIds), JSON.stringify(org.any), JSON.stringify(org.noProperty)],
    };
  }
  // Proposals with no property follow the same rule: on a record type above, or a fix for an issue
  // the role sees (a property manager who sends a vendor issue's fix sees the proposal it makes).
  if (table === "ai_proposals") {
    const org = orgIssueTypes(ctx.actor.role);
    const types = JSON.stringify([...org.any, ...org.noProperty]);
    const issues = eff("data_issues", ctx.ws);
    return {
      sql: `(${alias}.property_id IN (SELECT value FROM json_each(?)) OR (${alias}.property_id IS NULL AND (${alias}.entity_type IN (SELECT value FROM json_each(?)) OR (${alias}.entity_type = 'data_issues' AND EXISTS (SELECT 1 FROM ${issues.sql} di WHERE di.id = ${alias}.entity_id AND di.entity_type IN (SELECT value FROM json_each(?)))))))`,
      params: [JSON.stringify(ctx.actor.propertyIds), types, ...issues.params, types],
    };
  }
  const v = via ? via(alias, ctx.ws) : { sql: `${alias}.${col}`, params: [] };
  return { sql: `${v.sql} IN (SELECT value FROM json_each(?))`, params: [...v.params, JSON.stringify(ctx.actor.propertyIds)] };
}

// The entity def for a table, when one exists: its read permission and hidden fields apply to AI
// reads too (the same rules the entity API enforces).
function readRules(ctx: DataCtx, table: Table) {
  const def = defOf(table);
  if (!def) {
    if (ctx.actor.propertyIds !== "all" && !TABLES[table] && !SCOPE_VIA[table] && !ANY_SCOPE.has(table)) throw new Error(`${ctx.actor.role.replace(/_/g, " ")} can't view ${table.replace(/_/g, " ")}`);
    return (r: Row) => r;
  }
  if (!can(ctx.actor.role, "read", def.key)) throw new Error(`${ctx.actor.role.replace(/_/g, " ")} can't view ${def.label.many.toLowerCase()}`);
  const hidden = Object.entries(def.fields).filter(([, f]) => f.hiddenFor?.includes(ctx.actor.role)).map(([k, f]) => f.column ?? k);
  return hidden.length ? (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.includes(k))) : (r: Row) => r;
}

export type Filter = { field: string; op: "eq" | "ne" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "like" | "null" | "notnull"; value?: unknown };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const columnsCache = new Map<string, Set<string>>();

// Column names come from the database itself, so filter and sort fields can be checked against them.
export async function columns(db: Db, table: Table): Promise<Set<string>> {
  const hit = columnsCache.get(table);
  if (hit) return hit;
  const { results } = await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>();
  const set = new Set(results.map((r) => r.name));
  if (set.size) columnsCache.set(table, set);
  return set;
}

function filterSql(f: Filter, params: unknown[]): string {
  const c = `t.${f.field}`;
  switch (f.op) {
    case "eq": params.push(f.value); return `${c} = ?`;
    case "ne": params.push(f.value); return `${c} <> ?`;
    case "gt": params.push(f.value); return `${c} > ?`;
    case "gte": params.push(f.value); return `${c} >= ?`;
    case "lt": params.push(f.value); return `${c} < ?`;
    case "lte": params.push(f.value); return `${c} <= ?`;
    case "like": params.push(`%${String(f.value)}%`); return `${c} LIKE ?`;
    case "in": params.push(JSON.stringify(Array.isArray(f.value) ? f.value : [f.value])); return `${c} IN (SELECT value FROM json_each(?))`;
    case "nin": params.push(JSON.stringify(Array.isArray(f.value) ? f.value : [f.value])); return `${c} NOT IN (SELECT value FROM json_each(?))`;
    case "null": return `${c} IS NULL`;
    case "notnull": return `${c} IS NOT NULL`;
  }
}

export type ListArgs = { filters?: Filter[]; sort?: [string, "asc" | "desc"]; page?: number; size?: number; q?: string; qFields?: string[] };

// Paged, scoped list over one table. Unknown fields are rejected, not ignored.
export async function list(ctx: DataCtx, table: Table, args: ListArgs = {}): Promise<ListResult> {
  const visible = readRules(ctx, table);
  const cols = await columns(ctx.db, table);
  for (const f of args.filters ?? []) if (!IDENT.test(f.field) || !cols.has(f.field)) throw new Error(`Unknown field ${table}.${f.field}`);
  if (args.sort && !cols.has(args.sort[0])) throw new Error(`Unknown sort field ${table}.${args.sort[0]}`);
  const size = Math.min(Math.max(1, args.size ?? 25), MAX_PAGE_SIZE);
  const page = Math.max(1, args.page ?? 1);
  const e = eff(table, ctx.ws);
  const s = scopeClause(ctx, table);
  const params: unknown[] = [...e.params, ...s.params];
  const where = [s.sql, ...(args.filters ?? []).map((f) => filterSql(f, params))];
  if (args.q) {
    const fields = (args.qFields ?? []).filter((f) => cols.has(f));
    if (fields.length) {
      where.push(`(${fields.map((f) => `t.${f} LIKE ?`).join(" OR ")})`);
      for (let i = 0; i < fields.length; i++) params.push(`%${args.q}%`);
    }
  }
  const base = `FROM ${e.sql} t WHERE ${where.join(" AND ")}`;
  const order = args.sort ? `ORDER BY t.${args.sort[0]} ${args.sort[1] === "desc" ? "DESC" : "ASC"}` : "ORDER BY t.seq";
  const [rows, total] = await Promise.all([
    ctx.db.prepare(`SELECT t.* ${base} ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`).bind(...params).all<Row>(),
    ctx.db.prepare(`SELECT count(*) AS n ${base}`).bind(...params).first<{ n: number }>(),
  ]);
  return { rows: rows.results.map((r) => visible(clean(r))), total: total?.n ?? 0, page, size };
}

export async function get(ctx: DataCtx, table: Table, id: string): Promise<Row | null> {
  const visible = readRules(ctx, table);
  const e = eff(table, ctx.ws);
  const s = scopeClause(ctx, table);
  const row = await ctx.db.prepare(`SELECT t.* FROM ${e.sql} t WHERE t.id = ? AND ${s.sql}`).bind(...e.params, id, ...s.params).first<Row>();
  return row ? visible(clean(row)) : null;
}

// The effective row without role-based field hiding (still scoped). For internal comparisons such as
// proposal snapshots, which must not depend on who is looking.
export async function getRaw(ctx: DataCtx, table: Table, id: string): Promise<Row | null> {
  const e = eff(table, ctx.ws);
  const s = scopeClause(ctx, table);
  const row = await ctx.db.prepare(`SELECT t.* FROM ${e.sql} t WHERE t.id = ? AND ${s.sql}`).bind(...e.params, id, ...s.params).first<Row>();
  return row ? clean(row) : null;
}

// Raw SQL over effective tables for the AI's computed facts. `{t:table}` placeholders expand to the
// scoped overlay-over-base subquery; values are bound. Only used with SQL written in src/ai.
export async function sql<T = Row>(ctx: DataCtx, text: string, params: unknown[] = [], opts: { unscoped?: boolean } = {}): Promise<T[]> {
  const all: unknown[] = [];
  const rest = [...params];
  const out = text.replace(/\{(\w+)\}|\?/g, (m, t: string | undefined) => {
    if (!t) {
      all.push(rest.shift());
      return "?";
    }
    if (!isTable(t)) throw new Error(`Unknown table ${t}`);
    const e = eff(t, ctx.ws);
    all.push(...e.params);
    if (opts.unscoped) return e.sql;
    const s = scopeClause(ctx, t, "x");
    all.push(...s.params);
    return `(SELECT * FROM ${e.sql} x WHERE ${s.sql})`;
  });
  const { results } = await retryBusy(() => ctx.db.prepare(out).bind(...all).all<T>());
  return results;
}

// Copy-on-write: writes a full overlay row for (ws, id), starting from the effective row.
// Only the visitor's own workspace is written; base is read-only at request time.
export async function upsertOverlay(ctx: DataCtx, table: Table, id: string, changes: Row, opts: { tombstone?: boolean } = {}) {
  const cols = await columns(ctx.db, table);
  for (const k of Object.keys(changes)) if (!cols.has(k) || k === "seq" || k === "workspace_id" || k === "id") throw new Error(`Field ${table}.${k} can't be changed`);
  const e = eff(table, ctx.ws);
  const current = await ctx.db.prepare(`SELECT t.* FROM ${e.sql} t WHERE t.id = ?`).bind(...e.params, id).first<Row>();
  if (!current) throw new Error(`${table} ${id} not found`);
  const next: Row = { ...current, ...changes, workspace_id: ctx.ws, id, deleted: opts.tombstone ? 1 : 0 };
  delete next.seq;
  const keys = Object.keys(next).filter((k) => cols.has(k));
  await ctx.db
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) ON CONFLICT (workspace_id, id) DO UPDATE SET ${keys.filter((k) => k !== "workspace_id" && k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`)
    .bind(...keys.map((k) => next[k] ?? null))
    .run();
  return { before: pick(current, Object.keys(changes)), after: pick(next, Object.keys(changes)), row: next };
}

// Writes that must happen only together with a decision row (an approved proposal's effects): each
// statement runs only if the decision exists, so batched after the guarded decision insert, either
// all of them land or none do.
export type Gate = { decisionId: string };
const gateSql = "WHERE EXISTS (SELECT 1 FROM ai_decisions WHERE workspace_id = ? AND id = ?)";

export async function insertGated(db: Db, ws: string, table: Table | "audit", row: Row, gate: Gate) {
  const cols = await columns(db, table as Table);
  const full: Row = { ...row, workspace_id: ws };
  const keys = Object.keys(full).filter((k) => cols.has(k) && full[k] !== undefined);
  return db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) SELECT ${keys.map(() => "?").join(", ")} ${gateSql}`).bind(...keys.map((k) => toSql(full[k])), ws, gate.decisionId);
}

// upsertOverlay as a gated statement (the current row is read now; the write happens in the batch).
// `unlocked` keeps the write from landing on a row whose `field` is now one of `in` (EntityDef.lockedWhen).
export async function upsertOverlayGated(ctx: DataCtx, table: Table, id: string, changes: Row, gate: Gate, opts: { tombstone?: boolean; unlocked?: { field: string; in: string[] } } = {}) {
  const cols = await columns(ctx.db, table);
  for (const k of Object.keys(changes)) if (!cols.has(k) || k === "seq" || k === "workspace_id" || k === "id") throw new Error(`Field ${table}.${k} can't be changed`);
  const e = eff(table, ctx.ws);
  const current = await ctx.db.prepare(`SELECT t.* FROM ${e.sql} t WHERE t.id = ?`).bind(...e.params, id).first<Row>();
  if (!current) throw new Error(`${table} ${id} not found`);
  const next: Row = { ...current, ...changes, workspace_id: ctx.ws, id, deleted: opts.tombstone ? 1 : 0 };
  delete next.seq;
  const keys = Object.keys(next).filter((k) => cols.has(k));
  const lock = opts.unlocked && cols.has(opts.unlocked.field) ? opts.unlocked : null;
  const lockSql = lock ? ` AND NOT EXISTS (SELECT 1 FROM ${e.sql} l WHERE l.id = ? AND coalesce(l.${lock.field}, '') IN (SELECT value FROM json_each(?)))` : "";
  const stmt = ctx.db
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) SELECT ${keys.map(() => "?").join(", ")} ${gateSql}${lockSql} ON CONFLICT (workspace_id, id) DO UPDATE SET ${keys.filter((k) => k !== "workspace_id" && k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`)
    .bind(...keys.map((k) => toSql(next[k] ?? null)), ctx.ws, gate.decisionId, ...(lock ? [...e.params, id, JSON.stringify(lock.in)] : []));
  return { stmt, before: pick(current, Object.keys(changes)), after: pick(next, Object.keys(changes)) };
}

// Inserts a new row into the visitor's overlay (or base when ws is base, used by the cron sweep).
export async function insert(db: Db, ws: string, table: Table | "audit", row: Row) {
  const cols = await columns(db, table as Table);
  const full: Row = { ...row, workspace_id: ws };
  const keys = Object.keys(full).filter((k) => cols.has(k) && full[k] !== undefined);
  return db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((k) => toSql(full[k])));
}

export const toSql = (v: unknown) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

function clean(row: Row): Row {
  const out = { ...row };
  delete out.seq;
  delete out.workspace_id;
  delete out.deleted;
  return out;
}

const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));

export function newId(prefix: string) {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => (c === "+" ? "-" : c === "/" ? "_" : ""))}`;
}

export const parseJson = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

// The demo's "today" (meta.as_of, written by the seed). Falls back to the real date.
export async function asOf(db: Db): Promise<string> {
  const r = await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>().catch(() => null);
  return r?.value ?? AS_OF;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
