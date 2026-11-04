-- Indexes for the derived-status reads in src/server/data.ts: a charge's credits, and live
-- transfer lookups by idempotency key whatever their status (the unique index is partial).
CREATE INDEX IF NOT EXISTS credits_charge ON credits (workspace_id, charge_id);
CREATE INDEX IF NOT EXISTS transfers_key ON transfers (workspace_id, key);
CREATE INDEX IF NOT EXISTS work_orders_status ON work_orders (workspace_id, status);
