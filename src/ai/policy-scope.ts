import "server-only";
import type { Actor, Row } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/effective";
import { ORG_POLICY_TEXT } from "./policy-editors";

// Scope on top of the role check (canEditPolicies): an owner entity's policy may be changed only by
// someone whose scope covers every one of its properties, and the organization default only by an
// org-wide editor. Clearing the owner threshold on maintenance spend would let staff pay any repair
// without the owner (money.ts reads it), so that is refused; set a higher amount instead.
export async function policyEditRefusal(db: Db, ws: string, actor: Actor, policy: Row, body: { owner_approval_over_cents?: number | null; [k: string]: unknown }): Promise<string | null> {
  if (body.owner_approval_over_cents === null && policy.category === "Maintenance spend") return "Maintenance spend keeps an owner approval threshold. Set a higher amount instead of clearing it.";
  if (actor.propertyIds === "all") return null;
  if (policy.owner_entity_id == null) return ORG_POLICY_TEXT;
  const scope = JSON.stringify(actor.propertyIds);
  const r = await db
    .prepare(`SELECT count(*) AS n, coalesce(sum(p.id NOT IN (SELECT value FROM json_each(?3))), 0) AS outside FROM ${effective("properties")} AS p WHERE p.owner_entity_id = ?2`)
    .bind(ws, String(policy.owner_entity_id), scope)
    .first<{ n: number; outside: number }>();
  return !r || !Number(r.n) || Number(r.outside) ? "That owner's policy covers properties outside your scope" : null;
}
