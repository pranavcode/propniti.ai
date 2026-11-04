-- Indexes for the slowest production reads (D1 insights, 2026-11-04).
-- A household's charges newest first: without due_on in the index the planner walked charges_due
-- (every charge in the workspace) to avoid a sort. Replaces charges_household, its prefix.
CREATE INDEX IF NOT EXISTS charges_household_due ON charges (workspace_id, household_id, due_on);
DROP INDEX IF EXISTS charges_household;
-- Data-health duplicate rules self-join on these columns; without them each rule read millions of rows.
CREATE INDEX IF NOT EXISTS residents_phone ON residents (workspace_id, phone, id);
CREATE INDEX IF NOT EXISTS bills_invoice ON bills (workspace_id, vendor_id, invoice_number);
