import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { can } from "@/entities";
import type { ActionDef, ActionResult } from "@/entities/types";
import { getAction } from "@/extensions/actions";
import { rateLimit } from "@/lib/guard";
import { forgetOverlay, getDef, getRow, QueryError, type WriteCtx } from "@/server/query";

// Runs a named action on one record: the action must belong to the entity, the role must be
// allowed (action roles and module access), the row must be in scope and pass `when`. Each run
// that succeeds is audited here, so handlers don't need to write their own audit row for it.

export function resolveAction(entity: string, actionKey: string): ActionDef {
  const def = getDef(entity);
  const key = actionKey.includes(".") ? actionKey : `${def.key}.${actionKey}`;
  const a = getAction(key);
  if (!a || a.entity !== def.key) throw new QueryError(404, `Unknown action "${actionKey}" on ${def.label.many.toLowerCase()}`);
  return a;
}

// Actions that call a model also count against the AI limit (20/min per client), on top of the
// write limit every action gets.
export const aiLimit = (request: Request, a: ActionDef) => (a.ai ? rateLimit(request, "ai") : Promise.resolve(null));

export const inputSchema = (a: ActionDef) => (a.input as z.ZodType | undefined) ?? z.object({}).passthrough();

export async function runAction(ctx: WriteCtx, a: ActionDef, id: string, input: unknown): Promise<ActionResult> {
  const def = getDef(a.entity);
  if (!can(ctx.actor.role, a.key, def.key)) throw new QueryError(403, `You can't ${a.label.toLowerCase()}`);
  const row = await getRow(ctx, def.key, id);
  if (!row) throw new QueryError(404, `${def.label.one} not found`);
  if (a.when && !a.when(row)) return { status: 409, error: `${a.label} isn't available for this ${def.label.one.toLowerCase()} right now` };
  const result = await a.handler({ db: ctx.db, ws: ctx.ws, actor: ctx.actor, nowMs: ctx.nowMs }, row, input);
  forgetOverlay(ctx.actor);
  if (result.status === 200) {
    await ctx.db.prepare("INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, action, entity_type, entity_id, property_id, detail, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ctx.ws, crypto.randomUUID(), demoNowIso(ctx.nowMs), ctx.actor.name, ctx.actor.personaId, ctx.actor.role, a.key, def.key, id, typeof row.property_id === "string" ? row.property_id : null, result.message ?? a.label, JSON.stringify(input ?? {}).slice(0, 4000))
      .run();
  }
  return result;
}
