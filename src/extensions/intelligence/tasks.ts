import { z } from "zod";
import { AlarmClock, CircleCheck, RotateCcw, Send, UserRoundPen } from "lucide-react";
import type { ActionContext, Row } from "@/entities/types";
import { STAFF } from "@/entities/common";
import { demoNowIso } from "@/lib/clock";
import { formatAsOf } from "@/lib/format";
import { effective, overlayUpsertSql } from "@/server/effective";
import { registerAction } from "../actions";
import { isNoticeTask, noticeRecipient } from "./notice";

// Task changes (status, due date, assignee). Each is one batch: the task's activity entry goes in first, only while the
// task is still in the state the person saw; the status change and the entry on the related
// record run only if that entry exists. So a double click (or two people) changes a task once,
// and status and activity never disagree. The action route writes the audit row after a success.

const COLS = ["id", "deleted", "title", "detail", "entity_type", "entity_id", "property_id", "assignee_id", "assignee_role", "created_by", "due_on", "priority", "status", "queue_state", "source", "completed_at", "created_at"] as const;
const OPEN = ["Open", "In progress"];
const isOpen = (r: Row) => OPEN.includes(String(r.status));
const inList = (xs: string[]) => `(${xs.map((x) => `'${x}'`).join(", ")})`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Stmt = ReturnType<ActionContext["db"]["prepare"]>;
type Opts = { arg?: string; more?: (gate: string, at: string) => Stmt[] };

// `guard(n)` is SQL on the task as stored (alias e): the change lands only while it holds. It may
// use ?n, bound to `opts.arg`, so request values never become SQL text. `set` maps columns to SQL,
// where ?3 is `value`. `opts.more` adds statements to the same batch; they must run only when the
// gate activity row (id `gate`) exists, so they land together with the change or not at all.
async function change(ctx: ActionContext, row: Row, guard: (n: number) => string, set: Record<string, string>, value: unknown, verb: string, summary: string, opts: Opts = {}) {
  const { db, ws } = ctx;
  const at = demoNowIso(ctx.nowMs);
  const id = String(row.id);
  const gate = crypto.randomUUID();
  const pid = row.property_id == null ? null : String(row.property_id);
  const arg = opts.arg === undefined ? [] : [opts.arg];
  // ?1 workspace, ?2 activity id, ?3/?4 record, ?5 property, ?6 at, ?7 actor, ?8 verb, ?9 summary, ?10 data, ?11 task, ?12 gate, ?13 arg.
  const activity = (when: string) => `INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'staff', ?7, ?8, ?9, ?10 WHERE ${when}`;
  const binds = (actId: string, type: string, recId: string) => [ws, actId, type, recId, pid, at, ctx.actor.personaId, verb, summary, JSON.stringify({ task_id: id }), id, gate];
  const stmts = [
    // The gate: the task's own entry (its id is the gate id, so ?2 = ?12 always holds and every bound number is used).
    db.prepare(activity(`EXISTS (SELECT 1 FROM ${effective("tasks")} AS e WHERE e.id = ?11 AND ${guard(13)}) AND ?12 = ?2`)).bind(...binds(gate, "tasks", id), ...arg),
    db.prepare(overlayUpsertSql("tasks", COLS, set, `${guard(5)} AND EXISTS (SELECT 1 FROM activity_events WHERE workspace_id = ?1 AND id = ?4)`))
      .bind(ws, id, value, gate, ...arg),
  ];
  if (row.entity_type && row.entity_id) {
    stmts.push(db.prepare(activity("EXISTS (SELECT 1 FROM activity_events WHERE workspace_id = ?1 AND id = ?12)")).bind(...binds(crypto.randomUUID(), String(row.entity_type), String(row.entity_id))));
  }
  stmts.push(...(opts.more?.(gate, at) ?? []));
  const results = await db.batch(stmts);
  return results[0].meta.changes > 0;
}

