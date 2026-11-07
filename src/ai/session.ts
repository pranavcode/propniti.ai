import type { Actor } from "@/entities/types";
import { inLakeside, personaFromCookieHeader, type Persona } from "@/auth/personas";
import { getPlatform } from "@/lib/platform";
import { actorFor } from "@/server/permissions";
import type { Db } from "@/lib/platform/types";
import { cookieHeader, readCookie, resolveWorkspace } from "@/server/workspace";

// Who is asking and which workspace they act in, for the AI routes. Reads without a workspace
// cookie see the shared base; anything that writes (runs, proposals, decisions) needs the
// visitor's own workspace, which `create` makes on first use.

// Scope comes from lane C's resolver. Vendor and applicant portals are matched row by row elsewhere,
// so the AI gives them no property-wide reads.
export async function aiActor(db: Db, ws: string, persona: Persona): Promise<Actor> {
  const actor = await actorFor(db, ws === "base" ? null : ws, persona);
  return persona.portal && actor.propertyIds === "all" ? { ...actor, propertyIds: [] } : actor;
}

export type AiSession = { db: Db; ws: string; actor: Actor; persona: Persona; setCookie?: string; nowMs: number };

export async function aiSession(request: Request, opts: { write?: boolean } = {}): Promise<AiSession | Response> {
  const { db, writeLimiter } = getPlatform();
  const nowMs = Date.now();
  const persona = personaFromCookieHeader(request.headers.get("cookie"));
  let ws = readCookie(request);
  let setCookie: string | undefined;
  // Lakeside personas always get their own workspace: the "base" fallback below is Summit's data.
  const lakeside = inLakeside(persona);
  if (opts.write || ws || lakeside) {
    const r = await resolveWorkspace(db, request, nowMs, !!opts.write || lakeside, !!writeLimiter);
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
