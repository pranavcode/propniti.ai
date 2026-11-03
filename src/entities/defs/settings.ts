// Entity defs for the settings module: users, approval policies, state rules, automations and
// the audit log. Owned by the platform lane; see AGENTS.md "v2 lanes and ownership".
import { Bot, History, Landmark, ShieldCheck, UserRound, Workflow } from "lucide-react";
import { ROLES, type Role } from "../types";
import { AS_OF } from "../common";
import { registerEntity } from "../registry";

// Settings is org configuration: admins change it, leaders read it (PERMISSIONS gates the module).
const ADMINS: Role[] = ["admin", "platform_admin"];
const READERS: Role[] = ["admin", "platform_admin", "principal", "regional_manager"];
const ROLE_ENUM = ROLES.map((r) => ({ value: r, tone: "neutral" as const, label: r.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

registerEntity({
  key: "staff",
  table: "staff",
  label: { one: "User", many: "Users" },
  icon: UserRound,
  module: "settings",
  route: "/app/settings/users",
  titleField: "name",
  subtitle: (r) => [r.title, r.email].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    name: { type: "text", label: "Name", required: true, search: true, sortable: true, list: { default: true, width: 220 } },
    title: { type: "text", label: "Title", required: true, search: true, sortable: true, list: { default: true } },
    email: { type: "text", label: "Email", required: true, search: true, list: { default: true } },
    role: { type: "enum", label: "Role", facet: true, sortable: true, list: { default: true }, enum: ROLE_ENUM,
      sql: "(SELECT ra.role FROM {role_assignments} ra WHERE ra.staff_id = staff.id ORDER BY ra.id LIMIT 1)" },
    scope: { type: "text", label: "Scope", list: { default: true },
      sql: "(SELECT CASE ra.scope_kind WHEN 'org' THEN 'Whole org' WHEN 'platform' THEN 'Platform' ELSE ra.scope_kind || ': ' || group_concat(ra.scope_id, ', ') END FROM {role_assignments} ra WHERE ra.staff_id = staff.id GROUP BY ra.scope_kind ORDER BY count(*) DESC LIMIT 1)",
      help: { summary: "Which records the role reaches: the whole org, a region, or listed properties.", article: "roles-and-permissions" } },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Active", tone: "success" }, { value: "Invited", tone: "info" }, { value: "Deactivated", tone: "neutral" },
    ], sql: "(CASE WHEN staff.active = 1 THEN 'Active' WHEN staff.last_active_at IS NULL THEN 'Invited' ELSE 'Deactivated' END)" },
    last_active_at: { type: "datetime", label: "Last active", sortable: true, list: { default: true }, editable: [] },
    phone: { type: "text", label: "Phone", search: true },
    active: { type: "bool", label: "Can sign in", editable: ADMINS },
    org_id: { type: "text", label: "Org", editable: [] },
  },
  relations: [],
  list: {
    defaultSort: ["name", "asc"],
    statusTabs: "status",
    savedViews: [
      { key: "invited", label: "Pending invites", filters: { status: "Invited" } },
      { key: "inactive-30", label: "Not active in 30 days", filters: { status: "Active" }, sort: ["last_active_at", "asc"] },
    ],
  },
  detail: {
    facts: ["title", "role", "scope", "status", "email", "phone", "last_active_at"],
    tabs: [{ key: "overview", label: "Overview", fields: ["name", "title", "email", "phone", "role", "scope", "status", "active", "last_active_at"] }],
    related: [],
  },
  capabilities: { activity: true, notes: true },
  permissions: { read: READERS, update: ADMINS },
  writes: "generic",
  help: { summary: "People who sign in to Propniti, their role and the properties their role reaches.", article: "users-and-invites" },
});

const CATEGORY = ["Maintenance spend", "Bill payment", "Concession", "Write-off", "Legal", "Safety", "Owner distribution"] as const;

