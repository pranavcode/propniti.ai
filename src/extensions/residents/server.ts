import "server-only";
import { AS_OF } from "@/seed/constants";
import type { Actor, Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import type { Db } from "@/lib/platform/types";
import { expand, type QueryCtx } from "@/server/query";
import type { LeaseRecord } from "./lib";

// Server helpers for the residents lane's custom pages and tabs. SQL uses {table} for effective
// (overlay-over-base) rows; callers pass scope through the property id filters they bind.

export async function pageCtx(): Promise<QueryCtx & { personaId: string }> {
  const s = await currentSession();
  return { db: getPlatform().db, ws: s.ws, actor: s.actor, personaId: s.persona.id };
}

export async function sql<T = Row>(ctx: { db: Db; ws: string | null }, text: string, binds: unknown[] = []): Promise<T[]> {
  return (await ctx.db.prepare(expand(text, ctx.ws)).bind(...binds).all<T>()).results;
}

export async function one<T = Row>(ctx: { db: Db; ws: string | null }, text: string, binds: unknown[] = []): Promise<T | null> {
  return (await ctx.db.prepare(expand(text, ctx.ws)).bind(...binds).first<T>()) ?? null;
}

// "property_id IN (…)" for the actor's scope; binds one JSON parameter when scoped.
export function scopeIn(actor: Actor, col: string): { sql: string; binds: unknown[] } {
  return actor.propertyIds === "all" ? { sql: "1", binds: [] } : { sql: `${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(actor.propertyIds)] };
}

export async function asOfDate(db: Db) {
  return (await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? AS_OF;
}

const parse = <T,>(v: unknown, fallback: T): T => {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

// The lease as abstraction compares it: raw columns plus the names the document prints.
export async function leaseRecord(ctx: { db: Db; ws: string | null }, id: string): Promise<LeaseRecord | null> {
  const r = await one(ctx, `SELECT l.*, u.number AS unit, u.market_rent_cents, p.name AS property, (p.street || ', ' || p.city || ', ' || p.state || ' ' || p.zip) AS address, coalesce(h.name, '') AS household
    FROM {leases} l LEFT JOIN {units} u ON u.id = l.unit_id LEFT JOIN {properties} p ON p.id = l.property_id LEFT JOIN {households} h ON h.id = l.household_id WHERE l.id = ?`, [id]);
  if (!r) return null;
  const people = await sql<{ name: string }>(ctx, "SELECT first_name || ' ' || last_name AS name FROM {residents} WHERE household_id = ? ORDER BY is_primary DESC, last_name", [r.household_id]);
  const names = people.map((p) => p.name);
  return {
    id: String(r.id), kind: String(r.kind), property: String(r.property ?? ""), address: (r.address as string) ?? null, unit: String(r.unit ?? "?"),
    tenant: r.kind === "Commercial" ? String(r.household || names[0] || "") : names.join(" and ") || String(r.household),
    residents: names, start_on: String(r.start_on), end_on: (r.end_on as string) ?? null, term_months: r.term_months == null ? null : Number(r.term_months),
    rent_cents: Number(r.rent_cents), deposit_cents: Number(r.deposit_cents ?? 0), market_rent_cents: r.market_rent_cents == null ? null : Number(r.market_rent_cents),
    escalations: parse(r.escalations, []), nnn_share_pct: r.nnn_share_pct == null ? null : Number(r.nnn_share_pct),
    cam_cents: r.cam_cents == null ? null : Number(r.cam_cents), tax_cents: r.tax_cents == null ? null : Number(r.tax_cents), insurance_cents: r.insurance_cents == null ? null : Number(r.insurance_cents),
    signed_at: (r.signed_at as string) ?? null,
  };
}

const colCache = new Map<string, Set<string>>();
async function columnsOf(db: Db, table: string) {
  let c = colCache.get(table);
  if (!c) {
    c = new Set((await db.prepare(`SELECT name FROM pragma_table_info('${table.replace(/[^a-z_]/g, "")}')`).all<{ name: string }>()).results.map((r) => r.name));
    colCache.set(table, c);
  }
  return c;
}

// Copy-on-write into the visitor's overlay: the effective row plus changes, as one upsert.
export async function overlayWrite(db: Db, ws: string, table: string, id: string, changes: Row, opts: { tombstone?: boolean } = {}) {
  const cols = await columnsOf(db, table);
  for (const k of Object.keys(changes)) if (!cols.has(k) || ["seq", "workspace_id", "id"].includes(k)) throw new Error(`${table}.${k} can't be changed`);
  const current = await one<Row>({ db, ws }, `SELECT * FROM {${table}} WHERE id = ?`, [id]);
  if (!current) throw new Error(`${table} ${id} not found`);
  const next: Row = { ...current, ...changes, workspace_id: ws, id, deleted: opts.tombstone ? 1 : 0 };
  delete next.seq;
  const keys = Object.keys(next).filter((k) => cols.has(k));
  await db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) ON CONFLICT (workspace_id, id) DO UPDATE SET ${keys.filter((k) => k !== "workspace_id" && k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`)
    .bind(...keys.map((k) => toSql(next[k]))).run();
  return { before: Object.fromEntries(Object.keys(changes).map((k) => [k, current[k] ?? null])), after: changes };
}

const toSql = (v: unknown) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export async function insertRow(db: Db, ws: string, table: string, row: Row) {
  const cols = await columnsOf(db, table);
  const full: Row = { ...row, workspace_id: ws };
  const keys = Object.keys(full).filter((k) => cols.has(k) && full[k] !== undefined);
  return db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((k) => toSql(full[k])));
}

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
