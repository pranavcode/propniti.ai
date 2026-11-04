import "server-only";
import { AS_OF } from "@/seed/constants";
import { row, rows, type PortalCtx } from "./context";

// Reads for the resident portal. Every query is tied to the signed-in resident's household or
// their current lease, never to a property-wide set.

export type Me = { id: string; first_name: string; last_name: string; email: string; phone: string; autopay: number; household_id: string; property_id: string };
export type Lease = { id: string; unit_id: string; property_id: string; status: string; start_on: string; end_on: string | null; term_months: number | null; rent_cents: number; deposit_cents: number; move_in_on: string | null; unit: string; sqft: number; beds: number | null; baths: number | null; unit_photos: string; property: string; street: string; city: string; state: string; zip: string; photos: string };
export type OpenCharge = { id: string; description: string; period: string; due_on: string; amount_cents: number; balance_cents: number; status: "Overdue" | "Due" | "Processing" };
export type Request = { id: string; title: string; description: string; category: string; priority: string; status: string; opened_at: string; scheduled_at: string | null; completed_at: string | null; vendor: string | null; photos: string | null };
export type Offer = { id: string; lease_id: string; term_months: number; rent_cents: number; current_rent_cents: number; market_rent_cents: number | null; status: string; sent_at: string | null; expires_on: string | null };
export type Insurance = { id: string; carrier: string; policy_number: string; liability_cents: number; starts_on: string; expires_on: string; status: string };
export type Doc = { id: string; name: string; doc_type: string | null; url: string; uploaded_at: string };

export async function me(c: PortalCtx) {
  return row<Me>(c, "SELECT r.id, r.first_name, r.last_name, r.email, r.phone, r.autopay, r.household_id, r.property_id FROM {residents} r WHERE r.id = ?", c.me);
}

export async function currentLease(c: PortalCtx, householdId: string) {
  return row<Lease>(c, `SELECT l.id, l.unit_id, l.property_id, l.status, l.start_on, l.end_on, l.term_months, l.rent_cents, l.deposit_cents, l.move_in_on,
      u.number AS unit, u.sqft, ut.beds, ut.baths, coalesce(ut.photos, '[]') AS unit_photos, p.name AS property, p.street, p.city, p.state, p.zip, p.photos
    FROM {leases} l JOIN {units} u ON u.id = l.unit_id JOIN {properties} p ON p.id = l.property_id LEFT JOIN {unit_types} ut ON ut.id = u.unit_type_id
    WHERE l.household_id = ? AND l.status IN ('Active', 'Notice', 'Month-to-month', 'Future') ORDER BY l.start_on DESC LIMIT 1`, householdId);
}

const PAID = "(SELECT coalesce(sum(p.amount_cents), 0) FROM {payments} p WHERE p.charge_id = ch.id AND p.nsf = 0) + (SELECT coalesce(sum(x.amount_cents), 0) FROM {credits} x WHERE x.charge_id = ch.id)";

// Charges with money still owed. Processing = an ACH payment for it is in flight (rent:<charge>).
export async function openCharges(c: PortalCtx, householdId: string) {
  const list = await rows<OpenCharge & { pending: number }>(c, `SELECT ch.id, ch.description, ch.period, ch.due_on, ch.amount_cents, ch.amount_cents - (${PAID}) AS balance_cents,
      EXISTS (SELECT 1 FROM {transfers} t WHERE t.key = 'rent:' || ch.id AND t.status = 'Pending') AS pending
    FROM {charges} ch WHERE ch.household_id = ? AND ch.amount_cents - (${PAID}) > 0 ORDER BY ch.due_on, ch.id LIMIT 50`, householdId);
  return list.map(({ pending, ...ch }) => ({ ...ch, status: pending ? "Processing" : ch.due_on < AS_OF ? "Overdue" : "Due" }) as OpenCharge);
}

export type LedgerLine = { at: string; kind: "Charge" | "Payment" | "Credit"; description: string; amount_cents: number; balance_cents: number; nsf?: number };

