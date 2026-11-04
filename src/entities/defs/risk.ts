// Entity defs for the risk module: property insurance, vendor certificates of insurance (COIs),
// compliance items (permits, inspections, certificates, training) and legal cases.
// Owned by the platform lane; the dashboard at /app/compliance is a custom page.
import { ClipboardCheck, FileBadge, Gavel, ShieldCheck } from "lucide-react";
import { AS_OF, LEADERS, OPS, STAFF } from "../common";
import { registerEntity } from "../registry";
import type { Role } from "../types";
import { COI_STATUS_SQL, COMPLIANCE_STATUS_SQL, POLICY_STATUS_SQL } from "@/extensions/risk/sql";
import { complianceSentence } from "@/ai/rules-sentences";
import { formatDate } from "@/lib/format";

const RISK_WRITE: Role[] = [...OPS, "maintenance_supervisor"];
const WO_OPEN = "('Completed', 'Paid', 'Cancelled')";

const daysTo = (col: string) => `CAST(julianday(${col}) - julianday(${AS_OF}) AS INTEGER)`;

registerEntity({
  key: "insurance_policies",
  table: "insurance_policies",
  label: { one: "Insurance policy", many: "Insurance policies" },
  icon: ShieldCheck,
  module: "risk",
  nav: { section: "operations", group: "Compliance", order: 71, label: "Property insurance" },
  route: "/app/compliance/insurance",
  titleField: "name",
  subtitle: (r) => [r.policy_number, r.property_id__label].filter(Boolean).join(" · "),
  scopePath: "insurance_policies.property_id",
  fields: {
    name: { type: "text", label: "Policy", sortable: true, list: { default: true, width: 260 }, sql: "insurance_policies.kind || ' · ' || insurance_policies.carrier" },
    property_id: { type: "ref", ref: "properties", label: "Property", required: true, facet: true, sortable: true, list: { default: true }, editable: [] },
    kind: { type: "enum", label: "Coverage", required: true, facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Property", tone: "neutral" }, { value: "General liability", tone: "neutral" }, { value: "Umbrella", tone: "neutral" }, { value: "Flood", tone: "neutral" },
    ] },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, sql: POLICY_STATUS_SQL, enum: [
      { value: "Active", tone: "success" }, { value: "Expiring", tone: "warning" }, { value: "Expired", tone: "danger" },
    ], help: { summary: "Expiring means the policy ends within 60 days, the usual lead time for a renewal quote.", article: "property-insurance" } },
    carrier: { type: "text", label: "Carrier", required: true, search: true, facet: true, sortable: true, list: { default: true } },
    policy_number: { type: "text", label: "Policy number", required: true, search: true, list: { default: false } },
    coverage: { type: "money", label: "Coverage", column: "coverage_cents", required: true, format: "compact", sortable: true, list: { default: true, align: "right" } },
    premium: { type: "money", label: "Annual premium", column: "premium_cents", required: true, sortable: true, list: { default: true, align: "right" } },
    starts_on: { type: "date", label: "Starts", required: true, sortable: true },
    expires_on: { type: "date", label: "Expires", required: true, sortable: true, list: { default: true } },
    days_to_expiry: { type: "number", label: "Days to expiry", sortable: true, list: { default: false, align: "right" }, sql: daysTo("insurance_policies.expires_on") },
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
  ],
  list: {
    defaultSort: ["expires_on", "asc"],
    statusTabs: "status",
    savedViews: [
      { key: "expiring", label: "Expiring in 60 days", filters: { status: ["Expiring", "Expired"] }, sort: ["expires_on", "asc"] },
      { key: "liability", label: "General liability", filters: { kind: "General liability" } },
    ],
    footer: [{ field: "coverage", fn: "sum", label: "Coverage" }, { field: "premium", fn: "sum", label: "Premium" }],
  },
  detail: {
    facts: ["status", "kind", "carrier", "property_id", "coverage", "premium", "expires_on"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["kind", "carrier", "policy_number", "property_id", "coverage", "premium", "starts_on", "expires_on", "days_to_expiry"] },
    ],
    related: ["property"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  ai: {
    facts: (r) => ({ policy: String(r.name), property: (r.property_id__label as string) ?? null, status: String(r.status), expires_on: String(r.expires_on), days_to_expiry: Number(r.days_to_expiry ?? 0), coverage: Number(r.coverage ?? 0), premium: Number(r.premium ?? 0) }),
    summaryPrompt: "Summarise this insurance policy for the property manager in 2 sentences: coverage, when it ends, and whether renewal needs action now. Use only the facts.",
    agents: ["compliance"],
  },
  permissions: { read: [...STAFF], create: RISK_WRITE, update: RISK_WRITE, delete: [...LEADERS] },
  writes: "generic",
  help: { summary: "Property and liability policies for each building, with coverage, premium and renewal dates.", article: "property-insurance" },
});

