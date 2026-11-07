import { after } from "next/server";
import type { z } from "zod";
import type { Row } from "@/entities/types";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";
import { DB_BUSY, publicError, sql, type DataCtx } from "./data";
import { MODEL_DOWN, ModelError } from "./providers";
import { LIFE_SAFETY_ROLES, safetyJobs, vendorsTurnedOff } from "./life-safety";
import { needsApprove, staffDecision } from "./decide";
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

export { DB_BUSY, publicError };

export async function guarded(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    // The provider's own error was logged where it happened (providers/index.ts).
    if (err instanceof ModelError) return json({ error: MODEL_DOWN }, { status: 503 });
    const message = err instanceof Error ? err.message : "Something went wrong";
    const shown = publicError(message);
    if (shown === message) console.error("[ai] route failed:", err);
    return json({ error: shown }, { status: shown === DB_BUSY ? 503 : 400 });
  }
}

export { needsApprove };

// Who may decide an agent's proposal. Agents act on other people's records (reminders to other
// households, data fixes), so portal users never decide them; the one exception is an owner
// approving a spend that waits on them, for a property they own. Staff follow staffDecision (decide.ts).
export async function canDecide(s: Pick<AiSession, "db" | "ws" | "actor" | "persona">, p: Row): Promise<{ ok: true } | { ok: false; error: string }> {
  if (s.persona.portal) {
    if (s.actor.role === "owner" && p.queue_state === "waiting" && p.assignee_role === "owner" && (await ownsProposal(s, p))) return { ok: true };
    return { ok: false, error: "Only staff can act on agent proposals." };
  }
  // Checked again now: emergency jobs may have reached the vendor after the proposal was written.
  if (!LIFE_SAFETY_ROLES.includes(s.actor.role) && (await safetyJobs(s.db, s.ws, vendorsTurnedOff(p)))) {
    return { ok: false, error: `${s.persona.title} can't take a vendor with open emergency or life-safety work orders off work. Approver: principal or regional manager.` };
  }
  return staffDecision(s.actor.role, p, s.persona.title);
}

// The owner persona's record is an owners row; the proposal's property must belong to one of its entities.
async function ownsProposal(s: Pick<AiSession, "db" | "ws" | "persona">, p: Row) {
  const owner = s.persona.record?.entity === "owners" ? s.persona.record.id : null;
  if (!owner || !p.property_id) return false;
  const data = { db: s.db, ws: s.ws, actor: { personaId: s.persona.id, name: s.persona.name, role: s.persona.role, scope: s.persona.scope, propertyIds: "all" as const } };
  // The owner_id join is the check; property scope (none for a portal user) doesn't apply.
  const r = await sql<{ n: number }>(data, "SELECT count(*) AS n FROM {properties} pr JOIN {owner_entities} e ON e.id = pr.owner_entity_id WHERE pr.id = ? AND e.owner_id = ?", [String(p.property_id), owner], { unscoped: true });
  return (r[0]?.n ?? 0) > 0;
}
