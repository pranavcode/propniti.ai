import type { Db, DbStatement } from "@/lib/platform/types";
import type { AuditEntry, DemoState, Invoice, Notification, Property, Rating, Tenancy, Transfer, User, Vendor, WorkOrder } from "@/lib/types";

export const toCents = (n: number) => Math.round(n * 100);
const fromCents = (c: unknown) => Number(c) / 100;

type Row = Record<string, unknown>;
const str = (v: unknown) => v as string;
const opt = (v: unknown) => (v == null ? undefined : (v as string));

// Each table: how a DemoState item becomes a row, and back. Columns follow migrations/0001_init.sql.
export const tables = {
  users: {
    toRow: (u: User) => ({ id: u.id, name: u.name, role: u.role, email: u.email, phone: u.phone, channel: u.channel, id_verified: u.idVerified ? 1 : 0 }),
    fromRow: (r: Row): User => ({ id: str(r.id), name: str(r.name), role: r.role as User["role"], email: str(r.email), phone: str(r.phone), channel: r.channel as User["channel"], idVerified: !!r.id_verified }),
  },
  properties: {
    toRow: (p: Property) => ({ id: p.id, name: p.name, address: p.address, type: p.type, units: p.units, occupied: p.occupied, owner_id: p.ownerId }),
    fromRow: (r: Row): Property => ({ id: str(r.id), name: str(r.name), address: str(r.address), type: r.type as Property["type"], units: Number(r.units), occupied: Number(r.occupied), ownerId: str(r.owner_id) }),
  },
  vendors: {
    toRow: (v: Vendor) => ({ id: v.id, user_id: v.userId, company: v.company, trade: v.trade, ytd_paid_cents: toCents(v.ytdPaid) }),
    fromRow: (r: Row): Vendor => ({ id: str(r.id), userId: str(r.user_id), company: str(r.company), trade: str(r.trade), ytdPaid: fromCents(r.ytd_paid_cents) }),
  },
  tenancies: {
    toRow: (t: Tenancy) => ({ id: t.id, property_id: t.propertyId, unit: t.unit, tenant_id: t.tenantId, rent_cents: toCents(t.rent), cadence: t.cadence, lease_start: t.leaseStart, lease_end: t.leaseEnd, status: t.status }),
    fromRow: (r: Row): Tenancy => ({
      id: str(r.id), propertyId: str(r.property_id), unit: str(r.unit), tenantId: str(r.tenant_id), rent: fromCents(r.rent_cents),
      cadence: "Monthly", leaseStart: str(r.lease_start), leaseEnd: str(r.lease_end), status: r.status as Tenancy["status"],
    }),
  },
  invoices: {
    toRow: (i: Invoice) => ({ id: i.id, tenancy_id: i.tenancyId, amount_cents: toCents(i.amount), generated: i.generated, due: i.due, status: i.status }),
    fromRow: (r: Row): Invoice => ({ id: str(r.id), tenancyId: str(r.tenancy_id), amount: fromCents(r.amount_cents), generated: str(r.generated), due: str(r.due), status: r.status as Invoice["status"] }),
  },
  work_orders: {
    toRow: (w: WorkOrder) => ({
      id: w.id, property_id: w.propertyId, unit: w.unit, title: w.title, vendor_id: w.vendorId === "in-house" ? null : w.vendorId, assignee_id: w.assigneeId ?? null,
      estimated_hours: w.estimatedHours, status: w.status, po: JSON.stringify(w.po), submission: w.submission ? JSON.stringify(w.submission) : null, validation: w.validation ? JSON.stringify(w.validation) : null,
    }),
    fromRow: (r: Row): WorkOrder => ({
      id: str(r.id), propertyId: str(r.property_id), unit: str(r.unit), title: str(r.title), vendorId: opt(r.vendor_id) ?? "in-house",
      ...(r.assignee_id != null && { assigneeId: str(r.assignee_id) }),
      estimatedHours: Number(r.estimated_hours), status: r.status as WorkOrder["status"], po: JSON.parse(str(r.po)),
      ...(r.submission != null && { submission: JSON.parse(str(r.submission)) }),
      ...(r.validation != null && { validation: JSON.parse(str(r.validation)) }),
    }),
  },
  transfers: {
    toRow: (t: Transfer) => ({
      id: t.id, key: t.key, kind: t.kind, from_kind: t.from.kind, from_id: t.from.id, from_name: t.from.name, to_kind: t.to.kind, to_id: t.to.id, to_name: t.to.name,
      amount_cents: toCents(t.amount), property_id: t.propertyId, ref: t.ref, status: t.status, created: t.created, settles_at: t.settlesAt ?? null, cleared: t.cleared ?? null, statement: t.statement ?? null,
    }),
    fromRow: (r: Row): Transfer => ({
      id: str(r.id), key: str(r.key), kind: r.kind as Transfer["kind"],
      from: { kind: r.from_kind as Transfer["from"]["kind"], id: str(r.from_id), name: str(r.from_name) },
      to: { kind: r.to_kind as Transfer["to"]["kind"], id: str(r.to_id), name: str(r.to_name) },
      amount: fromCents(r.amount_cents), propertyId: str(r.property_id), ref: str(r.ref), status: r.status as Transfer["status"], created: str(r.created),
      ...(r.settles_at != null && { settlesAt: Number(r.settles_at) }),
      ...(r.cleared != null && { cleared: str(r.cleared) }),
      ...(r.statement != null && { statement: str(r.statement) }),
    }),
  },
  ratings: {
    toRow: (x: Rating) => ({ id: x.id, by_id: x.by, subject_kind: x.subject.kind, subject_id: x.subject.id, stars: x.stars, comment: x.comment, ref: x.ref ?? "", ts: x.ts }),
    fromRow: (r: Row): Rating => ({
      id: str(r.id), by: str(r.by_id), subject: { kind: r.subject_kind as Rating["subject"]["kind"], id: str(r.subject_id) }, stars: Number(r.stars), comment: str(r.comment),
      ...(r.ref !== "" && { ref: str(r.ref) }), ts: str(r.ts),
    }),
  },
  notifications: {
    toRow: (n: Notification) => ({ id: n.id, user_id: n.userId, channel: n.channel, message: n.message, ts: n.ts }),
    fromRow: (r: Row): Notification => ({ id: str(r.id), userId: str(r.user_id), channel: r.channel as Notification["channel"], message: str(r.message), ts: str(r.ts) }),
  },
  audit: {
    toRow: (a: AuditEntry) => ({ id: a.id, ts: a.ts, actor: a.actor, action: a.action, detail: a.detail }),
    fromRow: (r: Row): AuditEntry => ({ id: str(r.id), ts: str(r.ts), actor: str(r.actor), action: str(r.action), detail: str(r.detail) }),
  },
};
export type Table = keyof typeof tables;
type Item<T extends Table> = Parameters<(typeof tables)[T]["toRow"]>[0];

