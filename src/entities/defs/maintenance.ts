// Entity defs for the maintenance module. Call registerEntity() from "../registry" for each def.
// Owned by the maintenance module lane; see AGENTS.md "v2 lanes and ownership".
// Work orders and vendors are written by lane C as the reference pattern for module lanes.
import { HardHat, Wrench } from "lucide-react";
import { AS_OF, issuesField, LEADERS, OPS, STAFF } from "../common";
import { registerEntity } from "../registry";

const OPEN = "('Completed', 'Paid', 'Cancelled')";

registerEntity({
  key: "work_orders",
  table: "work_orders",
  label: { one: "Work order", many: "Work orders" },
  icon: Wrench,
  module: "maintenance",
  nav: { section: "operations", group: "Maintenance", order: 40 },
  route: "/app/maintenance/work-orders",
  titleField: "title",
  subtitle: (r) => [r.id, r.property_id__label, r.unit_id__label].filter(Boolean).join(" · "),
  scopePath: "work_orders.property_id",
  fields: {
    title: { type: "text", label: "Work order", required: true, search: true, sortable: true, list: { default: true, width: 280 } },
    status: { type: "enum", label: "Status", required: true, facet: true, sortable: true, list: { default: true }, enum: [
      { value: "New", tone: "warning" }, { value: "Triaged", tone: "info" }, { value: "Assigned", tone: "info" }, { value: "Scheduled", tone: "info" },
      { value: "In progress", tone: "info" }, { value: "On hold", tone: "warning" }, { value: "Submitted", tone: "warning" },
      { value: "Completed", tone: "success" }, { value: "Paid", tone: "success" }, { value: "Cancelled", tone: "neutral" },
    ] },
    priority: { type: "enum", label: "Priority", facet: true, required: true, sortable: true, list: { default: true }, enum: [
      { value: "Emergency", tone: "danger" }, { value: "Urgent", tone: "warning" }, { value: "Normal", tone: "neutral" }, { value: "Low", tone: "neutral" },
    ] },
    category: { type: "text", label: "Trade", facet: true, required: true, sortable: true, list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, required: true, sortable: true, list: { default: true }, editable: [] },
    unit_id: { type: "ref", ref: "units", label: "Unit", list: { default: true }, editable: [...OPS, "maintenance_supervisor"] },
    vendor_id: { type: "ref", ref: "vendors", label: "Vendor", facet: true, list: { default: true }, editable: [...OPS, "maintenance_supervisor"] },
    assignee_id: { type: "ref", ref: "staff", label: "Technician", facet: true, list: { default: false }, editable: [...OPS, "maintenance_supervisor"] },
    opened_at: { type: "datetime", label: "Opened", required: true, sortable: true, list: { default: true }, editable: [] },
    sla_due_at: { type: "datetime", label: "SLA due", sortable: true, list: { default: true } },
    past_sla: { type: "bool", label: "Past SLA", facet: true, list: { default: false },
      sql: `(work_orders.status NOT IN ${OPEN} AND work_orders.sla_due_at IS NOT NULL AND substr(work_orders.sla_due_at, 1, 10) < ${AS_OF})`,
      help: { summary: "Open past its SLA due time. Emergency SLAs are 4 hours, urgent 24, normal 72.", article: "maintenance-sla" } },
    age_days: { type: "number", label: "Age (days)", sortable: true, list: { default: false, align: "right" }, sql: `CAST(julianday(coalesce(work_orders.completed_at, ${AS_OF})) - julianday(work_orders.opened_at) AS INTEGER)` },
    estimate: { type: "money", label: "Estimate", column: "estimate_cents", sortable: true, list: { default: false, align: "right" } },
    cost: { type: "money", label: "Cost", column: "cost_cents", sortable: true, list: { default: true, align: "right" }, editable: [...OPS, "maintenance_supervisor"] },
    source: { type: "enum", label: "Source", facet: true, enum: [
      { value: "Resident", tone: "neutral" }, { value: "Staff", tone: "neutral" }, { value: "Inspection", tone: "neutral" }, { value: "Preventive", tone: "neutral" }, { value: "Turnover", tone: "neutral" },
    ] },
    description: { type: "text", label: "Description", search: true },
    scheduled_at: { type: "datetime", label: "Scheduled", sortable: true },
    completed_at: { type: "datetime", label: "Completed", sortable: true },
    permission_to_enter: { type: "bool", label: "Permission to enter" },
    open_issues: issuesField("work_orders"),
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "unit", entity: "units", fk: "unit_id", kind: "one" },
    { name: "vendor", entity: "vendors", fk: "vendor_id", kind: "one" },
    { name: "technician", entity: "staff", fk: "assignee_id", kind: "one" },
    { name: "bills", entity: "bills", fk: "work_order_id", kind: "many" },
  ],
  list: {
    defaultSort: ["opened_at", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "open", label: "Open", filters: { status: ["New", "Triaged", "Assigned", "Scheduled", "In progress", "On hold", "Submitted"] }, sort: ["sla_due_at", "asc"] },
      { key: "past-sla", label: "Past SLA", filters: { past_sla: "true" }, sort: ["sla_due_at", "asc"] },
      { key: "emergency", label: "Emergency and urgent", filters: { priority: ["Emergency", "Urgent"], status: ["New", "Triaged", "Assigned", "Scheduled", "In progress"] } },
      { key: "unassigned", label: "Unassigned", filters: { status: "New", "vendor_id.null": "1" } },
      { key: "awaiting-approval", label: "Invoices to approve", filters: { status: "Submitted" } },
    ],
    footer: [{ field: "cost", fn: "sum", label: "Cost" }, { field: "estimate", fn: "sum", label: "Estimate" }],
  },
  detail: {
    facts: ["status", "priority", "category", "property_id", "unit_id", "vendor_id", "sla_due_at", "cost"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["title", "description", "status", "priority", "category", "source", "property_id", "unit_id", "vendor_id", "assignee_id", "opened_at", "scheduled_at", "sla_due_at", "completed_at", "estimate", "cost", "permission_to_enter"] },
      { key: "bills", label: "Bills", relation: "bills", roles: [...OPS, "accountant", "maintenance_supervisor"] },
    ],
    related: ["property", "unit", "vendor", "technician"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  kpis: [
    { key: "open", label: "Open work orders", metric: "maintenance.wo_open", format: "count", delta: "mom", goodWhen: "down", drill: "/app/maintenance/work-orders?view=open" },
    { key: "sla", label: "Within SLA", metric: "maintenance.sla", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/maintenance/work-orders?view=past-sla" },
  ],
  charts: [
    { key: "wo_trend", title: "Work orders opened vs open, trailing 12 months", kind: "bar", metric: "maintenance.wo_open", x: "month", series: [{ key: "opened", label: "Opened", format: "count" }, { key: "open", label: "Open at month end", format: "count" }, { key: "breached", label: "Past SLA", format: "count" }], drill: "/app/maintenance/work-orders?view=open" },
  ],
  ai: {
    facts: (r) => ({ work_order: String(r.id), title: String(r.title), status: String(r.status), priority: String(r.priority), trade: String(r.category), past_sla: !!r.past_sla, age_days: Number(r.age_days ?? 0), vendor: (r.vendor_id__label as string) ?? null, estimate: r.estimate == null ? null : Number(r.estimate), cost: r.cost == null ? null : Number(r.cost) }),
    summaryPrompt: "Summarise this work order for the maintenance supervisor in 2 sentences: what's wrong, where it stands against SLA, and the next step. Use only the facts.",
    agents: ["maintenance_triage", "photo_check", "ap"],
  },
  permissions: { read: [...STAFF, "vendor", "resident", "owner"], create: [...OPS, "maintenance_supervisor", "leasing_agent", "resident"], update: [...OPS, "maintenance_supervisor", "vendor"], delete: [...LEADERS, "maintenance_supervisor"] },
  writes: "generic",
  help: { summary: "Repairs and requests from residents, inspections, preventive schedules and turnovers, tracked against SLA through vendor invoice and payment.", article: "work-orders" },
});

