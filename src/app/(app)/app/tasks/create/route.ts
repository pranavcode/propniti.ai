import { can } from "@/entities";
import { handle, json, writeCtx } from "@/app/api/e/_lib/http";
import { createTask, newTaskSchema } from "@/extensions/intelligence/my-tasks";

// POST /app/tasks/create: "New task" on My tasks. Same guarded write path as the entity API
// (same origin, write rate limit, capped body, the visitor's workspace).
export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, newTaskSchema);
    if (w instanceof Response) return w;
    if (w.ctx.actor.scope.kind === "self" || !can(w.ctx.actor.role, "read", "tasks")) return json({ error: "You can't add tasks" }, 403, w.setCookie);
    const r = await createTask(w.ctx, w.body);
    return json(r.status === 200 ? { ok: true, id: r.id } : { error: r.error }, r.status, w.setCookie);
  });
}
