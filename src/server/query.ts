import "server-only";
import { demoNowIso } from "@/lib/clock";
import { AS_OF } from "@/seed/constants";
import { z, type ZodType } from "zod";
import { can, getEntity } from "@/entities";
import { getPersona } from "@/auth/personas";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Actor, type EntityDef, type EntityKey, type FieldDef, type ListQuery, type ListResult, type Role, type Row } from "@/entities/types";
import type { Db, DbStatement } from "@/lib/platform/types";
import { getMetric, type MetricParams, type MetricResult } from "@/extensions/metrics";
import { forgetInboxCounts } from "@/extensions/inbox/counts";
import { BULK_MATCH_CAP } from "@/lib/bulk";
import { LIFE_SAFETY_ROLES, safetyJobs, VENDOR_OFF } from "@/ai/life-safety";
import { EXPORT_CAP } from "@/lib/export/types";
import { APPEND_ONLY, assertTable, effective as baseEffective, NO_WORKSPACE, overlayUpsertSql, TABLES } from "./effective";

// Registry-driven query layer (plan §4). Every SQL identifier comes from an EntityDef or a
// relation in one; every value is bound. Reads go through effective(): the visitor's overlay
// rows replace base rows with the same id, and an overlay tombstone hides the base row.
// Scope (the persona's properties) is applied to every read of a property-scoped entity.

export type QueryCtx = { db: Db; ws: string | null; actor: Actor };

export class QueryError extends Error {
  constructor(public status: 400 | 403 | 404 | 405 | 409, message: string) {
    super(message);
  }
}

// Addendum 1: page sizes are 25/50/100.
export const PAGE_SIZE_CAP = Math.min(MAX_PAGE_SIZE, 100);
const IDENT = /^[a-z_][a-z0-9_]*$/;
const WS_ID = /^[A-Za-z0-9_-]{22,64}$/;

function ident(name: string) {
  if (!IDENT.test(name)) throw new Error(`Bad identifier: ${name}`);
  return name;
}

// A workspace for reads: its id plus the tables it has overlay rows in (see readWs). Writes and
// guards pass the plain id and always get the full overlay form.
export type Ws = string | null | { id: string; overlay: Set<string> };

// Effective rows of a table for a workspace, as a parenthesised subquery: overlay rows replace
// base rows with the same id and tombstones hide them (same rows as src/server/effective.ts).
// It is a single flat SELECT rather than a UNION ALL so SQLite can flatten it into correlated
// aggregates (a property's unit count, a household's balance) and use the (workspace_id, fk)
// indexes; the compound form scans the whole base table once per outer row.
// The workspace id is inlined as a literal so def SQL can use {table} anywhere without
// threading parameters; that is safe because it must match the cookie regex.
export function effective(table: string, ws: Ws): string {
  assertTable(table);
  // Fast path: the visitor has no overlay rows in this table, so its effective rows are the base
  // rows. Skips the anti-join, which costs ~350 ms per scan on the 130k-row ledger tables.
  // Base rows are never tombstoned (tombstones live in overlays), so no deleted = 0 here: that
  // keeps counts on the (workspace_id, …) indexes instead of reading every row.
  if (typeof ws === "object" && ws && !ws.overlay.has(table)) return `(SELECT * FROM ${table} WHERE workspace_id = 'base')`;
  const id = typeof ws === "object" && ws ? ws.id : ws;
  const w = `'${id && WS_ID.test(id) ? id : NO_WORKSPACE}'`;
  if (APPEND_ONLY.has(table)) return `(SELECT * FROM ${table} WHERE workspace_id IN ('base', ${w}))`;
  if (table === "metrics_monthly") return baseEffective(table, w);
  return `(SELECT * FROM ${table} WHERE workspace_id IN ('base', ${w}) AND deleted = 0 AND (workspace_id = ${w} OR NOT EXISTS (SELECT 1 FROM ${table} AS o WHERE o.workspace_id = ${w} AND o.id = ${table}.id)))`;
}

// Tables the visitor's overlay touches: one indexed probe per table in one query, cached per
// request (keyed by the request's actor) and dropped after any write through this module.
const overlayCache = new WeakMap<Actor, Promise<Set<string>>>();
export const forgetOverlay = (actor: Actor) => overlayCache.delete(actor);

export async function readWs(ctx: QueryCtx): Promise<Ws> {
  const id = ctx.ws && WS_ID.test(ctx.ws) ? ctx.ws : null;
  if (!id) return { id: "", overlay: new Set() };
  let p = overlayCache.get(ctx.actor);
  if (!p) {
    // Rows of EXISTS columns, not a UNION: D1 allows only 5 terms in a compound SELECT and 100
    // columns per result, so the probes go in chunks of 60 columns, in one batch.
    const chunks = Array.from({ length: Math.ceil(TABLES.length / 60) }, (_, k) => TABLES.slice(k * 60, k * 60 + 60));
    const stmts = chunks.map((c, k) => ctx.db.prepare(`SELECT ${c.map((t, i) => `EXISTS (SELECT 1 FROM ${t} WHERE workspace_id = ?1) AS c${k * 60 + i}`).join(", ")}`).bind(id));
    p = ctx.db.batch(stmts).then((rs) => {
      const row = Object.assign({}, ...rs.map((r) => (r.results?.[0] ?? {}) as Record<string, number>));
      return new Set(TABLES.filter((_, i) => row[`c${i}`]));
    });
    overlayCache.set(ctx.actor, p);
  }
  return { id, overlay: await p };
}

// Def SQL may name another table as {table}; it expands to that table's effective rows.
export function expand(sql: string, ws: Ws) {
  return sql.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, t: string) => effective(t, ws));
}

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

export const visibleFields = (def: EntityDef, role: Role) =>
  Object.entries(def.fields).filter(([, f]) => !f.hiddenFor?.includes(role)) as [string, FieldDef][];

function field(def: EntityDef, key: string, role: Role): FieldDef {
  const f = def.fields[key];
  if (!f || f.hiddenFor?.includes(role)) throw new QueryError(400, `Unknown field "${key}" on ${def.key}`);
  return f;
}

function expr(def: EntityDef, key: string, f: FieldDef, ws: Ws) {
  return f.sql ? `(${expand(f.sql, ws)})` : `${def.table}.${ident(f.column ?? key)}`;
}

// Label of a referenced record: its def's titleField (computed or a column). A reference whose
// case is wrong ("P01" for "p01", a data-health issue) still shows the record's name.
function refLabel(def: EntityDef, key: string, f: FieldDef, ws: Ws) {
  const ref = f.ref && getEntity(f.ref);
  if (!ref) return null;
  const tf = ref.fields[ref.titleField];
  const title = tf?.sql ? `(${expand(tf.sql, ws)})` : `${ref.table}.${ident(tf?.column ?? ref.titleField)}`;
  const by = (id: string) => `(SELECT ${title} FROM ${effective(ref.table, ws)} AS ${ref.table} WHERE ${ref.table}.id = ${id})`;
  const v = expr(def, key, f, ws);
  return `coalesce(${by(v)}, ${by(`lower(${v})`)})`;
}

function selectList(def: EntityDef, role: Role, ws: Ws) {
  const cols = [`${def.table}.id AS id`];
  for (const [key, f] of visibleFields(def, role)) {
    if (key === "id") continue;
    cols.push(`${expr(def, key, f, ws)} AS "${key}"`);
    if (f.type === "ref") {
      const label = refLabel(def, key, f, ws);
      if (label) cols.push(`${label} AS "${key}__label"`);
    }
  }
  return cols.join(", ");
}