registerEntity({
  key: "vendors",
  table: "vendors",
  label: { one: "Vendor", many: "Vendors" },
  icon: HardHat,
  module: "maintenance",
  nav: { section: "operations", group: "Maintenance", order: 45 },
  route: "/app/maintenance/vendors",
  titleField: "company",
  subtitle: (r) => [r.trade, r.contact_name].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    company: { type: "text", label: "Company", required: true, search: true, sortable: true, list: { default: true, width: 240 } },
    trade: { type: "text", label: "Trade", facet: true, required: true, sortable: true, list: { default: true } },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Active", tone: "success" }, { value: "Inactive", tone: "neutral" }, { value: "Do not use", tone: "danger" },
    ] },
    rating: { type: "number", label: "Rating", sortable: true, list: { default: true, align: "right" }, editable: [] },
    open_jobs: { type: "number", label: "Open jobs", sortable: true, list: { default: true, align: "right" },
      sql: `(SELECT count(*) FROM {work_orders} w WHERE w.vendor_id = vendors.id AND w.status NOT IN ${OPEN})` },
    spend_12m: { type: "money", label: "Spend (12 mo)", format: "compact", sortable: true, list: { default: true, align: "right" }, hiddenFor: ["leasing_agent"],
      sql: `(SELECT coalesce(sum(b.amount_cents), 0) FROM {bills} b WHERE b.vendor_id = vendors.id AND b.bill_date >= date(${AS_OF}, '-12 months'))` },
    coi_expires: { type: "date", label: "COI expires", sortable: true, list: { default: true }, sql: "(SELECT max(c.expires_on) FROM {vendor_cois} c WHERE c.vendor_id = vendors.id)",
      help: { summary: "Latest certificate of insurance on file. Vendors with an expired COI shouldn't be dispatched.", article: "vendor-coi" } },
    contact_name: { type: "text", label: "Contact", search: true, list: { default: false } },
    email: { type: "text", label: "Email", search: true },
    phone: { type: "text", label: "Phone", search: true },
    metros: { type: "json", label: "Metros served" },
    w9_on_file: { type: "bool", label: "W-9 on file", facet: true, list: { default: false } },
    is_1099: { type: "bool", label: "1099 vendor", facet: true },
    tin_last4: { type: "text", label: "TIN (last 4)", hiddenFor: ["leasing_agent", "maintenance_supervisor", "property_manager", "vendor"], editable: ["accountant"] },
    bank_last4: { type: "text", label: "Bank account (last 4)", hiddenFor: ["leasing_agent", "maintenance_supervisor"], editable: ["accountant"],
      help: { summary: "Only accountants can change bank details. A change holds payments until someone verifies it by phone.", article: "vendor-bank-change" } },
    bank_changed_at: { type: "datetime", label: "Bank details changed", sortable: true, hiddenFor: ["leasing_agent", "maintenance_supervisor"], editable: [] },
    open_issues: issuesField("vendors"),
  },
  relations: [
    { name: "work_orders", entity: "work_orders", fk: "vendor_id", kind: "many" },
    { name: "bills", entity: "bills", fk: "vendor_id", kind: "many" },
    { name: "cois", label: "Insurance certificates", entity: "vendor_cois", fk: "vendor_id", kind: "many" },
  ],
  list: {
    defaultSort: ["company", "asc"],
    statusTabs: "status",
    savedViews: [
      { key: "coi-expiring", label: "COI expired or expiring", sort: ["coi_expires", "asc"] },
      { key: "bank-changed", label: "Recent bank change", filters: { "bank_changed_at.null": "0" }, sort: ["bank_changed_at", "desc"] },
      { key: "no-w9", label: "Missing W-9", filters: { w9_on_file: "false" } },
    ],
    footer: [{ field: "spend_12m", fn: "sum", label: "Spend" }],
  },
  detail: {
    facts: ["trade", "status", "rating", "open_jobs", "spend_12m", "coi_expires", "phone", "email"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["company", "trade", "status", "contact_name", "email", "phone", "metros", "rating", "w9_on_file", "is_1099", "tin_last4", "bank_last4", "bank_changed_at"] },
      { key: "work_orders", label: "Jobs", relation: "work_orders" },
      { key: "bills", label: "Bills", relation: "bills", roles: ["principal", "regional_manager", "property_manager", "accountant"] },
      { key: "cois", label: "Insurance", relation: "cois" },
    ],
    related: ["cois"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  ai: {
    facts: (r) => ({ vendor: String(r.company), trade: String(r.trade), status: String(r.status), rating: r.rating == null ? null : Number(r.rating), open_jobs: Number(r.open_jobs ?? 0), spend_12m: r.spend_12m == null ? null : Number(r.spend_12m), coi_expires: (r.coi_expires as string) ?? null, bank_changed_recently: !!r.bank_changed_at }),
    agents: ["ap", "compliance"],
  },
  permissions: { read: [...STAFF, "vendor"], create: [...OPS, "maintenance_supervisor", "accountant"], update: [...OPS, "maintenance_supervisor", "accountant", "vendor"], delete: [...LEADERS] },
  writes: "generic",
  dataRules: ["vendors.unverified_bank_change"],
  help: { summary: "The vendors you dispatch and pay: trade, insurance, tax forms, bank details and how they perform.", article: "vendors" },
});
