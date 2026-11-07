import type { Actor, Row } from "@/entities/types";
import type { Db, DbStatement } from "@/lib/platform/types";
import { effective as overlaySql, overlayUpsertSql } from "@/server/effective";
import { effective } from "@/server/query";

// Small read/write helpers for the maintenance module's own SQL. Reads go through effective()
// (overlay over base); writes land in the visitor's overlay only. Table and column names come from
// this module's code, never from a request.

export { effective };
export const OPEN_STATUSES = ["New", "Triaged", "Assigned", "Scheduled", "In progress", "On hold", "Submitted"] as const;
export const OPEN_SQL = `(${OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`;
export const OPEN_FILTER = OPEN_STATUSES.join(",");

// "AND <col> IN (scope)" for the actor's properties; nothing for org-wide actors.
export function scoped(propertyIds: Actor["propertyIds"], col: string) {
  return propertyIds === "all" ? { sql: "", binds: [] as unknown[] } : { sql: ` AND ${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(propertyIds)] as unknown[] };
}

// Rows from node:sqlite have a null prototype; copy them so they can be passed to client components.
export async function all<T = Row>(db: Db, sql: string, binds: unknown[] = []): Promise<T[]> {
  return (await db.prepare(sql).bind(...binds).all<T>()).results.map((r) => ({ ...r }));
}

const colsCache = new Map<string, string[]>();
async function columnsOf(db: Db, table: string) {
  const hit = colsCache.get(table);
  if (hit) return hit;
  const cols = (await all<{ name: string }>(db, `SELECT name FROM pragma_table_info('${table}')`)).map((c) => c.name);
  if (cols.length) colsCache.set(table, cols);
  return cols;
}

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const toSql = (v: unknown) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

// `onlyIf` inserts the row only while another row matches `where` (alias e), so the insert can share
// a batch with the update that makes it true.
export async function insertStmt(db: Db, ws: string, table: string, row: Row, onlyIf?: { table: string; id: string; where: string }): Promise<DbStatement> {
  const cols = await columnsOf(db, table);
  const full: Row = { ...row, workspace_id: ws };
  const keys = Object.keys(full).filter((k) => cols.includes(k) && full[k] !== undefined);
  const values = keys.map((k) => toSql(full[k]));
  if (!onlyIf) return db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...values);
  const n = keys.length;
  return db
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) SELECT ${keys.map((_, i) => `?${i + 1}`).join(", ")} WHERE EXISTS (SELECT 1 FROM ${overlaySql(onlyIf.table, `?${n + 1}`)} AS e WHERE e.id = ?${n + 2} AND (${onlyIf.where}))`)
    .bind(...values, ws, onlyIf.id);
}

// Copy-on-write update of one row; `guard` is SQL on the current row (alias e). Returns false when
// the row is missing or the guard failed, so callers can answer 409 without a separate read.
export async function updateStmt(db: Db, ws: string, table: string, id: string, changes: Row, guard = "1 = 1") {
  const cols = await columnsOf(db, table);
  const keys = Object.keys(changes).filter((k) => cols.includes(k));
  const set = Object.fromEntries(keys.map((k, i) => [k, `?${i + 3}`]));
  return db.prepare(overlayUpsertSql(table, cols, set, guard)).bind(ws, id, ...keys.map((k) => toSql(changes[k])));
}

export async function update(db: Db, ws: string, table: string, id: string, changes: Row, guard?: string) {
  const r = await (await updateStmt(db, ws, table, id, changes, guard)).run();
  return r.meta.changes > 0;
}

// Plain read of one effective row by id, for handlers that already passed the scope check.
export async function row<T = Row>(db: Db, ws: string, table: string, id: string) {
  return db.prepare(`SELECT * FROM ${overlaySql(table)} AS t WHERE t.id = ?2`).bind(ws, id).first<T>();
}

export const parse = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
