// Entity defs for the receivables module. Call registerEntity() from "../registry" for each def.
// Owned by the receivables module lane; see AGENTS.md "v2 lanes and ownership".
// Charges and payments are written by lane C as the reference for ledger tables: read-only
// through the generic API, changed only by named actions that go through src/server/money.ts.
import { Banknote, Receipt } from "lucide-react";
import { AS_OF, FINANCE } from "../common";
import { registerEntity } from "../registry";

// Status is derived, never stored (plan §1): Paid when payments and credits cover the charge,
// Processing while a live rent:<id> transfer is pending, else Overdue past the due date or Due.
const PAID = "(SELECT coalesce(sum(p.amount_cents), 0) FROM {payments} p WHERE p.charge_id = charges.id AND p.nsf = 0) + (SELECT coalesce(sum(cr.amount_cents), 0) FROM {credits} cr WHERE cr.charge_id = charges.id)";
const BALANCE = `max(charges.amount_cents - (${PAID}), 0)`;
const STATUS = `CASE WHEN (${PAID}) >= charges.amount_cents THEN 'Paid' WHEN EXISTS (SELECT 1 FROM {transfers} t WHERE t.key = 'rent:' || charges.id AND t.status = 'Pending') THEN 'Processing' WHEN charges.due_on < ${AS_OF} THEN 'Overdue' ELSE 'Due' END`;
const DAYS_LATE = `CAST(julianday(${AS_OF}) - julianday(charges.due_on) AS INTEGER)`;

registerEntity({
  key: "charges",
  table: "charges",
  label: { one: "Charge", many: "Charges" },
  icon: Receipt,
  module: "receivables",
  nav: { section: "finance", group: "Receivables", order: 10 },
  route: "/app/receivables/charges",
  titleField: "description",
  subtitle: (r) => [r.lease_id__label, r.period].filter(Boolean).join(" · "),
  scopePath: "charges.property_id",
  fields: {
    description: { type: "text", label: "Charge", search: true, sortable: true, list: { default: true, width: 220 } },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, sql: STATUS, enum: [
      { value: "Paid", tone: "success" }, { value: "Processing", tone: "info" }, { value: "Due", tone: "warning" }, { value: "Overdue", tone: "danger" },
    ], help: { summary: "Derived from payments, credits and pending transfers. It is never typed in.", article: "charge-status" } },
    lease_id: { type: "ref", ref: "leases", label: "Lease", list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true } },
    unit_id: { type: "ref", ref: "units", label: "Unit" },
    household_id: { type: "ref", ref: "households", label: "Household" },
    gl_account_id: { type: "ref", ref: "gl_accounts", label: "GL account", facet: true, list: { default: false } },
    period: { type: "text", label: "Period", facet: true, sortable: true, list: { default: true } },
    due_on: { type: "date", label: "Due", sortable: true, list: { default: true } },
    amount: { type: "money", label: "Amount", column: "amount_cents", sortable: true, list: { default: true, align: "right" } },
    balance: { type: "money", label: "Balance", sortable: true, list: { default: true, align: "right" }, sql: BALANCE },
    days_late: { type: "number", label: "Days late", sortable: true, list: { default: false, align: "right" }, sql: `CASE WHEN ${BALANCE} > 0 AND charges.due_on < ${AS_OF} THEN ${DAYS_LATE} END` },
    aging: { type: "enum", label: "Aging", facet: true, list: { default: false }, enum: [
      { value: "0-30", tone: "warning", label: "0–30 days" }, { value: "31-60", tone: "warning", label: "31–60 days" }, { value: "61-90", tone: "danger", label: "61–90 days" }, { value: "90+", tone: "danger", label: "90+ days" },
    ], sql: `CASE WHEN ${BALANCE} <= 0 OR charges.due_on >= ${AS_OF} THEN NULL WHEN ${DAYS_LATE} <= 30 THEN '0-30' WHEN ${DAYS_LATE} <= 60 THEN '31-60' WHEN ${DAYS_LATE} <= 90 THEN '61-90' ELSE '90+' END` },
  },
  relations: [
    { name: "lease", entity: "leases", fk: "lease_id", kind: "one" },
    { name: "unit", entity: "units", fk: "unit_id", kind: "one" },
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "payments", entity: "payments", fk: "charge_id", kind: "many" },
  ],
  list: {
    defaultSort: ["due_on", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "overdue", label: "Overdue", filters: { status: "Overdue" }, sort: ["days_late", "desc"] },
      { key: "90-plus", label: "90+ days", filters: { aging: "90+" }, sort: ["balance", "desc"] },
      { key: "processing", label: "Payments processing", filters: { status: "Processing" } },
    ],
    footer: [{ field: "amount", fn: "sum", label: "Charged" }, { field: "balance", fn: "sum", label: "Open balance" }],
  },
  detail: {
    facts: ["status", "amount", "balance", "due_on", "period", "lease_id", "gl_account_id", "days_late"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["description", "status", "amount", "balance", "due_on", "period", "days_late", "aging", "lease_id", "unit_id", "property_id", "gl_account_id"] },
      { key: "payments", label: "Payments", relation: "payments" },
    ],
    related: ["lease", "unit", "property"],
  },
  capabilities: { notes: true, activity: true, documents: false },
  kpis: [
    { key: "collections", label: "Collections rate", metric: "receivables.collections_rate", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/receivables/payments" },
    { key: "delinquent", label: "Delinquent", metric: "receivables.delinquency", format: "money", delta: "mom", goodWhen: "down", drill: "/app/receivables/charges?view=overdue" },
  ],
  charts: [
    { key: "scheduled_vs_collected", title: "Charged vs collected, trailing 12 months", kind: "bar", metric: "receivables.collections_rate", x: "month", series: [{ key: "charged", label: "Charged", format: "money" }, { key: "collected", label: "Collected", format: "money" }], drill: "/app/receivables/charges?f.period={month}" },
    { key: "aging", title: "Delinquency aging", kind: "bar", metric: "receivables.aging", x: "label", series: [{ key: "amount", label: "Balance", format: "money" }], drill: "/app/receivables/charges?f.aging={bucket}" },
  ],
  ai: {
    facts: (r) => ({ charge: String(r.description), status: String(r.status), amount: Number(r.amount ?? 0), balance: Number(r.balance ?? 0), due_on: String(r.due_on), days_late: r.days_late == null ? null : Number(r.days_late) }),
    agents: ["collections"],
  },
  permissions: { read: [...FINANCE, "resident", "owner"], create: [], update: [], delete: [] },
  writes: "actions-only",
  help: { summary: "Rent, fees and other amounts billed to residents. Status is worked out from payments; you change charges only through actions such as Record payment or Post late fees.", article: "charges" },
});

