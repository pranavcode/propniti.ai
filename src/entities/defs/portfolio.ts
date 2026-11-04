// Entity defs for the portfolio module. Call registerEntity() from "../registry" for each def.
// Owned by the portfolio module lane; see AGENTS.md "v2 lanes and ownership".
// Properties and units are written by lane C as the reference pattern for module lanes.
import { Briefcase, Building, Building2, DoorOpen, LayoutPanelTop, Map as MapIcon } from "lucide-react";
import { AS_OF, issuesField, LEADERS, OPS, propertyPhoto, STAFF, thumb } from "../common";
import { getEntity, registerEntity } from "../registry";
import type { Facts, Role } from "../types";
import { formatMoney, formatPct } from "@/lib/format";
import { AS_OF as TODAY } from "@/seed/constants";

const OWNER_PORTAL: Role[] = ["owner"];

// Latest precomputed month for the property (metrics_monthly), for list columns that would be
// too costly to aggregate from 150k ledger rows per page.
const latest = (expr: string) => `(SELECT ${expr} FROM metrics_monthly mm WHERE mm.workspace_id = 'base' AND mm.property_id = properties.id ORDER BY mm.month DESC LIMIT 1)`;

function monthName(period: string) {
  const name = new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return period === TODAY.slice(0, 7) ? `${name} to date` : name;
}

function propertySummary(f: Facts) {
  const n = (v: Facts[string]) => (v == null ? null : Number(v));
  const occ = n(f.occupancy), noi = n(f.noi_month), late = n(f.delinquent), wo = n(f.open_work_orders) ?? 0, vacant = n(f.vacant_units) ?? 0;
  const s = [
    occ == null ? `${f.property} has no occupancy figure yet.` : `${f.property} is ${formatPct(occ)} occupied${vacant ? `, with ${vacant} vacant unit${vacant === 1 ? "" : "s"}` : ""}.`,
    noi == null ? null : `NOI for ${f.noi_period ? monthName(String(f.noi_period)) : "the latest month"} is ${formatMoney(noi, "whole")}.`,
    `${late == null ? "No balance" : formatMoney(late, "whole")} is past due, and there ${wo === 1 ? "is 1 open work order" : `are ${wo} open work orders`}.`,
  ];
  return s.filter(Boolean).join(" ");
}

