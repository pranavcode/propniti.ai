// Base + overlay reads (plan §1). Every read of a domain table goes through effective(): a
// visitor's overlay rows replace base rows with the same id, and an overlay tombstone
// (deleted = 1) hides the base row. Append-only tables (transfers, audit) simply union both.

export const TABLES = [
  "orgs", "regions", "owners", "owner_entities", "portfolios", "bank_accounts", "staff", "role_assignments", "properties", "buildings", "unit_types",
  "units", "rentable_items", "rentable_assignments", "keys", "key_log", "inventory_items", "households", "residents", "vendors", "prospects", "applicants",
  "listings", "listing_price_history", "showings", "applications", "screening_results", "leases", "recurring_charges", "concessions", "renewal_offers",
  "renters_insurance", "deposits", "deposit_dispositions", "gl_accounts", "charges", "payments", "credits", "transfers", "purchase_orders", "po_lines",
  "bills", "bill_lines", "recurring_bills", "owner_distributions", "journal_entries", "budgets", "budget_lines", "capex_projects", "bank_transactions",
  "bank_reconciliations", "reconciliation_items", "vendor_1099s", "late_fee_policies", "utility_meters", "meter_readings", "utility_bills", "pm_schedules",
  "work_orders", "wo_events", "photos", "turnovers", "inspections", "inspection_items", "documents", "service_requests", "ratings", "message_threads",
  "messages", "templates", "announcements", "insurance_policies", "vendor_cois", "compliance_items", "legal_cases", "approval_policies", "state_rules",
  "automation_rules", "automation_runs", "agent_definitions", "agent_runs", "agent_steps", "events", "ai_proposals", "ai_decisions", "ai_summaries",
  "ai_feedback", "assistant_threads", "assistant_messages", "assistant_actions", "tasks", "notes", "activity_events", "notifications", "saved_views",
  "user_preferences", "onboarding_progress", "tour_progress", "help_articles", "data_rules", "data_issues", "data_fix_log", "audit", "metrics_monthly",
] as const;
export type Table = (typeof TABLES)[number];

const KNOWN = new Set<string>(TABLES);
export const APPEND_ONLY = new Set<string>(["transfers", "audit"]);
// A workspace id that can never exist; used when the caller has no workspace (reads see base only).
export const NO_WORKSPACE = "~";

export function assertTable(table: string): asserts table is Table {
  if (!KNOWN.has(table)) throw new Error(`Unknown table: ${table}`);
}

// A parenthesised subquery to use in FROM. `ws` is the SQL for the visitor's workspace id: a
// numbered parameter such as "?1" (bind the id, or NO_WORKSPACE). Alias the result yourself:
//   SELECT u.* FROM ${effective("units")} AS u WHERE u.property_id = ?2
export function effective(table: string, ws = "?1") {
  assertTable(table);
  if (APPEND_ONLY.has(table)) return `(SELECT * FROM ${table} WHERE workspace_id IN ('base', ${ws}))`;
  if (table === "metrics_monthly")
    return `(SELECT * FROM metrics_monthly WHERE workspace_id = ${ws} UNION ALL SELECT * FROM metrics_monthly AS b WHERE b.workspace_id = 'base' AND NOT EXISTS (SELECT 1 FROM metrics_monthly AS o WHERE o.workspace_id = ${ws} AND o.property_id = b.property_id AND o.month = b.month))`;
  return `(SELECT * FROM ${table} WHERE workspace_id = ${ws} AND deleted = 0 UNION ALL SELECT * FROM ${table} AS b WHERE b.workspace_id = 'base' AND b.deleted = 0 AND NOT EXISTS (SELECT 1 FROM ${table} AS o WHERE o.workspace_id = ${ws} AND o.id = b.id))`;
}

// Copy-on-write: moves the row into the overlay (copying the base row the first time) and applies
// `set` (column → SQL expression, e.g. { status: "?3" }). `cols` is the table's column list.
export function overlayUpsertSql(table: string, cols: readonly string[], set: Record<string, string>, ws = "?1", idParam = "?2") {
  assertTable(table);
  const list = cols.filter((c) => c !== "workspace_id" && c !== "seq");
  const exprs = list.map((c) => (c in set ? `${set[c]}` : `e.${c}`));
  const updates = Object.entries(set).map(([c, v]) => `${c} = ${v}`);
  return `INSERT INTO ${table} (workspace_id, ${list.join(", ")})
    SELECT ${ws}, ${exprs.join(", ")} FROM ${effective(table, ws)} AS e WHERE e.id = ${idParam}
    ON CONFLICT (workspace_id, id) DO UPDATE SET ${updates.join(", ") || "deleted = deleted"}`;
}
