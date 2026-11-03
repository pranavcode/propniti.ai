// Entity defs for the receivables module. Call registerEntity() from "../registry" for each def.
// Owned by the receivables module lane; see AGENTS.md "v2 lanes and ownership".
// Ledger tables (charges, payments, credits, deposits) are read-only through the generic API and
// change only through named actions that go through the guarded money functions.
import { Banknote, Gavel, HandCoins, Landmark, Receipt } from "lucide-react";
import { AS_OF, FINANCE, LEADERS } from "../common";
import { chargeOpenStoredSql, chargeStatusStoredSql } from "@/server/data";
import { registerEntity } from "../registry";
import type { Role } from "../types";

const ACCOUNTING: Role[] = ["principal", "regional_manager", "accountant"];

// Status is derived from the stored settlement columns (charges.paid_cents, pending_cents), which
// every money action keeps current, so lists, tabs and footers never sum payments per row.
const BALANCE = `max(${chargeOpenStoredSql("charges")}, 0)`;
const STATUS = chargeStatusStoredSql("charges");
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
      { value: "Paid", tone: "success" }, { value: "Processing", tone: "info" }, { value: "Due", tone: "warning" }, { value: "Partial", tone: "warning" }, { value: "Overdue", tone: "danger" },
    ], help: { summary: "Worked out from payments, credits and pending transfers; overdue 3 days after the due date. It is never typed in.", article: "record-a-payment" } },
    lease_id: { type: "ref", ref: "leases", label: "Lease", list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true } },
    unit_id: { type: "ref", ref: "units", label: "Unit" },
    household_id: { type: "ref", ref: "households", label: "Household" },
    gl_account_id: { type: "ref", ref: "gl_accounts", label: "GL account", facet: true, list: { default: false } },
    // No facet chip: a period chip is a full scan of every charge; ?f.period= still filters (chart drills use it).
    period: { type: "text", label: "Period", sortable: true, list: { default: true } },
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
    { name: "credits", entity: "credits", fk: "charge_id", kind: "many" },
  ],
  list: {
    defaultSort: ["due_on", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "overdue", label: "Overdue", filters: { status: "Overdue" }, sort: ["days_late", "desc"] },
      { key: "90-plus", label: "90+ days", filters: { aging: "90+" }, sort: ["balance", "desc"] },
      { key: "processing", label: "Payments processing", filters: { status: "Processing" } },
      { key: "late-fees", label: "Late fees", filters: { gl_account_id: "gl-4100" } },
      { key: "nsf-fees", label: "NSF fees", filters: { gl_account_id: "gl-4110" } },
    ],
    footer: [{ field: "amount", fn: "sum", label: "Charged" }, { field: "balance", fn: "sum", label: "Open balance" }],
  },
  detail: {
    facts: ["status", "amount", "balance", "due_on", "period", "lease_id", "gl_account_id", "days_late"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["description", "status", "amount", "balance", "due_on", "period", "days_late", "aging", "lease_id", "unit_id", "property_id", "gl_account_id"] },
      { key: "payments", label: "Payments", relation: "payments" },
      { key: "credits", label: "Credits", relation: "credits" },
      { custom: "receivables.ledger" },
    ],
    related: ["lease", "unit", "property"],
  },
  capabilities: { notes: true, activity: true, documents: false },
  kpis: [
    { key: "collections", label: "Collections rate", metric: "receivables.collections_rate", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/receivables/payments" },
    { key: "past_due", label: "Past due", metric: "receivables.aging_live", format: "money", goodWhen: "down", drill: "/app/receivables/delinquency", help: { summary: "Open balances on charges past their due date, live from the ledger.", article: "record-a-payment" } },
  ],
  charts: [
    { key: "scheduled_vs_collected", title: "Charged vs collected, trailing 12 months", kind: "bar", metric: "receivables.collections_rate", x: "month", series: [{ key: "charged", label: "Charged", format: "money" }, { key: "collected", label: "Collected", format: "money" }], drill: "/app/receivables/charges?f.period={month}" },
    { key: "aging", title: "Delinquency aging", kind: "bar", metric: "receivables.aging_live", x: "label", series: [{ key: "amount", label: "Past due", format: "money" }], drill: "/app/receivables/charges?f.aging={bucket}" },
    { key: "by_property", title: "Past due by property", kind: "stacked", metric: "receivables.aging_by_property", x: "name", series: [{ key: "d0_30", label: "0–30", format: "money" }, { key: "d31_60", label: "31–60", format: "money" }, { key: "d61_90", label: "61–90", format: "money" }, { key: "d90p", label: "90+", format: "money" }], drill: "/app/receivables/delinquency?property={property_id}" },
  ],
  ai: {
    facts: (r) => ({ charge: String(r.description), status: String(r.status), amount: Number(r.amount ?? 0), balance: Number(r.balance ?? 0), due_on: String(r.due_on), days_late: r.days_late == null ? null : Number(r.days_late) }),
    agents: ["collections"],
  },
  permissions: { read: [...FINANCE, "resident", "owner"], create: [], update: [], delete: [] },
  writes: "actions-only",
  actions: ["charges.record_payment", "charges.pay_rent"],
  help: { summary: "Rent, fees and other amounts billed to residents. Status is worked out from payments; you change charges only through actions such as Record payment or Post late fees.", article: "record-a-payment" },
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
    // Base transfers are all Cleared or Returned, so only the visitor's own payments can be Processing.
    status: { type: "enum", label: "Status", facet: true, list: { default: true }, sql: "CASE WHEN payments.nsf = 1 THEN 'Returned' WHEN payments.workspace_id <> 'base' AND EXISTS (SELECT 1 FROM {transfers} t WHERE t.id = payments.transfer_id AND t.status = 'Pending') THEN 'Processing' ELSE 'Cleared' END", enum: [
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
    tabs: [
      { key: "overview", label: "Overview", fields: ["amount", "received_on", "method", "reference", "status", "nsf", "lease_id", "charge_id", "property_id", "transfer_id"] },
      { custom: "receivables.payment_health" },
      { custom: "receivables.ledger" },
    ],
    related: ["lease", "charge", "property"],
  },
  capabilities: { notes: true, activity: true },
  kpis: [
    { key: "collections", label: "Collections rate", metric: "receivables.collections_rate", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/receivables/payments" },
    { key: "nsf", label: "Returned payments", metric: "receivables.nsf", format: "count", delta: "mom", goodWhen: "down", drill: "/app/receivables/payments?view=nsf" },
  ],
  permissions: { read: ["principal", "regional_manager", "property_manager", "accountant", "resident", "owner"], create: [], update: [], delete: [] },
  writes: "actions-only",
  actions: ["payments.move_to_lease"],
  dataRules: ["payments.wrong_lease"],
  help: { summary: "Money received from residents. Payments are recorded through the Record payment action so the trust account and ledger stay in balance.", article: "record-a-payment" },
});

registerEntity({
  key: "credits",
  table: "credits",
  label: { one: "Credit", many: "Credits" },
  icon: HandCoins,
  module: "receivables",
  nav: { section: "finance", group: "Receivables", order: 30 },
  route: "/app/receivables/credits",
  titleField: "description",
  subtitle: (r) => [r.kind, r.lease_id__label, r.on_date].filter(Boolean).join(" · "),
  scopePath: "credits.property_id",
  fields: {
    description: { type: "text", label: "Credit", search: true, sortable: true, list: { default: true, width: 260 } },
    kind: { type: "enum", label: "Kind", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Concession", tone: "info" }, { value: "Credit", tone: "neutral" }, { value: "Write-off", tone: "danger" },
    ], help: { summary: "Concession: a leasing discount. Credit: an adjustment such as a deposit applied. Write-off: a balance judged uncollectible.", article: "write-off-a-balance" } },
    on_date: { type: "date", label: "Date", sortable: true, list: { default: true } },
    amount: { type: "money", label: "Amount", column: "amount_cents", sortable: true, list: { default: true, align: "right" } },
    lease_id: { type: "ref", ref: "leases", label: "Lease", list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true } },
    charge_id: { type: "ref", ref: "charges", label: "Against charge", list: { default: false } },
    approved_by: { type: "text", label: "Approved by", list: { default: false } },
  },
  relations: [
    { name: "lease", entity: "leases", fk: "lease_id", kind: "one" },
    { name: "charge", entity: "charges", fk: "charge_id", kind: "one" },
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
  ],
  list: {
    defaultSort: ["on_date", "desc"],
    statusTabs: "kind",
    savedViews: [{ key: "write-offs", label: "Write-offs", filters: { kind: "Write-off" }, sort: ["amount", "desc"] }],
    footer: [{ field: "amount", fn: "sum", label: "Total" }],
  },
  detail: {
    facts: ["kind", "amount", "on_date", "lease_id", "charge_id", "approved_by"],
    tabs: [{ key: "overview", label: "Overview", fields: ["description", "kind", "amount", "on_date", "lease_id", "charge_id", "property_id", "approved_by"] }, { custom: "receivables.ledger" }],
    related: ["charge", "lease", "property"],
  },
  capabilities: { notes: true, activity: true },
  permissions: { read: [...FINANCE], create: [], update: [], delete: [] },
  writes: "actions-only",
  help: { summary: "Concessions, adjustments and write-offs that reduce what a resident owes. Each one lowers a charge's balance, so it shows on the resident ledger.", article: "write-off-a-balance" },
});

