import { effective } from "@/server/query";
import { handle, json, readCtx } from "../e/_lib/http";
import { recipientIds } from "./shared";

// Notification centre feed for the acting persona: newest 30, plus the unread count.
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await readCtx(request);
    const who = JSON.stringify(recipientIds(ctx.actor));
    const from = `FROM ${effective("notifications", ctx.ws)} WHERE user_id IN (SELECT value FROM json_each(?))`;
    const [rows, unread] = await Promise.all([
      ctx.db.prepare(`SELECT id, title, body, href, entity_type, entity_id, at, read_at ${from} ORDER BY at DESC LIMIT 30`).bind(who).all(),
      ctx.db.prepare(`SELECT count(*) AS n ${from} AND read_at IS NULL`).bind(who).first<{ n: number }>(),
    ]);
    // Stored hrefs are links into the app only.
    const out = rows.results.map((r) => ({ ...r, href: typeof r.href === "string" && /^\/(?!\/)/.test(r.href) ? r.href : null }));
    return json({ rows: out, unread: Number(unread?.n ?? 0) });
  });
}
