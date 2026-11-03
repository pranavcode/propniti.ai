import "server-only";
import { currentSession, type Session } from "@/auth/session";
import { PERSONAS, type Persona } from "@/auth/personas";
import type { PortalRole, Row } from "@/entities/types";
import { getPlatform } from "@/lib/platform";
import type { Db } from "@/lib/platform/types";
import { expand } from "@/server/query";
import { settle } from "@/server/money";

// Server context for /portal/<role> pages: who is signed in, their own record id and a reader
// over base + their overlay. Portal pages read only rows tied to that record id.

export type PortalCtx = { db: Db; ws: string | null; session: Session; persona: Persona; me: string };

export const portalPersona = (role: PortalRole) => PERSONAS.find((p) => p.role === role)!;

// null when the visitor is signed in as someone else (the layout offers a one-click switch).
export async function portalCtx(role: PortalRole): Promise<PortalCtx | null> {
  const session = await currentSession();
  if (session.persona.role !== role || !session.persona.record) return null;
  const db = getPlatform().db;
  // Settle-on-read (plan §1): ACH payments whose window has passed clear on the next visit.
  if (session.ws) await settle(db, session.ws, Date.now()).catch(() => undefined);
  return { db, ws: session.ws, session, persona: session.persona, me: session.persona.record.id };
}

// SQL helpers over effective rows. `{t}` in the SQL expands to the table's effective rows.
export async function rows<T = Row>(c: PortalCtx, sql: string, ...binds: unknown[]): Promise<T[]> {
  // Spread into plain objects: node:sqlite rows have a null prototype, which client props reject.
  return (await c.db.prepare(expand(sql, c.ws)).bind(...binds).all<T>()).results.map((r) => ({ ...r }));
}
export async function row<T = Row>(c: PortalCtx, sql: string, ...binds: unknown[]): Promise<T | null> {
  const r = await c.db.prepare(expand(sql, c.ws)).bind(...binds).first<T>();
  return r ? { ...r } : null;
}