registerEntity({
  key: "properties",
  table: "properties",
  label: { one: "Property", many: "Properties" },
  icon: Building2,
  module: "portfolio",
  nav: { section: "portfolio", order: 10 },
  route: "/app/properties",
  titleField: "name",
  subtitle: (r) => [r.street, r.city && `${r.city}, ${r.state}`].filter(Boolean).join(" · "),
  image: (r) => propertyPhoto(r.id, r.photos),
  scopePath: "properties.id",
  fields: {
    name: { type: "text", label: "Property", required: true, search: true, sortable: true, list: { default: true, width: 260 }, help: { summary: "The community or building name residents and owners know it by." } },
    metro: { type: "enum", label: "Metro", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Austin", tone: "neutral" }, { value: "Dallas", tone: "neutral" }, { value: "Atlanta", tone: "neutral" }, { value: "Phoenix", tone: "neutral" },
    ] },
    type: { type: "text", label: "Type", facet: true, sortable: true, list: { default: true } },
    class: { type: "enum", label: "Class", facet: true, sortable: true, list: { default: false }, enum: [{ value: "A", tone: "neutral" }, { value: "B", tone: "neutral" }, { value: "C", tone: "neutral" }] },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Stabilized", tone: "success" }, { value: "Lease-up", tone: "info" }, { value: "Renovation", tone: "warning" },
    ], editable: [...LEADERS] },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {units} u WHERE u.property_id = properties.id)", help: { summary: "Units on file for the property, counted from the unit list." } },
    occupancy: { type: "number", label: "Occupancy", format: "pct", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT CASE WHEN count(*) = 0 THEN NULL ELSE 1.0 * sum(u.status IN ('Occupied', 'Notice')) / count(*) END FROM {units} u WHERE u.property_id = properties.id AND u.status <> 'Model')",
      help: { summary: "Physical occupancy: occupied and on-notice units over rentable units, live from the unit list.", article: "occupancy" } },
    noi_month: { type: "money", label: "NOI (month)", format: "compact", sortable: true, list: { default: true, align: "right" }, sql: latest("mm.noi_cents"), help: { summary: "Net operating income for the latest month in the monthly figures (the current month is month to date): collected income less operating expenses.", article: "noi" } },
    noi_period: { type: "text", label: "NOI month", sql: latest("mm.month") },
    delinquent: { type: "money", label: "Delinquent", format: "compact", sortable: true, list: { default: true, align: "right" },
      sql: latest("mm.aging_0_30_cents + mm.aging_31_60_cents + mm.aging_61_90_cents + mm.aging_90p_cents"), help: { summary: "Unpaid resident balances past due, all aging buckets.", article: "delinquency" } },
    open_work_orders: { type: "number", label: "Open WOs", sortable: true, list: { default: false, align: "right" },
      sql: "(SELECT count(*) FROM {work_orders} w WHERE w.property_id = properties.id AND w.status NOT IN ('Completed', 'Paid', 'Cancelled'))" },
    vacant_units: { type: "number", label: "Vacant units", sortable: true, list: { default: false, align: "right" }, sql: "(SELECT count(*) FROM {units} u WHERE u.property_id = properties.id AND u.status = 'Vacant')" },
    neighborhood: { type: "text", label: "Neighborhood", search: true, list: { default: false } },
    street: { type: "text", label: "Street", search: true, required: true },
    city: { type: "text", label: "City", search: true, facet: true, required: true },
    state: { type: "text", label: "State", facet: true, required: true },
    zip: { type: "text", label: "ZIP", search: true, required: true },
    region_id: { type: "ref", ref: "regions", label: "Region", facet: true, required: true, editable: [...LEADERS] },
    portfolio_id: { type: "ref", ref: "portfolios", label: "Portfolio", required: true, editable: [...LEADERS] },
    owner_entity_id: { type: "ref", ref: "owner_entities", label: "Owner entity", facet: true, required: true, editable: [...LEADERS] },
    org_id: { type: "ref", ref: "orgs", label: "Organization", required: true, hiddenFor: ["owner", "resident", "vendor", "applicant"] },
    manager_id: { type: "ref", ref: "staff", label: "Property manager", facet: true, list: { default: false }, editable: [...LEADERS] },
    year_built: { type: "number", label: "Year built", sortable: true, list: { default: false, align: "right" } },
    stories: { type: "number", label: "Stories" },
    unit_count: { type: "number", label: "Units (on record)", help: { summary: "Unit count entered for the property. Data health compares it with the unit list." } },
    rentable_sqft: { type: "number", label: "Rentable sq ft", format: "compact" },
    acquired_on: { type: "date", label: "Acquired", sortable: true },
    amenities: { type: "json", label: "Amenities" },
    photos: { type: "json", label: "Photos" },
    lat: { type: "number", label: "Latitude" },
    lng: { type: "number", label: "Longitude" },
    open_issues: issuesField("properties"),
  },
  relations: [
    { name: "units", entity: "units", fk: "property_id", kind: "many" },
    { name: "leases", entity: "leases", fk: "property_id", kind: "many" },
    { name: "residents", entity: "residents", fk: "property_id", kind: "many" },
    { name: "work_orders", entity: "work_orders", fk: "property_id", kind: "many" },
    { name: "charges", label: "Ledger", entity: "charges", fk: "property_id", kind: "many" },
    { name: "owner_entity", label: "Owner entity", entity: "owner_entities", fk: "owner_entity_id", kind: "one" },
    { name: "manager", label: "Property manager", entity: "staff", fk: "manager_id", kind: "one" },
    { name: "region", entity: "regions", fk: "region_id", kind: "one" },
  ],
  list: {
    defaultSort: ["name", "asc"],
    statusTabs: "metro",
    savedViews: [
      { key: "texas", label: "Texas", filters: { state: "TX" } },
      { key: "below-92", label: "Occupancy below 92%", filters: { "occupancy.max": "0.92" }, sort: ["occupancy", "asc"] },
      { key: "delinquency", label: "Highest delinquency", sort: ["delinquent", "desc"] },
      { key: "lease-up", label: "Lease-up and renovation", filters: { status: ["Lease-up", "Renovation"] } },
      { key: "issues", label: "With data issues", filters: { "open_issues.min": "1" }, sort: ["open_issues", "desc"] },
    ],
    footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "noi_month", fn: "sum", label: "NOI" }, { field: "delinquent", fn: "sum", label: "Delinquent" }],
  },
  detail: {
    facts: ["metro", "type", "class", "units", "occupancy", "noi_month", "delinquent", "manager_id"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["name", "status", "type", "class", "year_built", "stories", "rentable_sqft", "unit_count", "street", "city", "state", "zip", "neighborhood", "region_id", "portfolio_id", "owner_entity_id", "manager_id", "acquired_on", "amenities"] },
      { key: "units", label: "Units", relation: "units" },
      { key: "leases", label: "Leases", relation: "leases" },
      { key: "residents", label: "Residents", relation: "residents" },
      { key: "work_orders", label: "Work orders", relation: "work_orders" },
      { key: "ledger", label: "Ledger", relation: "charges", roles: ["principal", "regional_manager", "property_manager", "accountant", "owner"] },
    ],
    related: ["owner_entity", "manager", "region"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  kpis: [
    { key: "occupancy", label: "Occupancy", metric: "portfolio.occupancy", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/units?f.status=Vacant", help: { summary: "Occupied units over rentable units for the month.", article: "occupancy" } },
    { key: "noi", label: "NOI", metric: "portfolio.noi", format: "money", delta: "mom", goodWhen: "up", drill: "/app/properties?sort=-noi_month", help: { summary: "Net operating income for the month across properties in your scope.", article: "noi" } },
    { key: "collections", label: "Collections rate", metric: "receivables.collections_rate", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/receivables/payments" },
    { key: "delinquent", label: "Delinquent", metric: "receivables.delinquency", format: "money", delta: "mom", goodWhen: "down", drill: "/app/receivables/charges?f.status=Overdue" },
  ],
  charts: [
    { key: "noi_trend", title: "NOI vs budget, trailing 12 months", kind: "line", metric: "portfolio.noi", x: "month", series: [{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money" }], drill: "/app/properties?sort=-noi_month" },
    { key: "noi_by_property", title: "NOI by property", kind: "hbar", metric: "portfolio.by_property", x: "name", series: [{ key: "noi", label: "NOI", format: "money" }], drill: "/app/properties/{property_id}" },
    { key: "occupancy_trend", title: "Occupancy, physical vs economic", kind: "line", metric: "portfolio.occupancy", x: "month", series: [{ key: "physical", label: "Physical", format: "pct" }, { key: "economic", label: "Economic", format: "pct" }], drill: "/app/units?f.status=Vacant" },
    { key: "aging", title: "Delinquency aging", kind: "bar", metric: "receivables.aging", x: "label", series: [{ key: "amount", label: "Balance", format: "money" }], drill: "/app/receivables/charges?f.aging={bucket}" },
  ],
  ai: {
    // Every figure is a field the record page shows, read from the same row.
    facts: (r) => ({
      property: String(r.name), metro: String(r.metro), type: String(r.type), units: Number(r.units ?? 0),
      occupancy: r.occupancy == null ? null : Math.round(Number(r.occupancy) * 1000) / 10,
      noi_month: r.noi_month == null ? null : Number(r.noi_month), noi_period: (r.noi_period as string) ?? null, delinquent: r.delinquent == null ? null : Number(r.delinquent),
      open_work_orders: Number(r.open_work_orders ?? 0), open_data_issues: Number(r.open_issues ?? 0), vacant_units: Number(r.vacant_units ?? 0),
    }),
    rulesSummary: propertySummary,
    summaryPrompt: "Summarise this property's month for its manager in 3 sentences: occupancy, collections, maintenance, and the one thing to act on. Use only the facts.",
    agents: ["collections", "maintenance_triage", "data_health"],
  },
  permissions: {
    read: [...STAFF, ...OWNER_PORTAL],
    create: ["principal", "regional_manager"],
    update: [...OPS],
    delete: ["principal"],
  },
  writes: "generic",
  dataRules: ["properties.negative_unit_count", "properties.missing_zip_state", "properties.address_format"],
  help: { summary: "Every community, small multifamily group, commercial NNN building and single-family portfolio you manage, with live occupancy, NOI and delinquency.", article: "properties" },
});

registerEntity({
  key: "units",
  table: "units",
  label: { one: "Unit", many: "Units" },
  icon: DoorOpen,
  module: "portfolio",
  nav: { section: "portfolio", order: 20 },
  route: "/app/units",
  titleField: "label",
  subtitle: (r) => [r.property_id__label, r.unit_type_id__label].filter(Boolean).join(" · "),
  image: (r) => thumb(r.photo),
  scopePath: "units.property_id",
  fields: {
    label: { type: "text", label: "Unit", sortable: true, list: { default: true, width: 200 }, sql: "(SELECT p.name FROM {properties} p WHERE p.id = units.property_id) || ' #' || units.number" },
    number: { type: "text", label: "Unit number", required: true, search: true, sortable: true },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, required: true, sortable: true, list: { default: true }, editable: [] },
    status: { type: "enum", label: "Status", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Occupied", tone: "success" }, { value: "Vacant", tone: "neutral" }, { value: "Notice", tone: "warning" },
      { value: "Make-ready", tone: "info" }, { value: "Down", tone: "danger" }, { value: "Model", tone: "neutral" },
    ], help: { summary: "Physical status. Leasing status comes from the unit's leases." } },
    unit_type_id: { type: "ref", ref: "unit_types", label: "Floor plan", facet: true, list: { default: true } },
    beds: { type: "number", label: "Beds", facet: true, sortable: true, list: { default: true, align: "right" }, sql: "(SELECT ut.beds FROM {unit_types} ut WHERE ut.id = units.unit_type_id)" },
    sqft: { type: "number", label: "Sq ft", sortable: true, list: { default: true, align: "right" } },
    market_rent: { type: "money", label: "Market rent", column: "market_rent_cents", sortable: true, list: { default: true, align: "right" }, editable: [...OPS] },
    rent: { type: "money", label: "Lease rent", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT l.rent_cents FROM {leases} l WHERE l.unit_id = units.id AND l.status IN ('Active', 'Notice', 'Month-to-month') ORDER BY l.start_on DESC LIMIT 1)" },
    resident: { type: "text", label: "Resident", search: true, list: { default: true },
      sql: "(SELECT h.name FROM {leases} l JOIN {households} h ON h.id = l.household_id WHERE l.unit_id = units.id AND l.status IN ('Active', 'Notice', 'Month-to-month') ORDER BY l.start_on DESC LIMIT 1)" },
    lease_end: { type: "date", label: "Lease ends", sortable: true, list: { default: true },
      sql: "(SELECT l.end_on FROM {leases} l WHERE l.unit_id = units.id AND l.status IN ('Active', 'Notice', 'Month-to-month') ORDER BY l.start_on DESC LIMIT 1)" },
    days_vacant: { type: "number", label: "Days vacant", sortable: true, list: { default: false, align: "right" },
      sql: `CASE WHEN units.status IN ('Vacant', 'Make-ready', 'Down') THEN CAST(julianday(${AS_OF}) - julianday(coalesce((SELECT max(l.move_out_on) FROM {leases} l WHERE l.unit_id = units.id), units.available_on)) AS INTEGER) END` },
    available_on: { type: "date", label: "Available", sortable: true, list: { default: false } },
    floor: { type: "number", label: "Floor", facet: true },
    building_id: { type: "ref", ref: "buildings", label: "Building" },
    photo: { type: "image", label: "Photo", sql: "(SELECT json_extract(ut.photos, '$[0]') FROM {unit_types} ut WHERE ut.id = units.unit_type_id)" },
    open_issues: issuesField("units"),
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "unit_type", label: "Floor plan", entity: "unit_types", fk: "unit_type_id", kind: "one" },
    { name: "leases", entity: "leases", fk: "unit_id", kind: "many" },
    { name: "work_orders", entity: "work_orders", fk: "unit_id", kind: "many" },
    { name: "charges", label: "Ledger", entity: "charges", fk: "unit_id", kind: "many" },
  ],
  list: {
    defaultSort: ["label", "asc"],
    statusTabs: "status",
    savedViews: [
      { key: "vacant", label: "Vacant", filters: { status: "Vacant" }, sort: ["days_vacant", "desc"] },
      { key: "vacant-90", label: "Vacant over 90 days", filters: { status: ["Vacant", "Down"], "days_vacant.min": "90" }, sort: ["days_vacant", "desc"] },
      { key: "expiring", label: "Leases ending in 60 days", filters: { status: ["Occupied", "Notice"] }, sort: ["lease_end", "asc"] },
      { key: "below-market", label: "Rent below market", sort: ["rent", "asc"] },
    ],
    footer: [{ field: "market_rent", fn: "sum", label: "Market rent" }, { field: "rent", fn: "sum", label: "Lease rent" }],
  },
  detail: {
    facts: ["status", "property_id", "unit_type_id", "beds", "sqft", "market_rent", "rent", "resident", "lease_end"],
    tabs: [
      { key: "overview", label: "Overview", fields: ["number", "property_id", "building_id", "floor", "unit_type_id", "beds", "sqft", "status", "available_on", "market_rent", "rent", "resident", "lease_end", "days_vacant"] },
      { key: "leases", label: "Leases", relation: "leases" },
      { key: "ledger", label: "Ledger", relation: "charges", roles: ["principal", "regional_manager", "property_manager", "accountant"] },
      { key: "work_orders", label: "Maintenance", relation: "work_orders" },
    ],
    related: ["property", "unit_type"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true, aiSummary: true },
  kpis: [
    { key: "occupancy", label: "Occupancy", metric: "portfolio.occupancy", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/units?f.status=Occupied" },
    { key: "vacancy_loss", label: "Vacancy loss", metric: "leasing.vacancy_loss", format: "money", delta: "mom", goodWhen: "down", drill: "/app/units?view=vacant" },
  ],
  ai: {
    facts: (r, rel) => ({ unit: String(r.label), status: String(r.status), beds: Number(r.beds ?? 0), market_rent: Number(r.market_rent ?? 0), lease_rent: r.rent == null ? null : Number(r.rent), resident: (r.resident as string) ?? null, lease_end: (r.lease_end as string) ?? null, open_work_orders: rel.work_orders?.length ?? 0 }),
    agents: ["leasing", "renewals"],
  },
  permissions: { read: [...STAFF, ...OWNER_PORTAL], create: [...OPS], update: [...OPS, "maintenance_supervisor", "leasing_agent"], delete: ["principal", "regional_manager"] },
  writes: "generic",
  dataRules: ["units.orphan_property"],
  help: { summary: "Every rentable unit with its live status, floor plan, rent and current resident. Filter by status to find vacancies.", article: "units" },
});

// ---------------------------------------------------------------------------------------------
// Portfolio lane: custom record tabs on properties and units, plus regions, portfolios, buildings
// and floor plans. Lane C's two defs above stay as written; these re-register them with the
// portfolio tabs (src/extensions/portfolio/tabs).
// ---------------------------------------------------------------------------------------------

const PROPERTY_FINANCE: Role[] = ["principal", "regional_manager", "property_manager", "accountant", "owner"];
const props = getEntity("properties")!;
registerEntity({
  ...props,
  detail: {
    ...props.detail,
    tabs: [
      { custom: "portfolio.overview" },
      { custom: "portfolio.stack" },
      { custom: "portfolio.floorplans" },
      { key: "units", label: "Units", relation: "units" },
      { custom: "portfolio.financials" },
      { key: "leases", label: "Leases", relation: "leases" },
      { key: "residents", label: "Residents", relation: "residents" },
      { key: "work_orders", label: "Work orders", relation: "work_orders" },
      { custom: "portfolio.compliance" },
      { key: "ledger", label: "Ledger", relation: "charges", roles: PROPERTY_FINANCE },
      { key: "details", label: "Details", fields: ["name", "status", "type", "class", "year_built", "stories", "rentable_sqft", "unit_count", "street", "city", "state", "zip", "neighborhood", "region_id", "portfolio_id", "owner_entity_id", "manager_id", "acquired_on", "amenities"] },
    ],
    related: [...props.detail.related, "portfolio"],
  },
  relations: [...props.relations, { name: "portfolio", entity: "portfolios", fk: "portfolio_id", kind: "one" }, { name: "buildings", entity: "buildings", fk: "property_id", kind: "many" }, { name: "unit_types", label: "Floor plans", entity: "unit_types", fk: "property_id", kind: "many" }],
});

const units = getEntity("units")!;
registerEntity({
  ...units,
  detail: {
    ...units.detail,
    tabs: [
      { custom: "portfolio.unit" },
      { custom: "portfolio.lease_history" },
      { custom: "portfolio.turnover" },
      { key: "work_orders", label: "Maintenance", relation: "work_orders" },
      { key: "ledger", label: "Ledger", relation: "charges", roles: ["principal", "regional_manager", "property_manager", "accountant"] },
      { key: "details", label: "Details", fields: ["number", "property_id", "building_id", "floor", "unit_type_id", "beds", "sqft", "status", "available_on", "market_rent", "rent", "resident", "lease_end", "days_vacant"] },
    ],
    related: [...units.detail.related, "building"],
  },
  relations: [...units.relations, { name: "building", entity: "buildings", fk: "building_id", kind: "one" }],
});

// Rollups for org-level records: properties in the region or portfolio, then their units and the
// latest closed month of metrics_monthly.
// Org-level records have no property scope and their rollups cover every property, so only
// roles whose scope is the whole org may read them.
const ORG_WIDE: Role[] = ["platform_admin", "principal", "admin", "accountant", "broker"];
const propsWhere = (cond: string) => `(SELECT count(*) FROM {properties} p WHERE ${cond})`;
const unitsWhere = (cond: string) => `(SELECT count(*) FROM {units} u JOIN {properties} p ON p.id = u.property_id WHERE ${cond})`;
const occWhere = (cond: string) => `(SELECT CASE WHEN count(*) = 0 THEN NULL ELSE 1.0 * sum(u.status IN ('Occupied', 'Notice')) / count(*) END FROM {units} u JOIN {properties} p ON p.id = u.property_id WHERE u.status <> 'Model' AND ${cond})`;
const noiWhere = (cond: string) => `(SELECT sum(mm.noi_cents) FROM metrics_monthly mm JOIN {properties} p ON p.id = mm.property_id WHERE mm.workspace_id = 'base' AND ${cond} AND mm.month = (SELECT max(month) FROM metrics_monthly WHERE workspace_id = 'base' AND month < substr(${AS_OF}, 1, 7)))`;

registerEntity({
  key: "regions",
  table: "regions",
  label: { one: "Region", many: "Regions" },
  icon: MapIcon,
  module: "portfolio",
  route: "/app/regions",
  titleField: "name",
  subtitle: (r) => [r.properties != null && `${r.properties} properties`, r.units != null && `${r.units} units`].filter(Boolean).join(" · "),
  // A region spans many properties, so it's org-level; its rollups still read scoped properties.
  scopePath: null,
  fields: {
    name: { type: "text", label: "Region", required: true, search: true, sortable: true, list: { default: true, width: 220 } },
    states: { type: "json", label: "States", list: { default: true } },
    properties: { type: "number", label: "Properties", sortable: true, list: { default: true, align: "right" }, sql: propsWhere("p.region_id = regions.id") },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" }, sql: unitsWhere("p.region_id = regions.id") },
    occupancy: { type: "number", label: "Occupancy", format: "pct", sortable: true, list: { default: true, align: "right" }, sql: occWhere("p.region_id = regions.id"), help: { summary: "Occupied and on-notice units over rentable units across the region.", article: "occupancy" } },
    noi_month: { type: "money", label: "NOI (last month)", format: "compact", sortable: true, list: { default: true, align: "right" }, sql: noiWhere("p.region_id = regions.id"), help: { summary: "Net operating income for the last closed month, summed across the region's properties.", article: "noi" } },
    org_id: { type: "ref", ref: "orgs", label: "Organization", required: true, hiddenFor: ["owner", "resident", "vendor", "applicant"] },
  },
  relations: [{ name: "properties", entity: "properties", fk: "region_id", kind: "many" }],
  list: { defaultSort: ["name", "asc"], footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "noi_month", fn: "sum", label: "NOI" }] },
  detail: {
    facts: ["properties", "units", "occupancy", "noi_month", "states"],
    tabs: [{ key: "properties", label: "Properties", relation: "properties" }, { key: "overview", label: "Details", fields: ["name", "states", "org_id"] }],
    related: [],
  },
  capabilities: { notes: true, activity: true },
  kpis: [
    { key: "noi", label: "NOI", metric: "portfolio.noi", format: "money", delta: "mom", goodWhen: "up", drill: "/app/properties?sort=-noi_month" },
    { key: "occupancy", label: "Occupancy", metric: "portfolio.occupancy", format: "pct", delta: "mom", goodWhen: "up", drill: "/app/units?f.status=Vacant" },
  ],
  charts: [{ key: "by_region", title: "NOI by region, last closed month", kind: "hbar", metric: "portfolio.by_region", x: "name", series: [{ key: "noi", label: "NOI", format: "money" }], drill: "/app/properties?f.region_id={region_id}" }],
  permissions: { read: ORG_WIDE, create: ["principal"], update: ["principal"], delete: ["principal"] },
  writes: "generic",
  help: { summary: "Regions group properties for regional managers: Texas, Southeast and Southwest. Scope and rollups follow the region.", article: "regions-and-portfolios" },
});

registerEntity({
  key: "portfolios",
  table: "portfolios",
  label: { one: "Portfolio", many: "Portfolios" },
  icon: Briefcase,
  module: "portfolio",
  route: "/app/portfolios",
  titleField: "name",
  subtitle: (r) => [r.owner_entity_id__label, r.properties != null && `${r.properties} properties`].filter(Boolean).join(" · "),
  scopePath: null,
  fields: {
    name: { type: "text", label: "Portfolio", required: true, search: true, sortable: true, list: { default: true, width: 300 } },
    owner_entity_id: { type: "ref", ref: "owner_entities", label: "Owner entity", facet: true, required: true, list: { default: true }, editable: [...LEADERS] },
    properties: { type: "number", label: "Properties", sortable: true, list: { default: true, align: "right" }, sql: propsWhere("p.portfolio_id = portfolios.id") },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" }, sql: unitsWhere("p.portfolio_id = portfolios.id") },
    occupancy: { type: "number", label: "Occupancy", format: "pct", sortable: true, list: { default: true, align: "right" }, sql: occWhere("p.portfolio_id = portfolios.id") },
    noi_month: { type: "money", label: "NOI (last month)", format: "compact", sortable: true, list: { default: true, align: "right" }, sql: noiWhere("p.portfolio_id = portfolios.id"), help: { summary: "Net operating income for the last closed month across the portfolio's properties.", article: "noi" } },
    org_id: { type: "ref", ref: "orgs", label: "Organization", required: true, hiddenFor: ["owner", "resident", "vendor", "applicant"] },
  },
  relations: [
    { name: "properties", entity: "properties", fk: "portfolio_id", kind: "many" },
    { name: "owner_entity", label: "Owner entity", entity: "owner_entities", fk: "owner_entity_id", kind: "one" },
  ],
  list: { defaultSort: ["name", "asc"], footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "noi_month", fn: "sum", label: "NOI" }] },
  detail: {
    facts: ["owner_entity_id", "properties", "units", "occupancy", "noi_month"],
    tabs: [{ key: "properties", label: "Properties", relation: "properties" }, { key: "overview", label: "Details", fields: ["name", "owner_entity_id", "org_id"] }],
    related: ["owner_entity"],
  },
  capabilities: { notes: true, activity: true, documents: true },
  permissions: { read: ORG_WIDE, create: ["principal"], update: ["principal"], delete: ["principal"] },
  writes: "generic",
  help: { summary: "A portfolio is the set of properties one owner entity holds title to. Owner statements and distributions roll up by portfolio.", article: "regions-and-portfolios" },
});

