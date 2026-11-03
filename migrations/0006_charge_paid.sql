-- Stored settlement state per charge, so charge lists and open/overdue views read columns instead of
-- summing payments and credits per row (D1 CPU). paid_cents = payments (not NSF) + credits on the
-- charge's own lease; pending_cents = rent on its way by ACH. The generator fills base rows; every
-- money action in src/server/money.ts rewrites the charge's overlay row in the same batch.
ALTER TABLE charges ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE charges ADD COLUMN pending_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX charges_open_lease ON charges (workspace_id, lease_id) WHERE paid_cents + pending_cents < amount_cents;
CREATE INDEX charges_open_due ON charges (workspace_id, due_on) WHERE paid_cents + pending_cents < amount_cents;
CREATE INDEX charges_due ON charges (workspace_id, due_on);
