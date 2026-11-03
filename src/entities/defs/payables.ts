// Entity defs for the payables module: bills, recurring bills and 1099 forms.
// Owned by the finance lane; see AGENTS.md "v2 lanes and ownership".
// Bills move money, so they change only through named actions (src/extensions/payables) that call
// src/server/money.ts. Bill lines are a child table, shown in the bill's "Lines" tab.
import { FileStack, Receipt, Repeat } from "lucide-react";
import { z } from "zod";
import { AS_OF, issuesField } from "../common";
import { registerEntity } from "../registry";
import type { Role, RuleKey } from "../types";

const AP: Role[] = ["principal", "regional_manager", "accountant"];
const AP_READ: Role[] = ["principal", "regional_manager", "property_manager", "accountant", "maintenance_supervisor"];

// Open = still owed and not yet sent to the bank.
const OPEN = "bills.status IN ('Draft', 'Pending approval', 'Approved')";
const DAYS_PAST_DUE = `CAST(julianday(${AS_OF}) - julianday(bills.due_on) AS INTEGER)`;

registerEntity({
  key: "bills",
  table: "bills",
  label: { one: "Bill", many: "Bills" },
  icon: Receipt,
  module: "payables",
  nav: { section: "finance", group: "Payables", order: 30 },
  route: "/app/payables/bills",
  titleField: "title",
  subtitle: (r) => [r.vendor_id__label, r.property_id__label].filter(Boolean).join(" · "),
  scopePath: "bills.property_id",
  fields: {
    title: { type: "text", label: "Bill", sortable: true, list: { default: true, width: 220 }, sql: "bills.id || ' · ' || bills.invoice_number" },
    invoice_number: { type: "text", label: "Invoice #", required: true, search: true, sortable: true },
    vendor_id: { type: "ref", ref: "vendors", label: "Vendor", required: true, facet: true, sortable: true, list: { default: true, width: 200 } },
    property_id: { type: "ref", ref: "properties", label: "Property", required: true, facet: true, sortable: true, list: { default: true } },
    status: { type: "enum", label: "Status", required: true, zod: z.literal("Draft"), facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Draft", tone: "neutral" }, { value: "Pending approval", tone: "warning" }, { value: "Approved", tone: "info" },
      { value: "Scheduled", tone: "info" }, { value: "Paid", tone: "success" }, { value: "Void", tone: "neutral" },
    ], help: { summary: "Draft → Pending approval → Approved → Scheduled (ACH sent) → Paid when the transfer clears.", article: "approve-a-bill" } },
    bill_date: { type: "date", label: "Bill date", required: true, sortable: true, list: { default: true } },
    due_on: { type: "date", label: "Due", required: true, sortable: true, list: { default: true } },
    amount: { type: "money", label: "Amount", column: "amount_cents", required: true, zod: z.number().finite().positive().max(1_000_000), sortable: true, list: { default: true, align: "right" } },
    gl_account_id: { type: "ref", ref: "gl_accounts", label: "GL account", facet: true, list: { default: false },
      sql: "(SELECT l.gl_account_id FROM {bill_lines} l WHERE l.bill_id = bills.id ORDER BY l.amount_cents DESC LIMIT 1)",
      help: { summary: "The GL account of the bill's largest line. Open the bill to see every line.", article: "approve-a-bill" } },
    aging: { type: "enum", label: "Payables aging", facet: true, list: { default: false }, enum: [
      { value: "Current", tone: "neutral" }, { value: "1-30", tone: "warning", label: "1–30 days past due" }, { value: "31-60", tone: "danger", label: "31–60 days past due" }, { value: "61+", tone: "danger", label: "61+ days past due" },
    ], sql: `CASE WHEN NOT (${OPEN}) THEN NULL WHEN bills.due_on >= ${AS_OF} THEN 'Current' WHEN ${DAYS_PAST_DUE} <= 30 THEN '1-30' WHEN ${DAYS_PAST_DUE} <= 60 THEN '31-60' ELSE '61+' END` },
    period: { type: "text", label: "Period", facet: true, sortable: true, sql: "substr(bills.bill_date, 1, 7)" },
    source: { type: "enum", label: "Source", facet: true, list: { default: false }, enum: [
      { value: "Work order", tone: "neutral" }, { value: "Recurring", tone: "neutral" }, { value: "Scanned invoice", tone: "ai" }, { value: "Manual", tone: "neutral" },
    ], sql: "CASE WHEN bills.work_order_id IS NOT NULL THEN 'Work order' WHEN bills.recurring_bill_id IS NOT NULL THEN 'Recurring' WHEN bills.document_id IS NOT NULL THEN 'Scanned invoice' ELSE 'Manual' END" },
    owner_entity_id: { type: "ref", ref: "owner_entities", label: "Owner entity", required: true, facet: true,
      help: { summary: "Whose trust account pays the bill. Submitting the bill resets it to the property's owner entity." } },
    work_order_id: { type: "ref", ref: "work_orders", label: "Work order" },
    recurring_bill_id: { type: "ref", ref: "recurring_bills", label: "Recurring bill" },
    document_id: { type: "ref", ref: "documents", label: "Scanned invoice" },
    approved_by: { type: "text", label: "Approved by", editable: [] },
    approved_at: { type: "datetime", label: "Approved at", editable: [] },
    open_issues: issuesField("bills"),
  },
  relations: [
    { name: "vendor", entity: "vendors", fk: "vendor_id", kind: "one" },
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "work_order", entity: "work_orders", fk: "work_order_id", kind: "one" },
    { name: "document", label: "Scanned invoice", entity: "documents", fk: "document_id", kind: "one" },
  ],
  list: {
    defaultSort: ["due_on", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "to-approve", label: "To approve", filters: { status: "Pending approval" }, sort: ["due_on", "asc"] },
      { key: "past-due", label: "Past due", filters: { aging: ["1-30", "31-60", "61+"] }, sort: ["due_on", "asc"] },
      { key: "ready-to-pay", label: "Approved, not paid", filters: { status: "Approved" }, sort: ["due_on", "asc"] },
      { key: "data-issues", label: "With data issues", filters: { "open_issues.min": "1" } },
    ],
    bulkActions: ["bills.approve"],
    footer: [{ field: "amount", fn: "sum", label: "Total" }],
  },
  detail: {
    facts: ["status", "amount", "vendor_id", "property_id", "invoice_number", "due_on", "bill_date", "gl_account_id", "source"],
    tabs: [
      { custom: "payables.review" },
      { custom: "payables.lines" },
      { key: "details", label: "Details", fields: ["invoice_number", "vendor_id", "property_id", "owner_entity_id", "status", "bill_date", "due_on", "amount", "period", "source", "work_order_id", "recurring_bill_id", "document_id", "approved_by", "approved_at"] },
    ],
    related: ["vendor", "property", "work_order", "document"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  kpis: [
    { key: "open_ap", label: "Open payables", metric: "payables.open_ap", format: "money", delta: "mom", goodWhen: "down", drill: "/app/payables/bills?f.status=Pending%20approval,Approved,Draft" },
    { key: "to_approve", label: "Waiting for approval", metric: "payables.to_approve", format: "count", goodWhen: "down", drill: "/app/payables/bills?view=to-approve" },
    { key: "past_due", label: "Past due", metric: "payables.past_due", format: "money", goodWhen: "down", drill: "/app/payables/bills?view=past-due" },
    { key: "paid_mtd", label: "Paid this month", metric: "payables.paid_month", format: "money", delta: "mom", drill: "/app/payables/bills?f.status=Paid" },
  ],
  charts: [
    { key: "ap_aging", title: "Payables aging", kind: "bar", metric: "payables.aging", x: "label", series: [{ key: "amount", label: "Open", format: "money" }], drill: "/app/payables/bills?f.aging={bucket}" },
    { key: "spend_by_gl", title: "Spend by GL account, last 3 months", kind: "hbar", metric: "payables.spend_by_gl", x: "label", series: [{ key: "amount", label: "Billed", format: "money" }], drill: "/app/payables/bills?f.gl_account_id={gl}" },
  ],
  ai: {
    facts: (r) => ({ bill: String(r.title), vendor: (r.vendor_id__label as string) ?? null, property: (r.property_id__label as string) ?? null, status: String(r.status), amount: Number(r.amount ?? 0), due_on: String(r.due_on), gl: (r.gl_account_id__label as string) ?? null }),
    summaryPrompt: "Summarise this bill for an accountant in 2 sentences: what it's for, whether anything about it looks unusual, and the next step. Use only the facts.",
    agents: ["ap"],
  },
  // New bills start as drafts through the generic create (status is fixed to Draft below); every
  // later change, and all money, goes through the named actions.
  permissions: { read: [...AP_READ, "owner", "vendor"], create: AP, update: [], delete: [] },
  writes: "generic",
  actions: ["bills.submit", "bills.approve", "bills.pay", "bills.approve_and_pay", "bills.recode", "bills.void", "bills.confirm_vendor_bank"],
  // INTEGRATE: scenarios.md names this rule bill_lines.gl_miscoded, but bill_lines isn't an EntityKey (logged in lane-requests.md).
  dataRules: ["bill_lines.gl_miscoded" as RuleKey],
  help: { summary: "Vendor invoices to approve and pay. The Payables agent checks each one for unusual amounts, duplicates, GL coding and vendor bank changes before you approve.", article: "approve-a-bill" },
});

