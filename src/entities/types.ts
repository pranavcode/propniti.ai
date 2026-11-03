import type { LucideIcon } from "lucide-react";
import type { ZodType } from "zod";
import type { Db } from "@/lib/platform/types";

// Contract for the config-driven entity framework (plan §4). Module lanes describe each record
// type once as an EntityDef; the framework derives the sidebar, ⌘K index, list/detail pages,
// generic API, permission matrix and SQL whitelist from it.
//
// Defs are server-side values (they hold functions and icons). Never pass an EntityDef to a
// client component; pass the plain data the component needs. Anything a client must run, such as
// chart drill links, is a template string ("/app/properties/{property_id}") instead of a function.

// ---------------------------------------------------------------------------------------------
// Keys. Closed unions so typos fail the type check. Ask the lead to add one.
// ---------------------------------------------------------------------------------------------

export const ROLES = [
  // Internal and platform (9)
  "platform_admin", "principal", "regional_manager", "property_manager", "leasing_agent",
  "broker", "accountant", "maintenance_supervisor", "admin",
  // Portals (4)
  "owner", "resident", "vendor", "applicant",
] as const;
export type Role = (typeof ROLES)[number];
export const PORTAL_ROLES = ["owner", "resident", "vendor", "applicant"] as const satisfies readonly Role[];
export type PortalRole = (typeof PORTAL_ROLES)[number];
export const INTERNAL_ROLES = ROLES.filter((r): r is Exclude<Role, PortalRole> => !(PORTAL_ROLES as readonly string[]).includes(r));

// Org → Region → Portfolio (owner entity) → Property. "self" = portal users see their own records.
export type ScopeKind = "platform" | "org" | "region" | "owner_entity" | "portfolio" | "property" | "self";

// The one status-colour mapping (brief §5.1). CSS: bg-tone-<tone>/10 text-tone-<tone>.
// success: Paid/Active/Occupied · warning: Pending/Notice/Due soon · danger: Overdue/Failed/Eviction
// neutral: Draft/Vacant · info: Scheduled/In progress · ai: AI-suggested (accent outline + ✦)
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "ai";

// One entity per main table in migrations/0002_v2.sql (child/line tables are tabs, not entities).
export const ENTITY_KEYS = [
  // Org and assets
  "orgs", "regions", "owners", "owner_entities", "portfolios", "bank_accounts", "staff",
  "properties", "buildings", "unit_types", "units", "rentable_items", "keys", "inventory_items",
  // People and leasing
  "households", "residents", "vendors", "prospects", "applicants", "listings", "showings",
  "applications", "screening_results", "leases", "recurring_charges", "concessions", "renewal_offers",
  "renters_insurance", "deposits",
  // Finance
  "gl_accounts", "charges", "payments", "credits", "transfers", "bills", "recurring_bills",
  "purchase_orders", "owner_distributions", "journal_entries", "budgets", "capex_projects",
  "bank_transactions", "bank_reconciliations", "vendor_1099s", "late_fee_policies",
  "utility_meters", "utility_bills",
  // Operations and communications
  "work_orders", "pm_schedules", "turnovers", "inspections", "documents", "service_requests",
  "message_threads", "templates", "announcements",
  // Risk and compliance
  "insurance_policies", "vendor_cois", "compliance_items", "legal_cases", "approval_policies", "state_rules",
  // Intelligence, automation, collaboration
  "ai_proposals", "automation_rules", "automation_runs", "tasks", "notes", "help_articles", "audit",
  // Data health
  "data_rules", "data_issues",
] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];

