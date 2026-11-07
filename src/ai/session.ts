import type { Actor } from "@/entities/types";
import { personaFromCookieHeader, type Persona } from "@/auth/personas";
import { getPlatform } from "@/lib/platform";
import { actorFor } from "@/server/permissions";
import type { Db } from "@/lib/platform/types";
import { cookieHeader, readCookie, resolveWorkspace } from "@/server/workspace";

// Who is asking and which workspace they act in, for the AI routes. Reads without a workspace
// cookie see the shared base; anything that writes (runs, proposals, decisions) needs the
// visitor's own workspace, which `create` makes on first use.

// Scope comes from lane C's resolver. Portal personas are matched row by row in their portals, so
// the AI gives them no property-wide reads (a resident's property id would show every resident's balance).
export async function aiActor(db: Db, ws: string, persona: Persona): Promise<Actor> {
  const actor = await actorFor(db, ws === "base" ? null : ws, persona);
  return persona.portal ? { ...actor, propertyIds: [] } : actor;
}

export type AiSession = { db: Db; ws: string; actor: Actor; persona: Persona; setCookie?: string; nowMs: number };

export async function aiSession(request: Request, opts: { write?: boolean } = {}): Promise<AiSession | Response> {
  const { db, writeLimiter } = getPlatform();
  const nowMs = Date.now();
  const persona = personaFromCookieHeader(request.headers.get("cookie"));
  let ws = readCookie(request);
  let setCookie: string | undefined;
  if (opts.write || ws) {
    const r = await resolveWorkspace(db, request, nowMs, !!opts.write, !!writeLimiter);
    if (r instanceof Response) return r;
    ws = r.ws;
    setCookie = r.setCookie;
  }
  return { db, ws: ws ?? "base", actor: await aiActor(db, ws ?? "base", persona), persona, setCookie, nowMs };
}

// Browsers send Origin on every POST; a mismatch means another site is submitting the request.
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

export function json(body: unknown, init: { status?: number; setCookie?: string } = {}) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (init.setCookie) headers.set("Set-Cookie", cookieHeader(init.setCookie));
  return Response.json(body, { status: init.status ?? 200, headers });
}
