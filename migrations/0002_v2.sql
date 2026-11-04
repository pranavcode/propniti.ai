-- Propniti v2 schema (plan §2). Replaces the 0001 domain; keeps `workspaces`. v2 runs on its own
-- D1 database, so dropping the old tables loses nothing.
--
-- Conventions, shared by every domain table:
--   seq          INTEGER PRIMARY KEY (rowid). Insertion order; owner statements close by seq cutoff.
--   workspace_id 'base' = the shared, read-only generated dataset; a visitor id = that visitor's
--                overlay. Reads go through effective(): overlay rows replace base rows with the
--                same id. 'base' can never match the pn_ws cookie regex, so visitors can't write it.
--   id           Stable text id, UNIQUE (workspace_id, id).
--   deleted      Tombstone. An overlay row with deleted = 1 hides the base row with the same id.
--   *_cents      Money, integer cents. Dates are 'YYYY-MM-DD'; timestamps are ISO-8601 text.
--   JSON         Columns named *_json or documented as JSON hold JSON text.
--
-- Foreign keys: every table cascades from workspaces, so deleting a workspace removes its overlay.
-- References between entities are NOT declared as foreign keys: an overlay row may point at a base
-- row (different workspace_id), which SQLite can't express. They are plain indexed columns marked
-- "-> table.id"; the generator tests and the query layer keep them consistent.

PRAGMA defer_foreign_keys = ON;

DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS audit;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS tenancies;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS users;

-- The overlay is wiped when a workspace's base_version differs from meta.base_version.
ALTER TABLE workspaces ADD COLUMN base_version TEXT;
-- The shared dataset hangs off this row. It never expires and no cookie can name it.
INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('base', 'org', 0, 0);

-- Key/value: base_version, base_hash, generated_at, as_of (the demo's "today").
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =============================================================================================
-- Org
-- =============================================================================================

-- Customer organisations. The demo has one real org; extras exist for the platform-admin view.
CREATE TABLE orgs (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'Enterprise',
  status TEXT NOT NULL DEFAULT 'Active',
  seats INTEGER NOT NULL DEFAULT 0,
  units_managed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);

CREATE TABLE regions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL,                 -- -> orgs.id
  name TEXT NOT NULL,                   -- "Texas", "Southeast", "Southwest"
  states TEXT NOT NULL DEFAULT '[]',    -- JSON array of US state codes
  UNIQUE (workspace_id, id)
);
CREATE INDEX regions_org ON regions (workspace_id, org_id);

-- Owners are the investors; owner_entities are the LLCs that hold title and get statements.
CREATE TABLE owners (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Individual', -- Individual | Fund | Family office | Institution
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  portal_enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id)
);
CREATE INDEX owners_name ON owners (workspace_id, name COLLATE NOCASE);

CREATE TABLE owner_entities (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL,                 -- -> orgs.id
  owner_id TEXT NOT NULL,               -- -> owners.id
  name TEXT NOT NULL,                   -- "Bluebonnet Residential Fund II, LLC"
  ein_last4 TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  mgmt_fee_pct REAL NOT NULL DEFAULT 0.08,   -- informational; money code reads MANAGEMENT_FEE_RATE
  reserve_cents INTEGER NOT NULL DEFAULT 0,  -- operating reserve held back from distributions
  agreement_signed_on TEXT,
  agreement_signed_by TEXT,             -- -> staff.id (a broker signs owner agreements)
  UNIQUE (workspace_id, id)
);
CREATE INDEX owner_entities_owner ON owner_entities (workspace_id, owner_id);

