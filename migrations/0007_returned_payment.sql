-- Adds the 'Returned payment' transfer kind: money the bank takes back out of trust when a resident's
-- payment bounces (NSF or a returned ACH). SQLite can't alter a CHECK, so the table is rebuilt with
-- the same columns, ids and seq values, then its indexes are recreated.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE transfers_new (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Rent', 'Management fee', 'Vendor payout', 'Owner payout', 'Deposit', 'Deposit refund', 'Other receipt', 'Returned payment')),
  bank_account_id TEXT NOT NULL,
  owner_entity_id TEXT NOT NULL,
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
  UNIQUE (workspace_id, id)
);
INSERT INTO transfers_new (seq, workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, settles_at, cleared)
  SELECT seq, workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created, settles_at, cleared FROM transfers;
DROP TABLE transfers;
ALTER TABLE transfers_new RENAME TO transfers;
CREATE UNIQUE INDEX transfers_live_key ON transfers (workspace_id, key) WHERE status <> 'Returned';
CREATE INDEX transfers_due ON transfers (workspace_id, status, settles_at);
CREATE INDEX transfers_account ON transfers (workspace_id, bank_account_id, status);
CREATE INDEX transfers_entity ON transfers (workspace_id, owner_entity_id, seq);
CREATE INDEX transfers_property ON transfers (workspace_id, property_id, seq);
CREATE INDEX transfers_to ON transfers (workspace_id, to_id, kind);
CREATE INDEX transfers_from ON transfers (workspace_id, from_id, kind);
CREATE INDEX transfers_key ON transfers (workspace_id, key);
