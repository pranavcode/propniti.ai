import { after } from "next/server";
import type { z } from "zod";
import { getEntity } from "@/entities";
import { PERMISSIONS } from "@/auth/personas";
import { INTERNAL_ROLES, type Row } from "@/entities/types";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";
import { sql, type DataCtx } from "./data";
import { aiSession, json, sameOrigin, type AiSession } from "./session";

// HTTP glue for /api/ai/*: session, origin and rate-limit checks, background work via after()
// (Cloudflare ctx.waitUntil under vinext), and who may decide a proposal.

export { json };
export const waitUntil = (p: Promise<unknown>) => after(p);
export const dataOf = (s: AiSession): DataCtx => ({ db: s.db, ws: s.ws, actor: s.actor });

export async function readSession(request: Request) {
  return aiSession(request);
}

// Staff-only AI routes (agents, runs, approvals, data health): portal personas get 403.
export const portalRefused = (s: AiSession) => (s.persona.portal ? json({ error: "This is a staff page." }, { status: 403 }) : null);

export async function staffSession(request: Request) {
  const s = await aiSession(request);
  return s instanceof Response ? s : portalRefused(s) ?? s;
}

// Writes: same origin, rate limit (AI calls use the AI limiter), capped zod body, own workspace.
export async function writeSession<S extends z.ZodType>(request: Request, schema: S | null, kind: "ai" | "write" = "write", opts: { staff?: boolean } = {}): Promise<{ s: AiSession; body: z.infer<S> } | Response> {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, kind);
  if (limited) return limited;
  let body: z.infer<S> = undefined as z.infer<S>;
  if (schema) {
    const b = await parseBody(request, schema, 16 * 1024);
    if (b instanceof Response) return b;
    body = b;
  }
  if (opts.staff) {
    const r = await aiSession(request);
    if (!(r instanceof Response) && r.persona.portal) return json({ error: "This is a staff page." }, { status: 403 });
  }
  const s = await aiSession(request, { write: true });
  if (s instanceof Response) return s;
  return { s, body };
}

export async function guarded(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    console.error("[ai] route failed:", err);
    return json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status: 400 });
  }
}

// Who may decide an agent's proposal. Agents act on other people's records (reminders to other
// households, data fixes), so portal users never decide them; the one exception is an owner
// approving a spend that waits on them, for a property they own. Staff need write access to the
// record's module for low-risk items and approve access for anything with money, legal or safety risk.
export async function canDecide(s: Pick<AiSession, "db" | "ws" | "actor" | "persona">, p: Row): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = s.actor.role;
  if (s.persona.portal) {
    if (role === "owner" && p.queue_state === "waiting" && p.assignee_role === "owner" && (await ownsProposal(s, p))) return { ok: true };
    return { ok: false, error: "Only staff can act on agent proposals." };
  }
  if (!(INTERNAL_ROLES as readonly string[]).includes(role)) return { ok: false, error: "Only staff can act on agent proposals." };
  if (p.queue_state === "waiting") return role === "principal" ? { ok: true } : { ok: false, error: "This one waits for the owner's approval in their portal." };
  const mod = getEntity(String(p.entity_type))?.module ?? "intelligence";
  const access = PERMISSIONS[role][mod] ?? "none";
  const needsApprove = p.risk !== "Low" || p.amount_cents != null;
  if (needsApprove ? access === "approve" : access === "write" || access === "approve") return { ok: true };
  return { ok: false, error: `${s.persona.title} can't ${needsApprove ? "approve" : "act on"} ${mod} items${p.assignee_role ? `; this one goes to the ${String(p.assignee_role).replace(/_/g, " ")}` : ""}.` };
}

// The owner persona's record is an owners row; the proposal's property must belong to one of its entities.
async function ownsProposal(s: Pick<AiSession, "db" | "ws" | "persona">, p: Row) {
  const owner = s.persona.record?.entity === "owners" ? s.persona.record.id : null;
  if (!owner || !p.property_id) return false;
  const data = { db: s.db, ws: s.ws, actor: { personaId: s.persona.id, name: s.persona.name, role: s.persona.role, scope: s.persona.scope, propertyIds: "all" as const } };
  const r = await sql<{ n: number }>(data, "SELECT count(*) AS n FROM {properties} pr JOIN {owner_entities} e ON e.id = pr.owner_entity_id WHERE pr.id = ? AND e.owner_id = ?", [String(p.property_id), owner]);
  return (r[0]?.n ?? 0) > 0;
}