registerEntity({
  key: "buildings",
  table: "buildings",
  label: { one: "Building", many: "Buildings" },
  icon: Building,
  module: "portfolio",
  route: "/app/buildings",
  titleField: "label",
  subtitle: (r) => [r.property_id__label, r.floors != null && `${r.floors} floors`].filter(Boolean).join(" · "),
  scopePath: "buildings.property_id",
  fields: {
    label: { type: "text", label: "Building", sortable: true, list: { default: true, width: 260 }, sql: "(SELECT p.name FROM {properties} p WHERE p.id = buildings.property_id) || ' · ' || buildings.name" },
    name: { type: "text", label: "Name", required: true, search: true, sortable: true, editable: [...OPS] },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, required: true, sortable: true, list: { default: true }, editable: [] },
    floors: { type: "number", label: "Floors", sortable: true, list: { default: true, align: "right" }, editable: [...OPS] },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {units} u WHERE u.building_id = buildings.id)" },
    occupancy: { type: "number", label: "Occupancy", format: "pct", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT CASE WHEN count(*) = 0 THEN NULL ELSE 1.0 * sum(u.status IN ('Occupied', 'Notice')) / count(*) END FROM {units} u WHERE u.building_id = buildings.id AND u.status <> 'Model')" },
    vacant: { type: "number", label: "Vacant", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {units} u WHERE u.building_id = buildings.id AND u.status IN ('Vacant', 'Make-ready', 'Down'))" },
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "units", entity: "units", fk: "building_id", kind: "many" },
  ],
  list: { defaultSort: ["label", "asc"], footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "vacant", fn: "sum", label: "Vacant" }] },
  detail: {
    facts: ["property_id", "floors", "units", "occupancy", "vacant"],
    tabs: [{ key: "units", label: "Units", relation: "units" }, { key: "overview", label: "Details", fields: ["name", "property_id", "floors"] }],
    related: ["property"],
  },
  capabilities: { notes: true, activity: true, tasks: true, documents: true },
  permissions: { read: [...STAFF, ...OWNER_PORTAL], create: [...OPS], update: [...OPS], delete: ["principal", "regional_manager"] },
  writes: "generic",
  help: { summary: "The physical buildings on a property. The unit stack on each property groups units by building and floor.", article: "units" },
});

