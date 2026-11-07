import { US_STATES } from "@/extensions/onboarding/state";
import { AS_OF } from "./constants";
import type { Tables } from "./generate";

// Lakeside Property Co., the second demo org (workspace 'base-lakeside'): a new customer with no
// portfolio yet. It holds only what setup needs before the first import: the org, its principal
// and one region covering every state, so imported properties have a region to go in. Everything
// else (properties, people, vendors, owners, history) arrives through the visitor's own import.

export const LAKESIDE = { id: "org-lakeside", name: "Lakeside Property Co.", plan: "Starter", status: "Trial", seats: 5, units_managed: 0, created_at: `${AS_OF}T16:00:00Z` };

export function lakesideTables(): Tables {
  return {
    orgs: [LAKESIDE],
    regions: [{ id: "r-lk-all", org_id: LAKESIDE.id, name: "All markets", states: JSON.stringify(US_STATES) }],
    staff: [{ id: "alex", org_id: LAKESIDE.id, name: "Alex Morgan", title: "Principal", email: "alex@lakesideproperty.example", phone: "", avatar: null, active: 1, last_active_at: `${AS_OF}T16:05:00Z` }],
    role_assignments: [{ id: "ra-alex", staff_id: "alex", role: "principal", scope_kind: "org", scope_id: LAKESIDE.id }],
  };
}