CREATE TABLE portfolios (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL,                 -- -> orgs.id
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id
  name TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX portfolios_entity ON portfolios (workspace_id, owner_entity_id);

-- Trust (operating) and security-deposit accounts per owner entity.
CREATE TABLE bank_accounts (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  owner_entity_id TEXT,                 -- -> owner_entities.id; NULL = the manager's own account
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Trust', 'Deposit', 'Operating')),
  bank TEXT NOT NULL,
  last4 TEXT NOT NULL,
  gl_account_id TEXT,                   -- -> gl_accounts.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX bank_accounts_entity ON bank_accounts (workspace_id, owner_entity_id);

-- Internal people (the 9 internal/platform personas plus the rest of the org).
CREATE TABLE staff (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL,                 -- -> orgs.id
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_active_at TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX staff_org ON staff (workspace_id, org_id);

-- Role × scope (Yardi model). scope_kind/scope_id match ScopeKind in src/entities/types.ts.
CREATE TABLE role_assignments (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  staff_id TEXT NOT NULL,               -- -> staff.id
  role TEXT NOT NULL,                   -- Role
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('platform', 'org', 'region', 'owner_entity', 'portfolio', 'property', 'self')),
  scope_id TEXT,                        -- NULL for platform/org
  UNIQUE (workspace_id, id)
);
CREATE INDEX role_assignments_staff ON role_assignments (workspace_id, staff_id);
CREATE INDEX role_assignments_scope ON role_assignments (workspace_id, scope_kind, scope_id);

-- =============================================================================================
-- Assets
-- =============================================================================================

CREATE TABLE properties (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,                     -- p01..p30 (src/seed/roster.json)
  deleted INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL,                 -- -> orgs.id
  region_id TEXT NOT NULL,              -- -> regions.id
  portfolio_id TEXT NOT NULL,           -- -> portfolios.id
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id
  manager_id TEXT,                      -- -> staff.id
  name TEXT NOT NULL,
  type TEXT NOT NULL,                   -- Multifamily | Small multifamily | Commercial NNN | Single-family portfolio
  class TEXT,                           -- A | B | C
  metro TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  lat REAL,
  lng REAL,
  year_built INTEGER,
  stories INTEGER,
  unit_count INTEGER NOT NULL DEFAULT 0,
  rentable_sqft INTEGER,
  amenities TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  photos TEXT NOT NULL DEFAULT '[]',    -- JSON array of image paths
  acquired_on TEXT,
  status TEXT NOT NULL DEFAULT 'Stabilized', -- Stabilized | Lease-up | Renovation
  UNIQUE (workspace_id, id)
);
CREATE INDEX properties_region ON properties (workspace_id, region_id);
CREATE INDEX properties_entity ON properties (workspace_id, owner_entity_id);
CREATE INDEX properties_portfolio ON properties (workspace_id, portfolio_id);
CREATE INDEX properties_manager ON properties (workspace_id, manager_id);
CREATE INDEX properties_name ON properties (workspace_id, name COLLATE NOCASE);

CREATE TABLE buildings (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  name TEXT NOT NULL,
  floors INTEGER,
  UNIQUE (workspace_id, id)
);
CREATE INDEX buildings_property ON buildings (workspace_id, property_id);

CREATE TABLE unit_types (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  name TEXT NOT NULL,                   -- "A2 · 1 bed"
  beds INTEGER NOT NULL DEFAULT 0,
  baths REAL NOT NULL DEFAULT 1,
  sqft INTEGER NOT NULL,
  market_rent_cents INTEGER NOT NULL DEFAULT 0,
  photos TEXT NOT NULL DEFAULT '[]',    -- JSON
  floorplan_svg TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX unit_types_property ON unit_types (workspace_id, property_id);

CREATE TABLE units (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  building_id TEXT,                     -- -> buildings.id
  unit_type_id TEXT,                    -- -> unit_types.id
  number TEXT NOT NULL,
  floor INTEGER,
  sqft INTEGER NOT NULL DEFAULT 0,
  market_rent_cents INTEGER NOT NULL DEFAULT 0,
  -- Occupied | Vacant | Notice | Make-ready | Down | Model. Physical status; leasing state comes from leases.
  status TEXT NOT NULL DEFAULT 'Vacant',
  available_on TEXT,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, property_id, number)
);
CREATE INDEX units_property ON units (workspace_id, property_id, status);
CREATE INDEX units_type ON units (workspace_id, unit_type_id);

-- Parking spaces and storage units share one table; assignments carry the charge.
CREATE TABLE rentable_items (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  kind TEXT NOT NULL CHECK (kind IN ('Parking', 'Storage')),
  label TEXT NOT NULL,                  -- "P-114", "S-22"
  subtype TEXT NOT NULL DEFAULT '',     -- Covered | Garage | EV | 5x10 ...
  rent_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX rentable_items_property ON rentable_items (workspace_id, property_id, kind);

CREATE TABLE rentable_assignments (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  item_id TEXT NOT NULL,                -- -> rentable_items.id
  lease_id TEXT NOT NULL,               -- -> leases.id
  property_id TEXT NOT NULL,            -- -> properties.id (denormalised for scope)
  start_on TEXT NOT NULL,
  end_on TEXT,
  rent_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX rentable_assignments_item ON rentable_assignments (workspace_id, item_id);
CREATE INDEX rentable_assignments_lease ON rentable_assignments (workspace_id, lease_id);

CREATE TABLE keys (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT,                         -- -> units.id
  label TEXT NOT NULL,                  -- "Master A", "Unit 204 front", "Fob 3381"
  kind TEXT NOT NULL DEFAULT 'Key',     -- Key | Fob | Code
  holder_kind TEXT,                     -- staff | vendor | resident; NULL = in the key box
  holder_id TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX keys_property ON keys (workspace_id, property_id);

CREATE TABLE key_log (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  key_id TEXT NOT NULL,                 -- -> keys.id
  property_id TEXT NOT NULL,            -- -> properties.id
  action TEXT NOT NULL CHECK (action IN ('Checked out', 'Returned', 'Lost', 'Rekeyed')),
  holder_kind TEXT,
  holder_id TEXT,
  work_order_id TEXT,                   -- -> work_orders.id
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX key_log_key ON key_log (workspace_id, key_id, at);

CREATE TABLE inventory_items (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id (the shop that stocks it)
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_at INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX inventory_items_property ON inventory_items (workspace_id, property_id);

-- =============================================================================================
-- People
-- =============================================================================================

CREATE TABLE households (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  name TEXT NOT NULL,                   -- "Nguyen household"
  UNIQUE (workspace_id, id)
);
CREATE INDEX households_property ON households (workspace_id, property_id);

CREATE TABLE residents (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  household_id TEXT NOT NULL,           -- -> households.id
  property_id TEXT NOT NULL,            -- -> properties.id (denormalised for scope)
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,                  -- always @*.example
  phone TEXT NOT NULL DEFAULT '',
  preferred_channel TEXT NOT NULL DEFAULT 'Email', -- Email | SMS | Portal | Phone
  language TEXT NOT NULL DEFAULT 'en',
  is_primary INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Current', -- Current | Notice | Past | Future | Eviction
  autopay INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER,                   -- 0-100 delinquency score, precomputed
  UNIQUE (workspace_id, id)
);
CREATE INDEX residents_household ON residents (workspace_id, household_id);
CREATE INDEX residents_property ON residents (workspace_id, property_id, status);
CREATE INDEX residents_name ON residents (workspace_id, last_name COLLATE NOCASE, first_name COLLATE NOCASE);

CREATE TABLE vendors (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  company TEXT NOT NULL,
  trade TEXT NOT NULL,                  -- Plumbing | HVAC | Electrical | Landscaping | Turn | ...
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  metros TEXT NOT NULL DEFAULT '[]',    -- JSON array
  w9_on_file INTEGER NOT NULL DEFAULT 0,
  tin_last4 TEXT NOT NULL DEFAULT '',
  is_1099 INTEGER NOT NULL DEFAULT 1,
  bank_last4 TEXT NOT NULL DEFAULT '',
  bank_changed_at TEXT,                 -- recent bank-detail change = fraud flag for AP review
  rating REAL,
  status TEXT NOT NULL DEFAULT 'Active', -- Active | Inactive | Do not use
  UNIQUE (workspace_id, id)
);
CREATE INDEX vendors_trade ON vendors (workspace_id, trade);
CREATE INDEX vendors_company ON vendors (workspace_id, company COLLATE NOCASE);

-- Applicants are people; applications tie them to a unit. Prospects are earlier-funnel leads.
CREATE TABLE prospects (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',      -- Zillow | Apartments.com | Website | Walk-in | Referral
  stage TEXT NOT NULL DEFAULT 'Inquiry', -- Inquiry | Contacted | Tour scheduled | Toured | Applied | Leased | Lost
  desired_beds INTEGER,
  desired_move_in TEXT,
  budget_cents INTEGER,
  assigned_to TEXT,                     -- -> staff.id (leasing agent)
  last_contact_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX prospects_property ON prospects (workspace_id, property_id, stage);
CREATE INDEX prospects_agent ON prospects (workspace_id, assigned_to);

CREATE TABLE applicants (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  prospect_id TEXT,                     -- -> prospects.id
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  monthly_income_cents INTEGER,
  employer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX applicants_prospect ON applicants (workspace_id, prospect_id);

-- =============================================================================================
-- Leasing and marketing
-- =============================================================================================

CREATE TABLE listings (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT NOT NULL,                -- -> units.id
  headline TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rent_cents INTEGER NOT NULL,
  available_on TEXT,
  status TEXT NOT NULL DEFAULT 'Active', -- Draft | Active | Paused | Leased
  syndication TEXT NOT NULL DEFAULT '{}', -- JSON {zillow: "Live", apartments: "Pending", ...}
  photos TEXT NOT NULL DEFAULT '[]',    -- JSON
  views INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  listed_on TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX listings_property ON listings (workspace_id, property_id, status);
CREATE INDEX listings_unit ON listings (workspace_id, unit_id);

CREATE TABLE listing_price_history (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  listing_id TEXT NOT NULL,             -- -> listings.id
  property_id TEXT NOT NULL,            -- -> properties.id
  rent_cents INTEGER NOT NULL,
  changed_on TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id)
);
CREATE INDEX listing_price_history_listing ON listing_price_history (workspace_id, listing_id, changed_on);

CREATE TABLE showings (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT,                         -- -> units.id
  prospect_id TEXT NOT NULL,            -- -> prospects.id
  agent_id TEXT,                        -- -> staff.id
  kind TEXT NOT NULL DEFAULT 'In person', -- In person | Self-guided | Virtual
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled', -- Scheduled | Completed | No-show | Cancelled
  feedback TEXT NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id)
);
CREATE INDEX showings_property ON showings (workspace_id, property_id, scheduled_at);
CREATE INDEX showings_prospect ON showings (workspace_id, prospect_id);
CREATE INDEX showings_agent ON showings (workspace_id, agent_id, scheduled_at);

CREATE TABLE applications (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT NOT NULL,                -- -> units.id
  listing_id TEXT,                      -- -> listings.id
  applicant_id TEXT NOT NULL,           -- -> applicants.id (primary)
  co_applicants TEXT NOT NULL DEFAULT '[]', -- JSON array of applicants.id
  -- Started | Submitted | Screening | Review | Approved | Conditional | Denied | Withdrawn | Leased
  stage TEXT NOT NULL DEFAULT 'Submitted',
  desired_move_in TEXT,
  rent_cents INTEGER,
  income_to_rent REAL,
  score INTEGER,                        -- 0-100 applicant score
  scoring_factors TEXT NOT NULL DEFAULT '[]', -- JSON [{factor, direction: "+"|"-", weight, detail}]
  recommendation TEXT,                  -- Approve | Conditional | Deny (rules + AI, a person decides)
  decided_by TEXT,                      -- -> staff.id (broker or manager)
  decided_at TEXT,
  fee_paid INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX applications_property ON applications (workspace_id, property_id, stage);
CREATE INDEX applications_applicant ON applications (workspace_id, applicant_id);
CREATE INDEX applications_unit ON applications (workspace_id, unit_id);

-- Summary-level screening outcome only: no SSNs, DOBs, report bodies or other real PII patterns.
CREATE TABLE screening_results (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  application_id TEXT NOT NULL,         -- -> applications.id
  applicant_id TEXT NOT NULL,           -- -> applicants.id
  property_id TEXT NOT NULL,            -- -> properties.id
  provider TEXT NOT NULL DEFAULT 'Sample Screening Co.',
  credit_band TEXT,                     -- Excellent | Good | Fair | Thin file | Poor
  score INTEGER,
  eviction_found INTEGER NOT NULL DEFAULT 0,
  criminal_flag INTEGER NOT NULL DEFAULT 0,
  income_verified INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,               -- Pass | Conditional | Fail
  completed_at TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX screening_results_application ON screening_results (workspace_id, application_id);

CREATE TABLE leases (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT NOT NULL,                -- -> units.id
  household_id TEXT NOT NULL,           -- -> households.id (commercial: the tenant company)
  application_id TEXT,                  -- -> applications.id
  renewal_of TEXT,                      -- -> leases.id
  kind TEXT NOT NULL DEFAULT 'Residential' CHECK (kind IN ('Residential', 'Commercial')),
  -- Future | Active | Notice | Month-to-month | Expired | Terminated | Eviction
  status TEXT NOT NULL,
  start_on TEXT NOT NULL,
  end_on TEXT,
  move_in_on TEXT,
  move_out_on TEXT,
  notice_on TEXT,
  term_months INTEGER,
  rent_cents INTEGER NOT NULL CHECK (rent_cents >= 0),
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  escalations TEXT NOT NULL DEFAULT '[]', -- JSON [{on, pct | amount_cents}]
  -- Commercial NNN: pro-rata share and estimated monthly CAM/tax/insurance recoveries.
  nnn_share_pct REAL,
  cam_cents INTEGER,
  tax_cents INTEGER,
  insurance_cents INTEGER,
  signed_by TEXT,                       -- -> staff.id
  signed_at TEXT,
  document_id TEXT,                     -- -> documents.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX leases_property ON leases (workspace_id, property_id, status);
CREATE INDEX leases_unit ON leases (workspace_id, unit_id);
CREATE INDEX leases_household ON leases (workspace_id, household_id);
CREATE INDEX leases_end ON leases (workspace_id, end_on);

CREATE TABLE recurring_charges (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  property_id TEXT NOT NULL,            -- -> properties.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  label TEXT NOT NULL,                  -- Rent | Parking | Pet rent | RUBS water | CAM
  amount_cents INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'Monthly',
  start_on TEXT NOT NULL,
  end_on TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX recurring_charges_lease ON recurring_charges (workspace_id, lease_id);

CREATE TABLE concessions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  lease_id TEXT,                        -- -> leases.id; NULL = a property-wide special
  label TEXT NOT NULL,                  -- "6 weeks free", "$500 off first month"
  amount_cents INTEGER NOT NULL,
  months TEXT NOT NULL DEFAULT '[]',    -- JSON array of 'YYYY-MM' the credit applies to
  approved_by TEXT,                     -- -> staff.id (regional approves concessions)
  status TEXT NOT NULL DEFAULT 'Active', -- Proposed | Active | Expired
  UNIQUE (workspace_id, id)
);
CREATE INDEX concessions_property ON concessions (workspace_id, property_id);
CREATE INDEX concessions_lease ON concessions (workspace_id, lease_id);

CREATE TABLE renewal_offers (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  property_id TEXT NOT NULL,            -- -> properties.id
  version INTEGER NOT NULL DEFAULT 1,   -- each counter-offer is a new row; history is all rows
  term_months INTEGER NOT NULL,
  rent_cents INTEGER NOT NULL,
  current_rent_cents INTEGER NOT NULL,
  market_rent_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Sent | Countered | Accepted | Declined | Expired
  sent_at TEXT,
  responded_at TEXT,
  expires_on TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX renewal_offers_lease ON renewal_offers (workspace_id, lease_id, version);
CREATE INDEX renewal_offers_property ON renewal_offers (workspace_id, property_id, status);

CREATE TABLE renters_insurance (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  property_id TEXT NOT NULL,            -- -> properties.id
  carrier TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  liability_cents INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active', -- Active | Expiring | Lapsed | Waived
  UNIQUE (workspace_id, id)
);
CREATE INDEX renters_insurance_lease ON renters_insurance (workspace_id, lease_id);
CREATE INDEX renters_insurance_expiry ON renters_insurance (workspace_id, expires_on);

-- Security deposits held, and how each is returned or applied at move-out.
CREATE TABLE deposits (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  property_id TEXT NOT NULL,            -- -> properties.id
  bank_account_id TEXT NOT NULL,        -- -> bank_accounts.id (Deposit kind)
  amount_cents INTEGER NOT NULL,
  received_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Held',  -- Held | Disposition due | Settled
  UNIQUE (workspace_id, id)
);
CREATE INDEX deposits_lease ON deposits (workspace_id, lease_id);

CREATE TABLE deposit_dispositions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deposit_id TEXT NOT NULL,             -- -> deposits.id
  property_id TEXT NOT NULL,            -- -> properties.id
  deductions TEXT NOT NULL DEFAULT '[]', -- JSON [{label, amount_cents, photo}]
  refund_cents INTEGER NOT NULL,
  due_on TEXT NOT NULL,                 -- state_rules deadline after move-out
  sent_on TEXT,
  status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Sent | Disputed
  UNIQUE (workspace_id, id)
);
CREATE INDEX deposit_dispositions_deposit ON deposit_dispositions (workspace_id, deposit_id);

-- =============================================================================================
-- Ledger. History is base; new money rows enter the overlay only through src/server/money.ts.
-- =============================================================================================

CREATE TABLE gl_accounts (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  number TEXT NOT NULL,                 -- "4000"
  name TEXT NOT NULL,                   -- "Rental income"
  type TEXT NOT NULL CHECK (type IN ('Asset', 'Liability', 'Equity', 'Income', 'Expense')),
  parent_id TEXT,                       -- -> gl_accounts.id
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number)
);

CREATE TABLE charges (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  household_id TEXT NOT NULL,           -- -> households.id
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT NOT NULL,                -- -> units.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  description TEXT NOT NULL,
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  due_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  -- Paid / Processing / Due / Overdue is derived (payments and live rent:<id> transfers), never stored.
  UNIQUE (workspace_id, id)
);
CREATE INDEX charges_lease ON charges (workspace_id, lease_id, due_on);
CREATE INDEX charges_property ON charges (workspace_id, property_id, period);
CREATE INDEX charges_household ON charges (workspace_id, household_id);

CREATE TABLE payments (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  household_id TEXT NOT NULL,           -- -> households.id
  property_id TEXT NOT NULL,            -- -> properties.id
  charge_id TEXT,                       -- -> charges.id (NULL = unapplied / on account)
  transfer_id TEXT,                     -- -> transfers.id (the money movement into trust)
  method TEXT NOT NULL,                 -- ACH | Card | Check | Money order | Cash
  reference TEXT NOT NULL DEFAULT '',
  received_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  nsf INTEGER NOT NULL DEFAULT 0,       -- returned unpaid
  UNIQUE (workspace_id, id)
);
CREATE INDEX payments_lease ON payments (workspace_id, lease_id, received_on);
CREATE INDEX payments_property ON payments (workspace_id, property_id, received_on);
CREATE INDEX payments_charge ON payments (workspace_id, charge_id);

CREATE TABLE credits (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL,               -- -> leases.id
  property_id TEXT NOT NULL,            -- -> properties.id
  charge_id TEXT,                       -- -> charges.id
  kind TEXT NOT NULL CHECK (kind IN ('Concession', 'Credit', 'Write-off')),
  description TEXT NOT NULL,
  on_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  approved_by TEXT,                     -- -> staff.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX credits_lease ON credits (workspace_id, lease_id);
CREATE INDEX credits_property ON credits (workspace_id, property_id, on_date);

-- Money through bank accounts (0001 semantics). Append-only: no deleted column, rows are never
-- edited except Pending -> Cleared/Returned on overlay rows. Parties are polymorphic, so no references.
-- Owner statements close by period cutoff: open items for an entity are rows with seq greater
-- than that entity's latest Owner payout. There is no `statement` column to update.
CREATE TABLE transfers (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  key TEXT NOT NULL,                    -- idempotency key: rent:<charge>, vendor:<bill>, owner:<idem>, latefee:<lease>:<yyyymm>
  kind TEXT NOT NULL CHECK (kind IN ('Rent', 'Management fee', 'Vendor payout', 'Owner payout', 'Deposit', 'Deposit refund', 'Other receipt')),
  bank_account_id TEXT NOT NULL,        -- -> bank_accounts.id (the trust or deposit account it moves through)
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  property_id TEXT NOT NULL,            -- -> properties.id
  ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Cleared', 'Returned')),
  created TEXT NOT NULL,
  settles_at INTEGER,
  cleared TEXT,
  UNIQUE (workspace_id, id)
);
-- One live transfer per idempotency key: a double click or retry can never move money twice.
-- Guards also check NOT EXISTS (… workspace_id = 'base' AND key = ?) for base-history keys.
CREATE UNIQUE INDEX transfers_live_key ON transfers (workspace_id, key) WHERE status <> 'Returned';
CREATE INDEX transfers_due ON transfers (workspace_id, status, settles_at);
CREATE INDEX transfers_account ON transfers (workspace_id, bank_account_id, status);
CREATE INDEX transfers_entity ON transfers (workspace_id, owner_entity_id, seq);
CREATE INDEX transfers_property ON transfers (workspace_id, property_id, seq);
CREATE INDEX transfers_to ON transfers (workspace_id, to_id, kind);
CREATE INDEX transfers_from ON transfers (workspace_id, from_id, kind);

-- Cleared balance per bank account across all base transfers, written by the generator.
-- Available = this constant + the overlay transfer sum for the account (money.ts guard).
CREATE TABLE base_balances (
  account_id TEXT PRIMARY KEY,          -- -> bank_accounts.id
  cleared_cents INTEGER NOT NULL
);

CREATE TABLE purchase_orders (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  vendor_id TEXT NOT NULL,              -- -> vendors.id
  work_order_id TEXT,                   -- -> work_orders.id
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',  -- Draft | Open | Partially billed | Closed | Cancelled
  total_cents INTEGER NOT NULL DEFAULT 0,
  issued_on TEXT NOT NULL,
  approved_by TEXT,                     -- -> staff.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX purchase_orders_property ON purchase_orders (workspace_id, property_id, status);
CREATE INDEX purchase_orders_vendor ON purchase_orders (workspace_id, vendor_id);
CREATE INDEX purchase_orders_wo ON purchase_orders (workspace_id, work_order_id);

CREATE TABLE po_lines (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  po_id TEXT NOT NULL,                  -- -> purchase_orders.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX po_lines_po ON po_lines (workspace_id, po_id);

CREATE TABLE bills (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id
  vendor_id TEXT NOT NULL,              -- -> vendors.id
  work_order_id TEXT,                   -- -> work_orders.id
  po_id TEXT,                           -- -> purchase_orders.id
  recurring_bill_id TEXT,               -- -> recurring_bills.id
  document_id TEXT,                     -- -> documents.id (scanned invoice)
  invoice_number TEXT NOT NULL,
  bill_date TEXT NOT NULL,
  due_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  -- Draft | Pending approval | Approved | Scheduled | Paid | Void. Paid comes from a live vendor:<id> transfer.
  status TEXT NOT NULL,
  approved_by TEXT,                     -- -> staff.id
  approved_at TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX bills_property ON bills (workspace_id, property_id, status);
CREATE INDEX bills_vendor ON bills (workspace_id, vendor_id, bill_date);
CREATE INDEX bills_due ON bills (workspace_id, status, due_on);
CREATE INDEX bills_wo ON bills (workspace_id, work_order_id);

CREATE TABLE bill_lines (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  bill_id TEXT NOT NULL,                -- -> bills.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX bill_lines_bill ON bill_lines (workspace_id, bill_id);

CREATE TABLE recurring_bills (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  vendor_id TEXT NOT NULL,              -- -> vendors.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  description TEXT NOT NULL,            -- "Landscaping contract", "Trash service"
  amount_cents INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'Monthly',
  day_of_month INTEGER NOT NULL DEFAULT 1,
  next_on TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id)
);
CREATE INDEX recurring_bills_property ON recurring_bills (workspace_id, property_id);
CREATE INDEX recurring_bills_vendor ON recurring_bills (workspace_id, vendor_id);

CREATE TABLE owner_distributions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id
  transfer_id TEXT NOT NULL,            -- -> transfers.id (the Owner payout)
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  income_cents INTEGER NOT NULL,
  expense_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  reserve_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX owner_distributions_entity ON owner_distributions (workspace_id, owner_entity_id, period);

-- Monthly summary per property × GL account (not every posting).
CREATE TABLE journal_entries (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id)
);
CREATE INDEX journal_entries_property ON journal_entries (workspace_id, property_id, period);
CREATE INDEX journal_entries_account ON journal_entries (workspace_id, gl_account_id, period);

CREATE TABLE budgets (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Approved', -- Draft | Submitted | Approved
  approved_by TEXT,                     -- -> staff.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX budgets_property ON budgets (workspace_id, property_id, year);

CREATE TABLE budget_lines (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  budget_id TEXT NOT NULL,              -- -> budgets.id
  property_id TEXT NOT NULL,            -- -> properties.id
  gl_account_id TEXT NOT NULL,          -- -> gl_accounts.id
  period TEXT NOT NULL,                 -- 'YYYY-MM'; budget vs actual joins journal_entries on these three
  amount_cents INTEGER NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX budget_lines_budget ON budget_lines (workspace_id, budget_id);
CREATE INDEX budget_lines_property ON budget_lines (workspace_id, property_id, period, gl_account_id);

CREATE TABLE capex_projects (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  vendor_id TEXT,                       -- -> vendors.id
  name TEXT NOT NULL,                   -- "Roof replacement, building B"
  category TEXT NOT NULL DEFAULT '',
  budget_cents INTEGER NOT NULL,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Planned', -- Planned | Approved | In progress | Complete | On hold
  start_on TEXT,
  target_on TEXT,
  milestones TEXT NOT NULL DEFAULT '[]', -- JSON [{name, due_on, done_on, pct}]
  UNIQUE (workspace_id, id)
);
CREATE INDEX capex_projects_property ON capex_projects (workspace_id, property_id, status);

-- Bank feed lines, matched to transfers during reconciliation.
CREATE TABLE bank_transactions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  bank_account_id TEXT NOT NULL,        -- -> bank_accounts.id
  posted_on TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,        -- signed: + deposit, - withdrawal
  transfer_id TEXT,                     -- -> transfers.id once matched
  UNIQUE (workspace_id, id)
);
CREATE INDEX bank_transactions_account ON bank_transactions (workspace_id, bank_account_id, posted_on);
CREATE INDEX bank_transactions_transfer ON bank_transactions (workspace_id, transfer_id);

CREATE TABLE bank_reconciliations (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  bank_account_id TEXT NOT NULL,        -- -> bank_accounts.id
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  statement_balance_cents INTEGER NOT NULL,
  book_balance_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',  -- Open | Balanced | Approved
  completed_by TEXT,                    -- -> staff.id
  completed_at TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX bank_reconciliations_account ON bank_reconciliations (workspace_id, bank_account_id, period);

CREATE TABLE reconciliation_items (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  reconciliation_id TEXT NOT NULL,      -- -> bank_reconciliations.id
  bank_transaction_id TEXT,             -- -> bank_transactions.id
  transfer_id TEXT,                     -- -> transfers.id
  status TEXT NOT NULL,                 -- Matched | Suggested | Unmatched | Excluded
  confidence REAL,                      -- for AI-suggested matches
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id)
);
CREATE INDEX reconciliation_items_rec ON reconciliation_items (workspace_id, reconciliation_id, status);

CREATE TABLE vendor_1099s (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  vendor_id TEXT NOT NULL,              -- -> vendors.id
  owner_entity_id TEXT NOT NULL,        -- -> owner_entities.id (the payer)
  year INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Ready | Filed | Corrected
  filed_on TEXT,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, vendor_id, owner_entity_id, year)
);
CREATE INDEX vendor_1099s_year ON vendor_1099s (workspace_id, year);

CREATE TABLE late_fee_policies (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT,                     -- -> properties.id; NULL = org default
  grace_days INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Flat', 'Percent', 'Flat + daily')),
  flat_cents INTEGER NOT NULL DEFAULT 0,
  pct REAL NOT NULL DEFAULT 0,
  daily_cents INTEGER NOT NULL DEFAULT 0,
  max_cents INTEGER,                    -- capped further by state_rules
  UNIQUE (workspace_id, id)
);
CREATE INDEX late_fee_policies_property ON late_fee_policies (workspace_id, property_id);

CREATE TABLE utility_meters (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT,                         -- -> units.id; NULL = master meter (RUBS allocates it)
  utility TEXT NOT NULL,                -- Water | Electric | Gas | Trash | Sewer
  meter_number TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id)
);
CREATE INDEX utility_meters_property ON utility_meters (workspace_id, property_id, utility);

CREATE TABLE meter_readings (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  meter_id TEXT NOT NULL,               -- -> utility_meters.id
  property_id TEXT NOT NULL,            -- -> properties.id
  read_on TEXT NOT NULL,
  reading REAL NOT NULL,
  usage REAL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX meter_readings_meter ON meter_readings (workspace_id, meter_id, read_on);

CREATE TABLE utility_bills (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  meter_id TEXT,                        -- -> utility_meters.id
  bill_id TEXT,                         -- -> bills.id (the AP bill that paid it)
  utility TEXT NOT NULL,
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  usage REAL,
  amount_cents INTEGER NOT NULL,
  rubs_method TEXT,                     -- Occupants | Sqft | Units | NULL = not billed back
  recovered_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX utility_bills_property ON utility_bills (workspace_id, property_id, period);

-- =============================================================================================
-- Operations
-- =============================================================================================

CREATE TABLE pm_schedules (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  name TEXT NOT NULL,                   -- "HVAC filter change", "Fire extinguisher check"
  category TEXT NOT NULL,
  frequency TEXT NOT NULL,              -- Monthly | Quarterly | Semiannual | Annual
  next_due_on TEXT NOT NULL,
  vendor_id TEXT,                       -- -> vendors.id
  assignee_id TEXT,                     -- -> staff.id
  checklist TEXT NOT NULL DEFAULT '[]', -- JSON array of steps
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id)
);
CREATE INDEX pm_schedules_property ON pm_schedules (workspace_id, property_id, next_due_on);

-- Preventive schedules generate work orders (source = 'Preventive', pm_schedule_id set).
CREATE TABLE work_orders (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,                     -- "WO-10482"
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT,                         -- -> units.id; NULL = common area
  service_request_id TEXT,              -- -> service_requests.id
  pm_schedule_id TEXT,                  -- -> pm_schedules.id
  turnover_id TEXT,                     -- -> turnovers.id
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,               -- Plumbing | HVAC | Electrical | Appliance | General | ...
  priority TEXT NOT NULL CHECK (priority IN ('Emergency', 'Urgent', 'Normal', 'Low')),
  source TEXT NOT NULL DEFAULT 'Resident', -- Resident | Staff | Inspection | Preventive | Turnover
  -- New | Triaged | Assigned | Scheduled | In progress | On hold | Submitted | Completed | Paid | Cancelled
  status TEXT NOT NULL,
  vendor_id TEXT,                       -- -> vendors.id; NULL = in-house
  assignee_id TEXT,                     -- -> staff.id (technician)
  estimate_cents INTEGER,
  cost_cents INTEGER,
  sla_due_at TEXT,
  opened_at TEXT NOT NULL,
  scheduled_at TEXT,
  completed_at TEXT,
  permission_to_enter INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id)
);
CREATE INDEX work_orders_property ON work_orders (workspace_id, property_id, status);
CREATE INDEX work_orders_unit ON work_orders (workspace_id, unit_id);
CREATE INDEX work_orders_vendor ON work_orders (workspace_id, vendor_id);
CREATE INDEX work_orders_assignee ON work_orders (workspace_id, assignee_id, status);
CREATE INDEX work_orders_sla ON work_orders (workspace_id, status, sla_due_at);
CREATE INDEX work_orders_schedule ON work_orders (workspace_id, pm_schedule_id);

-- Status changes and decisions on a work order. Base rows never change status; overlay events do.
CREATE TABLE wo_events (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  work_order_id TEXT NOT NULL,          -- -> work_orders.id
  property_id TEXT NOT NULL,            -- -> properties.id
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,             -- staff | vendor | resident | agent
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- Status | Assigned | Note | Submission | Validation | Approval
  status TEXT,                          -- new status when kind = 'Status'
  detail TEXT NOT NULL DEFAULT '{}',    -- JSON (submission lines, validation result, ...)
  UNIQUE (workspace_id, id)
);
CREATE INDEX wo_events_wo ON wo_events (workspace_id, work_order_id, at);

-- Photos on work orders and inspections, with the AI photo-check result.
CREATE TABLE photos (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,            -- work_orders | inspection_items | turnovers | deposit_dispositions
  entity_id TEXT NOT NULL,
  property_id TEXT NOT NULL,            -- -> properties.id
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  stage TEXT,                           -- Before | After | Evidence
  taken_at TEXT,
  check_result TEXT,                    -- Matches | Mismatch | Unclear (AI photo check)
  check_confidence REAL,
  check_note TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX photos_entity ON photos (workspace_id, entity_type, entity_id);

CREATE TABLE turnovers (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT NOT NULL,                -- -> units.id
  lease_id TEXT,                        -- -> leases.id (the lease that ended)
  move_out_on TEXT NOT NULL,
  target_ready_on TEXT NOT NULL,
  ready_on TEXT,
  status TEXT NOT NULL DEFAULT 'Not started', -- Not started | In progress | Ready | Leased
  checklist TEXT NOT NULL DEFAULT '[]', -- JSON [{step, done, by}]
  vendor_id TEXT,                       -- -> vendors.id
  cost_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX turnovers_property ON turnovers (workspace_id, property_id, status);
CREATE INDEX turnovers_unit ON turnovers (workspace_id, unit_id);

CREATE TABLE inspections (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT,                         -- -> units.id
  kind TEXT NOT NULL,                   -- Move-in | Move-out | Annual | Quarterly | Safety | Insurance
  scheduled_on TEXT NOT NULL,
  completed_on TEXT,
  inspector_id TEXT,                    -- -> staff.id
  status TEXT NOT NULL DEFAULT 'Scheduled', -- Scheduled | In progress | Completed | Failed
  score INTEGER,
  UNIQUE (workspace_id, id)
);
CREATE INDEX inspections_property ON inspections (workspace_id, property_id, scheduled_on);
CREATE INDEX inspections_unit ON inspections (workspace_id, unit_id);

CREATE TABLE inspection_items (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  inspection_id TEXT NOT NULL,          -- -> inspections.id
  property_id TEXT NOT NULL,            -- -> properties.id
  area TEXT NOT NULL,                   -- Kitchen | Bath | Living | Exterior ...
  item TEXT NOT NULL,
  condition TEXT NOT NULL,              -- Good | Fair | Damaged | Missing | N/A
  note TEXT NOT NULL DEFAULT '',
  work_order_id TEXT,                   -- -> work_orders.id when a defect raised one
  UNIQUE (workspace_id, id)
);
CREATE INDEX inspection_items_inspection ON inspection_items (workspace_id, inspection_id);

-- kind and the classification fields come from AI auto-classification (doc_type, confidence, filed_to).
CREATE TABLE documents (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT,                     -- -> properties.id
  entity_type TEXT,                     -- the record it is filed to (polymorphic)
  entity_id TEXT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  doc_type TEXT,                        -- Lease | Invoice | W-9 | COI | Notice | Inspection report | ...
  classify_confidence REAL,
  filed_to TEXT,                        -- human-readable destination, e.g. "Lease L-2041 › Documents"
  classified_by TEXT,                   -- agent key or staff id
  extracted TEXT,                       -- JSON fields from abstraction / invoice reading
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX documents_entity ON documents (workspace_id, entity_type, entity_id);
CREATE INDEX documents_property ON documents (workspace_id, property_id, doc_type);

-- Resident requests from the portal; triage turns them into work orders.
CREATE TABLE service_requests (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  unit_id TEXT,                         -- -> units.id
  resident_id TEXT NOT NULL,            -- -> residents.id
  body TEXT NOT NULL,
  category TEXT,                        -- triage result
  urgency TEXT,                         -- triage result
  status TEXT NOT NULL DEFAULT 'New',   -- New | Triaged | Converted | Closed
  work_order_id TEXT,                   -- -> work_orders.id
  submitted_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX service_requests_property ON service_requests (workspace_id, property_id, status);
CREATE INDEX service_requests_resident ON service_requests (workspace_id, resident_id);

CREATE TABLE ratings (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  by_kind TEXT NOT NULL,                -- resident | staff
  by_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,           -- work_orders | vendors | staff | properties
  subject_id TEXT NOT NULL,
  property_id TEXT,                     -- -> properties.id
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX ratings_subject ON ratings (workspace_id, subject_kind, subject_id);

-- =============================================================================================
-- Communications
-- =============================================================================================

CREATE TABLE message_threads (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT,                     -- -> properties.id
  party_kind TEXT NOT NULL CHECK (party_kind IN ('resident', 'vendor', 'owner', 'applicant', 'prospect')),
  party_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  entity_type TEXT,                     -- what it's about (polymorphic), e.g. work_orders
  entity_id TEXT,
  assigned_to TEXT,                     -- -> staff.id
  status TEXT NOT NULL DEFAULT 'Open',  -- Open | Waiting | Closed
  last_message_at TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX message_threads_party ON message_threads (workspace_id, party_kind, party_id);
CREATE INDEX message_threads_property ON message_threads (workspace_id, property_id, last_message_at);
CREATE INDEX message_threads_assignee ON message_threads (workspace_id, assigned_to, status);

CREATE TABLE messages (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT NOT NULL,              -- -> message_threads.id
  channel TEXT NOT NULL,                -- Email | SMS | Portal | Phone | Letter
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender_kind TEXT NOT NULL,            -- staff | resident | vendor | owner | agent
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  template_id TEXT,                     -- -> templates.id
  drafted_by_agent TEXT,                -- AgentKey when an agent drafted it
  sent_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX messages_thread ON messages (workspace_id, thread_id, sent_at);

CREATE TABLE templates (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  category TEXT NOT NULL,               -- Collections | Renewals | Maintenance | Leasing | Notices
  language TEXT NOT NULL DEFAULT 'en',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,                   -- {{merge_fields}}
  UNIQUE (workspace_id, id)
);

CREATE TABLE announcements (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT '{}',  -- JSON {property_ids, kinds: ["resident"], ...}
  channels TEXT NOT NULL DEFAULT '[]',  -- JSON
  status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Scheduled | Sent
  send_at TEXT,
  recipients INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,                      -- -> staff.id
  UNIQUE (workspace_id, id)
);

-- =============================================================================================
-- Risk and compliance
-- =============================================================================================

CREATE TABLE insurance_policies (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  kind TEXT NOT NULL,                   -- Property | General liability | Umbrella | Flood
  carrier TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  coverage_cents INTEGER NOT NULL,
  premium_cents INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX insurance_policies_property ON insurance_policies (workspace_id, property_id);
CREATE INDEX insurance_policies_expiry ON insurance_policies (workspace_id, expires_on);

CREATE TABLE vendor_cois (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  vendor_id TEXT NOT NULL,              -- -> vendors.id
  document_id TEXT,                     -- -> documents.id
  carrier TEXT NOT NULL,
  gl_limit_cents INTEGER NOT NULL,
  workers_comp INTEGER NOT NULL DEFAULT 0,
  expires_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Valid', -- Valid | Expiring | Expired | Missing
  UNIQUE (workspace_id, id)
);
CREATE INDEX vendor_cois_vendor ON vendor_cois (workspace_id, vendor_id);
CREATE INDEX vendor_cois_expiry ON vendor_cois (workspace_id, expires_on);

CREATE TABLE compliance_items (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT,                     -- -> properties.id; NULL = org-wide (e.g. training)
  staff_id TEXT,                        -- -> staff.id for training items
  kind TEXT NOT NULL,                   -- Permit | Elevator cert | Fire inspection | Fair housing training | Pool license | ...
  title TEXT NOT NULL,
  due_on TEXT NOT NULL,
  completed_on TEXT,
  status TEXT NOT NULL DEFAULT 'Open',  -- Open | Due soon | Overdue | Done
  document_id TEXT,                     -- -> documents.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX compliance_items_property ON compliance_items (workspace_id, property_id, due_on);
CREATE INDEX compliance_items_due ON compliance_items (workspace_id, status, due_on);

CREATE TABLE legal_cases (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  property_id TEXT NOT NULL,            -- -> properties.id
  lease_id TEXT,                        -- -> leases.id
  kind TEXT NOT NULL DEFAULT 'Eviction', -- Eviction | Small claims | Fair housing complaint | Other
  stage TEXT NOT NULL,                  -- Notice served | Filed | Hearing set | Judgment | Writ | Closed
  balance_cents INTEGER NOT NULL DEFAULT 0,
  attorney TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  next_date TEXT,
  opened_on TEXT NOT NULL,
  closed_on TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX legal_cases_property ON legal_cases (workspace_id, property_id, stage);
CREATE INDEX legal_cases_lease ON legal_cases (workspace_id, lease_id);

-- Per owner entity (or org default) limits; above a threshold a person must approve.
CREATE TABLE approval_policies (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  owner_entity_id TEXT,                 -- -> owner_entities.id; NULL = org default
  category TEXT NOT NULL CHECK (category IN ('Maintenance spend', 'Bill payment', 'Concession', 'Write-off', 'Legal', 'Safety', 'Owner distribution')),
  limit_cents INTEGER,                  -- auto-approve up to this; NULL = always a person
  approver_role TEXT NOT NULL,          -- Role that must approve above the limit
  owner_approval_over_cents INTEGER,    -- above this the owner approves in their portal
  always_human INTEGER NOT NULL DEFAULT 0, -- legal/safety: never automated
  UNIQUE (workspace_id, id)
);
CREATE INDEX approval_policies_entity ON approval_policies (workspace_id, owner_entity_id, category);

-- US state rules. Each edit is a new row with a later effective_from; history is every row.
CREATE TABLE state_rules (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,                  -- 'TX', 'GA', 'AZ'
  rule TEXT NOT NULL,                   -- late_fee_cap_pct | late_fee_cap_cents | grace_days | deposit_max_months | deposit_return_days | notice_days
  value TEXT NOT NULL,                  -- numeric or JSON
  note TEXT NOT NULL DEFAULT '',        -- citation / plain-English summary
  effective_from TEXT NOT NULL,
  changed_by TEXT,                      -- -> staff.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX state_rules_state ON state_rules (workspace_id, state, rule, effective_from);

-- =============================================================================================
-- Automation
-- =============================================================================================

-- A rule is one trigger → conditions → action; a workflow has several steps (steps JSON).
CREATE TABLE automation_rules (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Rule' CHECK (kind IN ('Rule', 'Workflow')),
  trigger_spec TEXT NOT NULL,           -- JSON {event: "charge.overdue", entity, schedule}
  conditions TEXT NOT NULL DEFAULT '[]', -- JSON [{field, op, value}]
  action TEXT NOT NULL,                 -- JSON {action: ActionKey, params}
  steps TEXT NOT NULL DEFAULT '[]',     -- JSON, workflows only
  agent TEXT,                           -- AgentKey that runs it, if any
  enabled INTEGER NOT NULL DEFAULT 1,
  scope_kind TEXT,                      -- ScopeKind
  scope_id TEXT,
  created_by TEXT,                      -- -> staff.id
  UNIQUE (workspace_id, id)
);

CREATE TABLE automation_runs (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rule_id TEXT NOT NULL,                -- -> automation_rules.id
  started_at TEXT NOT NULL,
  status TEXT NOT NULL,                 -- Succeeded | Failed | Skipped | Needs approval
  entity_type TEXT,
  entity_id TEXT,
  property_id TEXT,                     -- -> properties.id
  detail TEXT NOT NULL DEFAULT '{}',    -- JSON
  UNIQUE (workspace_id, id)
);
CREATE INDEX automation_runs_rule ON automation_runs (workspace_id, rule_id, started_at);

-- =============================================================================================
-- AI
-- =============================================================================================

-- =============================================================================================
-- Agent orchestration. Events (outbox) and schedules start runs; each run records its steps
-- (the live trace); proposals link back to the run and step that produced them. Write tools never
-- move money: they create proposals or, after approval, call the guarded actions in money.ts.
-- =============================================================================================

CREATE TABLE agent_definitions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,                     -- AgentKey
  deleted INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  owner_role TEXT NOT NULL,             -- Role of the persona who owns it
  goal TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]',     -- JSON array of allowed ToolKeys
  triggers TEXT NOT NULL DEFAULT '{}',  -- JSON {schedule: "0 13 * * *", events: ["payment.failed"]}
  autonomy TEXT NOT NULL CHECK (autonomy IN ('suggest', 'act_with_approval', 'auto_within_policy')),
  approval_policy_id TEXT,              -- -> approval_policies.id
  enabled INTEGER NOT NULL DEFAULT 1,
  model TEXT,                           -- model preference; NULL = platform default
  UNIQUE (workspace_id, id)
);

CREATE TABLE agent_runs (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  agent_key TEXT NOT NULL,              -- -> agent_definitions.id
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule', 'event', 'manual', 'chat')),
  event_id TEXT,                        -- -> events.id
  started_by TEXT,                      -- persona id for manual/chat
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'done', 'failed')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  model TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX agent_runs_agent ON agent_runs (workspace_id, agent_key, started_at);
CREATE INDEX agent_runs_status ON agent_runs (workspace_id, status, started_at);

CREATE TABLE agent_steps (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  run_id TEXT NOT NULL,                 -- -> agent_runs.id
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'tool_call', 'tool_result', 'reasoning_summary', 'proposal', 'message')),
  tool_key TEXT,                        -- ToolKey for tool_call/tool_result
  input TEXT,                           -- JSON
  output TEXT,                          -- JSON, truncated to a bounded size
  latency_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, run_id, idx)
);

-- Event queue / outbox: payment.failed, lease.expiring, wo.created, invoice.received,
-- coi.expiring, data_issue.detected, … processed_at/run_id are set when an agent picks it up.
CREATE TABLE events (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  property_id TEXT,                     -- -> properties.id
  payload TEXT NOT NULL DEFAULT '{}',   -- JSON
  created_at TEXT NOT NULL,
  processed_at TEXT,
  run_id TEXT,                          -- -> agent_runs.id
  UNIQUE (workspace_id, id)
);
CREATE INDEX events_pending ON events (workspace_id, processed_at, created_at);
CREATE INDEX events_type ON events (workspace_id, type, created_at);

-- Agent proposals (precomputed in base). queue_state feeds the home queue:
-- needs_you (awaiting a person) | auto_handled (done within policy) | waiting (on someone else).
CREATE TABLE ai_proposals (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  agent TEXT NOT NULL,                  -- AgentKey
  entity_type TEXT NOT NULL,            -- EntityKey
  entity_id TEXT NOT NULL,
  property_id TEXT,                     -- -> properties.id
  action TEXT NOT NULL,                 -- ActionKey run on approval
  title TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',   -- JSON params for the action
  why TEXT NOT NULL DEFAULT '[]',       -- JSON array of reasons
  evidence TEXT NOT NULL DEFAULT '[]',  -- JSON [{entity_type, entity_id, label}]
  confidence REAL NOT NULL,
  risk TEXT NOT NULL DEFAULT 'Low',     -- Low | Medium | High (money/legal/safety force a person)
  amount_cents INTEGER,
  queue_state TEXT NOT NULL DEFAULT 'needs_you' CHECK (queue_state IN ('needs_you', 'auto_handled', 'waiting')),
  assignee_role TEXT,                   -- Role
  model TEXT,
  run_id TEXT,                          -- -> agent_runs.id
  step_id TEXT,                         -- -> agent_steps.id
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX ai_proposals_run ON ai_proposals (workspace_id, run_id);
CREATE INDEX ai_proposals_queue ON ai_proposals (workspace_id, queue_state, created_at);
CREATE INDEX ai_proposals_entity ON ai_proposals (workspace_id, entity_type, entity_id);
CREATE INDEX ai_proposals_property ON ai_proposals (workspace_id, property_id);
CREATE INDEX ai_proposals_agent ON ai_proposals (workspace_id, agent);

-- A person's decision on a proposal (overlay only).
CREATE TABLE ai_decisions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  proposal_id TEXT NOT NULL,            -- -> ai_proposals.id
  decision TEXT NOT NULL CHECK (decision IN ('Approved', 'Rejected', 'Edited', 'Snoozed')),
  decided_by TEXT NOT NULL,             -- persona / staff id
  note TEXT NOT NULL DEFAULT '',
  edited_payload TEXT,                  -- JSON
  decided_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX ai_decisions_proposal ON ai_decisions (workspace_id, proposal_id);

CREATE TABLE ai_summaries (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  facts TEXT NOT NULL DEFAULT '{}',     -- JSON facts block the summary was written from
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX ai_summaries_entity ON ai_summaries (workspace_id, entity_type, entity_id);

CREATE TABLE ai_feedback (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  target_kind TEXT NOT NULL,            -- proposal | summary | assistant_message
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  comment TEXT NOT NULL DEFAULT '',
  by_id TEXT NOT NULL,
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX ai_feedback_target ON ai_feedback (workspace_id, target_kind, target_id);

-- Copilot chat history per workspace.
CREATE TABLE assistant_threads (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL,                -- persona id
  title TEXT NOT NULL,
  context_type TEXT,                    -- record the thread was opened from
  context_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX assistant_threads_user ON assistant_threads (workspace_id, user_id, updated_at);

CREATE TABLE assistant_messages (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT NOT NULL,              -- -> assistant_threads.id
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  plan TEXT,                            -- JSON QueryPlan the answer was computed from
  citations TEXT NOT NULL DEFAULT '[]', -- JSON [{entity_type, entity_id, label} | {help: slug}]
  model TEXT,
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX assistant_messages_thread ON assistant_messages (workspace_id, thread_id, seq);

CREATE TABLE assistant_actions (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  message_id TEXT NOT NULL,             -- -> assistant_messages.id
  action TEXT NOT NULL,                 -- ActionKey
  entity_type TEXT,
  entity_id TEXT,
  params TEXT NOT NULL DEFAULT '{}',    -- JSON
  status TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Confirmed', 'Executed', 'Failed', 'Cancelled')),
  result TEXT,                          -- JSON
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX assistant_actions_message ON assistant_actions (workspace_id, message_id);

-- =============================================================================================
-- Collaboration (polymorphic: entity_type is an EntityKey, entity_id the record id)
-- =============================================================================================

-- queue_state: needs_you | auto_handled | waiting (with ai_proposals, the home queue).
CREATE TABLE tasks (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id TEXT,
  property_id TEXT,                     -- -> properties.id
  assignee_id TEXT,                     -- -> staff.id
  assignee_role TEXT,                   -- Role, when assigned to a role not a person
  created_by TEXT,
  due_on TEXT,
  priority TEXT NOT NULL DEFAULT 'Normal', -- High | Normal | Low
  status TEXT NOT NULL DEFAULT 'Open',  -- Open | In progress | Done | Cancelled
  queue_state TEXT NOT NULL DEFAULT 'needs_you' CHECK (queue_state IN ('needs_you', 'auto_handled', 'waiting')),
  source TEXT NOT NULL DEFAULT 'Manual', -- Manual | Automation | Agent | Preventive
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX tasks_assignee ON tasks (workspace_id, assignee_id, status, due_on);
CREATE INDEX tasks_entity ON tasks (workspace_id, entity_type, entity_id);
CREATE INDEX tasks_queue ON tasks (workspace_id, queue_state, due_on);
CREATE INDEX tasks_property ON tasks (workspace_id, property_id);

CREATE TABLE notes (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  parent_id TEXT,                       -- -> notes.id (reply)
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,                   -- plain text with @[Name](staff:id) mentions
  mentions TEXT NOT NULL DEFAULT '[]',  -- JSON array of staff ids
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX notes_entity ON notes (workspace_id, entity_type, entity_id, created_at);

-- Per-record timeline (created, status changed, payment posted, AI acted, ...).
CREATE TABLE activity_events (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  property_id TEXT,                     -- -> properties.id
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,             -- staff | resident | vendor | owner | agent | system
  actor_id TEXT NOT NULL,
  verb TEXT NOT NULL,                   -- created | updated | status_changed | paid | approved | commented | ...
  summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',      -- JSON
  UNIQUE (workspace_id, id)
);
CREATE INDEX activity_events_entity ON activity_events (workspace_id, entity_type, entity_id, at);
CREATE INDEX activity_events_property ON activity_events (workspace_id, property_id, at);

CREATE TABLE notifications (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL,                -- persona / staff / portal user id
  channel TEXT NOT NULL DEFAULT 'In-app',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT,
  entity_type TEXT,
  entity_id TEXT,
  read_at TEXT,
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX notifications_user ON notifications (workspace_id, user_id, read_at, at);

CREATE TABLE saved_views (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id TEXT,                        -- NULL = shared with the org
  state TEXT NOT NULL,                  -- JSON ViewState (filters, sort, columns)
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX saved_views_entity ON saved_views (workspace_id, entity_type, owner_id);

CREATE TABLE user_preferences (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,                     -- = user id
  deleted INTEGER NOT NULL DEFAULT 0,
  density TEXT NOT NULL DEFAULT 'Comfortable', -- Compact | Comfortable
  theme TEXT NOT NULL DEFAULT 'light',  -- light | dark | system
  tables TEXT NOT NULL DEFAULT '{}',    -- JSON {entity: {columns, sort, size}}
  data TEXT NOT NULL DEFAULT '{}',      -- JSON, anything else
  UNIQUE (workspace_id, id)
);

CREATE TABLE onboarding_progress (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('org', 'user')),
  subject_id TEXT NOT NULL,
  step TEXT NOT NULL,                   -- import_portfolio | connect_bank | invite_team | set_policies | ...
  status TEXT NOT NULL DEFAULT 'Todo',  -- Todo | Done | Skipped
  done_at TEXT,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, subject_kind, subject_id, step)
);

CREATE TABLE tour_progress (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active', -- Active | Completed | Dismissed
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, user_id, tour)
);

-- Product help, used by tours and by the assistant for "how do I…" answers.
CREATE TABLE help_articles (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,                     -- = slug
  deleted INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL,                   -- markdown
  tags TEXT NOT NULL DEFAULT '[]',      -- JSON
  entity_type TEXT,                     -- EntityKey it documents, if any
  route TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX help_articles_entity ON help_articles (workspace_id, entity_type);

-- =============================================================================================
-- Data health. Rules detect bad records (corrupted seed cases, bad imports); rules or AI propose a
-- fix; a person (or an agent within policy) applies it. Fixes are logged before/after and audited.
-- =============================================================================================

CREATE TABLE data_rules (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,                     -- RuleKey, e.g. "leases.end_before_start"
  deleted INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,            -- EntityKey
  name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  description TEXT NOT NULL,
  check_kind TEXT NOT NULL CHECK (check_kind IN ('sql', 'computed')),
  check_sql TEXT,                       -- check_kind = 'sql': SELECT returning offending ids
  help_slug TEXT,                       -- -> help_articles.id
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id)
);
CREATE INDEX data_rules_entity ON data_rules (workspace_id, entity_type);

CREATE TABLE data_issues (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rule_id TEXT NOT NULL,                -- -> data_rules.id
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  property_id TEXT,                     -- -> properties.id (scope)
  detected_at TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  evidence TEXT NOT NULL DEFAULT '{}',  -- JSON: the offending values
  -- JSON {changes: {field: value} | action: ActionKey, params, why: [...], confidence, source: "rule" | AgentKey}
  suggested_fix TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'dismissed', 'auto-fixed')),
  fixed_by TEXT,                        -- persona/staff id or AgentKey
  fixed_at TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX data_issues_status ON data_issues (workspace_id, status, severity);
CREATE INDEX data_issues_entity ON data_issues (workspace_id, entity_type, entity_id);
CREATE INDEX data_issues_rule ON data_issues (workspace_id, rule_id);
CREATE INDEX data_issues_property ON data_issues (workspace_id, property_id, status);

CREATE TABLE data_fix_log (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  issue_id TEXT NOT NULL,               -- -> data_issues.id
  audit_id TEXT,                        -- -> audit.id
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT NOT NULL,            -- JSON of changed fields before
  after_json TEXT NOT NULL,             -- JSON after
  fixed_by TEXT NOT NULL,
  agent TEXT,                           -- AgentKey when AI proposed or applied it
  at TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX data_fix_log_issue ON data_fix_log (workspace_id, issue_id);
CREATE INDEX data_fix_log_entity ON data_fix_log (workspace_id, entity_type, entity_id);

-- Who did what. agent/model set when an AI proposal was approved or an agent acted.
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,                  -- display name
  actor_id TEXT,
  role TEXT,                            -- Role the actor was acting as
  agent TEXT,                           -- AgentKey
  model TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  property_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  UNIQUE (workspace_id, id)
);
CREATE INDEX audit_at ON audit (workspace_id, at);
CREATE INDEX audit_entity ON audit (workspace_id, entity_type, entity_id);

-- Pre-aggregated by the generator; dashboards read ~540 rows plus a live overlay delta.
CREATE TABLE metrics_monthly (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,            -- -> properties.id
  month TEXT NOT NULL,                  -- 'YYYY-MM'
  units INTEGER NOT NULL,
  occupied INTEGER NOT NULL,
  gpr_cents INTEGER NOT NULL,           -- gross potential rent
  charged_cents INTEGER NOT NULL,
  collected_cents INTEGER NOT NULL,
  vacancy_loss_cents INTEGER NOT NULL DEFAULT 0,
  concessions_cents INTEGER NOT NULL DEFAULT 0,
  occupancy_phys REAL NOT NULL,
  occupancy_econ REAL NOT NULL,
  aging_0_30_cents INTEGER NOT NULL DEFAULT 0,
  aging_31_60_cents INTEGER NOT NULL DEFAULT 0,
  aging_61_90_cents INTEGER NOT NULL DEFAULT 0,
  aging_90p_cents INTEGER NOT NULL DEFAULT 0,
  opex_cents INTEGER NOT NULL,
  noi_cents INTEGER NOT NULL,
  budget_noi_cents INTEGER,
  wo_opened INTEGER NOT NULL DEFAULT 0,
  wo_open INTEGER NOT NULL DEFAULT 0,
  wo_sla_breach INTEGER NOT NULL DEFAULT 0,
  move_ins INTEGER NOT NULL DEFAULT 0,
  move_outs INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  tours INTEGER NOT NULL DEFAULT 0,
  applications INTEGER NOT NULL DEFAULT 0,
  ai_actions INTEGER NOT NULL DEFAULT 0,
  ai_minutes_saved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, property_id, month)
);
CREATE INDEX metrics_monthly_month ON metrics_monthly (workspace_id, month);