registerEntity({
  key: "unit_types",
  table: "unit_types",
  label: { one: "Floor plan", many: "Floor plans" },
  icon: LayoutPanelTop,
  module: "portfolio",
  nav: { section: "portfolio", order: 25 },
  route: "/app/floor-plans",
  titleField: "name",
  subtitle: (r) => [r.property_id__label, r.sqft != null && `${r.sqft} sq ft`].filter(Boolean).join(" · "),
  image: (r) => thumb(r.photo),
  scopePath: "unit_types.property_id",
  fields: {
    name: { type: "text", label: "Floor plan", required: true, search: true, sortable: true, list: { default: true, width: 200 }, editable: [...OPS] },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, required: true, sortable: true, list: { default: true }, editable: [] },
    beds: { type: "number", label: "Beds", facet: true, sortable: true, list: { default: true, align: "right" }, editable: [...OPS] },
    baths: { type: "number", label: "Baths", sortable: true, list: { default: true, align: "right" }, editable: [...OPS] },
    sqft: { type: "number", label: "Sq ft", sortable: true, list: { default: true, align: "right" }, editable: [...OPS] },
    market_rent: { type: "money", label: "Market rent", column: "market_rent_cents", sortable: true, list: { default: true, align: "right" }, editable: [...OPS], help: { summary: "Asking rent for the plan. Units can carry their own market rent on top of it.", article: "rent-and-market" } },
    units: { type: "number", label: "Units", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {units} u WHERE u.unit_type_id = unit_types.id)" },
    available: { type: "number", label: "Available", sortable: true, list: { default: true, align: "right" }, sql: "(SELECT count(*) FROM {units} u WHERE u.unit_type_id = unit_types.id AND u.status IN ('Vacant', 'Make-ready', 'Notice'))" },
    avg_rent: { type: "money", label: "Avg lease rent", sortable: true, list: { default: true, align: "right" },
      sql: "(SELECT CAST(avg(l.rent_cents) AS INTEGER) FROM {leases} l JOIN {units} u ON u.id = l.unit_id WHERE u.unit_type_id = unit_types.id AND l.status IN ('Active', 'Notice', 'Month-to-month'))",
      help: { summary: "Average rent on active leases for units of this plan. Compare it with market rent to see loss to lease.", article: "rent-and-market" } },
    photo: { type: "image", label: "Photo", sql: "json_extract(unit_types.photos, '$[0]')" },
    photos: { type: "json", label: "Photos" },
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "units", entity: "units", fk: "unit_type_id", kind: "many" },
  ],
  list: {
    defaultSort: ["property_id", "asc"],
    savedViews: [
      { key: "available", label: "With availability", filters: { "available.min": "1" }, sort: ["available", "desc"] },
      { key: "two-bed", label: "2 bedrooms", filters: { beds: "2" } },
    ],
    footer: [{ field: "units", fn: "sum", label: "Units" }, { field: "available", fn: "sum", label: "Available" }],
  },
  detail: {
    facts: ["property_id", "beds", "baths", "sqft", "market_rent", "avg_rent", "units", "available"],
    tabs: [{ key: "units", label: "Units", relation: "units" }, { key: "overview", label: "Details", fields: ["name", "property_id", "beds", "baths", "sqft", "market_rent", "photos"] }],
    related: ["property"],
  },
  capabilities: { notes: true, activity: true, documents: true },
  ai: {
    facts: (r) => ({ plan: `${String(r.property_id__label ?? r.property_id)} · ${String(r.name)}`, beds: Number(r.beds ?? 0), sqft: Number(r.sqft ?? 0), market_rent: Number(r.market_rent ?? 0), avg_lease_rent: r.avg_rent == null ? null : Number(r.avg_rent), units: Number(r.units ?? 0), available: Number(r.available ?? 0) }),
    agents: ["leasing", "renewals"],
  },
  permissions: { read: [...STAFF, ...OWNER_PORTAL], create: [...OPS], update: [...OPS], delete: ["principal", "regional_manager"] },
  writes: "generic",
  help: { summary: "Each property's floor plans with beds, baths, size, market rent, photos and a generated floor-plan drawing.", article: "units" },
});