registerEntity({
  key: "vendor_cois",
  table: "vendor_cois",
  label: { one: "Vendor COI", many: "Vendor COIs" },
  icon: FileBadge,
  module: "risk",
  nav: { section: "operations", group: "Compliance", order: 72, label: "Vendor COIs" },
  route: "/app/compliance/cois",
  titleField: "name",
  subtitle: (r) => [r.carrier, r.expires_on ? `expires ${formatDate(String(r.expires_on), "always")}` : null].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    name: { type: "text", label: "Certificate", sortable: true, list: { default: true, width: 260 },
      sql: "coalesce((SELECT v.company FROM {vendors} v WHERE v.id = vendor_cois.vendor_id), vendor_cois.vendor_id) || ' · ' || vendor_cois.carrier" },
    vendor_id: { type: "ref", ref: "vendors", label: "Vendor", required: true, facet: true, sortable: true, list: { default: true }, editable: [] },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, sql: COI_STATUS_SQL, enum: [
      { value: "Pending verification", tone: "info" }, { value: "Valid", tone: "success" }, { value: "Expiring", tone: "warning" }, { value: "Expired", tone: "danger" }, { value: "Missing", tone: "danger" }, { value: "Rejected", tone: "danger" },
    ], help: { summary: "A new certificate is Pending verification until staff check it against the carrier's document. Only verified certificates count for dispatch. Expiring means it ends within 30 days.", article: "vendor-insurance-certificates" } },
    // The stored review state. New certificates (from anyone, including the vendor) start pending;
    // only vendor_cois.verify and vendor_cois.reject change it.
    review: { type: "enum", label: "Review", column: "status", system: true, initial: ["Pending verification"], list: { default: false }, enum: [
      { value: "Pending verification", tone: "info" }, { value: "Verified", tone: "success" }, { value: "Rejected", tone: "danger" },
      { value: "Valid", tone: "success", label: "Verified" }, { value: "Expiring", tone: "success", label: "Verified" }, { value: "Expired", tone: "success", label: "Verified" }, { value: "Missing", tone: "danger" },
    ] },
    is_current: { type: "bool", label: "Current certificate", facet: true, list: { default: false },
      sql: "(vendor_cois.expires_on = (SELECT max(c.expires_on) FROM {vendor_cois} c WHERE c.vendor_id = vendor_cois.vendor_id))",
      help: { summary: "The latest certificate on file for the vendor. Older ones are kept as history." } },
    carrier: { type: "text", label: "Carrier", required: true, search: true, facet: true, sortable: true, list: { default: true } },
    gl_limit: { type: "money", label: "GL limit", column: "gl_limit_cents", required: true, format: "compact", sortable: true, list: { default: true, align: "right" } },
    workers_comp: { type: "bool", label: "Workers' comp", facet: true, list: { default: true } },
    expires_on: { type: "date", label: "Expires", required: true, sortable: true, list: { default: true } },
    days_to_expiry: { type: "number", label: "Days to expiry", sortable: true, list: { default: false, align: "right" }, sql: daysTo("vendor_cois.expires_on") },
    open_jobs: { type: "number", label: "Open jobs", sortable: true, list: { default: true, align: "right" },
      sql: `(SELECT count(*) FROM {work_orders} w WHERE w.vendor_id = vendor_cois.vendor_id AND w.status NOT IN ${WO_OPEN})`,
      help: { summary: "Work orders still open with this vendor. An expired certificate with open jobs is a liability exposure." } },
    document_id: { type: "ref", ref: "documents", label: "Certificate file", list: { default: false } },
  },
  relations: [
    { name: "vendor", entity: "vendors", fk: "vendor_id", kind: "one" },
    { name: "document", label: "Certificate file", entity: "documents", fk: "document_id", kind: "one" },
  ],
  list: {
    defaultSort: ["expires_on", "asc"],
    statusTabs: "status",
    savedViews: [
      { key: "current", label: "Current", filters: { is_current: "true" }, sort: ["expires_on", "asc"] },
      { key: "to-verify", label: "To verify", filters: { status: "Pending verification" }, sort: ["expires_on", "asc"] },
      { key: "action", label: "Needs action", filters: { is_current: "true", status: ["Expiring", "Expired", "Missing"] }, sort: ["expires_on", "asc"] },
      { key: "exposed", label: "Expired with open jobs", filters: { is_current: "true", status: ["Expired", "Missing"], "open_jobs.min": "1" }, sort: ["open_jobs", "desc"] },
    ],
  },
  detail: {
    facts: ["status", "review", "vendor_id", "carrier", "gl_limit", "workers_comp", "expires_on", "open_jobs"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["vendor_id", "carrier", "gl_limit", "workers_comp", "expires_on", "days_to_expiry", "is_current", "open_jobs", "document_id"] },
    ],
    related: ["vendor", "document"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  ai: {
    facts: (r) => ({ vendor: (r.vendor_id__label as string) ?? String(r.vendor_id), status: String(r.status), expires_on: String(r.expires_on), days_to_expiry: Number(r.days_to_expiry ?? 0), open_jobs: Number(r.open_jobs ?? 0), gl_limit: Number(r.gl_limit ?? 0), workers_comp: !!r.workers_comp }),
    summaryPrompt: "Summarise this vendor's insurance certificate for the maintenance supervisor in 2 sentences: whether it's current, and whether open jobs are exposed. Use only the facts.",
    agents: ["compliance"],
  },
  // Vendors may submit a certificate (it stays pending) but never edit one, so a verified
  // certificate's expiry or limits can't be changed from the vendor side.
  permissions: { read: [...STAFF, "vendor"], create: [...RISK_WRITE, "vendor"], update: RISK_WRITE, delete: [...LEADERS] },
  writes: "generic",
  actions: ["vendor_cois.verify", "vendor_cois.reject", "vendor_cois.request_certificate"],
  help: { summary: "Certificates of insurance from the vendors you dispatch: carrier, liability limit, workers' comp and expiry.", article: "vendor-insurance-certificates" },
});

