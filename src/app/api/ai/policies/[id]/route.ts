import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { INTERNAL_ROLES, type Role } from "@/entities/types";
import { canEditPolicies } from "@/ai/policy-editors";
import { policyEditRefusal } from "@/ai/policy-scope";
import { get, insert, newId, upsertOverlay } from "@/ai/data";
import { dataOf, guarded, json, writeSession } from "@/ai/http";

const Body = z.object({
  limit_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  owner_approval_over_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  approver_role: z.enum(INTERNAL_ROLES.filter((r) => r !== "platform_admin") as [Role, ...Role[]]).optional(),
  always_human: z.boolean().optional(),
});
const ALWAYS_HUMAN = ["Legal", "Safety"];

// The one write path for approval policies (Agents page and Settings → Approval policies): limit,
// owner threshold, approver role and "always a person". Legal and safety stay always-human.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const w = await writeSession(request, Body, "write", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    if (!canEditPolicies(s.actor.role)) return json({ error: `${s.persona.title} can't change approval policies` }, { status: 403 });
    const cur = await get(dataOf(s), "approval_policies", id);
    if (!cur) return json({ error: "Policy not found" }, { status: 404 });
    if (body.always_human === false && ALWAYS_HUMAN.includes(String(cur.category))) return json({ error: `${cur.category} decisions always need a person` }, { status: 400 });
    const refused = await policyEditRefusal(s.db, s.ws, s.actor, cur, body);
    if (refused) return json({ error: refused }, { status: body.owner_approval_over_cents === null ? 400 : 403 });
    const r = await upsertOverlay(dataOf(s), "approval_policies", id, body);
    await (await insert(s.db, s.ws, "audit", { id: newId("aud"), at: demoNowIso(), actor: s.persona.name, actor_id: s.persona.id, role: s.actor.role, action: "approval_policy.changed", entity_type: "approval_policies", entity_id: id, detail: String(r.row.category), before_json: JSON.stringify(r.before), after_json: JSON.stringify(r.after) })).run();
    return json({ ok: true, policy: r.row }, { setCookie: s.setCookie });
  });
}
