import type { z } from "zod";
import { sessionFromRequest } from "@/auth/session";
import { rateLimit } from "@/lib/guard";
import { secureOrigin } from "@/lib/https";
import { getPlatform } from "@/lib/platform";
import { parseBody } from "@/lib/requests";
import { QueryError, type QueryCtx, type WriteCtx } from "@/server/query";
import { cookieHeader, resolveWorkspace } from "@/server/workspace";

// HTTP glue for the generic entity API: errors to JSON, read context, and the write path
// (same-origin check, write rate limit, capped zod-checked body, the visitor's workspace).

export const MAX_WRITE_BYTES = 64 * 1024;
const noStore = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, setCookie?: string) {
  const headers = new Headers(noStore);
  if (setCookie) headers.set("Set-Cookie", cookieHeader(setCookie));
  return Response.json(body, { status, headers });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QueryError) return json({ error: e.message }, e.status);
    console.error("entity api", e);
    return json({ error: "Something went wrong" }, 500);
  }
}

export async function readCtx(request: Request): Promise<QueryCtx> {
  const s = await sessionFromRequest(request);
  return { db: getPlatform().db, ws: s.ws, actor: s.actor };
}

// Browsers send Origin on every POST/PATCH/DELETE; a mismatch means another site sent it.
export const sameOrigin = (request: Request) =>
  secureOrigin(request.headers.get("origin"), request.headers.get("host") ?? new URL(request.url).host, process.env.NODE_ENV === "production");

export type Written<T> = { ctx: WriteCtx; body: T; setCookie?: string };

// The guarded write path. `schema` may depend on the actor (fields editable by role), so it is
// a function of the read context. Returns a Response when the request is refused.
export async function writeCtx<S extends z.ZodType>(request: Request, schema: S | ((ctx: QueryCtx) => S), nowMs = Date.now()): Promise<Written<z.infer<S>> | Response> {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused" }, 403);
  const limited = await rateLimit(request, "write");
  if (limited) return limited;
  const base = await readCtx(request);
  const s = typeof schema === "function" ? (schema as (ctx: QueryCtx) => S)(base) : schema;
  const body = await parseBody(request, s, MAX_WRITE_BYTES);
  if (body instanceof Response) return body;
  const { db, writeLimiter } = getPlatform();
  const r = await resolveWorkspace(db, request, nowMs, true, !!writeLimiter);
  if (r instanceof Response) return r;
  return { ctx: { ...base, ws: r.ws!, nowMs }, body, setCookie: r.setCookie };
}
