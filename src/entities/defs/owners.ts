// Entity defs for the owners module: owners, owner entities (the LLCs that hold title, with their
// management agreement) and owner distributions (one per entity per closed month).
// Owned by the owners module lane; see AGENTS.md "v2 lanes and ownership".
import { Building, HandCoins, Landmark } from "lucide-react";
import { FINANCE, LEADERS, STAFF, issuesField } from "../common";
import { registerEntity } from "../registry";
import { formatDate } from "@/lib/format";

registerEntity({
  key: "owners",
  table: "owners",
  label: { one: "Owner", many: "Owners" },
  icon: Landmark,
  module: "owners",
  nav: { section: "portfolio", order: 30 },
  route: "/app/owners",
  titleField: "name",
  subtitle: (r) => [r.kind, r.entities != null && `${r.entities} ${Number(r.entities) === 1 ? "entity" : "entities"}`].filter(Boolean).join(" · "),
  // Owners sit above properties (one owner, many properties), so the directory is org-level.
  scopePath: null,
  fields: {
    name: { type: "text", label: "Owner", required: true, search: true, sortable: true, list: { default: true, width: 260 } },
    kind: { type: "enum", label: "Type", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Individual", tone: "neutral" }, { value: "Fund", tone: "neutral" }, { value: "Family office", tone: "neutral" }, { value: "Institution", tone: "neutral" },
    ] },
    entities: { type: "number", label: "Entities", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {owner_entities} oe WHERE oe.owner_id = owners.id)" },
    properties: { type: "number", label: "Properties", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT count(*) FROM {properties} p JOIN {owner_entities} oe ON oe.id = p.owner_entity_id WHERE oe.owner_id = owners.id)" },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT count(*) FROM {units} u JOIN {properties} p ON p.id = u.property_id JOIN {owner_entities} oe ON oe.id = p.owner_entity_id WHERE oe.owner_id = owners.id)" },
    distributed_12m: { type: "money", label: "Distributed, 12 months", sortable: true, list: { default: true, align: "right" }, hiddenFor: ["leasing_agent", "maintenance_supervisor"],
      sql: "(SELECT coalesce(sum(d.amount_cents), 0) FROM {owner_distributions} d JOIN {owner_entities} oe ON oe.id = d.owner_entity_id WHERE oe.owner_id = owners.id AND d.period >= strftime('%Y-%m', (SELECT value FROM meta WHERE key = 'as_of'), '-12 months'))" },
    email: { type: "text", label: "Email", search: true, list: { default: true } },
    phone: { type: "text", label: "Phone", search: true },
    portal_enabled: { type: "bool", label: "Portal access", facet: true, list: { default: true }, help: { summary: "Whether the owner can sign in to the owner portal to see statements and approve repairs.", article: "owner-portal" } },
  },
  relations: [
    { name: "entities", label: "Owner entities", entity: "owner_entities", fk: "owner_id", kind: "many" },
  ],
  list: {
    defaultSort: ["name", "asc"],
    statusTabs: "kind",
    savedViews: [{ key: "no-portal", label: "Portal not enabled", filters: { portal_enabled: "false" } }],
    footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "distributed_12m", fn: "sum", label: "Distributed" }],
  },
  detail: {
    facts: ["kind", "entities", "properties", "units", "distributed_12m", "email", "phone", "portal_enabled"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["name", "kind", "email", "phone", "portal_enabled"] },
      { key: "entities", label: "Entities", relation: "entities" },
    ],
    related: ["entities"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  kpis: [
    { key: "distributed", label: "Distributed last month", metric: "owners.distributions", format: "money", delta: "mom", goodWhen: "up", drill: "/app/owner-distributions", help: { summary: "Cash paid to owners for the last closed month, after expenses, the management fee and reserves.", article: "owner-statements" } },
    { key: "owed", label: "Owed to owners now", metric: "owners.owed_now", format: "money", drill: "/app/owner-statements", help: { summary: "Open statement balances: cleared rent and other income since each entity's last payout, less fees and vendor payments.", article: "owner-statements" } },
  ],
  ai: {
    facts: (r) => ({ owner: String(r.name), kind: String(r.kind), entities: Number(r.entities ?? 0), properties: Number(r.properties ?? 0), units: Number(r.units ?? 0), distributed_12m: Number(r.distributed_12m ?? 0) }),
    agents: ["owner_reporting"],
  },
  permissions: { read: [...STAFF, "owner"], create: [...LEADERS, "broker"], update: [...LEADERS, "broker", "accountant"], delete: ["principal"] },
  writes: "generic",
  actions: ["owners.decide_spend", "owners.send_message"],
  help: { summary: "The investors you manage for. Each owns one or more LLCs (owner entities) that hold title and receive statements.", article: "owners" },
});

