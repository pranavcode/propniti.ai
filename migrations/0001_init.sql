-- One workspace per demo visitor (kind 'demo') or customer (kind 'org'). Every other row
-- belongs to a workspace and is deleted with it. Money is stored as integer cents.
-- seq (the rowid) keeps insertion order, which the UI relies on for list order.

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'demo' CHECK (kind IN ('demo', 'org')),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER,
  bank TEXT,
  invited TEXT NOT NULL DEFAULT '[]',
  imported_rows INTEGER NOT NULL DEFAULT 0,
  setup_completed INTEGER NOT NULL DEFAULT 0,
  wo_seq INTEGER NOT NULL DEFAULT 1050
);
CREATE INDEX workspaces_expires ON workspaces (expires_at);
CREATE INDEX workspaces_created_by ON workspaces (created_by, created_at);

CREATE TABLE users (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  id_verified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);

CREATE TABLE properties (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  type TEXT NOT NULL,
  units INTEGER NOT NULL,
  occupied INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, owner_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX properties_owner ON properties (workspace_id, owner_id);
CREATE INDEX properties_name ON properties (workspace_id, name COLLATE NOCASE);

CREATE TABLE vendors (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  trade TEXT NOT NULL,
  ytd_paid_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX vendors_user ON vendors (workspace_id, user_id);

CREATE TABLE tenancies (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  rent_cents INTEGER NOT NULL CHECK (rent_cents > 0),
  cadence TEXT NOT NULL DEFAULT 'Monthly',
  lease_start TEXT NOT NULL,
  lease_end TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, property_id, unit COLLATE NOCASE),
  FOREIGN KEY (workspace_id, property_id) REFERENCES properties (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX tenancies_tenant ON tenancies (workspace_id, tenant_id);
CREATE INDEX tenancies_property ON tenancies (workspace_id, property_id);

CREATE TABLE invoices (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  tenancy_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  generated TEXT NOT NULL,
  due TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Paid', 'Processing', 'Due', 'Overdue')),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, tenancy_id) REFERENCES tenancies (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX invoices_tenancy ON invoices (workspace_id, tenancy_id);

-- vendor_id NULL = in-house job. po, submission and validation are JSON documents.
CREATE TABLE work_orders (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  title TEXT NOT NULL,
  vendor_id TEXT,
  assignee_id TEXT,
  estimated_hours REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  po TEXT NOT NULL,
  submission TEXT,
  validation TEXT,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, property_id) REFERENCES properties (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES vendors (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, assignee_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX work_orders_assignee ON work_orders (workspace_id, assignee_id);
CREATE INDEX work_orders_vendor ON work_orders (workspace_id, vendor_id);
CREATE INDEX work_orders_unit ON work_orders (workspace_id, property_id, unit);

-- Parties are polymorphic (tenant, trust, pm, owner, vendor), so they carry no foreign keys.
CREATE TABLE transfers (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Rent', 'Management fee', 'Vendor payout', 'Owner payout')),
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  property_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Cleared', 'Returned')),
  created TEXT NOT NULL,
  settles_at INTEGER,
  cleared TEXT,
  statement TEXT,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, property_id) REFERENCES properties (workspace_id, id) ON DELETE CASCADE
);
-- One live transfer per idempotency key: a double click or retry can never move money twice.
CREATE UNIQUE INDEX transfers_live_key ON transfers (workspace_id, key) WHERE status <> 'Returned';
CREATE INDEX transfers_due ON transfers (workspace_id, status, settles_at);
CREATE INDEX transfers_statement ON transfers (workspace_id, property_id, statement);
CREATE INDEX transfers_to ON transfers (workspace_id, to_id, kind);
CREATE INDEX transfers_from ON transfers (workspace_id, from_id, kind);

CREATE TABLE ratings (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  by_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('maintenance', 'vendor', 'pm', 'property')),
  subject_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, by_id, subject_kind, subject_id, ref),
  FOREIGN KEY (workspace_id, by_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX ratings_subject ON ratings (workspace_id, subject_kind, subject_id);

CREATE TABLE notifications (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  ts TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_user ON notifications (workspace_id, user_id, ts);

CREATE TABLE audit (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (workspace_id, id)
);
CREATE INDEX audit_ts ON audit (workspace_id, ts);
