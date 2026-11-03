import type { Row } from "@/entities/types";
import { daysBetween, sql } from "../data";
import { addDays, defineAgent, money, type Candidate } from "./framework";
import { renewalRent } from "../rules";
export { renewalRent } from "../rules";

// Renewal offers for leases ending in the next 90 days that have no offer yet. Pricing: move toward
// market rent, capped at +5%; never raise a resident who is behind on rent without a person.

export default defineAgent({
  key: "renewals",
  name: "Renewals agent",
  ownerRole: "property_manager",
  goal: "Send a renewal offer for every lease ending in the next 90 days that has none, priced toward market rent and capped at +5%, with the reasoning shown.",
  tools: ["records.search", "records.get", "records.related", "ledger.lookup", "messages.draft", "actions.propose"],
  triggers: { schedule: "0 13 * * 1", events: ["lease.expiring"] },
  autonomy: "act_with_approval",
  entities: ["leases", "renewal_offers"],
  actions: ["leases.send_renewal_offer"],
  maxProposals: 8,
  async collect(ctx) {
    const end = addDays(ctx.today, 90);
    const found = await ctx.call<{ rows: Row[]; total: number }>("records.search", { entity: "leases", filters: [{ field: "status", op: "eq", value: "Active" }, { field: "end_on", op: "gte", value: ctx.today }, { field: "end_on", op: "lte", value: end }], sort: ["end_on", "asc"], size: 50 });
    const ids = found.rows.map((l) => String(l.id));
    if (!ids.length) return [];
    const rows = await sql<Row>(ctx.data,
      `SELECT l.id, l.property_id, l.end_on, l.rent_cents, u.number AS unit, u.market_rent_cents, p.name AS property, r.id AS resident_id, r.first_name, r.last_name, r.risk_score,
              (SELECT count(*) FROM {renewal_offers} o WHERE o.lease_id = l.id) AS offers
       FROM {leases} l JOIN {units} u ON u.id = l.unit_id JOIN {properties} p ON p.id = l.property_id
       LEFT JOIN {residents} r ON r.household_id = l.household_id AND r.is_primary = 1 WHERE l.id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(ids)]);
    return rows.filter((r) => !Number(r.offers) && r.resident_id).map((r): Candidate => {
      const current = Number(r.rent_cents);
      const market = r.market_rent_cents == null ? null : Number(r.market_rent_cents);
      const { rent, reason } = renewalRent(current, market);
      const days = daysBetween(ctx.today, String(r.end_on));
      const name = `${r.first_name} ${r.last_name}`;
      const risky = Number(r.risk_score ?? 0) >= 60;
      return {
        entity: "leases", entityId: String(r.id), propertyId: String(r.property_id), action: "leases.send_renewal_offer",
        title: `Offer ${name} a 12-month renewal at ${money(rent)} (${rent > current ? `+${(((rent - current) / current) * 100).toFixed(1)}%` : "flat"})`,
        why: [`Lease ends ${r.end_on} (${days} days)`, reason, risky ? `Delinquency risk score ${r.risk_score}: a person should confirm` : "Pays on time; good renewal candidate"],
        confidence: risky ? 0.6 : 0.82, risk: risky ? "Medium" : "Low", category: rent < current ? "Concession" : undefined,
        facts: { resident: name, property: String(r.property), unit: String(r.unit), end_on: String(r.end_on), current_rent_cents: current, market_rent_cents: market, offer_rent_cents: rent, days_to_end: days },
        evidence: [{ entity_type: "leases", entity_id: String(r.id), label: `${name} · ${r.property} #${r.unit}` }],
        message: { party_kind: "resident", party_id: String(r.resident_id), subject: `Your renewal offer at ${r.property}`, body: `Hi ${r.first_name}, your lease at ${r.property} #${r.unit} ends on ${r.end_on}. We'd love for you to stay: we can renew for 12 months at ${money(rent)} a month. Reply to accept or to talk about other terms.` },
        effects: [{ kind: "insert", table: "renewal_offers", row: { lease_id: String(r.id), property_id: String(r.property_id), version: 1, term_months: 12, rent_cents: rent, current_rent_cents: current, market_rent_cents: market, status: "Sent", sent_at: new Date().toISOString(), expires_on: addDays(ctx.today, 30) } }],
        priority: 1000 - days,
      };
    });
  },
});
