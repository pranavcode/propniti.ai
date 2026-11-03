// Pure pricing and policy terms for a listing: no database, so the Q&A and its tests can use them.

// Leasing terms the schema has no columns for yet (lane-requests.md, "listing terms"). Derived in
// one place from the property so the page, the Q&A and the application all quote the same figures.
// INTEGRATE: read listings.terms once the leasing lane adds it.
export type Terms = {
  application_fee_cents: number; deposit_cents: number; admin_fee_cents: number; lease_months: number[];
  pets: { allowed: boolean; deposit_cents: number; monthly_cents: number; max: number; note: string };
  laundry: string | null; parking: string | null; utilities: string; income_multiple: number;
};

export function listingTerms(l: { rent_cents: number; class: string | null; amenities: string[]; type: string; pets: boolean; parking: { subtype: string; rent_cents: number }[] }): Terms {
  const a = new Set(l.amenities);
  const deposit = l.class === "A" ? Math.round(l.rent_cents / 2 / 5000) * 5000 : l.class === "C" ? 30000 : 50000;
  const garage = l.parking.find((p) => p.subtype === "Garage");
  const parking = a.has("Attached garages") ? "Attached garage included with the home"
    : a.has("Off-street parking") || a.has("Ample parking") ? "Surface parking included, one space per bedroom"
    : garage ? `Garage parking from $${(garage.rent_cents / 100).toFixed(0)}/month`
    : l.parking.length ? `Reserved parking from $${(l.parking[0].rent_cents / 100).toFixed(0)}/month` : null;
  return {
    application_fee_cents: 5000, admin_fee_cents: l.class === "A" ? 25000 : 15000, deposit_cents: deposit, lease_months: l.type === "Townhomes" || l.type === "Small residential" ? [12, 18] : [6, 12, 13, 15],
    pets: l.pets ? { allowed: true, deposit_cents: 30000, monthly_cents: 3500, max: 2, note: "Up to 2 cats or dogs per home." } : { allowed: false, deposit_cents: 0, monthly_cents: 0, max: 0, note: "No pets." },
    laundry: a.has("In-unit laundry") || l.class === "A" ? "Washer and dryer in the home" : null,
    parking,
    utilities: "Electricity and internet are in your name. Water, sewer and trash are billed monthly by usage.",
    income_multiple: 3,
  };
}

// Due before move-in: first month's rent, the security deposit and the administration fee.
export const moveInCents = (l: { rent_cents: number; terms: Terms }) => l.rent_cents + l.terms.deposit_cents + l.terms.admin_fee_cents;