// DB value → API value: money in dollars, bools as booleans, JSON parsed.
function outValue(f: FieldDef, v: unknown) {
  if (v == null) return v;
  if (f.type === "money") return Number(v) / 100;
  if (f.type === "bool") return !!v;
  if (f.type === "json") {
    try {
      return JSON.parse(String(v));
    } catch {
      return null;
    }
  }
  return v;
}

export function present(def: EntityDef, role: Role, raw: Row): Row {
  const row: Row = { id: raw.id };
  for (const [key, f] of visibleFields(def, role)) {
    row[key] = outValue(f, raw[key]);
    if (f.type === "ref") row[`${key}__label`] = raw[`${key}__label`] ?? null;
  }
  row._title = row[def.titleField] ?? row.id;
  if (def.subtitle) row._subtitle = def.subtitle(row);
  if (def.image) row._image = def.image(row) ?? null;
  return row;
}

// API value → DB value, for filters and writes.
function inValue(f: FieldDef, v: unknown) {
  if (v == null || v === "") return null;
  if (f.type === "money") return Math.round(Number(v) * 100);
  if (f.type === "number") return Number(v);
  if (f.type === "bool") return v === true || v === "true" || v === "1" || v === 1 ? 1 : 0;
  if (f.type === "json") return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------

// Portal users (scope "self") see only rows tied to their own record: their household, their
// owner entities, their vendor or applicant id. An entity without such a column returns nothing
// for them; property scope never widens it to everything at a property.
function selfClause(def: EntityDef, actor: Actor, ws: Ws): { sql: string; params: unknown[] } {
  const rec = getPersona(actor.personaId)?.record;
  if (!rec) return { sql: "0", params: [] };
  if (def.key === rec.entity) return { sql: `${def.table}.id = ?`, params: [rec.id] };
  const has = (col: string) => Object.entries(def.fields).some(([k, f]) => (f.column ?? k) === col && !f.sql);
  if (rec.entity === "residents" && has("household_id")) return { sql: `${def.table}.household_id = (SELECT household_id FROM ${effective("residents", ws)} WHERE id = ?)`, params: [rec.id] };
  if (rec.entity === "vendors" && has("vendor_id")) return { sql: `${def.table}.vendor_id = ?`, params: [rec.id] };
  if (rec.entity === "applicants" && has("applicant_id")) return { sql: `${def.table}.applicant_id = ?`, params: [rec.id] };
  if (rec.entity === "owners" && has("owner_id")) return { sql: `${def.table}.owner_id = ?`, params: [rec.id] };
  if (rec.entity === "owners" && has("owner_entity_id")) return { sql: `${def.table}.owner_entity_id IN (SELECT id FROM ${effective("owner_entities", ws)} WHERE owner_id = ?)`, params: [rec.id] };
  return { sql: "0", params: [] };
}

function scopeWhere(def: EntityDef, actor: Actor, ws: Ws): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (actor.scope.kind === "self") {
    const s = selfClause(def, actor, ws);
    sql.push(s.sql);
    params.push(...s.params);
  }
  if (actor.propertyIds !== "all" && def.scopePath) {
    const e = `(${expand(def.scopePath, ws)})`;
    const nulls = actor.scope.kind !== "self" && def.scopeNullVisible?.(actor.role);
    sql.push(nulls ? `(${e} IS NULL OR ${e} IN (SELECT value FROM json_each(?)))` : `${e} IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(actor.propertyIds));
  }
  return { sql, params };
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

type Where = { sql: string[]; params: unknown[] };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

// Filter keys: "<field>" (equals; an array means any of), "<field>.min" / "<field>.max" (ranges
// on numbers, money and dates), "<field>.null" ("1" = is empty, "0" = has a value).
// Filtering by record id (a batch lookup of known rows) needs no field def.
const ID_FIELD: FieldDef = { type: "text", label: "Id" };

function filterWhere(def: EntityDef, role: Role, ws: Ws, filters: Record<string, string | string[]>, skip?: string): Where {
  const w: Where = { sql: [], params: [] };
  for (const [rawKey, rawVal] of Object.entries(filters)) {
    const [key, op] = rawKey.split(".", 2) as [string, string | undefined];
    if (key === skip) continue;
    const f = key === "id" ? ID_FIELD : field(def, key, role);
    if (f.type === "json" || f.type === "image") throw new QueryError(400, `Can't filter on "${key}"`);
    const e = expr(def, key, f, ws);
    const vals = (Array.isArray(rawVal) ? rawVal : [rawVal]).filter((v) => v !== "");
    if (!vals.length) continue;
    if (op === "min" || op === "max") {
      if (!["number", "money", "date", "datetime"].includes(f.type)) throw new QueryError(400, `"${key}" has no range`);
      w.sql.push(`${e} ${op === "min" ? ">=" : "<="} ?`);
      w.params.push(inValue(f, vals[0]));
    } else if (op === "null") {
      w.sql.push(vals[0] === "0" ? `${e} IS NOT NULL AND ${e} <> ''` : `(${e} IS NULL OR ${e} = '')`);
    } else if (op) {
      throw new QueryError(400, `Unknown filter "${rawKey}"`);
    } else if (vals.length === 1) {
      w.sql.push(`${e} = ?`);
      w.params.push(inValue(f, vals[0]));
    } else {
      w.sql.push(`${e} IN (SELECT value FROM json_each(?))`);
      w.params.push(JSON.stringify(vals.map((v) => inValue(f, v))));
    }
  }
  return w;
}

function searchWhere(def: EntityDef, role: Role, ws: Ws, q: string | undefined): Where {
  const term = q?.trim().slice(0, 100);
  if (!term) return { sql: [], params: [] };
  const fields = visibleFields(def, role).filter(([, f]) => f.search);
  const exprs = [`${def.table}.id`, ...fields.map(([k, f]) => expr(def, k, f, ws))];
  return { sql: [`(${exprs.map((e) => `${e} LIKE ? ESCAPE '\\'`).join(" OR ")})`], params: exprs.map(() => `%${likeEscape(term)}%`) };
}

const merge = (...ws: Where[]): Where => ({ sql: ws.flatMap((w) => w.sql), params: ws.flatMap((w) => w.params) });
const whereSql = (w: Where) => (w.sql.length ? ` WHERE ${w.sql.join(" AND ")}` : "");

// Keyset cursor: the last row's sort value and id, so the next page starts after it.
type Cursor = { v: unknown; id: string };
const encodeCursor = (c: Cursor) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(c)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeCursor(s: string): Cursor {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (c && typeof c.id === "string") return c;
  } catch {}
  throw new QueryError(400, "Bad cursor");
}

// SQLite sorts NULL first ascending and last descending; the keyset condition follows that.
function keysetWhere(e: string, dir: "asc" | "desc", c: Cursor, idExpr: string): Where {
  const gt = dir === "asc" ? ">" : "<";
  if (c.v == null) {
    return dir === "asc"
      ? { sql: [`(${e} IS NOT NULL OR ${idExpr} > ?)`], params: [c.id] }
      : { sql: [`(${e} IS NULL AND ${idExpr} < ?)`], params: [c.id] };
  }
  const tail = dir === "desc" ? ` OR ${e} IS NULL` : "";
  return { sql: [`(${e} ${gt} ? OR (${e} = ? AND ${idExpr} ${gt} ?)${tail})`], params: [c.v, c.v, c.id] };
}

