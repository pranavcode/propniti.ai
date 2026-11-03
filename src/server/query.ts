import "server-only";
import { z, type ZodType } from "zod";
import { can, getEntity } from "@/entities";
import { getPersona } from "@/auth/personas";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Actor, type EntityDef, type EntityKey, type FieldDef, type ListQuery, type ListResult, type Role, type Row } from "@/entities/types";
import type { Db, DbStatement } from "@/lib/platform/types";
import { getMetric, type MetricParams, type MetricResult } from "@/extensions/metrics";

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
const EXPORT_CAP = 10_000;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const WS_ID = /^[A-Za-z0-9_-]{22,64}$/;
// Append-only tables have no tombstone column.
const APPEND_ONLY = new Set(["transfers", "audit"]);

function ident(name: string) {
  if (!IDENT.test(name)) throw new Error(`Bad identifier: ${name}`);
  return name;
}

// The workspace id is inlined so def SQL can reference {table} anywhere without threading
// parameters; it is safe because it must match the cookie regex (or be the read-only base).
function wsLiteral(ws: string | null) {
  return ws && WS_ID.test(ws) ? `'${ws}'` : null;
}

// Effective rows of a table for a workspace, as a parenthesised subquery.
export function effective(table: string, ws: string | null): string {
  const t = ident(table);
  const w = wsLiteral(ws);
  if (APPEND_ONLY.has(t)) return `(SELECT * FROM ${t} WHERE workspace_id IN (${w ?? "'base'"}${w ? ", 'base'" : ""}))`;
  if (!w) return `(SELECT * FROM ${t} WHERE workspace_id = 'base' AND deleted = 0)`;
  return `(SELECT * FROM ${t} WHERE deleted = 0 AND (workspace_id = ${w} OR (workspace_id = 'base' AND id NOT IN (SELECT id FROM ${t} WHERE workspace_id = ${w}))))`;
}

