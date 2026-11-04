import { PERMISSIONS } from "@/auth/personas";
import { allEntities, getEntity } from "@/entities";
import { INTERNAL_ROLES, type ModuleKey, type Role, type Row } from "@/entities/types";

// Who may decide an agent's proposal, for staff. canDecide (http.ts) enforces it on every decision;
// the pages, the "Needs you" counts and the Approve button read the same rule from here, so the
// label, the button and the server always agree. Portal users never decide here (an owner's
// waiting approval is checked in canDecide).
//   needs_you: write access to the record's module for low-risk items with no amount; approve
//              access for anything with money, legal or safety risk.
//   waiting:   over the owner's limit; the owner decides in their portal, or a principal.

// Anything with money, legal or safety risk needs approve access, not just write.
export const needsApprove = (p: Row) => p.risk !== "Low" || p.amount_cents != null;

const moduleOf = (entityType: unknown) => getEntity(String(entityType))?.module ?? "intelligence";
const isStaff = (role: string) => (INTERNAL_ROLES as readonly string[]).includes(role);

function allows(role: Role, p: Row) {
  if (!isStaff(role)) return false;
  if (p.queue_state === "waiting") return role === "principal";
  const access = PERMISSIONS[role][moduleOf(p.entity_type)] ?? "none";
  return needsApprove(p) ? access === "approve" : access === "write" || access === "approve";
}

const roleName = (r: string) => r.replace(/_/g, " ");
const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

// "Approver: principal, regional manager or admin", from the rule itself (not the role the agent
// routed it to, which may lack the access).
export function approverLabel(p: Row) {
  if (p.queue_state === "waiting") return "Over the owner's limit: the owner approves in their portal";
  const roles = INTERNAL_ROLES.filter((r) => r !== "platform_admin" && allows(r, p));
  return roles.length ? `Approver: ${orList(roles.map(roleName))}` : "No staff role can approve this";
}

export function staffDecision(role: Role, p: Row, who = "Your role"): { ok: true } | { ok: false; error: string } {
  if (!isStaff(role)) return { ok: false, error: "Only staff can act on agent proposals." };
  if (allows(role, p)) return { ok: true };
  if (p.queue_state === "waiting") return { ok: false, error: "This one waits for the owner's approval in their portal." };
  return { ok: false, error: `${who} can't ${needsApprove(p) ? "approve" : "act on"} ${moduleOf(p.entity_type)} items. ${approverLabel(p)}.` };
}

// The same rule for open (needs_you) proposals as a SQL condition on `alias`, for lists and counts.
export function decidableSql(role: Role, alias = "p"): { sql: string; params: unknown[] } {
  if (!isStaff(role)) return { sql: "0 = 1", params: [] };
  const access = (m: ModuleKey) => PERMISSIONS[role][m] ?? "none";
  const known = allEntities().map((d) => d.key as string);
  const typesWith = (level: string) => known.filter((k) => access(getEntity(k)!.module) === level);
  // A type without an entity def counts as an intelligence item.
  const other = access("intelligence");
  const inList = (level: string) => {
    const unknown = other === level ? ` OR ${alias}.entity_type NOT IN (SELECT value FROM json_each(?))` : "";
    return { sql: `(${alias}.entity_type IN (SELECT value FROM json_each(?))${unknown})`, params: [JSON.stringify(typesWith(level)), ...(unknown ? [JSON.stringify(known)] : [])] };
  };
  const approve = inList("approve"), write = inList("write");
  return {
    sql: `(${approve.sql} OR (${alias}.risk = 'Low' AND ${alias}.amount_cents IS NULL AND ${write.sql}))`,
    params: [...approve.params, ...write.params],
  };
}
