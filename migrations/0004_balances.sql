-- Precomputed ledger balances for list views (D1 CPU: no per-row sums over the ledger). The
-- generator fills them for base rows; reads add the visitor's overlay delta (src/server/data.ts
-- leaseBalanceSql / householdBalanceSql), so money actions never have to update them.
ALTER TABLE leases ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leases ADD COLUMN last_payment_at TEXT;
ALTER TABLE households ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE households ADD COLUMN last_payment_at TEXT;