registerEntity({
  key: "payments",
  table: "payments",
  label: { one: "Payment", many: "Payments" },
  icon: Banknote,
  module: "receivables",
  nav: { section: "finance", group: "Receivables", order: 20 },
  route: "/app/receivables/payments",
  titleField: "label",
  subtitle: (r) => [r.lease_id__label, r.received_on].filter(Boolean).join(" · "),
  scopePath: "payments.property_id",
  fields: {
    label: { type: "text", label: "Payment", sortable: true, list: { default: true, width: 200 }, sql: "payments.method || ' · ' || CASE WHEN payments.reference = '' THEN payments.id ELSE payments.reference END" },
    received_on: { type: "date", label: "Received", sortable: true, list: { default: true } },
    amount: { type: "money", label: "Amount", column: "amount_cents", sortable: true, list: { default: true, align: "right" } },
    method: { type: "enum", label: "Method", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "ACH", tone: "neutral" }, { value: "Card", tone: "neutral" }, { value: "Check", tone: "neutral" }, { value: "Money order", tone: "neutral" }, { value: "Cash", tone: "neutral" },
    ] },
    status: { type: "enum", label: "Status", facet: true, list: { default: true }, sql: "CASE WHEN payments.nsf = 1 THEN 'Returned' WHEN EXISTS (SELECT 1 FROM {transfers} t WHERE t.id = payments.transfer_id AND t.status = 'Pending') THEN 'Processing' ELSE 'Cleared' END", enum: [
      { value: "Cleared", tone: "success" }, { value: "Processing", tone: "info" }, { value: "Returned", tone: "danger" },
    ] },
    lease_id: { type: "ref", ref: "leases", label: "Lease", list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true } },
    household_id: { type: "ref", ref: "households", label: "Household" },
    charge_id: { type: "ref", ref: "charges", label: "Applied to" },
    reference: { type: "text", label: "Reference", search: true },
    nsf: { type: "bool", label: "Returned (NSF)", facet: true },
    transfer_id: { type: "text", label: "Transfer" },
  },
  relations: [
    { name: "lease", entity: "leases", fk: "lease_id", kind: "one" },
    { name: "charge", entity: "charges", fk: "charge_id", kind: "one" },
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
  ],
  list: {
    defaultSort: ["received_on", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "nsf", label: "Returned (NSF)", filters: { nsf: "true" } },
      { key: "unapplied", label: "Unapplied", filters: { "charge_id.null": "1" } },
    ],
    footer: [{ field: "amount", fn: "sum", label: "Received" }],
  },
  detail: {
    facts: ["status", "amount", "received_on", "method", "reference", "lease_id", "charge_id"],
    tabs: [{ key: "overview", label: "Overview", fields: ["amount", "received_on", "method", "reference", "status", "nsf", "lease_id", "charge_id", "property_id", "transfer_id"] }],
    related: ["lease", "charge", "property"],
  },
  capabilities: { notes: true, activity: true },
  kpis: [
    { key: "collections", label: "Collections rate", metric: "receivables.collections_rate", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/receivables/payments" },
  ],
  permissions: { read: ["principal", "regional_manager", "property_manager", "accountant", "resident", "owner"], create: [], update: [], delete: [] },
  writes: "actions-only",
  dataRules: ["payments.wrong_lease"],
  help: { summary: "Money received from residents. Payments are recorded through the Record payment action so the trust account and ledger stay in balance.", article: "payments" },
});
