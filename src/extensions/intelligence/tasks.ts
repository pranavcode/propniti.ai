import { CircleCheck, RotateCcw } from "lucide-react";
import type { ActionContext, Row } from "@/entities/types";
import { STAFF } from "@/entities/common";
import { demoNowIso } from "@/lib/clock";
import { effective, overlayUpsertSql } from "@/server/effective";
import { registerAction } from "../actions";

// Task status changes. Each is one batch: the task's activity entry goes in first, only while the
// task is still in the state the person saw; the status change and the entry on the related
// record run only if that entry exists. So a double click (or two people) changes a task once,
// and status and activity never disagree. The action route writes the audit row after a success.

const COLS = ["id", "deleted", "title", "detail", "entity_type", "entity_id", "property_id", "assignee_id", "assignee_role", "created_by", "due_on", "priority", "status", "queue_state", "source", "completed_at", "created_at"] as const;
const OPEN = ["Open", "In progress"];
const isOpen = (r: Row) => OPEN.includes(String(r.status));
const inList = (xs: string[]) => `(${xs.map((x) => `'${x}'`).join(", ")})`;

async function changeStatus(ctx: ActionContext, row: Row, from: string[], to: "Done" | "Open", verb: string, summary: string) {
  const { db, ws } = ctx;
  const at = demoNowIso(ctx.nowMs);
  const id = String(row.id);
  const gate = crypto.randomUUID();
  const pid = row.property_id == null ? null : String(row.property_id);
  // ?1 workspace, ?2 activity id, ?3/?4 record, ?5 property, ?6 at, ?7 actor, ?8 verb, ?9 summary, ?10 data, ?11 task, ?12 gate.
  const activity = (when: string) => `INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'staff', ?7, ?8, ?9, ?10 WHERE ${when}`;
  const binds = (actId: string, type: string, recId: string) => [ws, actId, type, recId, pid, at, ctx.actor.personaId, verb, summary, JSON.stringify({ task_id: id }), id, gate];
  const stmts = [
    // The gate: the task's own entry (its id is the gate id, so ?2 = ?12 always holds and every bound number is used).
    db.prepare(activity(`EXISTS (SELECT 1 FROM ${effective("tasks")} AS e WHERE e.id = ?11 AND e.status IN ${inList(from)}) AND ?12 = ?2`)).bind(...binds(gate, "tasks", id)),
    db.prepare(overlayUpsertSql("tasks", COLS, { status: `'${to}'`, completed_at: to === "Done" ? "?3" : "NULL" }, `e.status IN ${inList(from)} AND EXISTS (SELECT 1 FROM activity_events WHERE workspace_id = ?1 AND id = ?4)`))
      .bind(ws, id, to === "Done" ? at : null, gate),
  ];
  if (row.entity_type && row.entity_id) {
    stmts.push(db.prepare(activity("EXISTS (SELECT 1 FROM activity_events WHERE workspace_id = ?1 AND id = ?12)")).bind(...binds(crypto.randomUUID(), String(row.entity_type), String(row.entity_id))));
  }
  const results = await db.batch(stmts);
  return results[0].meta.changes > 0;
}

registerAction({
  key: "tasks.complete",
  label: "Mark done",
  entity: "tasks",
  roles: [...STAFF],
  icon: CircleCheck,
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
