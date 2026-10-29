import type { z } from "zod";
import { rateLimit } from "@/lib/guard";
import { getPlatform } from "@/lib/platform";
import type { Db } from "@/lib/platform/types";
import { parseBody } from "@/lib/requests";
import { seed } from "@/lib/seed";
import type { DemoState } from "@/lib/types";
import { settle, type Outcome } from "./money";
import { loadState, trimStatements } from "./repo";
import { cookieHeader, resolveWorkspace } from "./workspace";

// Shared request handling for the demo data routes. Every response carries the fresh state,
// so the browser just replaces what it shows.

const MAX_WRITE_BYTES = 64 * 1024;

function respond(body: object, status: number, setCookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie) headers.set("Set-Cookie", cookieHeader(setCookie));
  return Response.json(body, { status, headers });
}

// Browsers send Origin on every POST; a mismatch means another site is submitting the request.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

export async function readState(request: Request, nowMs = Date.now()) {
  const { db, writeLimiter } = getPlatform();
  const r = await resolveWorkspace(db, request, nowMs, false, !!writeLimiter);
  if (r instanceof Response) return r;
  if (!r.ws) return respond({ state: seed() }, 200, r.setCookie);
  await settle(db, r.ws, nowMs);
  return respond({ state: await loadState(db, r.ws) }, 200, r.setCookie);
}

export type WriteContext<T> = { db: Db; ws: string; state: DemoState; body: T; nowMs: number };

// Checks origin, rate limit and body; finds or creates the workspace; settles due transfers;
// applies the action; then answers with the fresh state (and the error, if it was refused).
export async function write<S extends z.ZodType>(request: Request, schema: S, apply: (ctx: WriteContext<z.infer<S>>) => Promise<Outcome>, nowMs = Date.now()) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, "write");
  if (limited) return limited;
  const body = await parseBody(request, schema, MAX_WRITE_BYTES);
  if (body instanceof Response) return body;
  const { db, writeLimiter } = getPlatform();
  const r = await resolveWorkspace(db, request, nowMs, true, !!writeLimiter);
  if (r instanceof Response) return r;
  const ws = r.ws!;
  await settle(db, ws, nowMs);
  const outcome = await apply({ db, ws, state: await loadState(db, ws), body, nowMs });
  await db.batch(trimStatements(db, ws));
  const state = await loadState(db, ws);
  return respond(outcome.status === 200 ? { state } : { state, error: outcome.error }, outcome.status, r.setCookie);
}