// rowsOnly skips the total, status-tab counts and footer (CSV export pages through with cursors,
// so re-counting per page would multiply D1 queries).
export type ListOptions = ListQuery & { where?: { column: string; value: unknown }; rowsOnly?: boolean };
export type ListOut = ListResult & { footer?: Record<string, number | null> };

function assertRead(def: EntityDef, role: Role) {
  if (!can(role, "read", def.key)) throw new QueryError(403, `You can't view ${def.label.many.toLowerCase()}`);
}

export function getDef(key: string): EntityDef {
  const def = getEntity(key);
  if (!def) throw new QueryError(404, `Unknown entity "${key}"`);
  return def;
}

// Totals, status-tab counts and footers over base data. Base rows only change on a redeploy, so
// when none of the tables a def reads has overlay rows for this visitor, the aggregates for the
// same scope and filters are the same for everyone and are kept for a few minutes per isolate.
type Aggregates = Pick<ListOut, "total" | "counts" | "footer">;
const AGG_TTL_MS = 10 * 60_000;
const AGG_MAX = 500;
const aggCaches = new WeakMap<Db, Map<string, { at: number; v: Aggregates }>>();
const defTables = new WeakMap<EntityDef, string[]>();

// Tables a def's aggregates depend on: its own, plus those its computed fields and scope read.
function tablesRead(def: EntityDef): string[] {
  let t = defTables.get(def);
  if (!t) {
    const sql = [def.scopePath ?? "", ...Object.values(def.fields).map((f) => f.sql ?? "")].join(" ");
    // Reference labels don't enter counts or sums, so only computed SQL and the scope path count.
    t = [...new Set([def.table, ...[...sql.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map((m) => m[1])])];
    defTables.set(def, t);
  }
  return t;
}

function aggKey(def: EntityDef, actor: Actor, ws: Ws, q: ListOptions): string | null {
  if (typeof ws !== "object" || !ws || q.rowsOnly || tablesRead(def).some((t) => ws.overlay.has(t))) return null;
  const who = actor.scope.kind === "self" ? `self:${actor.personaId}` : JSON.stringify(actor.propertyIds);
  return JSON.stringify([def.key, actor.role, who, q.q ?? "", q.filters ?? {}, q.where ?? null]);
}

export async function list(ctx: QueryCtx, entity: EntityKey | string, q: ListOptions = {}): Promise<ListOut> {
  const def = getDef(entity);
  const { db, actor } = ctx;
  const role = actor.role;
  assertRead(def, role);
  const ws = await readWs(ctx);
  const size = Math.max(1, Math.min(PAGE_SIZE_CAP, Math.floor(Number(q.size) || DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const [sortKey, sortDir] = q.sort ?? def.list.defaultSort;
  const dir = sortDir === "asc" ? "asc" : "desc";
  const sf = sortKey === "id" ? null : field(def, sortKey, role);
  if (sf && (sf.sortable === false || sf.type === "json")) throw new QueryError(400, `Can't sort by "${sortKey}"`);
  const sortExpr = sf ? expr(def, sortKey, sf, ws) : `${def.table}.id`;
  const idExpr = `${def.table}.id`;

  const from = ` FROM ${effective(def.table, ws)} AS ${def.table}`;
  const fixed: Where = q.where ? { sql: [`${def.table}.${ident(q.where.column)} = ?`], params: [q.where.value] } : { sql: [], params: [] };
  const scope = scopeWhere(def, actor, ws);
  const search = searchWhere(def, role, ws, q.q);
  const filters = q.filters ?? {};
  const all = merge(fixed, scope, search, filterWhere(def, role, ws, filters));

  let pageWhere = all;
  let offset = (page - 1) * size;
  if (q.cursor) {
    pageWhere = merge(all, keysetWhere(sortExpr, dir, decodeCursor(q.cursor), idExpr));
    offset = 0;
  }
  const rowsSql = `SELECT ${selectList(def, role, ws)}, ${sortExpr} AS __sort${from}${whereSql(pageWhere)} ORDER BY ${sortExpr} ${dir}, ${idExpr} ${dir} LIMIT ? OFFSET ?`;
  const key = aggKey(def, actor, ws, q);
  let aggCache = aggCaches.get(db);
  if (!aggCache) aggCaches.set(db, (aggCache = new Map()));
  const hit = key ? aggCache.get(key) : undefined;
  const cached = hit && performance.now() - hit.at < AGG_TTL_MS ? hit.v : undefined;
  const skipAggs = q.rowsOnly || !!cached;
  const statements: DbStatement[] = [
    db.prepare(rowsSql).bind(...pageWhere.params, size + 1, offset),
    db.prepare(skipAggs ? "SELECT -1 AS n" : `SELECT count(*) AS n${from}${whereSql(all)}`).bind(...(skipAggs ? [] : all.params)),
  ];
  const tabKey = skipAggs ? undefined : def.list.statusTabs;
  if (tabKey && visibleFields(def, role).some(([k]) => k === tabKey)) {
    const tf = def.fields[tabKey];
    const tabWhere = merge(fixed, scope, search, filterWhere(def, role, ws, filters, tabKey));
    statements.push(db.prepare(`SELECT ${expr(def, tabKey, tf, ws)} AS v, count(*) AS n${from}${whereSql(tabWhere)} GROUP BY v`).bind(...tabWhere.params));
  }
  const footer = (skipAggs ? [] : def.list.footer ?? []).filter((a) => a.fn === "count" || visibleFields(def, role).some(([k]) => k === a.field));
  if (footer.length) {
    const aggs = footer.map((a, i) => (a.fn === "count" ? `count(*) AS a${i}` : `${a.fn}(${expr(def, a.field, def.fields[a.field], ws)}) AS a${i}`));
    statements.push(db.prepare(`SELECT ${aggs.join(", ")}${from}${whereSql(all)}`).bind(...all.params));
  }
  const [rowsRes, countRes, ...rest] = await Promise.all(statements.map((s) => s.all()));
  const raw = rowsRes.results;
  const more = raw.length > size;
  const pageRows = raw.slice(0, size);
  const out: ListOut = { rows: pageRows.map((r) => present(def, role, r)), total: Number(countRes.results[0]?.n ?? 0), page: q.cursor ? 0 : page, size };
  const last = pageRows[pageRows.length - 1];
  if (more && last) out.nextCursor = encodeCursor({ v: last.__sort ?? null, id: String(last.id) });
  if (tabKey && rest.length > (footer.length ? 1 : 0)) {
    const counts: Record<string, number> = {};
    for (const r of rest[0].results) counts[String(r.v ?? "")] = Number(r.n);
    out.counts = counts;
  }
  if (footer.length) {
    const r = rest[rest.length - 1].results[0] ?? {};
    out.footer = Object.fromEntries(footer.map((a, i) => {
      const v = r[`a${i}`] == null ? null : Number(r[`a${i}`]);
      const money = a.fn !== "count" && def.fields[a.field]?.type === "money";
      return [`${a.fn}:${a.field}`, v != null && money ? v / 100 : v];
    }));
  }
  if (cached) Object.assign(out, cached);
  else if (key) {
    if (aggCache.size >= AGG_MAX) aggCache.delete(aggCache.keys().next().value!);
    aggCache.set(key, { at: performance.now(), v: { total: out.total, counts: out.counts, footer: out.footer } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One record, with relations
// ---------------------------------------------------------------------------------------------

export async function getRow(ctx: QueryCtx, entity: EntityKey | string, id: string): Promise<Row | null> {
  const def = getDef(entity);
  assertRead(def, ctx.actor.role);
  const ws = await readWs(ctx);
  const scope = scopeWhere(def, ctx.actor, ws);
  const w = merge({ sql: [`${def.table}.id = ?`], params: [id] }, scope);
  const raw = await ctx.db.prepare(`SELECT ${selectList(def, ctx.actor.role, ws)} FROM ${effective(def.table, ws)} AS ${def.table}${whereSql(w)}`).bind(...w.params).first();
  return raw ? present(def, ctx.actor.role, raw) : null;
}

export type Related = Record<string, { entity: EntityKey; label: string; kind: "one" | "many"; rows: Row[]; total: number; href?: string }>;

// Related records for the detail page: "one" relations follow fk on this row; "many" list the
// related entity filtered by fk = this id (first page), or "remote=local" to match another
// column of this row. Relations the role can't read, or to unregistered entities, are left out.
export async function relations(ctx: QueryCtx, def: EntityDef, row: Row, names?: string[], size = 10): Promise<Related> {
  const out: Related = {};
  const raw = await ctx.db.prepare(`SELECT * FROM ${effective(def.table, await readWs(ctx))} WHERE id = ?`).bind(row.id).first();
  await Promise.all(def.relations.filter((r) => !names || names.includes(r.name)).map(async (r) => {
    const rel = getEntity(r.entity);
    if (!rel || !can(ctx.actor.role, "read", r.entity)) return;
    const label = r.label ?? (r.kind === "one" ? rel.label.one : rel.label.many);
    if (r.kind === "one") {
      const fkVal = raw?.[ident(r.fk)];
      const one = fkVal == null ? null : await getRow(ctx, r.entity, String(fkVal));
      out[r.name] = { entity: r.entity, label, kind: "one", rows: one ? [one] : [], total: one ? 1 : 0 };
    } else {
      // fk "remote=local" matches on another column of this row, e.g. "household_id=household_id".
      const [remote, local] = r.fk.split("=", 2);
      const value = local ? raw?.[ident(local)] : row.id;
      if (value == null) return;
      const res = await list(ctx, r.entity, { size, where: { column: remote, value } });
      out[r.name] = { entity: r.entity, label, kind: "many", rows: res.rows, total: res.total };
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Spreadsheet formula injection: a leading = + - @ would run as a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// "Select all matching" on a list: the ids under the same scope, search and filters, in list
// order, up to `cap`. Keyset pages, so it costs one query per 100 ids.
export async function matchingIds(ctx: QueryCtx, entity: string, q: ListQuery, cap = BULK_MATCH_CAP): Promise<{ ids: string[]; capped: boolean }> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await list(ctx, entity, { ...q, size: PAGE_SIZE_CAP, cursor, page: 1, rowsOnly: true });
    ids.push(...res.rows.map((r) => String(r.id)));
    cursor = res.nextCursor;
  } while (cursor && ids.length < cap);
  return { ids: ids.slice(0, cap), capped: ids.length > cap || (ids.length === cap && !!cursor) };
}

// Streams the CSV page by page (keyset cursor), so up to EXPORT_CAP rows never sit in memory.
// Validation errors (unknown filter, no read access) throw before the stream starts.
// Export columns: the list's visible columns (or ?cols=), never images or JSON. Shared with XLSX and PDF.
export function exportColumns(def: EntityDef, role: Role, q: ListQuery): [string, FieldDef][] {
  const cols = visibleFields(def, role).filter(([, f]) => f.type !== "image" && f.type !== "json");
  const keys = q.columns?.length ? cols.filter(([k]) => q.columns!.includes(k)) : cols.filter(([, f]) => f.list?.default);
  return keys.length ? keys : cols;
}

export async function exportCsv(ctx: QueryCtx, entity: string, q: ListQuery): Promise<ReadableStream<Uint8Array>> {
  const def = getDef(entity);
  const use = exportColumns(def, ctx.actor.role, q);
  const line = (r: Row) => [r.id, ...use.map(([k, f]) => (f.type === "ref" ? r[`${k}__label`] ?? r[k] : r[k]))].map(csvCell).join(",") + "\r\n";
  const page = (cursor?: string) => list(ctx, entity, { ...q, size: PAGE_SIZE_CAP, cursor, page: 1, rowsOnly: true });
  const first = await page();
  const enc = new TextEncoder();
  let next = first.nextCursor;
  let n = first.rows.length;
  let pending: string | null = ["ID", ...use.map(([, f]) => f.label)].map(csvCell).join(",") + "\r\n" + first.rows.map(line).join("");
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending != null) {
        controller.enqueue(enc.encode(pending));
        pending = null;
        return;
      }
      if (!next || n >= EXPORT_CAP) return controller.close();
      const res = await page(next);
      n += res.rows.length;
      next = res.nextCursor;
      controller.enqueue(enc.encode(res.rows.map(line).join("")));
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Writes: copy-on-write into the overlay, tombstones for deletes, audit + activity + event in
// the same batch. Base rows are never modified.
// ---------------------------------------------------------------------------------------------

export type WriteCtx = QueryCtx & { ws: string; nowMs: number };

// FieldDef.editable lists the roles that may set a field (create and PATCH). An empty list means
// set once at create (e.g. a unit's property) and never changed through the generic API.
export function editable(role: Role, key: string, f: FieldDef, mode: "create" | "update") {
  if (key === "id" || f.sql || f.type === "image" || f.hiddenFor?.includes(role)) return false;
  if (f.system) return mode === "create" && !!f.initial?.length;
  if (!f.editable) return true;
  return f.editable.length ? f.editable.includes(role) : mode === "create";
}

function fieldZod(f: FieldDef): ZodType {
  if (f.zod) return f.zod;
  switch (f.type) {
    case "number": return z.number().finite();
    case "money": return z.number().finite().min(-1e9).max(1e9);
    case "date": return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
    case "datetime": return z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "Not a date and time");
    case "enum": return f.enum?.length ? z.enum(f.enum.map((e) => e.value) as [string, ...string[]]) : z.string().max(80);
    case "bool": return z.boolean();
    case "ref": return z.string().min(1).max(80);
    case "json": return z.unknown().refine((v) => JSON.stringify(v ?? null).length <= 8000, "Too large");
    default: return z.string().trim().max(2000);
  }
}

// Body schema for POST (mode "create") or PATCH ("update") from the def's fields and the role.
export function writeSchema(def: EntityDef, role: Role, mode: "create" | "update") {
  const shape: Record<string, ZodType> = {};
  for (const [key, f] of Object.entries(def.fields)) {
    if (!editable(role, key, f, mode)) continue;
    // A system field on create takes only its initial values (and defaults to the first).
    if (f.system) {
      shape[key] = z.enum(f.initial as [string, ...string[]]).optional();
      continue;
    }
    const base = fieldZod(f);
    shape[key] = mode === "create" && f.required ? base : base.nullable().optional();
  }
  return z.strictObject(shape);
}

// A fresh id: the def's idFormat when it has one (never one already used in base or this
// workspace, so an overlay row can't shadow a base record), else "<key>-<random>".
async function newId(ctx: WriteCtx, def: EntityDef): Promise<string> {
  const f = def.idFormat;
  if (f) {
    const lo = 10 ** (f.digits - 1), span = 9 * lo;
    for (let i = 0; i < 12; i++) {
      const id = `${f.prefix}-${lo + (crypto.getRandomValues(new Uint32Array(1))[0] % span)}`;
      const taken = await ctx.db.prepare(`SELECT 1 FROM ${ident(def.table)} WHERE workspace_id IN ('base', ?) AND id = ? LIMIT 1`).bind(ctx.ws, id).first();
      if (!taken) return id;
    }
  }
  return `${def.key.slice(0, 3)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function rawRow(db: Db, table: string, ws: string, id: string) {
  return db.prepare(`SELECT * FROM ${effective(table, ws)} WHERE id = ?`).bind(id).first<Row>();
}

// Same rule as writeSchema, for callers that pass a body without the HTTP schema (AI tools,
// module code): system fields only take their initial values on create, never on edit.
function assertSystem(def: EntityDef, body: Record<string, unknown>, mode: "create" | "update") {
  for (const [key, v] of Object.entries(body)) {
    const f = def.fields[key];
    if (!f) throw new QueryError(400, `Unknown field "${key}" on ${def.key}`);
    if (!f.system || v === undefined) continue;
    if (mode === "update" || !f.initial?.includes(String(v))) throw new QueryError(400, `${f.label} changes only through its actions`);
  }
}

// EntityDef.lockedWhen: past approval (Approved, Paid…) generic edits stop; actions take over.
function assertUnlocked(def: EntityDef, current: Row, changed?: string[]) {
  const lock = def.lockedWhen;
  if (!lock || !lock.in.includes(String(current[lock.field]))) return;
  if (changed && lock.fields && !changed.some((k) => lock.fields!.includes(k))) return;
  throw new QueryError(409, `This ${def.label.one.toLowerCase()} is ${String(current[lock.field])}; change it through its actions`);
}

// Initial values for system fields a create didn't set.
const systemDefaults = (def: EntityDef) =>
  Object.fromEntries(Object.entries(def.fields).filter(([, f]) => f.system && f.initial?.length && !f.sql).map(([k, f]) => [ident(f.column ?? k), f.initial![0]]));

function changesToColumns(def: EntityDef, body: Record<string, unknown>) {
  const cols: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(body)) {
    if (v === undefined) continue;
    const f = def.fields[key];
    cols[ident(f.column ?? key)] = inValue(f, v);
  }
  return cols;
}

function upsert(db: Db, table: string, row: Row) {
  const cols = Object.keys(row).filter((c) => c !== "seq").map(ident);
  const sets = cols.filter((c) => c !== "workspace_id" && c !== "id").map((c) => `${c} = excluded.${c}`);
  return db.prepare(`INSERT INTO ${ident(table)} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (workspace_id, id) DO UPDATE SET ${sets.join(", ")}`).bind(...cols.map((c) => row[c]));
}

function trail(ctx: WriteCtx, def: EntityDef, id: string, verb: "created" | "updated" | "deleted", propertyId: unknown, before: Row | null, after: Row | null, summary: string) {
  const at = demoNowIso(ctx.nowMs);
  const rid = () => crypto.randomUUID();
  const { db, ws, actor } = ctx;
  const pid = propertyId == null ? null : String(propertyId);
  return [
    db.prepare("INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, action, entity_type, entity_id, property_id, detail, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ws, rid(), at, actor.name, actor.personaId, actor.role, `${def.key}.${verb}`, def.key, id, pid, summary, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null),
    db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?)")
      .bind(ws, rid(), def.key, id, pid, at, actor.personaId, verb, summary, JSON.stringify({ actor: actor.name, changes: after && before ? diffKeys(before, after) : undefined })),
    ...[`${def.key}.${verb}`, def.events?.[verb]].filter((t): t is string => !!t).map((type) =>
      db.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(ws, rid(), type, def.key, id, pid, JSON.stringify({ by: actor.personaId }), at)),
  ];
}

const diffKeys = (a: Row, b: Row) => Object.keys(b).filter((k) => k !== "seq" && k !== "workspace_id" && a[k] !== b[k]);

// The row's property for the audit trail, when it carries one directly.
const pidOf = (def: EntityDef, row: Row) => (def.scopePath && "property_id" in row && row.property_id != null ? String(row.property_id) : null);

async function propertyOf(ctx: QueryCtx, def: EntityDef, id: string) {
  if (!def.scopePath) return null;
  const r = await ctx.db.prepare(`SELECT (${expand(def.scopePath, ctx.ws)}) AS p FROM ${effective(def.table, ctx.ws)} AS ${def.table} WHERE ${def.table}.id = ?`).bind(id).first<{ p: unknown }>();
  return r?.p ?? null;
}

// A statement that fails the whole write batch unless the written row is readable under the
// actor's scope (properties and portal "self"). D1 and SQLite batches are transactions, so an
// out-of-scope create or edit writes nothing: the NOT NULL violation on meta.value aborts it.
const SCOPE_GUARD = "__scope_guard__";
function scopeGuard(ctx: QueryCtx, def: EntityDef, id: string): DbStatement {
  const w = merge({ sql: [`${def.table}.id = ?`], params: [id] }, scopeWhere(def, ctx.actor, ctx.ws));
  return ctx.db.prepare(`INSERT INTO meta (key, value) SELECT '${SCOPE_GUARD}', NULL WHERE NOT EXISTS (SELECT 1 FROM ${effective(def.table, ctx.ws)} AS ${def.table}${whereSql(w)})`).bind(...w.params);
}
const outOfScope = (e: unknown) => /meta\.value/.test(String((e as Error)?.message ?? e));

// Every reference set by a write must point at a record the actor can see under its scope, so a
// record in scope can't be linked to (and show the name of) one at another property.
async function assertRefs(ctx: QueryCtx, def: EntityDef, body: Record<string, unknown>) {
  for (const [key, v] of Object.entries(body)) {
    const f = def.fields[key];
    if (f?.type !== "ref" || !f.ref || v == null || v === "") continue;
    const ref = getEntity(f.ref);
    const table = ref?.table ?? f.ref;
    const scope = ref ? scopeWhere(ref, ctx.actor, ctx.ws) : { sql: [], params: [] };
    const w = merge({ sql: [`${table}.id = ?`], params: [String(v)] }, scope);
    const hit = await ctx.db.prepare(`SELECT 1 AS ok FROM ${effective(table, ctx.ws)} AS ${table}${whereSql(w)} LIMIT 1`).bind(...w.params).first();
    if (!hit) throw new QueryError(400, `${f.label}: no such record in your scope`);
  }
}

function assertWrite(def: EntityDef, role: Role, op: "create" | "update" | "delete") {
  if (def.writes !== "generic") throw new QueryError(405, `${def.label.many} change only through named actions`);
  if (!can(role, op, def.key)) throw new QueryError(403, `You can't ${op} ${def.label.many.toLowerCase()}`);
}

const constraintError = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/NOT NULL constraint failed: \w+\.(\w+)/.test(m)) return new QueryError(400, `Missing required value: ${m.match(/\.(\w+)/)![1]}`);
  if (/UNIQUE|CHECK constraint/.test(m)) return new QueryError(409, "That conflicts with an existing record");
  return e;
};

export async function createRecord(ctx: WriteCtx, entity: string, body: Record<string, unknown>): Promise<Row> {
  const def = getDef(entity);
  assertWrite(def, ctx.actor.role, "create");
  assertSystem(def, body, "create");
  await assertRefs(ctx, def, body);
  const id = await newId(ctx, def);
  const row: Row = { workspace_id: ctx.ws, id, ...systemDefaults(def), ...changesToColumns(def, body) };
  try {
    await ctx.db.batch([upsert(ctx.db, def.table, row), scopeGuard(ctx, def, id), ...trail(ctx, def, id, "created", pidOf(def, row), null, row, `Created ${def.label.one.toLowerCase()}`)]);
    forgetOverlay(ctx.actor);
    forgetInboxCounts(ctx.ws);
  } catch (e) {
    if (outOfScope(e)) throw new QueryError(403, "That record would be outside your scope");
    throw constraintError(e);
  }
  return (await getRow(ctx, entity, id))!;
}

export async function updateRecord(ctx: WriteCtx, entity: string, id: string, body: Record<string, unknown>): Promise<Row> {
  const def = getDef(entity);
  assertWrite(def, ctx.actor.role, "update");
  const current = await getRow(ctx, entity, id);
  if (!current) throw new QueryError(404, `${def.label.one} not found`);
  assertSystem(def, body, "update");
  assertUnlocked(def, current, Object.keys(body).filter((k) => body[k] !== undefined));
  await assertRefs(ctx, def, body);
  const before = (await rawRow(ctx.db, def.table, ctx.ws, id))!;
  // Taking a vendor with open emergency or life-safety jobs off work is a life-safety call.
  if (def.key === "vendors" && VENDOR_OFF.includes(String(body.status)) && !VENDOR_OFF.includes(String(before.status))) await assertNoSafetyJobs(ctx, id, "change the status");
  const changes = changesToColumns(def, body);
  if (!Object.keys(changes).length) throw new QueryError(400, "Nothing to change");
  const after: Row = { ...before, ...changes, workspace_id: ctx.ws, deleted: 0 };
  const changed = diffKeys(before, after).filter((k) => k in changes);
  const summary = `Updated ${changed.map((c) => Object.entries(def.fields).find(([k, f]) => (f.column ?? k) === c)?.[1].label ?? c).join(", ") || "nothing"}`;
  const fresh = unchangedSince(ctx, def, id, before, Object.keys(changes), Object.keys(body).filter((k) => body[k] !== undefined));
  try {
    await ctx.db.batch([fresh.guard, writeColumns(ctx, def, id, before, changes), scopeGuard(ctx, def, id), ...trail(ctx, def, id, "updated", pidOf(def, after) ?? (await propertyOf(ctx, def, id)), pick(before, changed), pick(after, changed), summary)]);
    forgetOverlay(ctx.actor);
    forgetInboxCounts(ctx.ws);
  } catch (e) {
    if (outOfScope(e)) {
      if (!(await fresh.check.first())) throw new QueryError(409, `This ${def.label.one.toLowerCase()} changed while you were editing it. Reload and try again.`);
      throw new QueryError(403, "That change would move the record outside your scope");
    }
    throw constraintError(e);
  }
  return (await getRow(ctx, entity, id))!;
}

// Copy-on-write of the changed columns only: the other columns come from the row as it is when the
// batch runs, so an edit never puts back values another request changed after this one read them.
function writeColumns(ctx: WriteCtx, def: EntityDef, id: string, before: Row, changes: Record<string, unknown>) {
  const cols = Object.keys(before).filter((c) => c !== "seq" && c !== "workspace_id").map(ident);
  const keys = Object.keys(changes);
  const set = Object.fromEntries(keys.map((k, i) => [ident(k), `?${i + 3}`]));
  return ctx.db.prepare(overlayUpsertSql(def.table, cols, { ...set, deleted: "0" })).bind(ctx.ws, id, ...keys.map((k) => changes[k]));
}

// Fails the write batch (like scopeGuard) unless the row still has the values this edit read in the
// columns it changes, and isn't now in a lockedWhen state that covers the edit. `check` is the same
// condition as a read, so a refused batch can say "changed" rather than "out of scope".
function unchangedSince(ctx: WriteCtx, def: EntityDef, id: string, before: Row, columns: string[], fields: string[]) {
  const sql = [`e.id = ?`, ...columns.map((c) => `e.${ident(c)} IS ?`)];
  const params: unknown[] = [id, ...columns.map((c) => before[c] ?? null)];
  const lock = def.lockedWhen;
  if (lock && (!lock.fields || fields.some((k) => lock.fields!.includes(k)))) {
    sql.push(`coalesce(e.${ident(def.fields[lock.field]?.column ?? lock.field)}, '') NOT IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(lock.in));
  }
  const cond = `EXISTS (SELECT 1 FROM ${effective(def.table, ctx.ws)} AS e WHERE ${sql.join(" AND ")})`;
  return {
    guard: ctx.db.prepare(`INSERT INTO meta (key, value) SELECT '${SCOPE_GUARD}', NULL WHERE NOT ${cond}`).bind(...params),
    check: ctx.db.prepare(`SELECT 1 AS ok WHERE ${cond}`).bind(...params),
  };
}

const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k]]));

// Deleting or deactivating a vendor that still has open emergency or life-safety jobs is for the
// principal or a regional manager (src/ai/life-safety.ts).
async function assertNoSafetyJobs(ctx: WriteCtx, vendorId: string, what: string) {
  if (LIFE_SAFETY_ROLES.includes(ctx.actor.role)) return;
  const n = await safetyJobs(ctx.db, ctx.ws, [vendorId]);
  if (n) throw new QueryError(403, `This vendor has ${n} open emergency or life-safety work order${n === 1 ? "" : "s"}. Reassign ${n === 1 ? "it" : "them"} first, or ask the principal or a regional manager to ${what}.`);
}

export async function deleteRecord(ctx: WriteCtx, entity: string, id: string): Promise<void> {
  const def = getDef(entity);
  assertWrite(def, ctx.actor.role, "delete");
  const current = await getRow(ctx, entity, id);
  if (!current) throw new QueryError(404, `${def.label.one} not found`);
  assertUnlocked(def, current);
  const before = (await rawRow(ctx.db, def.table, ctx.ws, id))!;
  if (def.key === "vendors") await assertNoSafetyJobs(ctx, id, "delete it");
  const pid = await propertyOf(ctx, def, id);
  forgetOverlay(ctx.actor);
  await ctx.db.batch([upsert(ctx.db, def.table, { ...before, workspace_id: ctx.ws, deleted: 1 }), ...trail(ctx, def, id, "deleted", pid, before, null, `Deleted ${def.label.one.toLowerCase()} ${String(before[def.fields[def.titleField]?.column ?? def.titleField] ?? id)}`)]);
  forgetInboxCounts(ctx.ws);
}

// ---------------------------------------------------------------------------------------------
// Notes, tasks, activity and documents on any record (capabilities)
// ---------------------------------------------------------------------------------------------

export type Collab = "notes" | "tasks" | "activity" | "documents";
const COLLAB_ORDER: Record<Collab, string> = { notes: "pinned DESC, created_at DESC", tasks: "CASE status WHEN 'Done' THEN 1 WHEN 'Cancelled' THEN 2 ELSE 0 END, due_on IS NULL, due_on", activity: "at DESC", documents: "uploaded_at DESC" };
const COLLAB_TABLE: Record<Collab, string> = { notes: "notes", tasks: "tasks", activity: "activity_events", documents: "documents" };

// Notes, tasks and the activity trail are staff working material, even on a portal user's own
// records (a collections note on a resident's charge). Nothing marks one as shared with a portal, so
// portal users (scope "self") can neither read nor add them. Documents stay readable.
function assertStaffCollab(actor: Actor, kind: Collab) {
  if (actor.scope.kind === "self" && kind !== "documents") throw new QueryError(403, `Only staff can see or add ${kind}`);
}

export async function collab(ctx: QueryCtx, kind: Collab, entity: string, id: string, page = 1, size = 50): Promise<ListResult> {
  const def = getDef(entity);
  if (!(await getRow(ctx, entity, id))) throw new QueryError(404, `${def.label.one} not found`);
  const s = Math.max(1, Math.min(PAGE_SIZE_CAP, size));
  const p = Math.max(1, page);
  assertStaffCollab(ctx.actor, kind);
  const rws = await readWs(ctx);
  const from = ` FROM ${effective(COLLAB_TABLE[kind], rws)} WHERE entity_type = ? AND entity_id = ?`;
  const [rows, count] = await Promise.all([
    ctx.db.prepare(`SELECT *${from} ORDER BY ${COLLAB_ORDER[kind]} LIMIT ? OFFSET ?`).bind(def.key, id, s, (p - 1) * s).all(),
    ctx.db.prepare(`SELECT count(*) AS n${from}`).bind(def.key, id).first<{ n: number }>(),
  ]);
  let out = rows.results.map((r) => {
    const row: Row = { ...r };
    delete row.seq;
    delete row.workspace_id;
    delete row.deleted;
    return row;
  });
  // The audit trail is part of a record's activity: field-level before/after on every change.
  if (kind === "activity" && p === 1) {
    const audit = await ctx.db.prepare(`SELECT id, at, actor, role, agent, model, action, detail, before_json, after_json FROM ${effective("audit", rws)} WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC LIMIT 50`).bind(def.key, id).all();
    const seen = new Set(out.map((r) => `${r.at}|${r.summary}`));
    // Audit rows hold raw columns: drop the ones this role can't see (e.g. vendor bank details).
    const hidden = new Set(Object.entries(def.fields).filter(([, f]) => f.hiddenFor?.includes(ctx.actor.role)).map(([k, f]) => f.column ?? k));
    const visible = (j: unknown) => {
      if (j == null) return null;
      try {
        const o = JSON.parse(String(j)) as Row;
        for (const k of hidden) delete o[k];
        return o;
      } catch {
        return null;
      }
    };
    out = [...out, ...audit.results.filter((a) => !seen.has(`${a.at}|${a.detail}`)).map((a) => ({ id: a.id, at: a.at, actor_kind: a.agent ? "agent" : "staff", actor_id: a.actor, verb: a.action, summary: a.detail, data: JSON.stringify({ actor: a.actor, role: a.role, agent: a.agent, model: a.model, before: visible(a.before_json), after: visible(a.after_json) }) }))]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  return { rows: out, total: Number(count?.n ?? 0), page: p, size: s };
}

export const noteSchema = z.strictObject({ body: z.string().trim().min(1).max(4000), parent_id: z.string().max(80).optional(), pinned: z.boolean().optional() });
export const taskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(2000).optional(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(["High", "Normal", "Low"]).optional(),
  assignee_id: z.string().max(80).optional(),
});

// Notes and tasks are collaboration, not record edits: anyone who can read the record may add them.
export async function addCollab(ctx: WriteCtx, kind: "notes" | "tasks", entity: string, id: string, body: z.infer<typeof noteSchema> | z.infer<typeof taskSchema>): Promise<Row> {
  const def = getDef(entity);
  assertStaffCollab(ctx.actor, kind);
  if (!(await getRow(ctx, entity, id))) throw new QueryError(404, `${def.label.one} not found`);
  const at = demoNowIso(ctx.nowMs);
  const pid = await propertyOf(ctx, def, id);
  const assignee = kind === "tasks" ? (body as z.infer<typeof taskSchema>).assignee_id : undefined;
  if (assignee && !(await staffCovers(ctx, assignee, pid == null ? null : String(pid)))) throw new QueryError(400, "Assign the task to an active staff member who works on this record's property");
  const rid = crypto.randomUUID();
  const { db, ws, actor } = ctx;
  let insert: DbStatement;
  let summary: string;
  if (kind === "notes") {
    const b = body as z.infer<typeof noteSchema>;
    const mentions = [...b.body.matchAll(/@\[[^\]]{1,80}\]\(staff:([\w-]{1,40})\)/g)].map((m) => m[1]);
    insert = db.prepare("INSERT INTO notes (workspace_id, id, entity_type, entity_id, parent_id, author_id, body, mentions, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ws, rid, def.key, id, b.parent_id ?? null, actor.personaId, b.body, JSON.stringify(mentions), b.pinned ? 1 : 0, at);
    summary = `${actor.name} added a note`;
  } else {
    const b = body as z.infer<typeof taskSchema>;
    insert = db.prepare("INSERT INTO tasks (workspace_id, id, title, detail, entity_type, entity_id, property_id, assignee_id, created_by, due_on, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ws, rid, b.title, b.detail ?? "", def.key, id, pid == null ? null : String(pid), b.assignee_id ?? null, actor.personaId, b.due_on ?? null, b.priority ?? "Normal", "Open", at);
    summary = `${actor.name} added task "${b.title}"`;
  }
  forgetOverlay(ctx.actor);
  await db.batch([
    insert,
    db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, '{}')")
      .bind(ws, crypto.randomUUID(), def.key, id, pid == null ? null : String(pid), at, actor.personaId, kind === "notes" ? "commented" : "task_added", summary),
  ]);
  const row = await db.prepare(`SELECT * FROM ${kind} WHERE workspace_id = ? AND id = ?`).bind(ws, rid).first<Row>();
  return row!;
}

// An active staff member whose role assignment covers the property (org-wide, its region or the
// property itself); for a record with no property, any active staff member.
async function staffCovers(ctx: QueryCtx, staffId: string, propertyId: string | null) {
  const covers = `EXISTS (SELECT 1 FROM ${effective("role_assignments", ctx.ws)} AS ra WHERE ra.staff_id = s.id AND (ra.scope_kind = 'org' OR (ra.scope_kind = 'property' AND ra.scope_id = ?2)
    OR (ra.scope_kind = 'region' AND ra.scope_id = (SELECT p.region_id FROM ${effective("properties", ctx.ws)} AS p WHERE p.id = ?2))))`;
  return !!(await ctx.db.prepare(`SELECT 1 AS ok FROM ${effective("staff", ctx.ws)} AS s WHERE s.id = ?1 AND s.active = 1 AND (?2 IS NULL OR ${covers})`).bind(staffId, propertyId).first());
}

// ---------------------------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------------------------

export const viewSchema = z.strictObject({
  entity: z.string().max(40),
  name: z.string().trim().min(1).max(80),
  shared: z.boolean().optional(),
  state: z.strictObject({
    q: z.string().max(200).optional(),
    filters: z.record(z.string().max(80), z.union([z.string().max(200), z.array(z.string().max(200)).max(50)])).optional(),
    sort: z.tuple([z.string().max(80), z.enum(["asc", "desc"])]).optional(),
    columns: z.array(z.string().max(80)).max(60).optional(),
  }),
});

export async function listViews(ctx: QueryCtx, entity: string) {
  const def = getDef(entity);
  assertRead(def, ctx.actor.role);
  const res = await ctx.db.prepare(`SELECT id, name, owner_id, state, position FROM ${effective("saved_views", await readWs(ctx))} WHERE entity_type = ? AND (owner_id IS NULL OR owner_id = ?) ORDER BY position, name LIMIT 100`).bind(def.key, ctx.actor.personaId).all();
  // Built-in views come from the def (EntityDef.list.savedViews); these are the stored ones.
  return res.results.map((r) => ({ key: String(r.id), label: String(r.name), shared: r.owner_id == null, mine: r.owner_id === ctx.actor.personaId, ...JSON.parse(String(r.state)) }));
}

export async function saveView(ctx: WriteCtx, body: z.infer<typeof viewSchema>) {
  const def = getDef(body.entity);
  assertRead(def, ctx.actor.role);
  // Fail fast on a view that names fields the entity doesn't have.
  for (const k of Object.keys(body.state.filters ?? {})) field(def, k.split(".")[0], ctx.actor.role);
  if (body.state.sort) field(def, body.state.sort[0], ctx.actor.role);
  const id = `view-${crypto.randomUUID().slice(0, 12)}`;
  await ctx.db.prepare("INSERT INTO saved_views (workspace_id, id, entity_type, name, owner_id, state, position) VALUES (?, ?, ?, ?, ?, ?, 100)")
    .bind(ctx.ws, id, def.key, body.name, body.shared ? null : ctx.actor.personaId, JSON.stringify(body.state)).run();
  forgetOverlay(ctx.actor);
  return { key: id, label: body.name, shared: !!body.shared, mine: !body.shared, ...body.state };
}

export async function deleteView(ctx: WriteCtx, id: string) {
  const v = await rawRow(ctx.db, "saved_views", ctx.ws, id);
  if (!v) throw new QueryError(404, "View not found");
  if (v.owner_id != null && v.owner_id !== ctx.actor.personaId) throw new QueryError(403, "That view belongs to someone else");
  await upsert(ctx.db, "saved_views", { ...v, workspace_id: ctx.ws, deleted: 1 }).run();
  forgetOverlay(ctx.actor);
}

// ---------------------------------------------------------------------------------------------
// URL ⇄ ListQuery (pages and the API share one encoding)
// ---------------------------------------------------------------------------------------------

// A built-in view key in the URL (?view=expiring-60, used by persona quick links) applies that
// view's state when the URL doesn't already carry filters of its own.
export function withView(def: EntityDef, sp: URLSearchParams): URLSearchParams {
  const key = sp.get("view");
  const v = key && def.list.savedViews?.find((x) => x.key === key);
  if (!v || [...sp.keys()].some((k) => k.startsWith("f.") || k === "q" || k === "sort")) return sp;
  const out = new URLSearchParams(sp);
  if (v.q) out.set("q", v.q);
  for (const [k, val] of Object.entries(v.filters ?? {})) out.set(`f.${k}`, Array.isArray(val) ? val.join(",") : val);
  if (v.sort) out.set("sort", v.sort[1] === "desc" ? `-${v.sort[0]}` : v.sort[0]);
  return out;
}

export function parseListQuery(sp: URLSearchParams): ListQuery {
  const filters: Record<string, string | string[]> = {};
  for (const [k, v] of sp) {
    if (!k.startsWith("f.")) continue;
    const key = k.slice(2);
    const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
    const prev = filters[key];
    const all = [...(prev ? (Array.isArray(prev) ? prev : [prev]) : []), ...parts];
    filters[key] = all.length === 1 ? all[0] : all;
  }
  const sortRaw = sp.get("sort");
  let sort: ListQuery["sort"];
  if (sortRaw) {
    const desc = sortRaw.startsWith("-");
    sort = [desc ? sortRaw.slice(1) : sortRaw, desc ? "desc" : "asc"];
  }
  const cols = sp.get("cols");
  return {
    q: sp.get("q") ?? undefined,
    filters,
    sort,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    size: sp.get("size") ? Number(sp.get("size")) : undefined,
    cursor: sp.get("cursor") ?? undefined,
    columns: cols ? cols.split(",").filter(Boolean) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Metrics (KPIs and charts)
// ---------------------------------------------------------------------------------------------

// The demo's "current month": meta.as_of from the generator, else the latest precomputed month.
export async function asOfMonth(db: Db): Promise<string> {
  const meta = await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>();
  if (meta?.value) return meta.value.slice(0, 7);
  const m = await db.prepare("SELECT max(month) AS m FROM metrics_monthly WHERE workspace_id = 'base'").first<{ m: string | null }>();
  return m?.m ?? AS_OF.slice(0, 7);
}

export async function metrics(ctx: QueryCtx, key: string, params: MetricParams = {}): Promise<MetricResult> {
  const m = getMetric(key);
  if (!m) throw new QueryError(404, `Unknown metric "${key}"`);
  // Metrics are portfolio figures: staff and owners see them by default; residents, vendors and
  // applicants only when the metric names their role (their scope is per row, not per property).
  const portal = ctx.actor.role === "resident" || ctx.actor.role === "vendor" || ctx.actor.role === "applicant";
  if (m.roles ? !m.roles.includes(ctx.actor.role) : portal) throw new QueryError(403, "You can't view this metric");
  if (params.property && ctx.actor.propertyIds !== "all" && !ctx.actor.propertyIds.includes(params.property)) throw new QueryError(403, "That property is outside your scope");
  if (params.month && !/^\d{4}-\d{2}$/.test(params.month)) throw new QueryError(400, "month must be YYYY-MM");
  // A row-scoped portal user ("self" with no property list) never gets portfolio-wide figures.
  const propertyIds = ctx.actor.scope.kind === "self" && ctx.actor.propertyIds === "all" ? [] : ctx.actor.propertyIds;
  return m.run({ db: ctx.db, ws: ctx.ws, actor: ctx.actor, propertyIds, asOf: await asOfMonth(ctx.db) }, params);
}

// ---------------------------------------------------------------------------------------------
// Facet options with counts (filter chips): for each facet field, its values under every other
// active filter, the search and the scope. Enum facets keep the def's order.
// ---------------------------------------------------------------------------------------------

export type FacetOptions = Record<string, { value: string; label?: string; count: number }[]>;
const FACET_LIMIT = 60;

export async function facetOptions(ctx: QueryCtx, entity: string, q: ListQuery = {}): Promise<FacetOptions> {
  const def = getDef(entity);
  const { actor } = ctx;
  assertRead(def, actor.role);
  const ws = await readWs(ctx);
  const keys = visibleFields(def, actor.role).filter(([k, f]) => f.facet && ["enum", "ref", "text", "bool"].includes(f.type) && k !== def.list.statusTabs);
  const from = ` FROM ${effective(def.table, ws)} AS ${def.table}`;
  const scope = scopeWhere(def, actor, ws);
  const search = searchWhere(def, actor.role, ws, q.q);
  const out: FacetOptions = {};
  await Promise.all(keys.map(async ([key, f]) => {
    const w = merge(scope, search, filterWhere(def, actor.role, ws, q.filters ?? {}, key));
    const label = f.type === "ref" ? refLabel(def, key, f, ws) : null;
    const res = await ctx.db.prepare(`SELECT ${expr(def, key, f, ws)} AS v${label ? `, ${label} AS l` : ""}, count(*) AS n${from}${whereSql(w)} GROUP BY v ORDER BY n DESC LIMIT ${FACET_LIMIT}`).bind(...w.params).all();
    let opts = res.results.filter((r) => r.v != null && r.v !== "").map((r) => ({ value: f.type === "bool" ? (r.v ? "true" : "false") : String(r.v), label: f.type === "bool" ? (r.v ? "Yes" : "No") : r.l != null ? String(r.l) : f.enum?.find((e) => e.value === String(r.v))?.label, count: Number(r.n) }));
    if (f.enum) opts = f.enum.map((e) => opts.find((o) => o.value === e.value) ?? { value: e.value, label: e.label, count: 0 });
    else if (f.type === "ref" || f.type === "text") opts.sort((a, b) => (a.label ?? a.value).localeCompare(b.label ?? b.value));
    out[key] = opts;
  }));
  return out;
}