// Lanes own modules: defs in src/entities/defs/<module>.ts, extensions in src/extensions/<module>/.
export const MODULE_KEYS = [
  "portfolio", "leasing", "residents", "maintenance", "communications", "receivables", "payables",
  "accounting", "owners", "risk", "intelligence", "settings", "platform",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

// Sidebar sections, in display order (brief §1.3).
export const NAV_SECTIONS = ["home", "portfolio", "operations", "finance", "intelligence", "settings"] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

// Named AI agents. Each produces ai_proposals rows; a person approves anything that moves money.
export const AGENT_KEYS = [
  "collections", "leasing", "renewals", "maintenance_triage", "ap", "reconciliation",
  "document_classifier", "photo_check", "screening", "compliance", "data_health", "copilot",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

// "<entity>.<verb>", e.g. "charges.record_payment", "bills.approve". Registered in src/extensions/actions.ts.
export type ActionKey = `${EntityKey}.${string}`;
// Custom detail tabs and dashboard widgets: "<module>.<name>".
export type TabKey = `${ModuleKey}.${string}`;
export type WidgetKey = `${ModuleKey}.${string}`;
// Data-health rule id (data_rules.id): "<entity>.<check>", e.g. "leases.end_before_start".
export type RuleKey = `${EntityKey}.${string}`;
// Chart/KPI data source served by GET /api/metrics/[key]: "<module>.<name>".
export type MetricKey = `${ModuleKey}.${string}`;

export type Row = Record<string, unknown>;
export type Facts = Record<string, string | number | boolean | null>;

// Plain-language help used by the product tour and the assistant ("how do I…").
export type HelpMeta = { summary: string; article?: string /* help_articles.id (slug) */ };

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

export type FieldType = "text" | "number" | "money" | "date" | "datetime" | "enum" | "ref" | "bool" | "image" | "json";

export type FieldDef = {
  type: FieldType;
  label: string;
  // Column name when it differs from the field key. Money fields point at the *_cents column;
  // the API converts cents ↔ dollars, the UI shows <Money>.
  column?: string;
  zod?: ZodType;                         // write validation; generated from type when omitted
  required?: boolean;
  enum?: { value: string; tone: Tone; label?: string }[];
  ref?: EntityKey;                       // type "ref": the referenced entity; shows its titleField
  format?: "compact" | "full" | "pct" | "relative";
  list?: { default: boolean; align?: "right"; width?: number };   // column in the DataTable
  facet?: boolean;                       // filter chip with counts
  search?: boolean;                      // included in the q= full-text search
  sortable?: boolean;
  sql?: string;                          // computed column; whitelisted because it lives in a def
  editable?: Role[];                     // roles that may change it via PATCH (writes: "generic")
  hiddenFor?: Role[];
  help?: HelpMeta;
};

// ---------------------------------------------------------------------------------------------
// Lists, details, dashboards
// ---------------------------------------------------------------------------------------------

export type RelationDef = { name: string; label?: string; entity: EntityKey; fk: string; kind: "one" | "many" };

// A saved view: filter/sort/column state, stored as JSON in saved_views.state.
export type ViewState = {
  q?: string;
  filters?: Record<string, string | string[]>;
  sort?: [string, "asc" | "desc"];
  columns?: string[];
};
export type View = ViewState & { key: string; label: string };

export type Agg = { field: string; fn: "sum" | "avg" | "count" | "min" | "max"; label?: string };

// Built-in tab: the fields listed, or a related list (relation name from `relations`).
export type TabDef = { key: string; label: string; fields?: string[]; relation?: string; roles?: Role[] };

export type KpiDef = {
  key: string;
  label: string;
  metric: MetricKey;
  format: "money" | "count" | "pct" | "days";
  delta?: "mom" | "yoy" | "vs_budget";
  goodWhen?: "up" | "down";              // colours the delta
  drill?: string;                        // href template, e.g. "/app/receivables/charges?f.status=Overdue"
  roles?: Role[];
  help?: HelpMeta;
};

export type ChartDef = {
  key: string;
  title: string;
  kind: "line" | "area" | "bar" | "stacked" | "hbar" | "funnel" | "donut";
  metric: MetricKey;
  x: string;                             // field in each data point
  series: { key: string; label: string; format?: KpiDef["format"] }[];
  // Click-through href template; {field} placeholders are filled from the clicked data point.
  drill?: string;
  roles?: Role[];
  help?: HelpMeta;
};

export type Capabilities = {
  notes?: boolean;                       // auto "Notes" tab (notes table, @mentions)
  activity?: boolean;                    // auto "Activity" tab (activity_events + audit)
  tasks?: boolean;                       // auto "Tasks" tab (tasks.entity_type/entity_id)
  documents?: boolean;                   // auto "Documents" tab
  aiSummary?: boolean;                   // AISummaryCard (ai_summaries)
};

export type EntityDef = {
  key: EntityKey;
  table: string;
  label: { one: string; many: string };
  icon: LucideIcon;
  module: ModuleKey;
  nav?: { section: NavSection; group?: string; order: number; label?: string }; // omit = not in sidebar
  route: string;                         // list URL under /app, e.g. "/app/leasing/prospects"; detail = route + "/<id>"
  titleField: string;
  subtitle?: (r: Row) => string;
  image?: (r: Row) => string | undefined;
  // SQL expression giving the row's property_id (scope filter), e.g. "property_id" or
  // "(SELECT property_id FROM leases WHERE id = charges.lease_id)". null = org-level, no property scope.
  scopePath: string | null;
  fields: Record<string, FieldDef>;
  relations: RelationDef[];
  list: {
    defaultSort: [string, "asc" | "desc"];
    statusTabs?: string;                 // enum field whose values become tabs with counts
    savedViews?: View[];
    bulkActions?: ActionKey[];
    footer?: Agg[];
  };
  detail: {
    facts: string[];                     // header fact strip
    tabs: (TabDef | { custom: TabKey })[];
    related: string[];                   // relation names shown in the right rail
  };
  capabilities?: Capabilities;
  kpis?: KpiDef[];
  charts?: ChartDef[];
  ai?: { facts: (row: Row, related: Record<string, Row[]>) => Facts; summaryPrompt?: string; agents?: AgentKey[] };
  permissions: { read: Role[]; create?: Role[]; update?: Role[]; delete?: Role[] };
  // generic: POST/PATCH/DELETE through write(). actions-only: writes only via named actions
  // (required for ledger tables: a test enforces it). none: read-only.
  writes: "generic" | "actions-only" | "none";
  actions?: ActionKey[];
  // Data-health rules for this entity: record pages show a "Data health" badge from open
  // data_issues and an "AI: fix this" affordance that applies data_issues.suggested_fix.
  dataRules?: RuleKey[];
  help?: HelpMeta;
};

// ---------------------------------------------------------------------------------------------
// Query contract (src/server/query.ts). No endpoint returns unbounded rows.
// ---------------------------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type ListQuery = ViewState & {
  page?: number;                         // 1-based offset paging (with total)
  size?: number;                         // clamped to MAX_PAGE_SIZE
  cursor?: string;                       // keyset paging where cheap (opaque; from nextCursor)
};

export type ListResult<T = Row> = {
  rows: T[];
  total: number;                         // count under the same filters and scope
  page: number;
  size: number;
  nextCursor?: string;
  counts?: Record<string, number>;       // statusTabs counts
};

// ---------------------------------------------------------------------------------------------
// Who is acting (resolved per request from the pn_as cookie, see src/auth/personas.ts)
// ---------------------------------------------------------------------------------------------

export type Scope = { kind: ScopeKind; ids?: readonly string[]; label: string };

export type Actor = { personaId: string; name: string; role: Role; scope: Scope; propertyIds: string[] | "all" };

export type ActionContext = { db: Db; ws: string; actor: Actor; nowMs: number };

// Matches money.ts Outcome so money actions can return it unchanged.
export type ActionResult = { status: 200; message?: string; href?: string } | { status: 400 | 403 | 404 | 409; error: string };

export type ActionDef<I = unknown> = {
  key: ActionKey;
  label: string;                         // verb phrase: "Record payment", "Approve bill"
  entity: EntityKey;
  roles: Role[];
  icon?: LucideIcon;
  when?: (row: Row) => boolean;          // shown/enabled for this row
  confirm?: { title: string; body?: string; tone?: Tone };
  input?: ZodType<I>;                    // dialog form schema; omit for one-click actions
  bulk?: boolean;
  money?: boolean;                       // handler must go through src/server/money.ts
  handler: (ctx: ActionContext, row: Row, input: I) => Promise<ActionResult>;
  help?: HelpMeta;
};