// Lists the UI shows newest first; the rest keep the order they were added in.
const NEWEST_FIRST = new Set<Table>(["work_orders", "transfers", "ratings", "notifications", "audit"]);

// Inserts many rows with one statement (D1 caps bound parameters per query, so rows travel as JSON).
// Items are given in DemoState order; newest-first lists are inserted oldest first so seq keeps that order.
export function insertItems<T extends Table>(db: Db, table: T, ws: string, items: Item<T>[], orIgnore = false): DbStatement {
  const toRow = tables[table].toRow as (x: Item<T>) => Row;
  const rows = (NEWEST_FIRST.has(table) ? [...items].reverse() : items).map(toRow);
  const cols = Object.keys(toRow(items[0]));
  return db
    .prepare(`INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${table} (workspace_id, ${cols.join(", ")}) SELECT ?1, ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?2) ORDER BY key`)
    .bind(ws, JSON.stringify(rows));
}

export type WorkspaceRow = { id: string; created_at: number; created_by: string | null; expires_at: number | null; bank: string | null; invited: string; imported_rows: number; setup_completed: number; wo_seq: number };

export async function loadState(db: Db, ws: string): Promise<DemoState> {
  const names = Object.keys(tables) as Table[];
  const results = await db.batch([
    ...names.map((t) => db.prepare(`SELECT * FROM ${t} WHERE workspace_id = ?1 ORDER BY seq ${NEWEST_FIRST.has(t) ? "DESC" : "ASC"}`).bind(ws)),
    db.prepare("SELECT * FROM workspaces WHERE id = ?1").bind(ws),
  ]);
  const list = <T extends Table>(t: T) => results[names.indexOf(t)].results.map((r) => tables[t].fromRow(r)) as ReturnType<(typeof tables)[T]["fromRow"]>[];
  const w = results[names.length].results[0] as WorkspaceRow | undefined;
  const invited = JSON.parse(w?.invited ?? "[]") as string[];
  const hasSetup = !!w && (w.bank != null || invited.length > 0 || w.imported_rows > 0 || !!w.setup_completed);
  return {
    properties: list("properties"),
    users: list("users"),
    vendors: list("vendors"),
    tenancies: list("tenancies"),
    invoices: list("invoices"),
    workOrders: list("work_orders"),
    transfers: list("transfers"),
    ratings: list("ratings"),
    ...(hasSetup && { setup: { ...(w.bank != null && { bank: w.bank }), invited, importedRows: w.imported_rows, completed: !!w.setup_completed } }),
    notifications: list("notifications"),
    audit: list("audit"),
  };
}