// Last payout per entity, for list columns. Open items follow Lane A's period cutoff (money.ts).
const LAST_PAYOUT = "(SELECT max(t.seq) FROM {transfers} t WHERE t.owner_entity_id = owner_entities.id AND t.kind = 'Owner payout' AND t.status <> 'Returned' AND t.key NOT LIKE 'owner-adj:%')";
const OPEN_ITEM = `t.owner_entity_id = owner_entities.id AND t.bank_account_id = 'ba-' || owner_entities.id || '-trust' AND t.status <> 'Returned' AND t.kind <> 'Owner payout' AND t.seq > coalesce(${LAST_PAYOUT}, 0)`;

registerEntity({
  key: "owner_entities",
  table: "owner_entities",
  label: { one: "Owner entity", many: "Owner entities" },
  icon: Building,
  module: "owners",
  nav: { section: "portfolio", order: 31, label: "Owner entities" },
  route: "/app/owner-entities",
  titleField: "name",
  subtitle: (r) => [r.owner_id__label, r.state, r.properties != null && `${r.properties} properties`].filter(Boolean).join(" · "),
  // An LLC holds several properties; it is org-level, like owners. Portal owners see their own (owner_id).
  scopePath: null,
  fields: {
    name: { type: "text", label: "Entity", required: true, search: true, sortable: true, list: { default: true, width: 300 } },
    owner_id: { type: "ref", ref: "owners", label: "Owner", required: true, facet: true, sortable: true, list: { default: true } },
    state: { type: "enum", label: "State", facet: true, sortable: true, list: { default: true }, enum: [{ value: "TX", tone: "neutral" }, { value: "GA", tone: "neutral" }, { value: "AZ", tone: "neutral" }] },
    ein_last4: { type: "text", label: "EIN (last 4)", hiddenFor: ["leasing_agent", "maintenance_supervisor", "owner"] },
    properties: { type: "number", label: "Properties", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {properties} p WHERE p.owner_entity_id = owner_entities.id)" },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {units} u JOIN {properties} p ON p.id = u.property_id WHERE p.owner_entity_id = owner_entities.id)" },
    mgmt_fee_pct: { type: "number", label: "Management fee", format: "pct", list: { default: false, align: "right" }, help: { summary: "The rate in this entity's management agreement. Statements currently charge every entity the standard 8% rate.", article: "owner-entities" } },
    reserve: { type: "money", label: "Operating reserve", column: "reserve_cents", sortable: true, list: { default: true, align: "right" }, help: { summary: "Cash kept in the trust account for this entity before anything is distributed.", article: "owner-statements" } },
    owed_now: { type: "money", label: "Owed now", sortable: true, list: { default: true, align: "right" }, hiddenFor: ["leasing_agent", "maintenance_supervisor"],
      sql: `(SELECT coalesce(sum(CASE WHEN t.kind IN ('Rent', 'Other receipt') THEN CASE WHEN t.status = 'Cleared' THEN t.amount_cents ELSE 0 END WHEN t.kind = 'Management fee' THEN CASE WHEN t.status = 'Cleared' THEN -t.amount_cents ELSE 0 END WHEN t.kind IN ('Vendor payout', 'Returned payment') THEN -t.amount_cents ELSE 0 END), 0) FROM {transfers} t WHERE ${OPEN_ITEM})`,
      help: { summary: "The open statement: cleared rent and other income since the last payout, less returned payments, the management fee and vendor payments.", article: "owner-statements" } },
    last_distribution: { type: "money", label: "Last distribution", sortable: true, list: { default: true, align: "right" }, hiddenFor: ["leasing_agent", "maintenance_supervisor"],
      sql: "(SELECT d.amount_cents FROM {owner_distributions} d WHERE d.owner_entity_id = owner_entities.id ORDER BY d.period DESC, d.paid_on DESC LIMIT 1)" },
    last_distribution_on: { type: "date", label: "Last paid", sortable: true, list: { default: true }, sql: "(SELECT max(d.paid_on) FROM {owner_distributions} d WHERE d.owner_entity_id = owner_entities.id)" },
    agreement_signed_on: { type: "date", label: "Agreement signed", sortable: true, list: { default: false }, help: { summary: "The management agreement between the owner entity and Summit Residential Partners.", article: "owner-entities" } },
    agreement_signed_by: { type: "ref", ref: "staff", label: "Signed by" },
    org_id: { type: "ref", ref: "orgs", label: "Org", hiddenFor: ["owner"] },
  },
  relations: [
    { name: "owner", entity: "owners", fk: "owner_id", kind: "one" },
    { name: "properties", label: "Properties", entity: "properties", fk: "owner_entity_id", kind: "many" },
    { name: "distributions", label: "Distributions", entity: "owner_distributions", fk: "owner_entity_id", kind: "many" },
  ],
  list: {
    defaultSort: ["name", "asc"],
    statusTabs: "state",
    savedViews: [
      { key: "owed", label: "Largest balance owed", sort: ["owed_now", "desc"] },
      { key: "agreements", label: "Agreements by date", sort: ["agreement_signed_on", "asc"], columns: ["name", "owner_id", "agreement_signed_on", "agreement_signed_by", "mgmt_fee_pct"] },
    ],
    footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "owed_now", fn: "sum", label: "Owed now" }, { field: "last_distribution", fn: "sum", label: "Last distributions" }],
  },
  detail: {
    facts: ["owner_id", "state", "properties", "units", "reserve", "owed_now", "last_distribution", "agreement_signed_on"],
    tabs: [
      { custom: "owners.statement" },
      { key: "distributions", label: "Distributions", relation: "distributions" },
      { key: "properties", label: "Properties", relation: "properties" },
      { key: "agreement", label: "Management agreement", fields: ["name", "owner_id", "state", "ein_last4", "mgmt_fee_pct", "reserve", "agreement_signed_on", "agreement_signed_by"] },
    ],
    related: ["owner", "properties", "distributions"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  kpis: [
    { key: "owed", label: "Owed to owners now", metric: "owners.owed_now", format: "money", drill: "/app/owner-entities?view=owed", help: { summary: "Open statement balances across entities in your scope.", article: "owner-statements" } },
    { key: "distributed", label: "Distributed last month", metric: "owners.distributions", format: "money", delta: "mom", goodWhen: "up", drill: "/app/owner-distributions" },
    { key: "unreconciled", label: "Unreconciled statements", metric: "owners.unreconciled", format: "count", goodWhen: "down", drill: "/app/owner-distributions?view=unreconciled" },
  ],
  charts: [
    { key: "dist_trend", title: "Owner distributions, trailing 12 months", kind: "bar", metric: "owners.distributions", x: "month", series: [{ key: "amount", label: "Distributed", format: "money" }], drill: "/app/owner-distributions?f.period={month}" },
    { key: "waterfall", title: "Rent collected to distribution", kind: "stacked", metric: "owners.waterfall", x: "month", series: [{ key: "expense", label: "Vendor payments", format: "money" }, { key: "fee", label: "Management fee", format: "money" }, { key: "amount", label: "Distributed", format: "money" }], drill: "/app/owner-distributions?f.period={month}" },
    { key: "by_entity", title: "Last month's distribution by entity", kind: "hbar", metric: "owners.by_entity", x: "name", series: [{ key: "amount", label: "Distributed", format: "money" }], drill: "/app/owner-entities/{owner_entity_id}" },
  ],
  ai: {
    facts: (r) => ({ entity: String(r.name), owner: String(r.owner_id__label ?? r.owner_id), state: String(r.state), properties: Number(r.properties ?? 0), units: Number(r.units ?? 0), owed_now: Number(r.owed_now ?? 0), last_distribution: Number(r.last_distribution ?? 0), reserve: Number(r.reserve ?? 0) }),
    agents: ["owner_reporting"],
  },
  permissions: { read: [...STAFF, "owner"], create: [...LEADERS, "broker"], update: [...LEADERS, "broker", "accountant"], delete: ["principal"] },
  writes: "generic",
  actions: ["owner_entities.distribute", "owner_entities.send_explanation"],
  help: { summary: "The LLCs that hold title to properties. Each has a management agreement, a trust account and a monthly statement.", article: "owner-entities" },
});

