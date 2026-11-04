import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { PERMISSIONS } from "@/auth/personas";
import { insert, newId, upsertOverlay } from "@/ai/data";
import { dataOf, guarded, json, writeSession } from "@/ai/http";

const Body = z.object({
  limit_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  owner_approval_over_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  approver_role: z.enum(["principal", "regional_manager", "property_manager", "accountant", "maintenance_supervisor", "broker", "admin"]).optional(),
});

// Approval policy editor on the agents page: auto-approve limit, owner threshold, approver role.
// Legal and safety stay always-human; that flag isn't editable here.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const w = await writeSession(request, Body, "write", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    if (!["principal", "admin", "regional_manager"].includes(s.actor.role) || PERMISSIONS[s.actor.role].intelligence === "none") return json({ error: `${s.persona.title} can't change approval policies` }, { status: 403 });
    const r = await upsertOverlay(dataOf(s), "approval_policies", id, body);
    await (await insert(s.db, s.ws, "audit", { id: newId("aud"), at: demoNowIso(), actor: s.persona.name, actor_id: s.persona.id, role: s.actor.role, action: "approval_policy.changed", entity_type: "approval_policies", entity_id: id, detail: String(r.row.category), before_json: JSON.stringify(r.before), after_json: JSON.stringify(r.after) })).run();
    return json({ ok: true, policy: r.row }, { setCookie: s.setCookie });
  });
}
