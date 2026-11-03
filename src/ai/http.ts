import { after } from "next/server";
import type { z } from "zod";
import { getEntity } from "@/entities";
import { PERMISSIONS } from "@/auth/personas";
import type { Row } from "@/entities/types";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";
import type { DataCtx } from "./data";
import { aiSession, json, sameOrigin, type AiSession } from "./session";

// HTTP glue for /api/ai/*: session, origin and rate-limit checks, background work via after()
// (Cloudflare ctx.waitUntil under vinext), and who may decide a proposal.

export { json };
export const waitUntil = (p: Promise<unknown>) => after(p);
export const dataOf = (s: AiSession): DataCtx => ({ db: s.db, ws: s.ws, actor: s.actor });

export async function readSession(request: Request) {
  return aiSession(request);
}

// Writes: same origin, rate limit (AI calls use the AI limiter), capped zod body, own workspace.
export async function writeSession<S extends z.ZodType>(request: Request, schema: S | null, kind: "ai" | "write" = "write"): Promise<{ s: AiSession; body: z.infer<S> } | Response> {
  if (!sameOrigin(request)) return json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, kind);
  if (limited) return limited;
  let body: z.infer<S> = undefined as z.infer<S>;
  if (schema) {
    const b = await parseBody(request, schema, 16 * 1024);
    if (b instanceof Response) return b;
    body = b;
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

// Low-risk proposals need write access to the record's module; anything with money, legal or
// safety risk needs approve access. An item waiting on the owner is the owner's call.
export function canDecide(s: AiSession, p: Row): { ok: true } | { ok: false; error: string } {
  const role = s.actor.role;
  if (p.queue_state === "waiting") return p.assignee_role === role || role === "principal" ? { ok: true } : { ok: false, error: "This one waits for the owner's approval in their portal." };
  const mod = getEntity(String(p.entity_type))?.module ?? "intelligence";
  const access = PERMISSIONS[role][mod] ?? "none";
  const needsApprove = p.risk !== "Low" || p.amount_cents != null;
  if (needsApprove ? access === "approve" : access === "write" || access === "approve") return { ok: true };
  return { ok: false, error: `${s.persona.title} can't ${needsApprove ? "approve" : "act on"} ${mod} items${p.assignee_role ? `; this one goes to the ${String(p.assignee_role).replace(/_/g, " ")}` : ""}.` };
}