// Def SQL may name another table as {table}; it expands to that table's effective rows.
export function expand(sql: string, ws: string | null) {
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

function expr(def: EntityDef, key: string, f: FieldDef, ws: string | null) {
  return f.sql ? `(${expand(f.sql, ws)})` : `${def.table}.${ident(f.column ?? key)}`;
}

// Label of a referenced record: its def's titleField (computed or a column).
function refLabel(def: EntityDef, key: string, f: FieldDef, ws: string | null) {
  const ref = f.ref && getEntity(f.ref);
  if (!ref) return null;
  const tf = ref.fields[ref.titleField];
  const title = tf?.sql ? `(${expand(tf.sql, ws)})` : `${ref.table}.${ident(tf?.column ?? ref.titleField)}`;
  return `(SELECT ${title} FROM ${effective(ref.table, ws)} AS ${ref.table} WHERE ${ref.table}.id = ${expr(def, key, f, ws)})`;
}

function selectList(def: EntityDef, role: Role, ws: string | null) {
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

// Portal users (scope "self") see only rows tied to their own record.
function selfClause(def: EntityDef, actor: Actor, ws: string | null): { sql: string; params: unknown[] } | null {
  const rec = getPersona(actor.personaId)?.record;
  if (!rec) return { sql: "0", params: [] };
  if (def.key === rec.entity) return { sql: `${def.table}.id = ?`, params: [rec.id] };
  const has = (col: string) => Object.entries(def.fields).some(([k, f]) => (f.column ?? k) === col && !f.sql);
  if (rec.entity === "residents" && has("household_id")) return { sql: `${def.table}.household_id = (SELECT household_id FROM ${effective("residents", ws)} WHERE id = ?)`, params: [rec.id] };
  if (rec.entity === "vendors" && has("vendor_id")) return { sql: `${def.table}.vendor_id = ?`, params: [rec.id] };
  if (rec.entity === "applicants" && has("applicant_id")) return { sql: `${def.table}.applicant_id = ?`, params: [rec.id] };
  if (rec.entity === "owners" && has("owner_id")) return { sql: `${def.table}.owner_id = ?`, params: [rec.id] };
  // Owners also see everything on the properties their entities hold (property scope below).
  if (rec.entity === "owners" && def.scopePath) return null;
  return { sql: "0", params: [] };
}

function scopeWhere(def: EntityDef, actor: Actor, ws: string | null): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (actor.scope.kind === "self") {
    const s = selfClause(def, actor, ws);
    if (s) {
      sql.push(s.sql);
      params.push(...s.params);
    }
  }
  if (actor.propertyIds !== "all" && def.scopePath) {
    sql.push(`(${expand(def.scopePath, ws)}) IN (SELECT value FROM json_each(?))`);
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
function filterWhere(def: EntityDef, role: Role, ws: string | null, filters: Record<string, string | string[]>, skip?: string): Where {
  const w: Where = { sql: [], params: [] };
  for (const [rawKey, rawVal] of Object.entries(filters)) {
    const [key, op] = rawKey.split(".", 2) as [string, string | undefined];
    if (key === skip) continue;
    const f = field(def, key, role);
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

function searchWhere(def: EntityDef, role: Role, ws: string | null, q: string | undefined): Where {
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

export type ListOptions = ListQuery & { where?: { column: string; value: unknown } };
export type ListOut = ListResult & { footer?: Record<string, number | null> };

function assertRead(def: EntityDef, role: Role) {
  if (!can(role, "read", def.key)) throw new QueryError(403, `You can't view ${def.label.many.toLowerCase()}`);
}

export function getDef(key: string): EntityDef {
  const def = getEntity(key);
  if (!def) throw new QueryError(404, `Unknown entity "${key}"`);
  return def;
}

export async function list(ctx: QueryCtx, entity: EntityKey | string, q: ListOptions = {}): Promise<ListOut> {
  const def = getDef(entity);
  const { db, ws, actor } = ctx;
  const role = actor.role;
  assertRead(def, role);
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
  const statements: DbStatement[] = [
    db.prepare(rowsSql).bind(...pageWhere.params, size + 1, offset),
    db.prepare(`SELECT count(*) AS n${from}${whereSql(all)}`).bind(...all.params),
  ];
  const tabKey = def.list.statusTabs;
  if (tabKey && visibleFields(def, role).some(([k]) => k === tabKey)) {
    const tf = def.fields[tabKey];
    const tabWhere = merge(fixed, scope, search, filterWhere(def, role, ws, filters, tabKey));
    statements.push(db.prepare(`SELECT ${expr(def, tabKey, tf, ws)} AS v, count(*) AS n${from}${whereSql(tabWhere)} GROUP BY v`).bind(...tabWhere.params));
  }
  const footer = (def.list.footer ?? []).filter((a) => a.fn === "count" || visibleFields(def, role).some(([k]) => k === a.field));
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
  return out;
}

// ---------------------------------------------------------------------------------------------
// One record, with relations
// ---------------------------------------------------------------------------------------------

export async function getRow(ctx: QueryCtx, entity: EntityKey | string, id: string): Promise<Row | null> {
  const def = getDef(entity);
  assertRead(def, ctx.actor.role);
  const scope = scopeWhere(def, ctx.actor, ctx.ws);
  const w = merge({ sql: [`${def.table}.id = ?`], params: [id] }, scope);
  const raw = await ctx.db.prepare(`SELECT ${selectList(def, ctx.actor.role, ctx.ws)} FROM ${effective(def.table, ctx.ws)} AS ${def.table}${whereSql(w)}`).bind(...w.params).first();
  return raw ? present(def, ctx.actor.role, raw) : null;
}

export type Related = Record<string, { entity: EntityKey; label: string; kind: "one" | "many"; rows: Row[]; total: number; href?: string }>;

// Related records for the detail page: "one" relations follow fk on this row; "many" list the
// related entity filtered by fk = this id (first page), or "remote=local" to match another
// column of this row. Relations the role can't read, or to unregistered entities, are left out.
export async function relations(ctx: QueryCtx, def: EntityDef, row: Row, names?: string[], size = 10): Promise<Related> {
  const out: Related = {};
  const raw = await ctx.db.prepare(`SELECT * FROM ${effective(def.table, ctx.ws)} WHERE id = ?`).bind(row.id).first();
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

export async function exportCsv(ctx: QueryCtx, entity: string, q: ListQuery): Promise<string> {
  const def = getDef(entity);
  const cols = visibleFields(def, ctx.actor.role).filter(([, f]) => f.type !== "image" && f.type !== "json");
  const keys = q.columns?.length ? cols.filter(([k]) => q.columns!.includes(k)) : cols.filter(([, f]) => f.list?.default);
  const use = keys.length ? keys : cols;
  const lines = [["ID", ...use.map(([, f]) => f.label)].map(csvCell).join(",")];
  let cursor: string | undefined;
  let n = 0;
  do {
    const res = await list(ctx, entity, { ...q, size: PAGE_SIZE_CAP, cursor: cursor ?? undefined, page: 1 });
    for (const r of res.rows) lines.push([r.id, ...use.map(([k, f]) => (f.type === "ref" ? r[`${k}__label`] ?? r[k] : r[k]))].map(csvCell).join(","));
    n += res.rows.length;
    cursor = res.nextCursor;
  } while (cursor && n < EXPORT_CAP);
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------
// Writes: copy-on-write into the overlay, tombstones for deletes, audit + activity + event in
// the same batch. Base rows are never modified.
// ---------------------------------------------------------------------------------------------

export type WriteCtx = QueryCtx & { ws: string; nowMs: number };

// FieldDef.editable narrows who may change a field later (PATCH); on create every stored field
// the role can see may be set.
function editable(role: Role, key: string, f: FieldDef, mode: "create" | "update") {
  if (key === "id" || f.sql || f.type === "image" || f.hiddenFor?.includes(role)) return false;
  return mode === "create" || !f.editable || f.editable.includes(role);
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
    const base = fieldZod(f);
    shape[key] = mode === "create" && f.required ? base : base.nullable().optional();
  }
  return z.strictObject(shape);
}

const newId = (def: EntityDef) => `${def.key.slice(0, 3)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

async function rawRow(db: Db, table: string, ws: string, id: string) {
  return db.prepare(`SELECT * FROM ${effective(table, ws)} WHERE id = ?`).bind(id).first<Row>();
}

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
  const at = new Date(ctx.nowMs).toISOString();
  const rid = () => crypto.randomUUID();
  const { db, ws, actor } = ctx;
  const pid = propertyId == null ? null : String(propertyId);
  return [
    db.prepare("INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, action, entity_type, entity_id, property_id, detail, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ws, rid(), at, actor.name, actor.personaId, actor.role, `${def.key}.${verb}`, def.key, id, pid, summary, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null),
    db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?)")
      .bind(ws, rid(), def.key, id, pid, at, actor.personaId, verb, summary, JSON.stringify({ actor: actor.name, changes: after && before ? diffKeys(before, after) : undefined })),
    db.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ws, rid(), `${def.key}.${verb}`, def.key, id, pid, JSON.stringify({ by: actor.personaId }), at),
  ];
}

const diffKeys = (a: Row, b: Row) => Object.keys(b).filter((k) => k !== "seq" && k !== "workspace_id" && a[k] !== b[k]);

async function propertyOf(ctx: QueryCtx, def: EntityDef, id: string) {
  if (!def.scopePath) return null;
  const r = await ctx.db.prepare(`SELECT (${expand(def.scopePath, ctx.ws)}) AS p FROM ${effective(def.table, ctx.ws)} AS ${def.table} WHERE ${def.table}.id = ?`).bind(id).first<{ p: unknown }>();
  return r?.p ?? null;
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
  const id = newId(def);
  const row: Row = { workspace_id: ctx.ws, id, ...changesToColumns(def, body) };
  const statements = [upsert(ctx.db, def.table, row)];
  try {
    // Insert first so the scope check below can read the new row; roll back if out of scope.
    await ctx.db.batch(statements);
    const pid = await propertyOf(ctx, def, id);
    // getRow applies the full scope (properties and portal "self"), so a row it can't read back
    // was created outside the persona's scope.
    if (!(await getRow(ctx, entity, id))) {
      await ctx.db.prepare(`DELETE FROM ${def.table} WHERE workspace_id = ? AND id = ?`).bind(ctx.ws, id).run();
      throw new QueryError(403, "That property is outside your scope");
    }
    await ctx.db.batch(trail(ctx, def, id, "created", pid, null, row, `Created ${def.label.one.toLowerCase()}`));
  } catch (e) {
    throw constraintError(e);
  }
  return (await getRow(ctx, entity, id))!;
}

export async function updateRecord(ctx: WriteCtx, entity: string, id: string, body: Record<string, unknown>): Promise<Row> {
  const def = getDef(entity);
  assertWrite(def, ctx.actor.role, "update");
  if (!(await getRow(ctx, entity, id))) throw new QueryError(404, `${def.label.one} not found`);
  const before = (await rawRow(ctx.db, def.table, ctx.ws, id))!;
  const changes = changesToColumns(def, body);
  if (!Object.keys(changes).length) throw new QueryError(400, "Nothing to change");
  const after: Row = { ...before, ...changes, workspace_id: ctx.ws, deleted: 0 };
  const changed = diffKeys(before, after).filter((k) => k in changes);
  const summary = `Updated ${changed.map((c) => Object.entries(def.fields).find(([k, f]) => (f.column ?? k) === c)?.[1].label ?? c).join(", ") || "nothing"}`;
  try {
    await ctx.db.batch([upsert(ctx.db, def.table, after), ...trail(ctx, def, id, "updated", await propertyOf(ctx, def, id), pick(before, changed), pick(after, changed), summary)]);
  } catch (e) {
    throw constraintError(e);
  }
  const row = await getRow(ctx, entity, id);
  if (!row) throw new QueryError(403, "That change would move the record outside your scope");
  return row;
}

const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k]]));

export async function deleteRecord(ctx: WriteCtx, entity: string, id: string): Promise<void> {
  const def = getDef(entity);
  assertWrite(def, ctx.actor.role, "delete");
  if (!(await getRow(ctx, entity, id))) throw new QueryError(404, `${def.label.one} not found`);
  const before = (await rawRow(ctx.db, def.table, ctx.ws, id))!;
  const pid = await propertyOf(ctx, def, id);
  await ctx.db.batch([upsert(ctx.db, def.table, { ...before, workspace_id: ctx.ws, deleted: 1 }), ...trail(ctx, def, id, "deleted", pid, before, null, `Deleted ${def.label.one.toLowerCase()} ${String(before[def.fields[def.titleField]?.column ?? def.titleField] ?? id)}`)]);
}

// ---------------------------------------------------------------------------------------------
// Notes, tasks, activity and documents on any record (capabilities)
// ---------------------------------------------------------------------------------------------

export type Collab = "notes" | "tasks" | "activity" | "documents";
const COLLAB_ORDER: Record<Collab, string> = { notes: "pinned DESC, created_at DESC", tasks: "CASE status WHEN 'Done' THEN 1 WHEN 'Cancelled' THEN 2 ELSE 0 END, due_on IS NULL, due_on", activity: "at DESC", documents: "uploaded_at DESC" };
const COLLAB_TABLE: Record<Collab, string> = { notes: "notes", tasks: "tasks", activity: "activity_events", documents: "documents" };

export async function collab(ctx: QueryCtx, kind: Collab, entity: string, id: string, page = 1, size = 50): Promise<ListResult> {
  const def = getDef(entity);
  if (!(await getRow(ctx, entity, id))) throw new QueryError(404, `${def.label.one} not found`);
  const s = Math.max(1, Math.min(PAGE_SIZE_CAP, size));
  const p = Math.max(1, page);
  const from = ` FROM ${effective(COLLAB_TABLE[kind], ctx.ws)} WHERE entity_type = ? AND entity_id = ?`;
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
    const audit = await ctx.db.prepare(`SELECT id, at, actor, role, agent, model, action, detail, before_json, after_json FROM ${effective("audit", ctx.ws)} WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC LIMIT 50`).bind(def.key, id).all();
    const seen = new Set(out.map((r) => `${r.at}|${r.summary}`));
    out = [...out, ...audit.results.filter((a) => !seen.has(`${a.at}|${a.detail}`)).map((a) => ({ id: a.id, at: a.at, actor_kind: a.agent ? "agent" : "staff", actor_id: a.actor, verb: a.action, summary: a.detail, data: JSON.stringify({ actor: a.actor, role: a.role, agent: a.agent, model: a.model, before: a.before_json, after: a.after_json }) }))]
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
  status: z.enum(["Open", "In progress", "Done", "Cancelled"]).optional(),
});

// Notes and tasks are collaboration, not record edits: anyone who can read the record may add them.
export async function addCollab(ctx: WriteCtx, kind: "notes" | "tasks", entity: string, id: string, body: z.infer<typeof noteSchema> | z.infer<typeof taskSchema>): Promise<Row> {
  const def = getDef(entity);
  if (!(await getRow(ctx, entity, id))) throw new QueryError(404, `${def.label.one} not found`);
  const at = new Date(ctx.nowMs).toISOString();
  const pid = await propertyOf(ctx, def, id);
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
      .bind(ws, rid, b.title, b.detail ?? "", def.key, id, pid == null ? null : String(pid), b.assignee_id ?? null, actor.personaId, b.due_on ?? null, b.priority ?? "Normal", b.status ?? "Open", at);
    summary = `${actor.name} added task "${b.title}"`;
  }
  await db.batch([
    insert,
    db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, '{}')")
      .bind(ws, crypto.randomUUID(), def.key, id, pid == null ? null : String(pid), at, actor.personaId, kind === "notes" ? "commented" : "task_added", summary),
  ]);
  const row = await db.prepare(`SELECT * FROM ${kind} WHERE workspace_id = ? AND id = ?`).bind(ws, rid).first<Row>();
  return row!;
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
  const res = await ctx.db.prepare(`SELECT id, name, owner_id, state, position FROM ${effective("saved_views", ctx.ws)} WHERE entity_type = ? AND (owner_id IS NULL OR owner_id = ?) ORDER BY position, name LIMIT 100`).bind(def.key, ctx.actor.personaId).all();
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
  return { key: id, label: body.name, shared: !!body.shared, mine: !body.shared, ...body.state };
}

export async function deleteView(ctx: WriteCtx, id: string) {
  const v = await rawRow(ctx.db, "saved_views", ctx.ws, id);
  if (!v) throw new QueryError(404, "View not found");
  if (v.owner_id != null && v.owner_id !== ctx.actor.personaId) throw new QueryError(403, "That view belongs to someone else");
  await upsert(ctx.db, "saved_views", { ...v, workspace_id: ctx.ws, deleted: 1 }).run();
}

// ---------------------------------------------------------------------------------------------
// URL ⇄ ListQuery (pages and the API share one encoding)
// ---------------------------------------------------------------------------------------------

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
  return m?.m ?? new Date().toISOString().slice(0, 7);
}

export async function metrics(ctx: QueryCtx, key: string, params: MetricParams = {}): Promise<MetricResult> {
  const m = getMetric(key);
  if (!m) throw new QueryError(404, `Unknown metric "${key}"`);
  if (m.roles && !m.roles.includes(ctx.actor.role)) throw new QueryError(403, "You can't view this metric");
  if (params.property && ctx.actor.propertyIds !== "all" && !ctx.actor.propertyIds.includes(params.property)) throw new QueryError(403, "That property is outside your scope");
  if (params.month && !/^\d{4}-\d{2}$/.test(params.month)) throw new QueryError(400, "month must be YYYY-MM");
  return m.run({ db: ctx.db, ws: ctx.ws, actor: ctx.actor, propertyIds: ctx.actor.propertyIds, asOf: await asOfMonth(ctx.db) }, params);
}

// ---------------------------------------------------------------------------------------------
// Facet options with counts (filter chips): for each facet field, its values under every other
// active filter, the search and the scope. Enum facets keep the def's order.
// ---------------------------------------------------------------------------------------------

export type FacetOptions = Record<string, { value: string; label?: string; count: number }[]>;
const FACET_LIMIT = 60;

export async function facetOptions(ctx: QueryCtx, entity: string, q: ListQuery = {}): Promise<FacetOptions> {
  const def = getDef(entity);
  const { ws, actor } = ctx;
  assertRead(def, actor.role);
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
