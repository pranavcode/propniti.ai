import { PERMISSIONS } from "@/auth/personas";
import type { Actor, Role } from "@/entities/types";

// Who may change approval policies; /api/ai/policies/[id] refuses everyone else.
export const POLICY_EDITORS: Role[] = ["principal", "regional_manager", "admin"];
export const canEditPolicies = (role: Role) => POLICY_EDITORS.includes(role) && (PERMISSIONS[role]?.intelligence ?? "none") !== "none";
export const POLICY_EDITORS_TEXT = "Only a principal, regional manager or administrator can change approval policies.";
// The organization defaults need an org-wide editor too (policy-scope.ts refuses the rest).
export const canEditOrgPolicies = (actor: Pick<Actor, "role" | "propertyIds">) => canEditPolicies(actor.role) && actor.propertyIds === "all";
export const ORG_POLICY_TEXT = "Only an org-wide editor, the principal or an administrator, can change the organization defaults.";
