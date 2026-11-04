import { demoNowIso } from "@/lib/clock";
import { PERSONAS, type Persona } from "@/auth/personas";
import { scopeProperties } from "@/server/permissions";
import { sql } from "./data";
import { canDecide } from "./http";
import type { AiSession } from "./session";
import { proposal } from "./views";

// "Notify approver": someone who can see a proposal but not decide it (an admin, a leasing agent)
// pings the people who can. Recipients are staff whose scope covers the proposal's property and who
// may decide it: the assignee role, or else the nearest manager up the chain. One notification per proposal,
// recipient and day: the id carries the date and the unique index drops repeats, double clicks included.

const CHAIN = ["property_manager", "regional_manager", "principal"];
type Who = Pick<AiSession, "db" | "ws" | "actor" | "persona">;
type Result = { ok: true; notified: string[]; message: string } | { ok: false; status: number; error: string };

export async function notifyApprover(s: Who, id: string, nowIso = demoNowIso()): Promise<Result> {
  const data = { db: s.db, ws: s.ws, actor: s.actor };
  const p = await proposal(data, id);
  if (!p) return { ok: false, status: 404, error: "Not found" };
  if ((await sql(data, "SELECT id FROM {ai_decisions} WHERE proposal_id = ? LIMIT 1", [id])).length) return { ok: false, status: 409, error: "Already decided" };
  if ((await canDecide(s, p)).ok) return { ok: false, status: 409, error: "You can decide this one yourself." };

  const ws = s.ws === "base" ? null : s.ws;
  const able: Persona[] = [];
  for (const persona of PERSONAS) {
    if (persona.portal || persona.id === s.persona.id) continue;
    const propertyIds = await scopeProperties(s.db, ws, persona);
    if (p.property_id && propertyIds !== "all" && !propertyIds.includes(String(p.property_id))) continue;
    const actor = { personaId: persona.id, name: persona.name, role: persona.role, scope: persona.scope, propertyIds };
    if ((await canDecide({ db: s.db, ws: s.ws, actor, persona }, p)).ok) able.push(persona);
  }
  // The assignee role when anyone in scope holds it; otherwise the nearest manager up the chain.
  const to = [p.assignee_role, ...CHAIN].map((role) => able.filter((x) => x.role === role)).find((x) => x.length) ?? able;
  if (!to.length) return { ok: false, status: 409, error: "No one in scope can decide this one; check the approval policies." };

  const day = nowIso.slice(0, 10);
  const res = await s.db.batch(to.map((r) => s.db.prepare(
    "INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at) VALUES (?, ?, ?, 'In-app', ?, ?, ?, 'ai_proposals', ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING",
  ).bind(s.ws, `ntf-appr-${id}-${r.id}-${day}`, r.id, "An approval is waiting on you", `${s.persona.name} (${s.persona.title}) asked you to decide: ${String(p.title)}.`, `/app/ai/approvals?proposal=${encodeURIComponent(id)}`, id, nowIso)));
  const notified = to.filter((_, i) => res[i].meta.changes > 0).map((r) => r.name);
  if (!notified.length) return { ok: false, status: 409, error: "Already notified today" };
  return { ok: true, notified, message: `Notified ${notified.join(", ")}` };
}