registerEntity({
  key: "approval_policies",
  table: "approval_policies",
  label: { one: "Approval policy", many: "Approval policies" },
  icon: ShieldCheck,
  module: "settings",
  route: "/app/settings/approvals",
  titleField: "name",
  subtitle: (r) => String(r.applies_to ?? ""),
  scopePath: null,
  fields: {
    name: { type: "text", label: "Policy", sql: "(approval_policies.category || CASE WHEN approval_policies.owner_entity_id IS NULL THEN ' · org default' ELSE ' · ' || coalesce((SELECT oe.name FROM {owner_entities} oe WHERE oe.id = approval_policies.owner_entity_id), approval_policies.owner_entity_id) END)", search: true, list: { default: true, width: 300 } },
    category: { type: "enum", label: "Category", facet: true, sortable: true, required: true, list: { default: true }, editable: [], enum: CATEGORY.map((c) => ({ value: c, tone: c === "Legal" || c === "Safety" ? "warning" as const : "neutral" as const })) },
    owner_entity_id: { type: "ref", ref: "owner_entities", label: "Owner entity", facet: true, editable: [] },
    applies_to: { type: "text", label: "Applies to", list: { default: true }, sql: "(CASE WHEN approval_policies.owner_entity_id IS NULL THEN 'Org default' ELSE coalesce((SELECT oe.name FROM {owner_entities} oe WHERE oe.id = approval_policies.owner_entity_id), approval_policies.owner_entity_id) END)" },
    limit: { type: "money", label: "Auto-approve up to", column: "limit_cents", sortable: true, list: { default: true, align: "right" }, editable: ADMINS,
      help: { summary: "Agents and staff may act alone up to this amount. Blank means a person always approves.", article: "approval-policies" } },
    approver_role: { type: "enum", label: "Approver above limit", facet: true, list: { default: true }, editable: ADMINS, enum: ROLE_ENUM },
    owner_approval_over: { type: "money", label: "Owner approves above", column: "owner_approval_over_cents", sortable: true, list: { default: true, align: "right" }, editable: ADMINS,
      help: { summary: "Above this amount the owner approves in their portal, after your approver.", article: "approval-policies" } },
    always_human: { type: "bool", label: "Always a person", facet: true, list: { default: true }, editable: ADMINS,
      help: { summary: "Legal and safety decisions are never automated, whatever the amount.", article: "approval-policies" } },
  },
  relations: [],
  list: { defaultSort: ["category", "asc"], savedViews: [{ key: "defaults", label: "Org defaults", filters: { "owner_entity_id.null": "1" } }, { key: "overrides", label: "Owner overrides", filters: { "owner_entity_id.null": "0" } }] },
  detail: {
    facts: ["category", "applies_to", "limit", "approver_role", "owner_approval_over", "always_human"],
    tabs: [{ key: "overview", label: "Policy", fields: ["category", "applies_to", "limit", "approver_role", "owner_approval_over", "always_human"] }],
    related: [],
  },
  capabilities: { activity: true, notes: true },
  permissions: { read: READERS, update: ADMINS, create: ADMINS, delete: ADMINS },
  writes: "generic",
  help: { summary: "How much agents and staff may approve alone, who approves above that, and when the owner signs off. Money, legal and safety thresholds.", article: "approval-policies" },
});

export const STATE_RULES = {
  late_fee_cap_pct: { label: "Late-fee cap", unit: "% of monthly rent", zeroMeans: "No statutory cap" },
  late_fee_cap_cents: { label: "Late-fee cap (flat)", unit: "cents", zeroMeans: "No statutory cap" },
  grace_days: { label: "Grace period", unit: "days", zeroMeans: "No statutory grace period" },
  deposit_max_months: { label: "Deposit limit", unit: "months of rent", zeroMeans: "No statutory limit" },
  deposit_return_days: { label: "Deposit return", unit: "days after move-out", zeroMeans: "Not set" },
  notice_days: { label: "Nonpayment notice", unit: "days", zeroMeans: "No minimum notice" },
} as const;

// The rule in force: the latest effective_from on or before the demo's today, per state and rule.
const CURRENT = `(state_rules.effective_from = (SELECT max(s2.effective_from) FROM {state_rules} s2 WHERE s2.state = state_rules.state AND s2.rule = state_rules.rule AND s2.effective_from <= ${AS_OF}))`;

