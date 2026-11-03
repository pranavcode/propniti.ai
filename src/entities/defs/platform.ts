// Entity defs for the platform module. Call registerEntity() from "../registry" for each def.
// Owned by the platform module lane; see AGENTS.md "v2 lanes and ownership".
import { Building } from "lucide-react";
import { registerEntity } from "../registry";

// Customer organisations, seen only by the SaaS operator (platform admin) from Settings → Platform.
registerEntity({
  key: "orgs",
  table: "orgs",
  label: { one: "Organization", many: "Organizations" },
  icon: Building,
  module: "platform",
  route: "/app/settings/platform/orgs",
  titleField: "name",
  subtitle: (r) => [r.plan, r.status].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    name: { type: "text", label: "Organization", required: true, search: true, sortable: true, list: { default: true, width: 260 }, editable: ["platform_admin"] },
    plan: { type: "enum", label: "Plan", facet: true, sortable: true, list: { default: true }, editable: ["platform_admin"], enum: [
      { value: "Starter", tone: "neutral" }, { value: "Growth", tone: "info" }, { value: "Enterprise", tone: "success" },
    ] },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, editable: ["platform_admin"], enum: [
      { value: "Active", tone: "success" }, { value: "Trial", tone: "info" }, { value: "Past due", tone: "warning" }, { value: "Suspended", tone: "danger" }, { value: "Churned", tone: "neutral" },
    ] },
    seats: { type: "number", label: "Seats", sortable: true, list: { default: true, align: "right" }, editable: ["platform_admin"] },
    staff: { type: "number", label: "Users", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT count(*) FROM {staff} s WHERE s.org_id = orgs.id AND s.active = 1)",
      help: { summary: "Active users on file for the organization, compared with the seats it pays for." } },
    units_managed: { type: "number", label: "Units managed", format: "compact", sortable: true, list: { default: true, align: "right" }, editable: [] },
    created_at: { type: "datetime", label: "Customer since", sortable: true, list: { default: true }, editable: [] },
  },
  relations: [{ name: "staff", label: "Users", entity: "staff", fk: "org_id", kind: "many" }],
  list: {
    defaultSort: ["units_managed", "desc"],
    statusTabs: "status",
    savedViews: [
      { key: "attention", label: "Needs attention", filters: { status: ["Past due", "Suspended"] } },
      { key: "trials", label: "Trials", filters: { status: "Trial" }, sort: ["created_at", "desc"] },
    ],
    footer: [{ field: "seats", fn: "sum", label: "Seats" }, { field: "units_managed", fn: "sum", label: "Units" }],
  },
  detail: {
    facts: ["plan", "status", "seats", "staff", "units_managed", "created_at"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["name", "plan", "status", "seats", "staff", "units_managed", "created_at"] },
      { key: "staff", label: "Users", relation: "staff" },
    ],
    related: [],
  },
  capabilities: { notes: true, activity: true },
  permissions: { read: ["platform_admin"], update: ["platform_admin"] },
  writes: "generic",
  help: { summary: "Customer organizations on the platform: plan, status, seats and the portfolio size they manage." },
});