const DEP_LEASE = (col: string) => `(SELECT l.${col} FROM {leases} l WHERE l.id = deposits.lease_id)`;
const DEP_DUE = "(SELECT x.due_on FROM {deposit_dispositions} x WHERE x.deposit_id = deposits.id)";

registerEntity({
  key: "deposits",
  table: "deposits",
  label: { one: "Security deposit", many: "Security deposits" },
  icon: Landmark,
  module: "receivables",
  nav: { section: "finance", group: "Receivables", order: 40, label: "Deposits" },
  route: "/app/receivables/deposits",
  titleField: "label",
  subtitle: (r) => [r.property_id__label, r.received_on].filter(Boolean).join(" · "),
  scopePath: "deposits.property_id",
  fields: {
    label: { type: "text", label: "Deposit", sortable: true, list: { default: true, width: 220 }, sql: `coalesce((SELECT h.name FROM {households} h WHERE h.id = ${DEP_LEASE("household_id")}), deposits.lease_id)` },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Held", tone: "neutral" }, { value: "Disposition due", tone: "warning" }, { value: "Settled", tone: "success" },
    ], help: { summary: "Held while the lease runs. After move-out the disposition is due by the state deadline; Settled once it is sent.", article: "move-out-deposit-disposition" } },
    amount: { type: "money", label: "Amount", column: "amount_cents", sortable: true, list: { default: true, align: "right" } },
    received_on: { type: "date", label: "Received", sortable: true, list: { default: false } },
    lease_id: { type: "ref", ref: "leases", label: "Lease", list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true } },
    move_out_on: { type: "date", label: "Moved out", sortable: true, list: { default: true }, sql: DEP_LEASE("move_out_on") },
    due_on: { type: "date", label: "Disposition due", sortable: true, list: { default: true }, sql: DEP_DUE,
      help: { summary: "The state deadline to send the itemized disposition after move-out (Texas and Georgia 30 days, Arizona 14 business days).", article: "move-out-deposit-disposition" } },
    days_left: { type: "number", label: "Days left", sortable: true, list: { default: false, align: "right" }, sql: `CASE WHEN deposits.status <> 'Settled' AND ${DEP_DUE} IS NOT NULL THEN CAST(julianday(${DEP_DUE}) - julianday(${AS_OF}) AS INTEGER) END` },
    bank_account_id: { type: "text", label: "Held in", list: { default: false } },
  },
  relations: [
    { name: "lease", entity: "leases", fk: "lease_id", kind: "one" },
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
  ],
  list: {
    defaultSort: ["received_on", "desc"],
    statusTabs: "status",
    savedViews: [{ key: "due", label: "Dispositions due", filters: { status: "Disposition due" }, sort: ["due_on", "asc"] }],
    footer: [{ field: "amount", fn: "sum", label: "Held" }],
  },
  detail: {
    facts: ["amount", "lease_id", "move_out_on", "due_on", "days_left", "received_on"],
    tabs: [
      { custom: "receivables.disposition" },
      { key: "overview", label: "Overview", fields: ["label", "status", "amount", "received_on", "lease_id", "property_id", "move_out_on", "due_on", "bank_account_id"] },
      { custom: "receivables.ledger" },
    ],
    related: ["lease", "property"],
  },
  capabilities: { notes: true, activity: true, documents: true },
  kpis: [{ key: "due", label: "Dispositions due", metric: "receivables.dispositions_due", format: "count", goodWhen: "down", drill: "/app/receivables/deposits?view=due" }],
  permissions: { read: [...FINANCE, "resident"], create: [], update: [], delete: [] },
  writes: "actions-only",
  actions: ["deposits.send_disposition"],
  help: { summary: "Security deposits held in each owner's deposit account. At move-out, send the itemized disposition before the state deadline; deductions settle open charges and the rest is refunded.", article: "move-out-deposit-disposition" },
});

