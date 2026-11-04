import { z } from "zod";
import { registerAction } from "@/extensions/actions";
import { getPersona } from "@/auth/personas";
import { INTERNAL_ROLES, type EntityKey } from "@/entities/types";
import { eff } from "./data";
import { AI_ACTIONS } from "./action-keys";
import { executeProposal } from "./effects";
import { canDecide, needsApprove } from "./http";

// Named actions that only agents propose. Each runs its proposal's effects (messages, tasks, narrow
// record updates), so approving through the approvals inbox or through the generic action route
// (POST /api/e/<entity>/<id>/actions/<action>, input { proposal_id }) does the same thing once.
// Actions other modules already register (bills.approve, applications.decide, …) stay theirs.

const Input = z.object({ proposal_id: z.string().max(80).optional(), note: z.string().max(500).optional() }).passthrough();

for (const a of AI_ACTIONS) {
  registerAction({
    key: a.key,
    label: a.label,
    entity: a.key.split(".")[0] as EntityKey,
    roles: [...INTERNAL_ROLES],
    input: Input,
    help: { summary: "Proposed by an AI agent; approving runs exactly what the proposal shows, once, and logs it to the audit trail." },
    handler: async (ctx, row, input) => {
      const e = eff("ai_proposals", ctx.ws);
      const d = eff("ai_decisions", ctx.ws);
      // Only open proposals: one already approved, rejected or auto-applied isn't waiting for anyone.
      const p = await ctx.db
        .prepare(`SELECT t.* FROM ${e.sql} t WHERE t.action = ? AND t.entity_id = ? ${input.proposal_id ? "AND t.id = ?" : ""} AND NOT EXISTS (SELECT 1 FROM ${d.sql} d WHERE d.proposal_id = t.id) ORDER BY t.created_at DESC LIMIT 1`)
        .bind(...e.params, a.key, String(row.id), ...(input.proposal_id ? [input.proposal_id] : []), ...d.params)
        .first<Record<string, unknown>>();
      if (!p) return { status: 404, error: "No open AI proposal for this record; this action only runs what an agent proposed" };
      // Same rule as the approvals inbox. A money, legal or safety proposal the caller can't approve
      // stays in the inbox for someone who can.
      const persona = getPersona(ctx.actor.personaId);
      const allowed = persona ? await canDecide({ db: ctx.db, ws: ctx.ws, actor: ctx.actor, persona }, p) : { ok: false as const, error: "Unknown persona" };
      if (!allowed.ok) {
        return needsApprove(p)
          ? { status: 202, message: `${allowed.error} It waits in the approvals inbox.`, proposalId: String(p.id) }
          : { status: 403, error: allowed.error };
      }
      const r = await executeProposal({ db: ctx.db, ws: ctx.ws, actor: ctx.actor }, p, { id: ctx.actor.personaId, name: ctx.actor.name, role: ctx.actor.role }, undefined, input.note ?? "");
      return r.ok ? { status: 200, message: r.message, href: r.href } : { status: (r.status ?? 400) as 400 | 404 | 409, error: r.message };
    },
  });
}