registerEntity({
  key: "recurring_bills",
  table: "recurring_bills",
  label: { one: "Recurring bill", many: "Recurring bills" },
  icon: Repeat,
  module: "payables",
  nav: { section: "finance", group: "Payables", order: 32 },
  route: "/app/payables/recurring",
  titleField: "description",
  subtitle: (r) => [r.vendor_id__label, r.property_id__label].filter(Boolean).join(" · "),
  scopePath: "recurring_bills.property_id",
  fields: {
    description: { type: "text", label: "Description", required: true, search: true, sortable: true, list: { default: true, width: 220 } },
    vendor_id: { type: "ref", ref: "vendors", label: "Vendor", required: true, facet: true, sortable: true, list: { default: true } },
    property_id: { type: "ref", ref: "properties", label: "Property", required: true, facet: true, sortable: true, list: { default: true } },
    gl_account_id: { type: "ref", ref: "gl_accounts", label: "GL account", required: true, facet: true, list: { default: true } },
    amount: { type: "money", label: "Amount", column: "amount_cents", required: true, sortable: true, list: { default: true, align: "right" } },
    frequency: { type: "enum", label: "Frequency", facet: true, list: { default: true }, enum: [{ value: "Monthly", tone: "neutral" }, { value: "Quarterly", tone: "neutral" }, { value: "Annual", tone: "neutral" }] },
    day_of_month: { type: "number", label: "Day of month", list: { default: false, align: "right" } },
    next_on: { type: "date", label: "Next bill", sortable: true, list: { default: true } },
    active: { type: "bool", label: "Active", facet: true, list: { default: true } },
    billed_12m: { type: "money", label: "Billed (12 mo)", sortable: true, list: { default: false, align: "right" },
      sql: `(SELECT coalesce(sum(b.amount_cents), 0) FROM {bills} b WHERE b.recurring_bill_id = recurring_bills.id AND b.bill_date >= date(${AS_OF}, '-12 months'))` },
  },
  relations: [
    { name: "vendor", entity: "vendors", fk: "vendor_id", kind: "one" },
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "bills", entity: "bills", fk: "recurring_bill_id", kind: "many" },
  ],
  list: {
    defaultSort: ["next_on", "asc"],
    statusTabs: "frequency",
    savedViews: [{ key: "next-30", label: "Billing in 30 days", sort: ["next_on", "asc"] }],
    footer: [{ field: "amount", fn: "sum", label: "Per cycle" }],
  },
  detail: {
    facts: ["amount", "frequency", "next_on", "vendor_id", "property_id", "gl_account_id", "active"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["description", "vendor_id", "property_id", "gl_account_id", "amount", "frequency", "day_of_month", "next_on", "active", "billed_12m"] },
      { key: "bills", label: "Bills", relation: "bills" },
    ],
    related: ["vendor", "property"],
  },
  capabilities: { notes: true, activity: true },
  permissions: { read: AP_READ, create: AP, update: AP, delete: AP },
  writes: "generic",
  help: { summary: "Contracts billed on a schedule, such as landscaping and trash. Each cycle creates a bill that goes through the normal approval.", article: "approve-a-bill" },
});

