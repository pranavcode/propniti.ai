import { PERMISSIONS } from "@/auth/personas";
import type { Role } from "@/entities/types";

// Who may change approval policies; /api/ai/policies/[id] refuses everyone else.
export const POLICY_EDITORS: Role[] = ["principal", "regional_manager", "admin"];
export const canEditPolicies = (role: Role) => POLICY_EDITORS.includes(role) && (PERMISSIONS[role]?.intelligence ?? "none") !== "none";
export const POLICY_EDITORS_TEXT = "Only a principal, regional manager or administrator can change approval policies.";
