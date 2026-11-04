import { z } from "zod";
import { can } from "@/entities";
import { handle, json, writeCtx } from "@/app/api/e/_lib/http";
import { draftNotice } from "@/extensions/intelligence/notice-draft";

// POST /app/tasks/notice { task_id }: the notice-of-entry draft for "Draft notice" on My tasks.
// Writes nothing; it goes through the write context for the same origin check, rate limit and
// body cap as the actions that follow it.
export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, z.strictObject({ task_id: z.string().min(1).max(80) }));
    if (w instanceof Response) return w;
    if (w.ctx.actor.scope.kind === "self" || !can(w.ctx.actor.role, "tasks.send_notice", "tasks")) return json({ error: "You can't send notices" }, 403, w.setCookie);
    const r = await draftNotice(w.ctx, w.body.task_id);
    return json(r.status === 200 ? { draft: r.draft } : { error: r.error }, r.status, w.setCookie);
  });
}