// Income − expenses − fee − reserve − paid − corrections. Anything but zero means the statement and the payout disagree.
// A paid correction (transfer key owner-adj:<distribution>) closes the gap.
const GAP = "(owner_distributions.income_cents - owner_distributions.expense_cents - owner_distributions.fee_cents - owner_distributions.reserve_cents - owner_distributions.amount_cents - coalesce((SELECT a.amount_cents FROM {transfers} a WHERE a.key = 'owner-adj:' || owner_distributions.id AND a.status <> 'Returned'), 0))";

registerEntity({
  key: "owner_distributions",
  table: "owner_distributions",
  label: { one: "Owner distribution", many: "Owner distributions" },
  icon: HandCoins,
  module: "owners",
  nav: { section: "finance", group: "Owners", order: 61, label: "Distributions" },
  route: "/app/owner-distributions",
  titleField: "title",
  subtitle: (r) => [r.owner_entity_id__label, r.paid_on && `paid ${formatDate(String(r.paid_on), "always")}`].filter(Boolean).join(" · "),
  // Scope by the entity's first property: a manager scoped to any of its properties sees the payout.
  scopePath: "(SELECT min(p.id) FROM {properties} p WHERE p.owner_entity_id = owner_distributions.owner_entity_id)",
  fields: {
    title: { type: "text", label: "Statement", sql: "'Statement ' || owner_distributions.period", list: { default: true, width: 160 } },
    owner_entity_id: { type: "ref", ref: "owner_entities", label: "Owner entity", facet: true, sortable: true, list: { default: true, width: 260 } },
    period: { type: "text", label: "Period", facet: true, sortable: true, search: true, list: { default: true } },
    income: { type: "money", label: "Income", column: "income_cents", sortable: true, list: { default: true, align: "right" } },
    expense: { type: "money", label: "Expenses", column: "expense_cents", sortable: true, list: { default: true, align: "right" } },
    fee: { type: "money", label: "Management fee", column: "fee_cents", sortable: true, list: { default: true, align: "right" } },
    reserve: { type: "money", label: "Reserve change", column: "reserve_cents", list: { default: false, align: "right" } },
    amount: { type: "money", label: "Distributed", column: "amount_cents", sortable: true, list: { default: true, align: "right" } },
    paid_on: { type: "date", label: "Paid", sortable: true, list: { default: true } },
    status: { type: "enum", label: "Payment", facet: true, list: { default: true }, sql: "(SELECT t.status FROM {transfers} t WHERE t.id = owner_distributions.transfer_id)", enum: [
      { value: "Pending", tone: "info", label: "On its way" }, { value: "Cleared", tone: "success", label: "Paid" }, { value: "Returned", tone: "danger" },
    ] },
    gap: { type: "money", label: "Unreconciled", sortable: true, list: { default: false, align: "right" }, sql: GAP, help: { summary: "Income less expenses, fee and reserve, minus what was paid and any correction. Should be $0.00; anything else opens a Data Health issue.", article: "owner-statements" } },
    transfer_id: { type: "text", label: "Transfer" },
    issues: issuesField("owner_distributions"),
  },
  relations: [
    { name: "entity", entity: "owner_entities", fk: "owner_entity_id", kind: "one" },
  ],
  list: {
    defaultSort: ["period", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "unreconciled", label: "Unreconciled", filters: { "gap.min": "0.01" }, sort: ["gap", "desc"] },
      { key: "issues", label: "With data issues", filters: { "issues.min": "1" } },
    ],
    footer: [{ field: "income", fn: "sum", label: "Income" }, { field: "expense", fn: "sum", label: "Expenses" }, { field: "fee", fn: "sum", label: "Fees" }, { field: "amount", fn: "sum", label: "Distributed" }],
  },
  detail: {
    facts: ["owner_entity_id", "period", "income", "expense", "fee", "reserve", "amount", "gap"],
    tabs: [
      { custom: "owners.distribution" },
      { key: "overview", label: "Details", fields: ["owner_entity_id", "period", "income", "expense", "fee", "reserve", "amount", "paid_on", "status", "gap", "transfer_id"] },
    ],
    related: ["entity"],
  },
  capabilities: { activity: true, notes: true },
  kpis: [
    { key: "distributed", label: "Distributed last month", metric: "owners.distributions", format: "money", delta: "mom", goodWhen: "up", drill: "/app/owner-distributions" },
    { key: "unreconciled", label: "Unreconciled statements", metric: "owners.unreconciled", format: "count", goodWhen: "down", drill: "/app/owner-distributions?view=unreconciled" },
  ],
  permissions: { read: [...FINANCE, "broker", "owner"], create: [], update: [], delete: [] },
  writes: "actions-only",
  actions: ["owner_distributions.pay_rounding_cent"],
  dataRules: ["owner_distributions.rounding_cent"],
  help: { summary: "One row per owner entity per closed month: income, expenses, the management fee, reserve and the amount paid out of trust.", article: "owner-statements" },
});