registerEntity({
  key: "compliance_items",
  table: "compliance_items",
  label: { one: "Compliance item", many: "Compliance items" },
  icon: ClipboardCheck,
  module: "risk",
  nav: { section: "operations", group: "Compliance", order: 73, label: "Compliance items" },
  route: "/app/compliance/items",
  titleField: "title",
  subtitle: (r) => [r.kind, r.property_id__label ?? r.staff_id__label ?? "Org-wide"].filter(Boolean).join(" · "),
  scopePath: "compliance_items.property_id",
  fields: {
    title: { type: "text", label: "Item", required: true, search: true, sortable: true, list: { default: true, width: 320 } },
    kind: { type: "text", label: "Type", required: true, facet: true, sortable: true, list: { default: true } },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, sql: COMPLIANCE_STATUS_SQL, enum: [
      { value: "Overdue", tone: "danger" }, { value: "Due soon", tone: "warning" }, { value: "Open", tone: "info" }, { value: "Done", tone: "success" },
    ], help: { summary: "Due soon means due within 30 days. An item is done once its completion date is recorded.", article: "compliance-items" } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true }, editable: [] },
    staff_id: { type: "ref", ref: "staff", label: "Staff member", facet: true, list: { default: false } },
    due_on: { type: "date", label: "Due", required: true, sortable: true, list: { default: true } },
    days_to_due: { type: "number", label: "Days to due", sortable: true, list: { default: false, align: "right" }, sql: daysTo("compliance_items.due_on") },
    completed_on: { type: "date", label: "Completed", sortable: true, list: { default: true } },
    document_id: { type: "ref", ref: "documents", label: "Certificate or report" },
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "staff", label: "Staff member", entity: "staff", fk: "staff_id", kind: "one" },
    { name: "document", label: "Certificate or report", entity: "documents", fk: "document_id", kind: "one" },
  ],
  list: {
    defaultSort: ["due_on", "asc"],
    statusTabs: "status",
    savedViews: [
      { key: "attention", label: "Overdue and due soon", filters: { status: ["Overdue", "Due soon"] }, sort: ["due_on", "asc"] },
      { key: "next-90", label: "Due in 90 days", filters: { status: ["Overdue", "Due soon", "Open"] }, sort: ["due_on", "asc"] },
      { key: "training", label: "Staff training", filters: { kind: "Fair housing training" } },
    ],
  },
  detail: {
    facts: ["status", "kind", "property_id", "staff_id", "due_on", "completed_on"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["title", "kind", "property_id", "staff_id", "due_on", "days_to_due", "completed_on", "document_id"] },
    ],
    related: ["property", "staff", "document"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  ai: {
    facts: (r) => ({ item: String(r.title), kind: String(r.kind), status: String(r.status), due_on: String(r.due_on), days_to_due: Number(r.days_to_due ?? 0), property: (r.property_id__label as string) ?? null, completed_on: (r.completed_on as string) ?? null }),
    rulesSummary: complianceSentence,
    summaryPrompt: "Summarise this compliance item for the property manager in 2 sentences: what it is, where it stands against its due date, and the next step. Use only the facts.",
    agents: ["compliance"],
  },
  permissions: { read: [...STAFF], create: RISK_WRITE, update: RISK_WRITE, delete: [...LEADERS] },
  writes: "generic",
  actions: ["compliance_items.mark_done"],
  help: { summary: "Permits, inspections, certificates and staff training with due dates, so nothing lapses unnoticed.", article: "compliance-items" },
});

