import { addMonthsDay, iso, rng } from "./rng";

// What a lease's signed document says. Usually the same as the lease record; for about 3% of leases
// the document differs in one term (rent, end date or deposit), so lease abstraction has real
// mismatches to find. Deterministic per lease id. The generator stores the result in the lease
// document's `extracted` JSON and lists the mismatched lease ids in meta.lease_doc_mismatches.

export type DocTerms = { rent_cents: number; deposit_cents: number; start_on: string; end_on: string | null; term_months: number | null; mismatch: null | { field: "rent_cents" | "end_on" | "deposit_cents"; record: number | string | null } };

export function leaseDocTerms(l: { id: string; rent: number; deposit: number; start: number; end: number | null; term: number | null }): DocTerms {
  const terms: DocTerms = { rent_cents: l.rent, deposit_cents: l.deposit, start_on: iso(l.start), end_on: l.end === null ? null : iso(l.end), term_months: l.term, mismatch: null };
  const r = rng(`leasedoc:${l.id}`);
  if (!r.chance(0.03)) return terms;
  const field = r.pick(["rent_cents", "end_on", "deposit_cents"] as const);
  if (field === "rent_cents" && l.rent > 0) {
    terms.mismatch = { field, record: l.rent };
    terms.rent_cents = l.rent + r.pick([-5000, 2500, 5000, 7500, 10000]);
  } else if (field === "end_on" && l.end !== null) {
    terms.mismatch = { field, record: iso(l.end) };
    terms.end_on = iso(addMonthsDay(l.end + 1, r.pick([-1, 1, 3])) - 1);
  } else {
    terms.mismatch = { field: "deposit_cents", record: l.deposit };
    terms.deposit_cents = l.deposit + r.pick([25000, 50000, -25000].filter((d) => l.deposit + d > 0));
  }
  return terms;
}
