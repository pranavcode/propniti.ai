import "server-only";
import { z } from "zod";
import { can, getEntity, type Actor, type ListQuery, type Row } from "@/entities";
import { demoNowIso } from "@/lib/clock";
import { effective, expand, forgetOverlay, parseListQuery, readWs, type QueryCtx, type WriteCtx } from "@/server/query";

// My tasks: the signed-in person's tasks, plus tasks given to their role with no person named,
// in their scope. The page reads them through the generic list (same scope and field rules).

export const TASK_VIEWS = ["open", "overdue", "today", "upcoming", "done"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
export const taskView = (v: string | null): TaskView => (TASK_VIEWS as readonly string[]).includes(v ?? "") ? (v as TaskView) : "open";

export const mine = (actor: Actor) => [actor.personaId, `role:${actor.role}`];

// The URL's filters, search, sort and page, with the assignee and the view always set here.
export function myTasksQuery(actor: Actor, sp: URLSearchParams): ListQuery {
  const q = parseListQuery(sp);
  const view = taskView(sp.get("due"));
  const filters = { ...q.filters, assignee_key: mine(actor), bucket: view === "open" ? ["overdue", "today", "upcoming"] : view };
  return { ...q, filters, sort: q.sort ?? (view === "done" ? ["completed_at", "desc"] : ["due_on", "asc"]), cursor: undefined };
}

export type Related = { entity: string; id: string; label: string; title: string | null; href: string | null };

// The record each task is about, with its title, one query per record type on the page. Only
// types the role can read, and only records in its scope, get a title and a link.
export async function relatedRecords(ctx: QueryCtx, rows: Row[]): Promise<Record<string, Related>> {
  const ws = await readWs(ctx);
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.entity_type || !r.entity_id) continue;
    byType.set(String(r.entity_type), [...(byType.get(String(r.entity_type)) ?? []), String(r.entity_id)]);
  }
  const out: Record<string, Related> = {};
  const queries = [...byType].flatMap(([type, ids]) => {
    const def = getEntity(type);
    for (const id of ids) out[`${type}:${id}`] = { entity: type, id, label: def?.label.one ?? type.replace(/_/g, " "), title: null, href: null };
    if (!def || !can(ctx.actor.role, "read", def.key)) return [];
    const tf = def.fields[def.titleField];
    const title = tf?.sql ? `(${expand(tf.sql, ws)})` : `${def.table}.${tf?.column ?? def.titleField}`;
    const scoped = ctx.actor.propertyIds !== "all" && def.scopePath;
    const sql = `SELECT ${def.table}.id AS id, ${title} AS title FROM ${effective(def.table, ws)} AS ${def.table} WHERE ${def.table}.id IN (SELECT value FROM json_each(?))${scoped ? ` AND (${expand(def.scopePath!, ws)}) IN (SELECT value FROM json_each(?))` : ""}`;
    return [{ def, stmt: ctx.db.prepare(sql).bind(JSON.stringify([...new Set(ids)]), ...(scoped ? [JSON.stringify(ctx.actor.propertyIds)] : [])) }];
  });
  if (!queries.length) return out;
  const results = await ctx.db.batch(queries.map((q) => q.stmt));
  results.forEach((res, i) => {
    const { def } = queries[i];
    for (const r of res.results) {
      const k = `${def.key}:${String(r.id)}`;
      out[k] = { ...out[k], title: r.title == null ? String(r.id) : String(r.title), href: `${def.route}/${encodeURIComponent(String(r.id))}` };
    }
  });
  return out;
}