const stillOpen = () => `e.status IN ${inList(OPEN)}`;
const changeStatus = (ctx: ActionContext, row: Row, from: string[], to: "Done" | "Open", verb: string, summary: string, more?: Opts["more"]) =>
  change(ctx, row, () => `e.status IN ${inList(from)}`, { status: `'${to}'`, completed_at: to === "Done" ? "?3" : "NULL" }, to === "Done" ? demoNowIso(ctx.nowMs) : null, verb, summary, { more });

registerAction({
  key: "tasks.complete",
  label: "Mark done",
  entity: "tasks",
  roles: [...STAFF],
  icon: CircleCheck,
  bulk: true,
  when: isOpen,
  handler: async (ctx, row) => {
    const ok = await changeStatus(ctx, row, OPEN, "Done", "task_completed", `${ctx.actor.name} completed task "${String(row.title)}"`);
    return ok ? { status: 200, message: `Marked "${String(row.title)}" done` } : { status: 409, error: "This task is already done" };
  },
  help: { summary: "Marks the task done and records who completed it and when." },
});

registerAction({
  key: "tasks.reopen",
  label: "Reopen",
  entity: "tasks",
  roles: [...STAFF],
  icon: RotateCcw,
  when: (r) => !isOpen(r),
  handler: async (ctx, row) => {
    const ok = await changeStatus(ctx, row, ["Done", "Cancelled"], "Open", "task_reopened", `${ctx.actor.name} reopened task "${String(row.title)}"`);
    return ok ? { status: 200, message: `Reopened "${String(row.title)}"` } : { status: 409, error: "This task is already open" };
  },
  help: { summary: "Puts a done or cancelled task back on the assignee's list." },
});

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

registerAction({
  key: "tasks.snooze",
  label: "Snooze",
  entity: "tasks",
  roles: [...STAFF],
  icon: AlarmClock,
  bulk: true,
  when: isOpen,
  input: z.strictObject({ due_on: DATE }),
  handler: async (ctx, row, input) => {
    const today = demoNowIso(ctx.nowMs).slice(0, 10);
    if (input.due_on <= today) return { status: 400, error: "Pick a date after today" };
    if (input.due_on > addDays(today, 365)) return { status: 400, error: "Pick a date within a year" };
    const ok = await change(ctx, row, (n) => `${stillOpen()} AND coalesce(e.due_on, '') <> ?${n}`, { due_on: "?3" }, input.due_on, "task_snoozed", `${ctx.actor.name} snoozed task "${String(row.title)}" to ${formatAsOf(input.due_on)}`, { arg: input.due_on });
    return ok ? { status: 200, message: `Snoozed "${String(row.title)}" to ${formatAsOf(input.due_on)}` } : { status: 409, error: "This task is already due then, or no longer open" };
  },
  help: { summary: "Moves the due date to a later day. The task stays on the list and comes back as due on that day." },
});

// Staff who can take a task: active, and their role assignment covers the task's property (the
// property itself, its region or the whole org). A task with no property can go to any active staff.
const COVERS = `EXISTS (SELECT 1 FROM ${effective("role_assignments")} ra WHERE ra.staff_id = st.id AND (ra.scope_kind = 'org' OR (ra.scope_kind = 'property' AND ra.scope_id = ?3)
  OR (ra.scope_kind = 'region' AND ra.scope_id = (SELECT p.region_id FROM ${effective("properties")} p WHERE p.id = ?3))))`;