registerEntity({
  key: "state_rules",
  table: "state_rules",
  label: { one: "State rule", many: "State rules" },
  icon: Landmark,
  module: "settings",
  route: "/app/settings/state-rules",
  titleField: "title",
  subtitle: (r) => `Effective ${r.effective_from}`,
  scopePath: null,
  fields: {
    title: { type: "text", label: "Rule", sql: `(state_rules.state || ' · ' || CASE state_rules.rule ${Object.entries(STATE_RULES).map(([k, v]) => `WHEN '${k}' THEN '${v.label}'`).join(" ")} ELSE state_rules.rule END)`, list: { default: true, width: 240 } },
    state: { type: "enum", label: "State", facet: true, sortable: true, required: true, list: { default: true }, enum: [{ value: "TX", tone: "neutral" }, { value: "GA", tone: "neutral" }, { value: "AZ", tone: "neutral" }] },
    rule: { type: "enum", label: "Rule key", facet: true, required: true, enum: Object.keys(STATE_RULES).map((k) => ({ value: k, tone: "neutral" as const, label: STATE_RULES[k as keyof typeof STATE_RULES].label })) },
    value: { type: "text", label: "Value", required: true, list: { default: true } },
    note: { type: "text", label: "Summary and citation", search: true, list: { default: true, width: 360 } },
    effective_from: { type: "date", label: "Effective from", required: true, sortable: true, list: { default: true } },
    current: { type: "bool", label: "In force", facet: true, list: { default: true }, sql: CURRENT },
    changed_by: { type: "ref", ref: "staff", label: "Changed by", list: { default: true }, editable: [] },
  },
  relations: [],
  list: { defaultSort: ["effective_from", "desc"], savedViews: [{ key: "current", label: "In force", filters: { current: "true" } }] },
  detail: {
    facts: ["state", "rule", "value", "effective_from", "current", "changed_by"],
    tabs: [{ key: "overview", label: "Rule", fields: ["state", "rule", "value", "note", "effective_from", "current", "changed_by"] }],
    related: [],
  },
  capabilities: { activity: true, notes: true },
  // History is every row: amending adds a new row (state_rules.amend), so rows are never edited.
  permissions: { read: [...READERS, "property_manager", "accountant"] },
  writes: "none",
  actions: ["state_rules.amend"],
  help: { summary: "Late-fee caps, grace periods, deposit limits and notice periods for Texas, Georgia and Arizona. Late fees are capped by these when they post.", article: "state-rules" },
});

registerEntity({
  key: "automation_rules",
  table: "automation_rules",
  label: { one: "Automation", many: "Automations" },
  icon: Workflow,
  module: "settings",
  route: "/app/settings/automations",
  titleField: "name",
  subtitle: (r) => String(r.kind ?? ""),
  scopePath: null,
  fields: {
    name: { type: "text", label: "Automation", required: true, search: true, sortable: true, list: { default: true, width: 300 } },
    kind: { type: "enum", label: "Type", facet: true, list: { default: true }, editable: [], enum: [{ value: "Rule", tone: "neutral" }, { value: "Workflow", tone: "info" }] },
    enabled: { type: "bool", label: "On", facet: true, list: { default: true }, editable: ADMINS },
    agent: { type: "text", label: "Agent", facet: true, list: { default: true }, editable: [] },
    trigger_spec: { type: "json", label: "Trigger", editable: [] },
    conditions: { type: "json", label: "Conditions", editable: [] },
    action: { type: "json", label: "Action", editable: [] },
    steps: { type: "json", label: "Workflow steps", editable: [] },
    runs_30d: { type: "number", label: "Runs (30 days)", sortable: true, list: { default: true, align: "right" },
      sql: `(SELECT count(*) FROM {automation_runs} r WHERE r.rule_id = automation_rules.id AND r.started_at >= date(${AS_OF}, '-30 days'))` },
    failed_30d: { type: "number", label: "Failed (30 days)", sortable: true, list: { default: true, align: "right" },
      sql: `(SELECT count(*) FROM {automation_runs} r WHERE r.rule_id = automation_rules.id AND r.status = 'Failed' AND r.started_at >= date(${AS_OF}, '-30 days'))` },
    last_run_at: { type: "datetime", label: "Last run", sortable: true, list: { default: true }, sql: "(SELECT max(r.started_at) FROM {automation_runs} r WHERE r.rule_id = automation_rules.id)" },
    created_by: { type: "ref", ref: "staff", label: "Created by", editable: [] },
  },
  relations: [{ name: "runs", label: "Run log", entity: "automation_runs", fk: "rule_id", kind: "many" }],
  list: { defaultSort: ["name", "asc"], savedViews: [{ key: "failing", label: "Failing", filters: { "failed_30d.min": "1" }, sort: ["failed_30d", "desc"] }, { key: "off", label: "Turned off", filters: { enabled: "false" } }] },
  detail: {
    facts: ["kind", "enabled", "agent", "runs_30d", "failed_30d", "last_run_at"],
    tabs: [
      { key: "overview", label: "Definition", fields: ["name", "kind", "enabled", "agent", "trigger_spec", "conditions", "action", "steps", "created_by"] },
      { key: "runs", label: "Run log", relation: "runs" },
    ],
    related: [],
  },
  capabilities: { activity: true, notes: true },
  permissions: { read: READERS, update: ADMINS },
  writes: "generic",
  help: { summary: "Rules and workflows that run on events or a schedule: reminders, late fees, renewal offers, COI requests. Anything that moves money still waits for approval.", article: "automation-rules" },
});