export const randomId = (bytes = 18) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const uid = (prefix: string) => `${prefix}-${randomId(6)}`;

// A condition appended to a write so it only happens if an earlier statement in the same batch
// took effect. `?G` in sql is replaced with the next free parameter, bound to value.
export type Gate = { sql: string; value: string };
export const transferExists = (id: string): Gate => ({ sql: "EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?G)", value: id });
export const transferMissing = (id: string): Gate => ({ sql: "NOT EXISTS (SELECT 1 FROM transfers WHERE workspace_id = ?1 AND id = ?G)", value: id });
const gated = (sql: string, params: unknown[], gate?: Gate) => (gate ? [`${sql} AND ${gate.sql.replace(/\?G/g, `?${params.length + 1}`)}`, [...params, gate.value]] : [sql, params]) as [string, unknown[]];

// Message to a user on their preferred channel (skipped if the user doesn't exist).
export function notifyStmt(db: Db, ws: string, userId: string, message: string, ts: string, gate?: Gate) {
  const [sql, params] = gated(
    "INSERT INTO notifications (workspace_id, id, user_id, channel, message, ts) SELECT ?1, ?2, id, channel, ?3, ?4 FROM users WHERE workspace_id = ?1 AND id = ?5",
    [ws, uid("n"), message, ts, userId],
    gate,
  );
  return db.prepare(sql).bind(...params);
}

// dedupe skips the entry when it repeats the latest one (e.g. the same refusal clicked twice).
export function auditStmt(db: Db, ws: string, ts: string, actor: string, action: string, detail: string, gate?: Gate, dedupe = false) {
  const [sql, params] = gated(
    `INSERT INTO audit (workspace_id, id, ts, actor, action, detail) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE 1${dedupe ? " AND coalesce((SELECT detail FROM audit WHERE workspace_id = ?1 ORDER BY seq DESC LIMIT 1), '') <> ?6" : ""}`,
    [ws, uid("a"), ts, actor, action, detail],
    gate,
  );
  return db.prepare(sql).bind(...params);
}

// Keeps the activity lists bounded; older entries are dropped.
export const KEEP_LATEST = 2_000;
export const trimStatements = (db: Db, ws: string) =>
  (["notifications", "audit", "ratings"] as const).map((t) =>
    db.prepare(`DELETE FROM ${t} WHERE workspace_id = ?1 AND seq <= (SELECT seq FROM ${t} WHERE workspace_id = ?1 ORDER BY seq DESC LIMIT 1 OFFSET ${KEEP_LATEST})`).bind(ws),
  );
