import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { canEditPolicies } from "@/ai/policy-editors";
import { getAgent } from "@/ai/agents";
import { parseCron } from "@/ai/cron";
import { eff, insert, newId } from "@/ai/data";
import { guarded, json, writeSession } from "@/ai/http";

const Patch = z.object({
  enabled: z.boolean().optional(),
  autonomy: z.enum(["suggest", "act_with_approval", "auto_within_policy"]).optional(),
  schedule: z.string().max(60).nullable().optional(),
});

// Agent settings: on/off, autonomy and schedule. Written to the visitor's overlay row, audited.
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return guarded(async () => {
    const { key } = await params;
    const def = getAgent(key);
    if (!def) return json({ error: "Unknown agent" }, { status: 404 });
    const w = await writeSession(request, Patch, "write", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    // Agent settings apply to the whole org, so only the roles that set approval policies change them.
    if (!canEditPolicies(s.actor.role)) return json({ error: `${s.persona.title} can't change agent settings` }, { status: 403 });
    if (body.schedule) {
      try {
        parseCron(body.schedule);
      } catch (e) {
        return json({ error: (e as Error).message }, { status: 400 });
      }
    }
    const e = eff("agent_definitions", s.ws);
    const cur = await s.db.prepare(`SELECT * FROM ${e.sql} t WHERE t.id = ?`).bind(...e.params, key).first<Record<string, unknown>>();
    const triggers = { ...JSON.parse(String(cur?.triggers ?? "{}")) } as { schedule?: string | null; events?: string[] };
    if (!cur) Object.assign(triggers, def.triggers);
    if (body.schedule !== undefined) triggers.schedule = body.schedule ?? undefined;
    const next = {
      id: key, name: def.name, owner_role: def.ownerRole, goal: def.goal, tools: JSON.stringify(def.tools), triggers: JSON.stringify(triggers),
      autonomy: body.autonomy ?? cur?.autonomy ?? def.autonomy, enabled: body.enabled === undefined ? (cur ? Number(cur.enabled) : 1) : body.enabled ? 1 : 0,
      approval_policy_id: cur?.approval_policy_id ?? null, model: cur?.model ?? null,
    };
    await s.db.batch([
      s.db.prepare("DELETE FROM agent_definitions WHERE workspace_id = ? AND id = ?").bind(s.ws, key),
      await insert(s.db, s.ws, "agent_definitions", next),
      await insert(s.db, s.ws, "audit", {
        id: newId("aud"), at: demoNowIso(), actor: s.persona.name, actor_id: s.persona.id, role: s.actor.role, agent: key, action: "agent.settings_changed",
        entity_type: "agent_definitions", entity_id: key, detail: Object.entries(body).map(([k, v]) => `${k}: ${v}`).join(", "),
        before_json: JSON.stringify({ autonomy: cur?.autonomy ?? def.autonomy, enabled: cur ? Number(cur.enabled) : 1, schedule: cur ? JSON.parse(String(cur.triggers)).schedule : def.triggers.schedule }), after_json: JSON.stringify({ autonomy: next.autonomy, enabled: next.enabled, schedule: triggers.schedule }),
      }),
    ]);
    return json({ ok: true, agent: { key, enabled: next.enabled === 1, autonomy: next.autonomy, schedule: triggers.schedule ?? null } }, { setCookie: s.setCookie });
  });
}
