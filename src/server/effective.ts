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
  "user_preferences", "onboarding_progress", "tour_progress", "help_articles", "data_rules", "data_issues", "data_fix_log", "audit", "metrics_monthly", "org_usage_monthly",
] as const;
export type Table = (typeof TABLES)[number];

const KNOWN = new Set<string>(TABLES);
export const APPEND_ONLY = new Set<string>(["transfers", "audit"]);
// A workspace id that can never exist; used when the caller has no workspace (reads see base only).
export const NO_WORKSPACE = "~";

export function assertTable(table: string): asserts table is Table {
  if (!KNOWN.has(table)) throw new Error(`Unknown table: ${table}`);
}

// Lakeside Property Co., the second demo org, starts with no data. Its personas work in their own
// overlay, the visitor's workspace id plus LAKESIDE_WS ("~.lakeside" before their first write),
// over the base-lakeside rows. Of the shared base they see only the reference tables in SHARED.
// Every query already filters on workspace_id, so this is the org boundary: neither org's queries
// can reach the other's rows.
export const LAKESIDE_WS = ".lakeside";
export const LAKESIDE_BASE = "base-lakeside";
export const isLakeside = (ws: string | null | undefined) => !!ws && ws.endsWith(LAKESIDE_WS);
// The base workspace a workspace's overlay sits on.
export const baseOf = (ws: string | null | undefined) => (isLakeside(ws) ? LAKESIDE_BASE : "base");
// Reference data both orgs read from 'base': product help, data and state rules, message templates,
// the chart of accounts, agent definitions and the org-default approval and late-fee policies.
export const SHARED: Partial<Record<Table, string>> = {
  help_articles: "1 = 1", data_rules: "1 = 1", state_rules: "1 = 1", templates: "1 = 1", gl_accounts: "1 = 1", agent_definitions: "1 = 1",
  approval_policies: "owner_entity_id IS NULL", late_fee_policies: "property_id IS NULL",
};

// Rows a workspace sees before overlay replacement, as a WHERE condition. `ws` is SQL (a numbered
// parameter or a quoted literal), so the org is picked in SQL; SQLite still uses the
// (workspace_id, …) indexes because the CASE depends only on the parameter.
export function seen(table: string, ws = "?1") {
  const lakeside = `substr(${ws}, -${LAKESIDE_WS.length}) = '${LAKESIDE_WS}'`;
  const shared = SHARED[table as Table];
  return `(workspace_id IN ((CASE WHEN ${lakeside} THEN '${LAKESIDE_BASE}' ELSE 'base' END), ${ws})${shared ? ` OR (workspace_id = 'base' AND ${lakeside} AND ${shared})` : ""})`;
}

// A parenthesised subquery to use in FROM. `ws` is the SQL for the visitor's workspace id: a
// numbered parameter such as "?1" (bind the id, or NO_WORKSPACE). Alias the result yourself:
//   SELECT u.* FROM ${effective("units")} AS u WHERE u.property_id = ?2
export function effective(table: string, ws = "?1") {
  assertTable(table);
  if (APPEND_ONLY.has(table)) return `(SELECT * FROM ${table} WHERE ${seen(table, ws)})`;
  if (table === "metrics_monthly")
    return `(SELECT * FROM metrics_monthly WHERE workspace_id = ${ws} UNION ALL SELECT * FROM metrics_monthly AS b WHERE b.workspace_id = (CASE WHEN substr(${ws}, -${LAKESIDE_WS.length}) = '${LAKESIDE_WS}' THEN '${LAKESIDE_BASE}' ELSE 'base' END) AND NOT EXISTS (SELECT 1 FROM metrics_monthly AS o WHERE o.workspace_id = ${ws} AND o.property_id = b.property_id AND o.month = b.month))`;
  // One SELECT, not a UNION ALL: SQLite flattens it into the outer query, so a join on id uses the
  // (workspace_id, id) index instead of scanning a materialised copy for every outer row.
  return `(SELECT * FROM ${table} WHERE ${seen(table, ws)} AND deleted = 0 AND (workspace_id = ${ws} OR NOT EXISTS (SELECT 1 FROM ${table} AS o WHERE o.workspace_id = ${ws} AND o.id = ${table}.id)))`;
}

// Copy-on-write: moves the row into the overlay (copying the base row the first time) and applies
// `set` (column → SQL expression, e.g. { status: "?3" }). `cols` is the table's column list.
// `where` adds a guard on the current row (alias e), e.g. "e.status = 'Submitted'".
export function overlayUpsertSql(table: string, cols: readonly string[], set: Record<string, string>, where = "1 = 1", ws = "?1", idParam = "?2") {
  assertTable(table);
  const list = cols.filter((c) => c !== "workspace_id" && c !== "seq");
  const exprs = list.map((c) => (c in set ? `${set[c]}` : `e.${c}`));
  const updates = Object.entries(set).map(([c, v]) => `${c} = ${v}`);
  return `INSERT INTO ${table} (workspace_id, ${list.join(", ")})
    SELECT ${ws}, ${exprs.join(", ")} FROM ${effective(table, ws)} AS e WHERE e.id = ${idParam} AND (${where})
    ON CONFLICT (workspace_id, id) DO UPDATE SET ${updates.join(", ") || "deleted = deleted"}`;
}
