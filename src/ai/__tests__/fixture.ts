import { DatabaseSync } from "node:sqlite";
import { applyMigrations, D1_LIMITS, sqliteDb } from "@/lib/platform/sqlite";
import type { Actor } from "@/entities/types";

// A small base dataset for the AI tests: two Austin properties and one in Atlanta, three leases at
// different stages of delinquency, a new work order, a pending bill from a vendor whose bank changed,
// a data issue, policies, help and two months of metrics. "Today" is 2026-11-04.
export const WS = "ai-test-workspace-00000000001";
export const TODAY = "2026-11-04";

type R = Record<string, string | number | null>;
function ins(raw: DatabaseSync, table: string, rows: R[]) {
  for (const r of rows) {
    const row = { workspace_id: "base", ...r };
    const k = Object.keys(row);
    raw.prepare(`INSERT INTO ${table} (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).run(...Object.values(row));
  }
}

export function openFixture() {
  const raw = new DatabaseSync(":memory:", { limits: D1_LIMITS });
  applyMigrations(raw);
  raw.exec(`INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('${WS}', 'demo', 0, ${Date.now()})`);
  raw.exec(`INSERT INTO meta (key, value) VALUES ('as_of', '${TODAY}')`);
  ins(raw, "properties", [
    { id: "p01", org_id: "org1", region_id: "r-tx", portfolio_id: "pf1", owner_entity_id: "oe01", name: "The Lofts at Riverside", type: "Multifamily", metro: "Austin", street: "100 Riverside Dr", city: "Austin", state: "TX", zip: "78704" },
    { id: "p02", org_id: "org1", region_id: "r-tx", portfolio_id: "pf1", owner_entity_id: "oe01", name: "Barton Creek Commons", type: "Multifamily", metro: "Austin", street: "123 MAIN STREET.", city: "Austin", state: "TX", zip: "78746" },
    { id: "p10", org_id: "org1", region_id: "r-se", portfolio_id: "pf2", owner_entity_id: "oe02", name: "Inman Park Flats", type: "Multifamily", metro: "Atlanta", street: "9 Elizabeth St", city: "Atlanta", state: "GA", zip: "30307" },
  ]);
  ins(raw, "owners", [{ id: "ow01", name: "Helen Carter" }]);
  ins(raw, "owner_entities", [{ id: "oe01", org_id: "org1", owner_id: "ow01", name: "Bluebonnet Residential Fund II, LLC", state: "TX" }, { id: "oe02", org_id: "org1", owner_id: "ow01", name: "Peach State Holdings, LLC", state: "GA" }]);
  ins(raw, "units", [
    { id: "u1", property_id: "p01", number: "412", market_rent_cents: 150000, status: "Occupied" },
    { id: "u2", property_id: "p01", number: "108", market_rent_cents: 125000, status: "Occupied" },
    { id: "u3", property_id: "p10", number: "201", market_rent_cents: 110000, status: "Occupied" },
  ]);
  ins(raw, "households", [{ id: "h1", property_id: "p01", name: "Lee household" }, { id: "h2", property_id: "p01", name: "Ruiz household" }, { id: "h3", property_id: "p10", name: "Okoro household" }]);
  ins(raw, "residents", [
    { id: "r1", household_id: "h1", property_id: "p01", first_name: "Jordan", last_name: "Lee", email: "jordan@lee.example", phone: "(512) 555-0101" },
    { id: "r2", household_id: "h2", property_id: "p01", first_name: "Ana", last_name: "Ruiz", email: "512-555-0199", language: "es" },
    { id: "r3", household_id: "h3", property_id: "p10", first_name: "Chidi", last_name: "Okoro", email: "chidi@okoro.example" },
  ]);
  ins(raw, "leases", [
    { id: "l1", property_id: "p01", unit_id: "u1", household_id: "h1", status: "Active", start_on: "2025-12-16", end_on: "2026-12-15", rent_cents: 140000 },
    { id: "l2", property_id: "p01", unit_id: "u2", household_id: "h2", status: "Active", start_on: "2026-03-01", end_on: "2027-02-28", rent_cents: 120000 },
    { id: "l3", property_id: "p10", unit_id: "u3", household_id: "h3", status: "Active", start_on: "2026-01-01", end_on: "2026-12-31", rent_cents: 100000 },
  ]);
  ins(raw, "gl_accounts", [{ id: "gl-4000", number: "4000", name: "Rental income", type: "Income" }, { id: "gl-6100", number: "6100", name: "Repairs & maintenance", type: "Expense" }, { id: "gl-6300", number: "6300", name: "Landscaping", type: "Expense" }]);
  const charge = (id: string, lease: string, h: string, p: string, u: string, month: string, cents: number) => ({ id, lease_id: lease, household_id: h, property_id: p, unit_id: u, gl_account_id: "gl-4000", description: "Rent", period: month, due_on: `${month}-01`, amount_cents: cents });
  ins(raw, "charges", [
    ...["2026-08", "2026-09", "2026-10", "2026-11"].map((m) => charge(`c1-${m}`, "l1", "h1", "p01", "u1", m, 140000)),
    ...["2026-09", "2026-10", "2026-11"].map((m) => charge(`c2-${m}`, "l2", "h2", "p01", "u2", m, 120000)),
    ...["2026-06", "2026-07", "2026-08"].map((m) => charge(`c3-${m}`, "l3", "h3", "p10", "u3", m, 100000)),
  ]);
  ins(raw, "payments", [
    { id: "pay1", lease_id: "l1", household_id: "h1", property_id: "p01", method: "ACH", received_on: "2026-08-02", amount_cents: 140000 },
    { id: "pay2", lease_id: "l2", household_id: "h2", property_id: "p01", method: "ACH", received_on: "2026-09-03", amount_cents: 120000 },
    { id: "pay3", lease_id: "l2", household_id: "h2", property_id: "p01", method: "ACH", received_on: "2026-10-03", amount_cents: 120000, nsf: 1 },
  ]);
  // Stored allocation, as the generator writes it: the good payments settled the oldest charges.
  raw.exec("UPDATE charges SET paid_cents = amount_cents WHERE id IN ('c1-2026-08', 'c2-2026-09')");
  ins(raw, "approval_policies", [
    { id: "ap1", category: "Maintenance spend", limit_cents: 50000, approver_role: "maintenance_supervisor", owner_approval_over_cents: 250000 },
    { id: "ap2", category: "Bill payment", limit_cents: 100000, approver_role: "accountant" },
    { id: "ap3", category: "Legal", limit_cents: null, approver_role: "property_manager", always_human: 1 },
    { id: "ap4", category: "Safety", limit_cents: null, approver_role: "maintenance_supervisor", always_human: 1 },
  ]);
  ins(raw, "vendors", [
    { id: "v01", company: "Lone Star Plumbing", trade: "Plumbing", metros: '["Austin","Dallas"]', rating: 4.7, status: "Active" },
    { id: "v02", company: "Hill Country Grounds", trade: "Landscaping", metros: '["Austin"]', rating: 4.1, status: "Active", bank_changed_at: "2026-10-20" },
  ]);
  ins(raw, "vendor_cois", [{ id: "coi1", vendor_id: "v01", carrier: "Travelers", gl_limit_cents: 100000000, expires_on: "2027-06-01" }, { id: "coi2", vendor_id: "v02", carrier: "Hartford", gl_limit_cents: 100000000, expires_on: "2026-11-20", status: "Expiring" }]);
  ins(raw, "work_orders", [
    { id: "WO-10001", property_id: "p01", unit_id: "u1", title: "Kitchen sink leaking under cabinet", description: "Water pooling under the sink", category: "General", priority: "Normal", status: "New", opened_at: "2026-11-03T15:00:00Z" },
    { id: "WO-9001", property_id: "p01", title: "Replace faucet", category: "Plumbing", priority: "Normal", status: "Completed", opened_at: "2026-05-01", cost_cents: 18000 },
    { id: "WO-9002", property_id: "p01", title: "Clogged drain", category: "Plumbing", priority: "Normal", status: "Paid", opened_at: "2026-06-01", cost_cents: 22000 },
  ]);
  ins(raw, "bills", [
    { id: "b1", property_id: "p01", owner_entity_id: "oe01", vendor_id: "v02", invoice_number: "HCG-881", bill_date: "2026-10-28", due_on: "2026-11-15", amount_cents: 64000, status: "Pending approval" },
    { id: "b2", property_id: "p01", owner_entity_id: "oe01", vendor_id: "v01", invoice_number: "LSP-1201", bill_date: "2026-10-30", due_on: "2026-11-20", amount_cents: 22000, status: "Pending approval" },
  ]);
  ins(raw, "bill_lines", [
    { id: "bl1", bill_id: "b1", gl_account_id: "gl-6300", description: "Monthly grounds", unit_cents: 64000, amount_cents: 64000 },
    { id: "bl2", bill_id: "b2", gl_account_id: "gl-6100", description: "Drain repair", unit_cents: 22000, amount_cents: 22000 },
  ]);
  ins(raw, "applicants", [{ id: "apl-1", first_name: "Priyanka", last_name: "Rao", email: "p@rao.example", monthly_income_cents: 600000, created_at: "2026-11-04" }, { id: "apl-2", first_name: "Old", last_name: "Waiter", email: "o@w.example", monthly_income_cents: 300000, created_at: "2026-10-01" }]);
  ins(raw, "applications", [
    { id: "app-new", property_id: "p01", unit_id: "u2", applicant_id: "apl-1", stage: "Started", rent_cents: 150000, submitted_at: "2026-11-04T10:00:00Z" },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `app-old-${i}`, property_id: "p01", unit_id: "u1", applicant_id: "apl-2", stage: "Review", rent_cents: 150000, submitted_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z` })),
  ]);
  ins(raw, "screening_results", [{ id: "scr-1", application_id: "app-new", applicant_id: "apl-1", property_id: "p01", credit_band: "Excellent", income_verified: 1, decision: "Pass" }]);
  ins(raw, "help_articles", [{ id: "post-late-fee", title: "How to post a late fee", body: "Open the lease ledger, choose Post late fee. The fee is capped by the state rules for the property's state.", tags: '["late fee","receivables"]', route: "/app/receivables/charges", updated_at: "2026-10-01" }]);
  ins(raw, "data_rules", [{ id: "properties.address_format", entity_type: "properties", name: "Address format", severity: "info", description: "Street not in USPS style", check_kind: "sql", check_sql: "SELECT id FROM properties WHERE street GLOB '*[A-Z][A-Z][A-Z]*'" }]);
  ins(raw, "data_issues", [{ id: "di1", rule_id: "properties.address_format", entity_type: "properties", entity_id: "p02", property_id: "p02", detected_at: "2026-11-01", severity: "info", evidence: '{"street":"123 MAIN STREET."}' }]);
  const m = (p: string, month: string, collected: number, opex: number) => ({ property_id: p, month, units: 100, occupied: 95, gpr_cents: 15000000, charged_cents: 14000000, collected_cents: collected, occupancy_phys: 0.95, occupancy_econ: 0.93, opex_cents: opex, noi_cents: collected - opex });
  ins(raw, "metrics_monthly", [m("p01", "2026-09", 13500000, 6000000), m("p01", "2026-10", 13000000, 7000000), m("p02", "2026-09", 9000000, 4000000), m("p02", "2026-10", 9100000, 4100000)]);
  return { raw, db: sqliteDb(raw) };
}

export const MARCUS: Actor = { personaId: "marcus", name: "Marcus Bell", role: "property_manager", scope: { kind: "property", ids: ["p01", "p02", "p03"], label: "3 Austin properties" }, propertyIds: ["p01", "p02", "p03"] };
export const DANIEL: Actor = { personaId: "daniel", name: "Daniel Reyes", role: "principal", scope: { kind: "org", label: "All" }, propertyIds: "all" };
