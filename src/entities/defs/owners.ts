// Entity defs for the owners module. Call registerEntity() from "../registry" for each def.
// Owned by the owners module lane; see AGENTS.md "v2 lanes and ownership".
// Owners is written by lane C as the reference pattern; the owners lane adds owner entities,
// distributions and statements.
import { Landmark } from "lucide-react";
import { LEADERS, STAFF } from "../common";
import { registerEntity } from "../registry";

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
    email: { type: "text", label: "Email", search: true, list: { default: true } },
    phone: { type: "text", label: "Phone", search: true },
    portal_enabled: { type: "bool", label: "Portal access", facet: true, list: { default: true } },
  },
  relations: [
    { name: "entities", label: "Owner entities", entity: "owner_entities", fk: "owner_id", kind: "many" },
  ],
  list: {
    defaultSort: ["name", "asc"],
    statusTabs: "kind",
    savedViews: [{ key: "no-portal", label: "Portal not enabled", filters: { portal_enabled: "false" } }],
    footer: [{ field: "units", fn: "sum", label: "Units" }],
  },
  detail: {
    facts: ["kind", "entities", "properties", "units", "email", "phone", "portal_enabled"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["name", "kind", "email", "phone", "portal_enabled"] },
      { key: "entities", label: "Entities", relation: "entities" },
    ],
    related: ["entities"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  ai: {
    facts: (r) => ({ owner: String(r.name), kind: String(r.kind), entities: Number(r.entities ?? 0), properties: Number(r.properties ?? 0), units: Number(r.units ?? 0) }),
    agents: ["owner_reporting"],
  },
  permissions: { read: [...STAFF, "owner"], create: [...LEADERS, "broker"], update: [...LEADERS, "broker", "accountant"], delete: ["principal"] },
  writes: "generic",
  help: { summary: "The investors you manage for. Each owns one or more LLCs (owner entities) that hold title and receive statements.", article: "owners" },
});