registerEntity({
  key: "legal_cases",
  table: "legal_cases",
  label: { one: "Legal case", many: "Legal cases" },
  icon: Gavel,
  module: "risk",
  nav: { section: "operations", group: "Compliance", order: 74, label: "Legal and evictions" },
  route: "/app/compliance/legal",
  titleField: "name",
  subtitle: (r) => [r.id, r.property_id__label, r.court].filter(Boolean).join(" · "),
  scopePath: "legal_cases.property_id",
  fields: {
    name: { type: "text", label: "Case", sortable: true, list: { default: true, width: 280 },
      sql: "legal_cases.kind || ' · ' || coalesce((SELECT h.name FROM {leases} l JOIN {households} h ON h.id = l.household_id WHERE l.id = legal_cases.lease_id), (SELECT p.name FROM {properties} p WHERE p.id = legal_cases.property_id), legal_cases.id)" },
    kind: { type: "enum", label: "Type", required: true, facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Eviction", tone: "danger" }, { value: "Small claims", tone: "warning" }, { value: "Fair housing complaint", tone: "warning" }, { value: "Other", tone: "neutral" },
    ] },
    stage: { type: "enum", label: "Stage", required: true, facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Notice served", tone: "warning" }, { value: "Filed", tone: "info" }, { value: "Hearing set", tone: "info" }, { value: "Judgment", tone: "warning" }, { value: "Writ", tone: "danger" }, { value: "Closed", tone: "neutral" },
    ] },
    property_id: { type: "ref", ref: "properties", label: "Property", required: true, facet: true, sortable: true, list: { default: true }, editable: [] },
    lease_id: { type: "ref", ref: "leases", label: "Lease", list: { default: false }, editable: OPS },
    balance: { type: "money", label: "Balance at issue", column: "balance_cents", sortable: true, list: { default: true, align: "right" } },
    attorney: { type: "text", label: "Attorney", search: true, facet: true, list: { default: false } },
    court: { type: "text", label: "Court", search: true, list: { default: true } },
    next_date: { type: "date", label: "Next court date", sortable: true, list: { default: true } },
    opened_on: { type: "date", label: "Opened", required: true, sortable: true, list: { default: false } },
    closed_on: { type: "date", label: "Closed", sortable: true },
    days_open: { type: "number", label: "Days open", sortable: true, list: { default: false, align: "right" },
      sql: `CAST(julianday(coalesce(legal_cases.closed_on, ${AS_OF})) - julianday(legal_cases.opened_on) AS INTEGER)` },
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "lease", entity: "leases", fk: "lease_id", kind: "one" },
  ],
  list: {
    defaultSort: ["next_date", "asc"],
    statusTabs: "stage",
    savedViews: [
      { key: "open", label: "Open", filters: { stage: ["Notice served", "Filed", "Hearing set", "Judgment", "Writ"] }, sort: ["next_date", "asc"] },
      { key: "evictions", label: "Evictions", filters: { kind: "Eviction" } },
    ],
    footer: [{ field: "balance", fn: "sum", label: "Balance" }],
  },
  detail: {
    facts: ["kind", "stage", "property_id", "lease_id", "balance", "next_date", "attorney"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["kind", "stage", "property_id", "lease_id", "balance", "attorney", "court", "next_date", "opened_on", "closed_on", "days_open"] },
    ],
    related: ["property", "lease"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  ai: {
    facts: (r) => ({ case: String(r.name), stage: String(r.stage), balance: r.balance == null ? null : Number(r.balance), next_date: (r.next_date as string) ?? null, days_open: Number(r.days_open ?? 0), attorney: (r.attorney as string) || null, court: (r.court as string) || null }),
    summaryPrompt: "Summarise this legal case for the property manager in 2 sentences: where it stands, the next court date, and the amount at issue. Use only the facts. Never give legal advice.",
    agents: ["compliance", "collections"],
  },
  permissions: { read: [...OPS, "broker", "accountant"], create: OPS, update: OPS, delete: [...LEADERS] },
  writes: "generic",
  help: { summary: "Evictions, small-claims collections and fair-housing complaints, with stage, court dates and the balance at issue. Every step here needs a person; no agent files or advances a case.", article: "legal-cases" },
});
