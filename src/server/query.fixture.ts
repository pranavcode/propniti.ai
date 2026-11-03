import type { Db } from "@/lib/platform/types";

// Fixture: 6 properties across 3 regions, 3 units each, one lease per occupied unit, a few
// charges and payments, and two months of metrics_monthly. All rows are base rows.
export const WS = "visitor-workspace-000000001";
export const OTHER = "visitor-workspace-000000002";

export function seed(db: Db) {
  const props = [
    ["p01", "The Lofts at Riverside", "Austin", "TX", "r-tx"], ["p02", "Barton Creek Commons", "Austin", "TX", "r-tx"], ["p03", "Mueller Park Residences", "Austin", "TX", "r-tx"],
    ["p04", "Deep Ellum Lofts", "Dallas", "TX", "r-tx"], ["p05", "Inman Park Flats", "Atlanta", "GA", "r-se"], ["p06", "Camelback Terrace", "Phoenix", "AZ", "r-sw"],
  ];
  const sql: string[] = [
    "INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('" + WS + "', 'demo', 0, 0), ('" + OTHER + "', 'demo', 0, 0)",
    "INSERT INTO meta (key, value) VALUES ('as_of', '2026-10-28')",
    "INSERT INTO owners (workspace_id, id, name) VALUES ('base', 'ow01', 'Helen Carter')",
    "INSERT INTO owner_entities (workspace_id, id, org_id, owner_id, name, state) VALUES ('base', 'oe01', 'org1', 'ow01', 'Bluebonnet Residential Fund II, LLC', 'TX'), ('base', 'oe02', 'org1', 'ow02', 'Peach State Holdings, LLC', 'GA')",
  ];
  for (const [id, name, metro, state, region] of props) {
    sql.push(`INSERT INTO properties (workspace_id, id, org_id, region_id, portfolio_id, owner_entity_id, name, type, metro, street, city, state, zip, photos) VALUES ('base', '${id}', 'org1', '${region}', 'pf1', '${state === "TX" ? "oe01" : "oe02"}', '${name}', 'Garden multifamily', '${metro}', '1 Main St', '${metro}', '${state}', '78701', '["/img/props/${id}.webp"]')`);
    for (let n = 1; n <= 3; n++) {
      const unit = `${id}-u${n}`;
      const occupied = n < 3;
      sql.push(`INSERT INTO units (workspace_id, id, property_id, number, sqft, market_rent_cents, status) VALUES ('base', '${unit}', '${id}', '10${n}', 800, 150000, '${occupied ? "Occupied" : "Vacant"}')`);
      if (occupied) {
        sql.push(`INSERT INTO households (workspace_id, id, property_id, name) VALUES ('base', 'h-${unit}', '${id}', 'Household ${unit}')`);
        sql.push(`INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-${unit}', 'h-${unit}', '${id}', 'Res', '${unit}', 'r@x.example')`);
        sql.push(`INSERT INTO leases (workspace_id, id, property_id, unit_id, household_id, status, start_on, end_on, rent_cents) VALUES ('base', 'l-${unit}', '${id}', '${unit}', 'h-${unit}', 'Active', '2026-01-01', '2026-12-31', 145000)`);
        sql.push(`INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents) VALUES ('base', 'c-${unit}', 'l-${unit}', 'h-${unit}', '${id}', '${unit}', 'gl-4000', 'Rent', '2026-10', '2026-10-01', 145000)`);
        if (n === 1) sql.push(`INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, method, received_on, amount_cents) VALUES ('base', 'pay-${unit}', 'l-${unit}', 'h-${unit}', '${id}', 'c-${unit}', 'ACH', '2026-10-02', 145000)`);
      }
    }
    for (const month of ["2026-09", "2026-10"]) {
      sql.push(`INSERT INTO metrics_monthly (workspace_id, property_id, month, units, occupied, gpr_cents, charged_cents, collected_cents, occupancy_phys, occupancy_econ, opex_cents, noi_cents, aging_0_30_cents) VALUES ('base', '${id}', '${month}', 3, ${month === "2026-10" ? 2 : 3}, 450000, 290000, 145000, 0.66, 0.6, 50000, 95000, 145000)`);
    }
  }
  return db.batch(sql.map((s) => db.prepare(s)));
}