registerEntity({
  key: "vendor_1099s",
  table: "vendor_1099s",
  label: { one: "1099 form", many: "1099 forms" },
  icon: FileStack,
  module: "payables",
  nav: { section: "finance", group: "Payables", order: 36, label: "1099s" },
  route: "/app/payables/1099s",
  titleField: "title",
  subtitle: (r) => [r.owner_entity_id__label, r.year].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    title: { type: "text", label: "Form", sortable: true, list: { default: true, width: 220 }, sql: "'1099-NEC ' || vendor_1099s.year || ' · ' || coalesce((SELECT v.company FROM {vendors} v WHERE v.id = vendor_1099s.vendor_id), vendor_1099s.vendor_id)" },
    vendor_id: { type: "ref", ref: "vendors", label: "Vendor", required: true, facet: true, sortable: true, list: { default: true } },
    owner_entity_id: { type: "ref", ref: "owner_entities", label: "Payer", required: true, facet: true, list: { default: true } },
    year: { type: "number", label: "Tax year", required: true, facet: true, sortable: true, list: { default: true } },
    amount: { type: "money", label: "Box 1 (nonemployee comp.)", column: "amount_cents", required: true, sortable: true, list: { default: true, align: "right" } },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Draft", tone: "neutral" }, { value: "Ready", tone: "info" }, { value: "Filed", tone: "success" }, { value: "Corrected", tone: "warning" },
    ] },
    w9_on_file: { type: "bool", label: "W-9 on file", facet: true, list: { default: true }, sql: "(SELECT v.w9_on_file FROM {vendors} v WHERE v.id = vendor_1099s.vendor_id)" },
    filed_on: { type: "date", label: "Filed", sortable: true, list: { default: true } },
  },
  relations: [{ name: "vendor", entity: "vendors", fk: "vendor_id", kind: "one" }],
  list: {
    defaultSort: ["year", "desc"],
    statusTabs: "status",
    savedViews: [{ key: "missing-w9", label: "Missing W-9", filters: { w9_on_file: "false" } }],
    footer: [{ field: "amount", fn: "sum", label: "Reported" }],
  },
  detail: {
    facts: ["status", "year", "amount", "vendor_id", "owner_entity_id", "w9_on_file", "filed_on"],
    tabs: [{ key: "overview", label: "Overview", fields: ["vendor_id", "owner_entity_id", "year", "amount", "status", "w9_on_file", "filed_on"] }],
    related: ["vendor"],
  },
  capabilities: { notes: true, activity: true, documents: true },
  permissions: { read: AP, create: ["accountant"], update: ["accountant"], delete: ["accountant"] },
  writes: "generic",
  help: { summary: "1099-NEC forms for vendors each owner entity paid $600 or more in a tax year. Prepare them from 1099 preparation, then mark them filed.", article: "prepare-1099s" },
});

