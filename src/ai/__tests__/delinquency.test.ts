import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, sqliteDb } from "@/lib/platform/sqlite";
import { writeBase } from "@/server/base";
import { AS_OF } from "@/seed/constants";
import { daysBetween, sql, type DataCtx } from "../data";
import { delinquency, type Delinquent } from "../facts";
import { DANIEL } from "./fixture";

// The ledger-summing delinquency this replaced (FIFO over charges, payments and credits), kept here to
// prove the stored allocation gives the same leases, balances, days late and aging on the full seed.
// Balances per lease from charges due by today, minus good payments and credits; days late is the
// age of the oldest charge the payments haven't covered (first in, first out).
async function ledgerDelinquency(ctx: DataCtx, today: string, f: { minDays?: number; metro?: string; propertyIds?: string[]; leaseIds?: string[]; limit?: number } = {}): Promise<{ rows: Omit<Delinquent, "manager">[]; total: number; total_balance_cents: number }> {
  const filters: string[] = [];
  const params: unknown[] = [today, today];
  if (f.metro) {
    filters.push("p.metro = ?");
    params.push(f.metro);
  }
  if (f.propertyIds?.length) {
    filters.push("l.property_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(f.propertyIds));
  }
  if (f.leaseIds?.length) {
    filters.push("l.id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(f.leaseIds));
  }
  const owing = await sql<{ lease_id: string; property_id: string; household_id: string; unit_id: string; status: string; property: string; metro: string; manager: string | null; charged: number; paid: number }>(
    ctx,
    `WITH ch AS (SELECT lease_id, sum(amount_cents) AS s FROM {charges} WHERE due_on <= ? GROUP BY lease_id),
          pa AS (SELECT lease_id, sum(amount_cents) AS s FROM {payments} WHERE nsf = 0 AND received_on <= ? GROUP BY lease_id),
          cr AS (SELECT lease_id, sum(amount_cents) AS s FROM {credits} GROUP BY lease_id)
     SELECT l.id AS lease_id, l.property_id, l.household_id, l.unit_id, l.status, p.name AS property, p.metro, (SELECT s.name FROM {staff} s WHERE s.id = p.manager_id) AS manager,
            ch.s AS charged, coalesce(pa.s, 0) + coalesce(cr.s, 0) AS paid
     FROM ch JOIN {leases} l ON l.id = ch.lease_id JOIN {properties} p ON p.id = l.property_id
     LEFT JOIN pa ON pa.lease_id = ch.lease_id LEFT JOIN cr ON cr.lease_id = ch.lease_id
     WHERE ch.s - coalesce(pa.s, 0) - coalesce(cr.s, 0) > 0 ${filters.length ? "AND " + filters.join(" AND ") : ""}`,
    params,
  );
  if (!owing.length) return { rows: [], total: 0, total_balance_cents: 0 };
  const ids = owing.map((o) => o.lease_id);
  const [charges, people, units, plans] = await Promise.all([
    sql<{ lease_id: string; due_on: string; amount_cents: number }>(ctx, "SELECT lease_id, due_on, amount_cents FROM {charges} WHERE due_on <= ? AND lease_id IN (SELECT value FROM json_each(?)) ORDER BY lease_id, due_on", [today, JSON.stringify(ids)]),
    sql<{ household_id: string; id: string; first_name: string; last_name: string; phone: string; email: string; language: string; risk_score: number | null }>(
      ctx, "SELECT household_id, id, first_name, last_name, phone, email, language, risk_score FROM {residents} WHERE is_primary = 1 AND household_id IN (SELECT value FROM json_each(?))", [JSON.stringify(owing.map((o) => o.household_id))],
    ),
    sql<{ id: string; number: string }>(ctx, "SELECT id, number FROM {units} WHERE id IN (SELECT value FROM json_each(?))", [JSON.stringify(owing.map((o) => o.unit_id))]),
    sql<{ entity_id: string }>(ctx, "SELECT entity_id FROM {tasks} WHERE entity_type = 'leases' AND title LIKE '%payment plan%' AND status <> 'Cancelled' AND entity_id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids)]).catch(() => []),
  ]);
  const byLease = new Map<string, { due_on: string; amount_cents: number }[]>();
  for (const c of charges) (byLease.get(c.lease_id) ?? byLease.set(c.lease_id, []).get(c.lease_id)!).push(c);
  const person = new Map(people.map((p) => [p.household_id, p]));
  const unit = new Map(units.map((u) => [u.id, u.number]));
  const planned = new Set(plans.map((p) => p.entity_id));

  let rows: Omit<Delinquent, "manager">[] = owing.map((o) => {
    let covered = o.paid;
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    let oldest = today;
    for (const c of byLease.get(o.lease_id) ?? []) {
      const open = Math.max(0, c.amount_cents - Math.max(0, covered));
      covered -= c.amount_cents;
      if (!open) continue;
      if (oldest === today) oldest = c.due_on;
      const age = daysBetween(c.due_on, today);
      if (age <= 30) aging.d0_30 += open;
      else if (age <= 60) aging.d31_60 += open;
      else if (age <= 90) aging.d61_90 += open;
      else aging.d90p += open;
    }
    const p = person.get(o.household_id);
    return {
      lease_id: o.lease_id, property_id: o.property_id, property: o.property, metro: o.metro, manager: o.manager ?? null, unit: unit.get(o.unit_id) ?? o.unit_id, household_id: o.household_id,
      resident: p ? `${p.first_name} ${p.last_name}` : o.household_id, resident_id: p?.id ?? null, phone: p?.phone ?? "", email: p?.email ?? "", language: p?.language ?? "en",
      balance_cents: o.charged - o.paid, days_late: daysBetween(oldest, today), oldest_due_on: oldest, aging, lease_status: o.status,
      risk_score: p?.risk_score ?? null, open_plan: planned.has(o.lease_id),
    };
  });
  if (f.minDays) rows = rows.filter((r) => r.days_late >= f.minDays!);
  rows.sort((a, b) => b.days_late - a.days_late || b.balance_cents - a.balance_cents);
  const total_balance_cents = rows.reduce((s, r) => s + r.balance_cents, 0);
  return { rows: rows.slice(0, f.limit ?? 50), total: rows.length, total_balance_cents };
}


describe("delinquency from stored charge columns", () => {
  it("matches the ledger-summing version on the full seed", async () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw);
    writeBase(raw);
    const ctx: DataCtx = { db: sqliteDb(raw), ws: "base", actor: DANIEL };
    const t0 = Date.now();
    const now = await delinquency(ctx, AS_OF, { limit: 5000 });
    const fast = Date.now() - t0;
    const t1 = Date.now();
    const before = await ledgerDelinquency(ctx, AS_OF, { limit: 5000 });
    const slow = Date.now() - t1;
    const key = (r: { lease_id: string; balance_cents: number; days_late: number; aging: object }) => `${r.lease_id}|${r.balance_cents}|${r.days_late}|${JSON.stringify(r.aging)}`;
    expect(now.total).toBe(before.total);
    expect(now.total_balance_cents).toBe(before.total_balance_cents);
    expect(now.rows.map(key).sort()).toEqual(before.rows.map(key).sort());
    // Informational: the stored read should be the faster one.
    console.log(`delinquency: ${now.total} leases, stored ${fast} ms vs ledger ${slow} ms`);
  }, 180_000);
});