registerEntity({
  key: "late_fee_policies",
  table: "late_fee_policies",
  label: { one: "Late-fee policy", many: "Late-fee policies" },
  icon: Gavel,
  module: "receivables",
  nav: { section: "finance", group: "Receivables", order: 60, label: "Late-fee policies" },
  route: "/app/receivables/late-fees",
  titleField: "label",
  subtitle: (r) => String(r.summary ?? ""),
  scopePath: null,
  fields: {
    label: { type: "text", label: "Policy", sortable: true, list: { default: true, width: 240 }, sql: "CASE WHEN late_fee_policies.property_id IS NULL THEN 'Organization default' ELSE coalesce((SELECT p.name FROM {properties} p WHERE p.id = late_fee_policies.property_id), late_fee_policies.property_id) END" },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, list: { default: false }, editable: ACCOUNTING, help: { summary: "Leave empty for the organization default, which covers every property without its own policy." } },
    kind: { type: "enum", label: "Fee type", required: true, facet: true, list: { default: true }, editable: ACCOUNTING, enum: [{ value: "Flat", tone: "neutral" }, { value: "Percent", tone: "neutral" }, { value: "Flat + daily", tone: "neutral" }] },
    grace_days: { type: "number", label: "Grace days", required: true, list: { default: true, align: "right" }, editable: ACCOUNTING, help: { summary: "Days after the due date before a fee may post. Texas requires rent to be unpaid two full days." } },
    flat: { type: "money", label: "Flat fee", column: "flat_cents", list: { default: true, align: "right" }, editable: ACCOUNTING },
    pct: { type: "number", label: "Percent of rent", list: { default: true, align: "right" }, editable: ACCOUNTING },
    daily: { type: "money", label: "Daily fee", column: "daily_cents", list: { default: false, align: "right" }, editable: ACCOUNTING },
    max: { type: "money", label: "Maximum", column: "max_cents", list: { default: true, align: "right" }, editable: ACCOUNTING, help: { summary: "The policy's own cap. The state cap also applies; the fee is the lower of the two." } },
    summary: { type: "text", label: "Summary", sql: "CASE late_fee_policies.kind WHEN 'Flat' THEN '$' || printf('%.2f', late_fee_policies.flat_cents / 100.0) || ' after ' || late_fee_policies.grace_days || ' days' WHEN 'Percent' THEN late_fee_policies.pct || '% of rent after ' || late_fee_policies.grace_days || ' days' ELSE '$' || printf('%.2f', late_fee_policies.flat_cents / 100.0) || ' + $' || printf('%.2f', late_fee_policies.daily_cents / 100.0) || '/day after ' || late_fee_policies.grace_days || ' days' END" },
  },
  relations: [{ name: "property", entity: "properties", fk: "property_id", kind: "one" }],
  list: { defaultSort: ["label", "asc"] },
  detail: { facts: ["kind", "grace_days", "flat", "pct", "daily", "max"], tabs: [{ key: "overview", label: "Overview", fields: ["label", "property_id", "kind", "grace_days", "flat", "pct", "daily", "max", "summary"] }], related: ["property"] },
  capabilities: { notes: true, activity: true },
  permissions: { read: [...FINANCE], create: ACCOUNTING, update: ACCOUNTING, delete: [...LEADERS] },
  writes: "generic",
  actions: ["late_fee_policies.post_late_fees"],
  help: { summary: "How late fees are worked out per property. Posting runs once per lease per month and never goes above the state's cap.", article: "post-late-fees" },
});