// The household's ledger, newest first, with a running balance computed over the whole history.
export async function ledger(c: PortalCtx, householdId: string, page: number, size = 25) {
  const all = await rows<{ at: string; kind: LedgerLine["kind"]; description: string; amount_cents: number; nsf: number; seq: number }>(c, `
    SELECT ch.due_on AS at, 'Charge' AS kind, ch.description, ch.amount_cents, 0 AS nsf, 0 AS seq FROM {charges} ch WHERE ch.household_id = ?1
    UNION ALL SELECT p.received_on, 'Payment', CASE WHEN p.reference <> '' THEN p.reference ELSE p.method END, -p.amount_cents, p.nsf, 1 FROM {payments} p WHERE p.household_id = ?1
    UNION ALL SELECT x.on_date, 'Credit', x.description, -x.amount_cents, 0, 2 FROM {credits} x JOIN {leases} l ON l.id = x.lease_id WHERE l.household_id = ?1
    ORDER BY 1, 6 LIMIT 2000`, householdId);
  let bal = 0;
  const withBal: LedgerLine[] = all.map((r) => {
    // A returned (NSF) payment never reduced the balance.
    if (!(r.kind === "Payment" && r.nsf)) bal += r.amount_cents;
    return { at: r.at, kind: r.kind, description: r.kind === "Payment" && r.nsf ? `${r.description} (returned)` : r.description, amount_cents: r.amount_cents, balance_cents: bal, nsf: r.nsf };
  }).reverse();
  return { rows: withBal.slice((page - 1) * size, page * size), total: withBal.length, page, size };
}

// Work orders for the household: the ones they asked for, plus resident requests on their unit
// since their lease started (an earlier tenant's requests stay private).
export async function requests(c: PortalCtx, unitId: string | null, since: string | null) {
  return rows<Request>(c, `SELECT w.id, w.title, w.description, w.category, w.priority, w.status, w.opened_at, w.scheduled_at, w.completed_at, v.company AS vendor,
      (SELECT json_group_array(ph.url) FROM {photos} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = w.id) AS photos
    FROM {work_orders} w LEFT JOIN {vendors} v ON v.id = w.vendor_id
    WHERE w.id IN (SELECT sr.work_order_id FROM {service_requests} sr WHERE sr.resident_id = ?) OR (w.unit_id = ? AND w.source = 'Resident' AND w.opened_at >= coalesce(?, '9999'))
    ORDER BY w.opened_at DESC LIMIT 50`, c.me, unitId, since);
}

export const OPEN_WO = ["New", "Triaged", "Assigned", "Scheduled", "In progress", "On hold", "Submitted"];

export async function offers(c: PortalCtx, leaseId: string) {
  return rows<Offer>(c, "SELECT o.id, o.lease_id, o.term_months, o.rent_cents, o.current_rent_cents, o.market_rent_cents, o.status, o.sent_at, o.expires_on FROM {renewal_offers} o WHERE o.lease_id = ? AND o.status <> 'Draft' ORDER BY o.version DESC, o.term_months DESC", leaseId);
}

export async function insurance(c: PortalCtx, leaseId: string) {
  return row<Insurance>(c, "SELECT i.id, i.carrier, i.policy_number, i.liability_cents, i.starts_on, i.expires_on, i.status FROM {renters_insurance} i WHERE i.lease_id = ? ORDER BY i.expires_on DESC LIMIT 1", leaseId);
}

export async function documents(c: PortalCtx, leaseId: string) {
  return rows<Doc>(c, `SELECT d.id, d.name, d.doc_type, d.url, d.uploaded_at FROM {documents} d
    WHERE (d.entity_type = 'leases' AND d.entity_id = ?) OR (d.entity_type = 'residents' AND d.entity_id = ?) ORDER BY d.uploaded_at DESC LIMIT 50`, leaseId, c.me);
}

export const parsePhotos = (json: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
export const daysUntil = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${AS_OF}T00:00:00Z`)) / 86_400_000);

// Rent is due on the 1st: the next due date after the demo's today.
export const nextRentDue = () => {
  const [y, m] = AS_OF.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
