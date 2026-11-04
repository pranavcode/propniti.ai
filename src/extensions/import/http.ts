import "server-only";
import { PORTAL_ROLES } from "@/entities/types";
import { readCtx, json, sameOrigin } from "@/app/api/e/_lib/http";
import { rateLimit } from "@/lib/guard";
import { getPlatform } from "@/lib/platform";
import { QueryError, type QueryCtx, type WriteCtx } from "@/server/query";
import { resolveWorkspace } from "@/server/workspace";

// Shared guard for the import routes: same origin, a rate limit, staff only. Writes also resolve
// (or create) the visitor's private workspace, which is where every import lands.

export async function importCtx(request: Request, kind: "ai" | "write"): Promise<QueryCtx | Response> {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused" }, 403);
  const limited = await rateLimit(request, kind);
  if (limited) return limited;
  const ctx = await readCtx(request);
  if ((PORTAL_ROLES as readonly string[]).includes(ctx.actor.role)) throw new QueryError(403, "Imports are for staff.");
  return ctx;
}

export async function writeWorkspace(request: Request, ctx: QueryCtx, create: boolean): Promise<{ ctx: WriteCtx; setCookie?: string } | Response> {
  const nowMs = Date.now();
  const { db, writeLimiter } = getPlatform();
  const r = await resolveWorkspace(db, request, nowMs, create, !!writeLimiter);
  if (r instanceof Response) return r;
  if (!r.ws) throw new QueryError(404, "No import in this workspace.");
  return { ctx: { ...ctx, ws: r.ws, nowMs }, setCookie: r.setCookie };
}
