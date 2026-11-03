import type { ActionContext, Row } from "@/entities/types";
import { effective } from "@/server/query";

// Copy-on-write writes for leasing actions. The action route already checked the role, the scope
// and audited the run; these add the record's activity entry and the event other agents listen to.
// Table and column names come only from this module's code, never from a request.

export type LeasingTable = "listings" | "listing_price_history" | "prospects" | "showings" | "applications" | "concessions" | "renewal_offers" | "message_threads" | "messages";

const id = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function readRow(ctx: Pick<ActionContext, "db" | "ws">, table: LeasingTable, rowId: string) {
  return ctx.db.prepare(`SELECT * FROM ${effective(table, ctx.ws)} WHERE id = ?`).bind(rowId).first<Row>();
}

function upsert(ctx: ActionContext, table: LeasingTable, row: Row) {
  const cols = Object.keys(row).filter((c) => c !== "seq");
  const sets = cols.filter((c) => c !== "workspace_id" && c !== "id").map((c) => `${c} = excluded.${c}`);
  return ctx.db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (workspace_id, id) DO UPDATE SET ${sets.join(", ")}`).bind(...cols.map((c) => row[c] ?? null));
}

function trail(ctx: ActionContext, entity: string, entityId: string, propertyId: unknown, verb: string, summary: string, data: Row = {}) {
  const at = new Date(ctx.nowMs).toISOString();
  const pid = propertyId == null ? null : String(propertyId);
  return [
    ctx.db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?)")
      .bind(ctx.ws, `act-${id()}`, entity, entityId, pid, at, ctx.actor.personaId, verb, summary, JSON.stringify({ actor: ctx.actor.name, ...data })),
    ctx.db.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ctx.ws, `evt-${id()}`, `${entity.replace(/s$/, "")}.${verb}`, entity, entityId, pid, JSON.stringify({ by: ctx.actor.personaId, ...data }), at),
  ];
}

export type Change = { table: LeasingTable; id: string; changes: Row };
export type NewRow = { table: LeasingTable; row: Row };

// Applies every change and insert in one batch, with one activity entry on the main record.
export async function commit(ctx: ActionContext, main: { entity: string; id: string; propertyId: unknown; verb: string; summary: string; data?: Row }, changes: Change[], inserts: NewRow[] = []) {
  const statements = [];
  for (const c of changes) {
    const before = await readRow(ctx, c.table, c.id);
    if (!before) throw new Error(`${c.table} ${c.id} not found`);
    statements.push(upsert(ctx, c.table, { ...before, ...c.changes, workspace_id: ctx.ws, deleted: 0 }));
  }
  for (const n of inserts) statements.push(upsert(ctx, n.table, { workspace_id: ctx.ws, deleted: 0, ...n.row }));
  await ctx.db.batch([...statements, ...trail(ctx, main.entity, main.id, main.propertyId, main.verb, main.summary, main.data)]);
}

export const newId = (prefix: string) => `${prefix}-${id()}`;