registerAction({
  key: "tasks.reassign",
  label: "Reassign",
  entity: "tasks",
  roles: [...STAFF],
  icon: UserRoundPen,
  when: isOpen,
  input: z.strictObject({ assignee_id: z.string().min(1).max(80) }),
  handler: async (ctx, row, input) => {
    const pid = row.property_id == null ? null : String(row.property_id);
    const who = await ctx.db.prepare(`SELECT st.name FROM ${effective("staff")} st WHERE st.id = ?2 AND st.active = 1${pid ? ` AND ${COVERS}` : ""}`)
      .bind(ctx.ws, input.assignee_id, ...(pid ? [pid] : [])).first<{ name: string }>();
    if (!who) return { status: 400, error: "Pick someone who works at this task's property" };
    const ok = await change(ctx, row, (n) => `${stillOpen()} AND coalesce(e.assignee_id, '') <> ?${n}`, { assignee_id: "?3", assignee_role: "NULL" }, input.assignee_id, "task_reassigned", `${ctx.actor.name} reassigned task "${String(row.title)}" to ${who.name}`, { arg: input.assignee_id });
    return ok ? { status: 200, message: `Reassigned "${String(row.title)}" to ${who.name}` } : { status: 409, error: `This task is already with ${who.name}, or no longer open` };
  },
  help: { summary: "Gives the task to someone else who works at its property. It leaves your list and shows on theirs." },
});

// Notice of entry: a person sends the notice drafted for them (see draftNotice in notice.ts), and
// the task is done, in one batch.
registerAction({
  key: "tasks.send_notice",
  label: "Send notice",
  entity: "tasks",
  roles: [...STAFF],
  icon: Send,
  when: (r) => isOpen(r) && isNoticeTask(r),
  input: z.strictObject({ resident_id: z.string().min(1).max(80), channel: z.enum(["Email", "SMS", "Portal"]), subject: z.string().trim().min(1).max(160), body: z.string().trim().min(10).max(2000) }),
  handler: async (ctx, row, input) => {
    const to = await noticeRecipient(ctx.db, ctx.ws, String(row.entity_id), input.resident_id);
    if (!to) return { status: 400, error: "That resident doesn't live in this unit now" };
    const thread = `thr-${crypto.randomUUID().slice(0, 12)}`;
    // One batch: the task completes, and the thread, message and unit activity are written only if
    // that change landed (the gate row exists). A double click sends one notice.
    const gated = "WHERE EXISTS (SELECT 1 FROM activity_events WHERE workspace_id = ?1 AND id = ?2)";
    const ok = await changeStatus(ctx, row, OPEN, "Done", "task_completed", `${ctx.actor.name} sent the notice of entry to ${to.name} and completed the task`, (gate, at) => [
      ctx.db.prepare(`INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, entity_type, entity_id, assigned_to, status, last_message_at, unread) SELECT ?1, ?3, ?4, 'resident', ?5, ?6, 'units', ?7, ?8, 'Waiting', ?9, 0 ${gated}`)
        .bind(ctx.ws, gate, thread, row.property_id ?? to.property_id, input.resident_id, input.subject, row.entity_id, ctx.actor.personaId, at),
      ctx.db.prepare(`INSERT INTO messages (workspace_id, id, thread_id, channel, direction, sender_kind, sender_id, body, template_id, drafted_by_agent, sent_at) SELECT ?1, ?3, ?4, ?5, 'out', 'staff', ?6, ?7, 'tpl-entry-notice', NULL, ?8 ${gated}`)
        .bind(ctx.ws, gate, `msg-${crypto.randomUUID().slice(0, 12)}`, thread, input.channel, ctx.actor.personaId, input.body, at),
      ctx.db.prepare(`INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) SELECT ?1, ?3, 'units', ?4, ?5, ?6, 'staff', ?7, 'messaged', ?8, ?9 ${gated}`)
        .bind(ctx.ws, gate, crypto.randomUUID(), row.entity_id, row.property_id ?? null, at, ctx.actor.personaId, `${ctx.actor.name} sent a notice of entry to ${to.name} by ${input.channel}`, JSON.stringify({ thread_id: thread })),
    ]);
    if (!ok) return { status: 409, error: "This notice was already sent" };
    return { status: 200, message: `Notice sent to ${to.name} by ${input.channel} (simulated)`, href: `/app/communications/inbox?t=${encodeURIComponent(thread)}` };
  },
  help: { summary: "Sends the notice of entry you reviewed to the resident and completes the task. In this demo sending is simulated: the message is recorded but nothing leaves the system." },
});
