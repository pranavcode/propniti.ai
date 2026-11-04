import { demoNowIso } from "@/lib/clock";
import type { Row } from "@/entities/types";
import { daysBetween, sql } from "../data";
import { addDays, defineAgent, money, planOf, type Candidate } from "./framework";
import { letterDates, renewalRent } from "../rules";
import type { AgentCtx } from "../runtime";
import { formatDate } from "@/lib/format";
export { renewalRent } from "../rules";

// Renewal offers for leases ending in the next 90 days that have no offer yet. Pricing: move toward
// market rent, capped at +5%; never raise a resident who is behind on rent without a person.
// Also follows up on sent offers nobody answered when the lease ends within 14 days: a reminder,
// or, within 3 days, a notice that the lease would go month to month (legal wording, so a person decides).

export const RENEWAL_WINDOW_DAYS = 90;

export default defineAgent({
  key: "renewals",
  name: "Renewals Agent",
  ownerRole: "property_manager",
  goal: "Send a renewal offer for every lease ending in the next 90 days that has none, priced toward market rent and capped at +5%, with the reasoning shown.",
  tools: ["records.search", "records.get", "records.related", "ledger.lookup", "messages.draft", "actions.propose"],
  triggers: { schedule: "0 13 * * 1", events: ["lease.expiring"] },
  autonomy: "act_with_approval",
  entities: ["leases", "renewal_offers"],
  actions: ["leases.send_renewal_offer", "renewal_offers.follow_up"],
  maxProposals: 8,
  async collect(ctx, trigger) {
    const end = addDays(ctx.today, RENEWAL_WINDOW_DAYS);
    const plan = planOf(trigger);
    const found = await ctx.call<{ rows: Row[]; total: number }>("records.search", { entity: "leases", filters: [{ field: "status", op: "eq", value: "Active" }, { field: "end_on", op: "gte", value: ctx.today }, { field: "end_on", op: "lte", value: end }, ...(plan ? [{ field: "id", op: "in", value: plan.ids.slice(0, 50) }] : [])], sort: ["end_on", "asc"], size: 50 });
    const ids = found.rows.map((l) => String(l.id));
    // A plan names leases; follow-ups then only cover those leases' offers.
    const reminders = (await unanswered(ctx)).filter((c) => !plan || plan.ids.includes(String(c.evidence?.[0]?.entity_id)));
    if (!ids.length) return reminders;
    const rows = await sql<Row>(ctx.data,
      `SELECT l.id, l.property_id, l.end_on, l.rent_cents, u.number AS unit, u.market_rent_cents, p.name AS property, r.id AS resident_id, r.first_name, r.last_name, r.risk_score,
              (SELECT count(*) FROM {renewal_offers} o WHERE o.lease_id = l.id) AS offers
       FROM {leases} l JOIN {units} u ON u.id = l.unit_id JOIN {properties} p ON p.id = l.property_id
       LEFT JOIN {residents} r ON r.household_id = l.household_id AND r.is_primary = 1 WHERE l.id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(ids)]);
    return [...reminders, ...rows.filter((r) => !Number(r.offers) && r.resident_id).map((r): Candidate => {
      const current = Number(r.rent_cents);
      const market = r.market_rent_cents == null ? null : Number(r.market_rent_cents);
      const { rent, reason } = renewalRent(current, market);
      const days = daysBetween(ctx.today, String(r.end_on));
      const name = `${r.first_name} ${r.last_name}`;
      const risky = Number(r.risk_score ?? 0) >= 60;
      return {
        entity: "leases", entityId: String(r.id), propertyId: String(r.property_id), action: "leases.send_renewal_offer",
        title: `Offer ${name} a 12-month renewal at ${money(rent)} (${rent > current ? `+${(((rent - current) / current) * 100).toFixed(1)}%` : "flat"})`,
        why: [`Lease ends ${formatDate(String(r.end_on), "always")} (${days} days)`, reason, risky ? `Delinquency risk score ${r.risk_score}: a person should confirm` : "Pays on time; good renewal candidate"],
        confidence: risky ? 0.6 : 0.82, risk: risky ? "Medium" : "Low", category: rent < current ? "Concession" : undefined,
        facts: { resident: name, property: String(r.property), unit: String(r.unit), end_on: String(r.end_on), current_rent_cents: current, market_rent_cents: market, offer_rent_cents: rent, days_to_end: days },
        evidence: [{ entity_type: "leases", entity_id: String(r.id), label: `${name} · ${r.property} #${r.unit}` }],
        message: { party_kind: "resident", party_id: String(r.resident_id), subject: `Your renewal offer at ${r.property}`, body: `Hi ${r.first_name}, your lease at ${r.property} #${r.unit} ends on ${formatDate(String(r.end_on), "always")}. We'd love for you to stay: we can renew for 12 months at ${money(rent)} a month. Reply to accept or to talk about other terms.` },
        effects: [{ kind: "insert", table: "renewal_offers", row: { lease_id: String(r.id), property_id: String(r.property_id), version: 1, term_months: 12, rent_cents: rent, current_rent_cents: current, market_rent_cents: market, status: "Sent", sent_at: demoNowIso(), expires_on: addDays(ctx.today, 30) } }],
        priority: 1000 - days,
      };
    })];
  },
});

