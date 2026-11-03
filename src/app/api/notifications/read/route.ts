import { z } from "zod";
import { effective } from "@/server/query";
import { handle, json, writeCtx } from "../../e/_lib/http";
import { recipientIds } from "../shared";

const ReadBody = z.strictObject({ ids: z.array(z.string().min(1).max(80)).max(100).optional() });

// Marks the persona's notifications read (the listed ids, or all). Base rows are read-only, so
// this copies each unread row into the visitor's overlay with read_at set.
export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, ReadBody);
    if (w instanceof Response) return w;
    const { ctx, body, setCookie } = w;
    const at = new Date(ctx.nowMs).toISOString();
    const filter = body.ids ? " AND id IN (SELECT value FROM json_each(?))" : "";
    const binds: unknown[] = [ctx.ws, at, JSON.stringify(recipientIds(ctx.actor)), ...(body.ids ? [JSON.stringify(body.ids)] : [])];
    const res = await ctx.db.prepare(
      `INSERT INTO notifications (workspace_id, id, deleted, user_id, channel, title, body, href, entity_type, entity_id, read_at, at)
       SELECT ?1, id, 0, user_id, channel, title, body, href, entity_type, entity_id, ?2, at FROM ${effective("notifications", ctx.ws)}
       WHERE user_id IN (SELECT value FROM json_each(?3)) AND read_at IS NULL${filter.replace("?", "?4")}
       ON CONFLICT (workspace_id, id) DO UPDATE SET read_at = coalesce(notifications.read_at, excluded.read_at)`,
    ).bind(...binds).run();
    return json({ marked: res.meta?.changes ?? 0 }, 200, setCookie);
  });
}
