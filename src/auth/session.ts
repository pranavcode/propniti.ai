import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Actor } from "@/entities/types";
import { getPlatform } from "@/lib/platform";
import { actorFor } from "@/server/permissions";
import { readCookie } from "@/server/workspace";
import { DEFAULT_PERSONA, getPersona, PN_AS, personaFromCookieHeader, type Persona } from "./personas";

// Who this request acts as. The persona comes from the pn_as cookie (a demo switcher, not a
// security boundary); the workspace from pn_ws. Scope is still enforced server-side for
// whichever persona is chosen.

const WS_ID = /^[A-Za-z0-9_-]{22,64}$/;

// The persona this request acts as (pn_as cookie), for server components and route handlers.
export async function currentPersona(): Promise<Persona> {
  const id = (await cookies()).get(PN_AS)?.value;
  return getPersona(id) ?? getPersona(DEFAULT_PERSONA)!;
}

// Whether the visitor picked a persona yet (the sign-in page sets it).
export async function hasPersona(): Promise<boolean> {
  return !!getPersona((await cookies()).get(PN_AS)?.value);
}

export type Session = { persona: Persona; actor: Actor; ws: string | null };

// Server components: the acting persona, its resolved scope and the visitor's workspace (null
// until their first write; reads then see base data only).
// Memoized per request (React cache): the layout, the page and its metadata share one scope lookup.
export const currentSession = cache(async (): Promise<Session> => {
  const jar = await cookies();
  const persona = getPersona(jar.get(PN_AS)?.value) ?? getPersona(DEFAULT_PERSONA)!;
  const raw = jar.get("pn_ws")?.value;
  const ws = raw && WS_ID.test(raw) ? raw : null;
  return { persona, ws, actor: await actorFor(getPlatform().db, ws, persona) };
});

// Route handlers: same, from the request headers.
export async function sessionFromRequest(request: Request): Promise<Session> {
  const persona = personaFromCookieHeader(request.headers.get("cookie"));
  const ws = readCookie(request);
  return { persona, ws, actor: await actorFor(getPlatform().db, ws, persona) };
}