// Properties a new task can be filed under: the person's scope.
export async function propertyOptions(ctx: QueryCtx): Promise<{ id: string; name: string }[]> {
  const ids = ctx.actor.propertyIds;
  const res = await ctx.db.prepare(`SELECT id, name FROM ${effective("properties", await readWs(ctx))}${ids === "all" ? "" : " WHERE id IN (SELECT value FROM json_each(?))"} ORDER BY name LIMIT 200`)
    .bind(...(ids === "all" ? [] : [JSON.stringify(ids)])).all<{ id: string; name: string }>();
  return res.results.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

// People a task can be reassigned to: active staff whose role assignment covers at least one of
// this person's properties (or anyone with an assignment, for org-wide roles). tasks.reassign checks
// the task's own property again on the server.
export async function staffOptions(ctx: QueryCtx): Promise<{ id: string; name: string; title: string }[]> {
  const ws = await readWs(ctx);
  const ids = ctx.actor.propertyIds;
  const covers = ids === "all" ? "1 = 1" : `(ra.scope_kind = 'org' OR (ra.scope_kind = 'property' AND ra.scope_id IN (SELECT value FROM json_each(?1)))
    OR (ra.scope_kind = 'region' AND ra.scope_id IN (SELECT p.region_id FROM ${effective("properties", ws)} p WHERE p.id IN (SELECT value FROM json_each(?1)))))`;
  const res = await ctx.db.prepare(`SELECT st.id, st.name, st.title FROM ${effective("staff", ws)} st WHERE st.active = 1 AND EXISTS (SELECT 1 FROM ${effective("role_assignments", ws)} ra WHERE ra.staff_id = st.id AND ${covers}) ORDER BY st.name LIMIT 200`)
    .bind(...(ids === "all" ? [] : [JSON.stringify(ids)])).all<{ id: string; name: string; title: string }>();
  return res.results.map((r) => ({ id: String(r.id), name: String(r.name), title: String(r.title) }));
}

// `key` is made by the browser once per form, so a double submit or a retry adds the task once.
export const newTaskSchema = z.strictObject({
  key: z.uuid(),
  title: z.string().trim().min(1, "Give the task a title").max(200),
  detail: z.string().trim().max(2000).optional(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  priority: z.enum(["High", "Normal", "Low"]).optional(),
  property_id: z.string().max(80).optional(),
});
export type NewTask = z.infer<typeof newTaskSchema>;

export type CreateResult = { status: 200; id: string } | { status: 400 | 403 | 409; error: string };

// A task for yourself. People scoped to properties file it under one of theirs, so it stays in
// their scope; org-wide roles may leave the property empty. Task, activity and audit are one batch.
export async function createTask(ctx: WriteCtx, body: NewTask): Promise<CreateResult> {
  const { db, ws, actor } = ctx;
  const pid = body.property_id || null;
  if (!pid && actor.propertyIds !== "all") return { status: 400, error: "Choose one of your properties" };
  if (pid) {
    if (actor.propertyIds !== "all" && !actor.propertyIds.includes(pid)) return { status: 403, error: "That property is outside your scope" };
    const hit = await db.prepare(`SELECT 1 AS ok FROM ${effective("properties", ws)} WHERE id = ?`).bind(pid).first();
    if (!hit) return { status: 400, error: "No such property" };
  }
  const id = `task-${body.key}`;
  const at = demoNowIso(ctx.nowMs);
  const row = { id, title: body.title, detail: body.detail ?? "", property_id: pid, assignee_id: actor.personaId, created_by: actor.personaId, due_on: body.due_on ?? null, priority: body.priority ?? "Normal", status: "Open", source: "Manual", created_at: at };
  const results = await db.batch([
    db.prepare("INSERT INTO tasks (workspace_id, id, title, detail, entity_type, entity_id, property_id, assignee_id, created_by, due_on, priority, status, queue_state, source, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'Open', 'needs_you', 'Manual', ?) ON CONFLICT (workspace_id, id) DO NOTHING")
      .bind(ws, id, row.title, row.detail, pid, actor.personaId, actor.personaId, row.due_on, row.priority, at),
    db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, 'tasks', ?, ?, ?, 'staff', ?, 'created', ?, '{}') ON CONFLICT (workspace_id, id) DO NOTHING")
      .bind(ws, `act-${id}`, id, pid, at, actor.personaId, `${actor.name} added task "${row.title}"`),
    db.prepare("INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, action, entity_type, entity_id, property_id, detail, after_json) VALUES (?, ?, ?, ?, ?, ?, 'tasks.created', 'tasks', ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING")
      .bind(ws, `au-${id}`, at, actor.name, actor.personaId, actor.role, id, pid, `Created task "${row.title}"`, JSON.stringify(row)),
  ]);
  forgetOverlay(actor);
  if (results[0].meta.changes) return { status: 200, id };
  // The same person sending the same form again (a double click, or a retry after a lost
  // response) gets the task that was already saved.
  const prior = await db.prepare("SELECT created_by FROM tasks WHERE workspace_id = ? AND id = ?").bind(ws, id).first<{ created_by: string | null }>();
  return prior?.created_by === actor.personaId ? { status: 200, id } : { status: 409, error: "This task was already added" };
}