async function unanswered(ctx: AgentCtx): Promise<Candidate[]> {
  const rows = await sql<Row>(ctx.data,
    `SELECT o.id, o.property_id, o.rent_cents, o.current_rent_cents, o.term_months, o.sent_at, l.id AS lease_id, l.end_on, u.number AS unit, p.name AS property, r.id AS resident_id, r.first_name, r.last_name
     FROM {renewal_offers} o JOIN {leases} l ON l.id = o.lease_id JOIN {units} u ON u.id = l.unit_id JOIN {properties} p ON p.id = l.property_id
     LEFT JOIN {residents} r ON r.household_id = l.household_id AND r.is_primary = 1
     WHERE o.status = 'Sent' AND o.responded_at IS NULL AND l.status = 'Active' AND l.end_on BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM {message_threads} t WHERE t.entity_type = 'renewal_offers' AND t.entity_id = o.id AND substr(t.last_message_at, 1, 10) > substr(o.sent_at, 1, 10))
     ORDER BY l.end_on LIMIT 20`, [ctx.today, addDays(ctx.today, 14)]);
  return rows.filter((r) => r.resident_id).map((r): Candidate => {
    const days = daysBetween(ctx.today, String(r.end_on));
    const name = `${r.first_name} ${r.last_name}`;
    const rent = Number(r.rent_cents);
    const notice = days <= 3;
    const end = letterDates(String(r.end_on));
    return {
      entity: "renewal_offers", entityId: String(r.id), propertyId: String(r.property_id), action: "renewal_offers.follow_up",
      title: notice ? `${name}'s lease ends ${days ? `in ${days} day${days === 1 ? "" : "s"}` : "today"} with no reply: send a month-to-month notice` : `Remind ${name}: renewal offer unanswered, lease ends in ${days} days`,
      why: [`Offer of ${money(rent)} sent ${formatDate(String(r.sent_at), "always")}, no reply`, `Lease ends ${formatDate(String(r.end_on), "always")} (${days ? `${days} days` : "today"})`, notice ? "Month-to-month wording is a legal notice: a person decides" : "A reminder before the lease ends"],
      confidence: notice ? 0.7 : 0.85, risk: notice ? "Medium" : "Low", alwaysHuman: notice,
      facts: { resident: name, property: String(r.property), unit: String(r.unit), end_on: String(r.end_on), offer_rent_cents: rent, current_rent_cents: Number(r.current_rent_cents ?? rent), days_to_end: days },
      evidence: [{ entity_type: "leases", entity_id: String(r.lease_id), label: `${name} · ${r.property} #${r.unit}` }, { entity_type: "renewal_offers", entity_id: String(r.id), label: "Renewal offer" }],
      message: notice
        ? { party_kind: "resident", party_id: String(r.resident_id), subject: `Your lease at ${r.property} ends ${end}`, body: `Hi ${r.first_name},\n\nYour lease at ${r.property} #${r.unit} ends on ${end}, and we haven't heard back about your renewal offer of ${money(rent)} a month for ${r.term_months ?? 12} months. Reply to accept, or to talk about other terms. If we don't hear from you by ${end}, we'll contact you about moving to month to month.` }
        : { party_kind: "resident", party_id: String(r.resident_id), subject: `Your renewal offer at ${r.property} is still open`, body: `Hi ${r.first_name},\n\nA reminder that your renewal offer of ${money(rent)} a month for ${r.term_months ?? 12} months is still open. Your lease at ${r.property} #${r.unit} ends on ${end}. Reply to accept, or let us know if you'd like to talk about other terms.` },
      effects: [], priority: 2000 - days,
    };
  });
}
