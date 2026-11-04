import { CircleCheck, RotateCcw } from "lucide-react";
import type { Row } from "@/entities/types";
import { STAFF } from "@/entities/common";
import { demoNowIso } from "@/lib/clock";
import { overlayUpsertSql } from "@/server/effective";
import { registerAction } from "../actions";

// Task status changes. Each is a guarded copy-on-write: the update only happens while the task is
// still in the state the person saw, so a double click (or two people) changes it once. The
// action route writes the audit row; the activity entry shows on the task and on its record.

const COLS = ["id", "deleted", "title", "detail", "entity_type", "entity_id", "property_id", "assignee_id", "assignee_role", "created_by", "due_on", "priority", "status", "queue_state", "source", "completed_at", "created_at"] as const;
const OPEN = ["Open", "In progress"];
const isOpen = (r: Row) => OPEN.includes(String(r.status));

const activity = (ws: string, row: Row, at: string, actorId: string, verb: string, summary: string) =>
  [row.entity_type && row.entity_id ? [String(row.entity_type), String(row.entity_id)] : null, ["tasks", String(row.id)]].filter((x): x is string[] => !!x).map(([type, id]) => ({
    sql: "INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?)",
    binds: [ws, crypto.randomUUID(), type, id, row.property_id == null ? null : String(row.property_id), at, actorId, verb, summary, JSON.stringify({ task_id: String(row.id) })],
  }));

registerAction({
  key: "tasks.complete",
  label: "Mark done",
  entity: "tasks",
  roles: [...STAFF],
  icon: CircleCheck,
  when: isOpen,
  handler: async (ctx, row) => {
    const at = demoNowIso(ctx.nowMs);
    const res = await ctx.db.prepare(overlayUpsertSql("tasks", COLS, { status: "'Done'", completed_at: "?3" }, "e.status IN ('Open', 'In progress')")).bind(ctx.ws, String(row.id), at).run();
    if (!res.meta.changes) return { status: 409, error: "This task is already done" };
    await ctx.db.batch(activity(ctx.ws, row, at, ctx.actor.personaId, "task_completed", `${ctx.actor.name} completed task "${String(row.title)}"`).map((s) => ctx.db.prepare(s.sql).bind(...s.binds)));
    return { status: 200, message: `Marked "${String(row.title)}" done` };
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
    const at = demoNowIso(ctx.nowMs);
    const res = await ctx.db.prepare(overlayUpsertSql("tasks", COLS, { status: "'Open'", completed_at: "NULL" }, "e.status IN ('Done', 'Cancelled')")).bind(ctx.ws, String(row.id)).run();
    if (!res.meta.changes) return { status: 409, error: "This task is already open" };
    await ctx.db.batch(activity(ctx.ws, row, at, ctx.actor.personaId, "task_reopened", `${ctx.actor.name} reopened task "${String(row.title)}"`).map((s) => ctx.db.prepare(s.sql).bind(...s.binds)));
    return { status: 200, message: `Reopened "${String(row.title)}"` };
  },
  help: { summary: "Puts a done or cancelled task back on the assignee's list." },
});
