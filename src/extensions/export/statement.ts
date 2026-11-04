import "server-only";
import { can } from "@/entities";
import type { Session } from "@/auth/session";
import { entityInScope, entityOf, monthLabel, statementOf, type Ctx } from "@/extensions/owners/statements";
import { demoNowIso } from "@/lib/clock";
import type { ExportDoc } from "@/lib/export/types";
import { QueryError } from "@/server/query";

// An owner statement as an export document. Who may read it is the same rule as "Explain this
// line" (src/extensions/owners/explain.ts): the owner of the entity, or staff who can read owner
// distributions and cover one of the entity's properties.

export async function statementDoc(c: Ctx, s: Session, entityId: string, period: string, branded: boolean): Promise<ExportDoc & { name: string }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new QueryError(400, "Choose a statement month");
  const entity = await entityOf(c, entityId);
  if (!entity) throw new QueryError(404, "Statement not found");
  const role = s.actor.role;
  const allowed = role === "owner"
    ? s.persona.record?.id === entity.owner_id
    : can(role, "read", "owner_distributions") && (await entityInScope(c, entity.id, s.actor.propertyIds));
  if (!allowed) throw new QueryError(403, "You can't view this statement");
  const st = await statementOf(c, entityId, period);
  if (!st) throw new QueryError(404, "No statement for this month");
  const rows: ExportDoc["rows"] = [];
  for (const l of st.lines) {
    rows.push([l.label, l.detail ?? "", l.sign * l.amount_cents / 100]);
    for (const ch of l.children ?? []) rows.push([`    ${ch.label}`, "", l.sign * ch.amount_cents / 100]);
  }
  const status = st.closed ? `Paid ${st.distribution?.paid_on ?? ""} by ACH`.trim() : "Open, not yet distributed";
  return {
    name: `owner-statement-${entity.id}-${period}`,
    title: `Owner statement, ${monthLabel(period)}: ${entity.name}`,
    columns: [{ label: "Line" }, { label: "Detail" }, { label: "Amount", kind: "money" }],
    rows,
    branded,
    scope: role === "owner" ? `${entity.owner_name}'s owner portal` : s.actor.scope.label,
    filters: [`Entity: ${entity.name}`, `Prepared for: ${entity.owner_name}`, `Month: ${monthLabel(period)}`, `Status: ${status}`],
    generatedAt: demoNowIso(),
  };
}