registerEntity({
  key: "automation_runs",
  table: "automation_runs",
  label: { one: "Automation run", many: "Automation runs" },
  icon: Bot,
  module: "settings",
  route: "/app/settings/automations/runs",
  titleField: "summary",
  scopePath: "automation_runs.property_id",
  fields: {
    summary: { type: "text", label: "What happened", sql: "coalesce(json_extract(automation_runs.detail, '$.summary'), automation_runs.status)", search: true, list: { default: true, width: 360 } },
    rule_id: { type: "ref", ref: "automation_rules", label: "Automation", facet: true, list: { default: true } },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Succeeded", tone: "success" }, { value: "Needs approval", tone: "warning" }, { value: "Skipped", tone: "neutral" }, { value: "Failed", tone: "danger" },
    ] },
    started_at: { type: "datetime", label: "Ran", sortable: true, list: { default: true } },
    entity_type: { type: "text", label: "Record type", facet: true, list: { default: true } },
    entity_id: { type: "text", label: "Record", search: true, list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, list: { default: false } },
    error: { type: "text", label: "Error", sql: "json_extract(automation_runs.detail, '$.error')", list: { default: false } },
    detail: { type: "json", label: "Detail" },
  },
  relations: [],
  list: { defaultSort: ["started_at", "desc"], statusTabs: "status" },
  detail: {
    facts: ["status", "rule_id", "started_at", "entity_type", "entity_id", "property_id"],
    tabs: [{ key: "overview", label: "Run", fields: ["summary", "status", "rule_id", "started_at", "entity_type", "entity_id", "property_id", "error", "detail"] }],
    related: [],
  },
  permissions: { read: READERS },
  writes: "none",
  help: { summary: "Every time an automation ran, on which record, and whether it succeeded.", article: "automation-rules" },
});

registerEntity({
  key: "audit",
  table: "audit",
  label: { one: "Audit entry", many: "Audit log" },
  icon: History,
  module: "settings",
  route: "/app/settings/audit",
  titleField: "detail",
  subtitle: (r) => [r.actor, r.action].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    at: { type: "datetime", label: "When", sortable: true, list: { default: true, width: 150 } },
    actor: { type: "text", label: "Who", facet: true, search: true, sortable: true, list: { default: true } },
    role: { type: "enum", label: "Acting as", facet: true, list: { default: true }, enum: ROLE_ENUM },
    agent: { type: "text", label: "Agent", facet: true, list: { default: true } },
    by_ai: { type: "bool", label: "By an agent", facet: true, sql: "(audit.agent IS NOT NULL)" },
    action: { type: "text", label: "Action", facet: true, search: true, sortable: true, list: { default: true } },
    entity_type: { type: "text", label: "Record type", facet: true, list: { default: true } },
    entity_id: { type: "text", label: "Record", search: true, list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true },
    detail: { type: "text", label: "Detail", search: true, list: { default: true, width: 320 } },
    has_diff: { type: "bool", label: "Has changes", facet: true, list: { default: false }, sql: "(audit.before_json IS NOT NULL OR audit.after_json IS NOT NULL)" },
    model: { type: "text", label: "Model" },
    before_json: { type: "json", label: "Before" },
    after_json: { type: "json", label: "After" },
  },
  relations: [],
  list: {
    defaultSort: ["at", "desc"],
    savedViews: [
      { key: "ai", label: "AI actions", filters: { by_ai: "true" } },
      { key: "policies", label: "Policy and rule changes", filters: { entity_type: ["approval_policies", "state_rules", "automation_rules"] } },
      { key: "people", label: "People and roles", filters: { entity_type: ["staff"] } },
    ],
  },
  detail: {
    facts: ["at", "actor", "role", "agent", "action", "entity_type", "entity_id", "model"],
    tabs: [{ custom: "settings.audit_diff" }, { key: "overview", label: "Fields", fields: ["at", "actor", "role", "agent", "model", "action", "entity_type", "entity_id", "property_id", "detail"] }],
    related: [],
  },
  permissions: { read: READERS },
  writes: "none",
  help: { summary: "Every change and approval, by a person or an agent: who, when, acting as which role, and what changed.", article: "audit-log" },
});

