import type { Delinquent } from "../facts";
import { addDays, defineAgent, money, type Candidate } from "./framework";
import { planMessage, planSplit, reminder } from "../rules";
export { reminder } from "../rules";

// Delinquency follow-up: a reminder for the recently late, a payment plan offer at 31–90 days,
// and a legal referral (always a person) past 90 days.

export default defineAgent({
  key: "collections",
  name: "Collections agent",
  ownerRole: "property_manager",
  goal: "Follow up on every resident who owes rent: remind the recently late, offer payment plans at 31–90 days, and refer 90+ day balances to a manager for legal review. Never promise a waiver.",
  tools: ["ledger.delinquency", "ledger.lookup", "records.get", "records.related", "policy.lookup", "messages.draft", "actions.propose"],
  triggers: { schedule: "0 14 * * *", events: ["payment.failed", "charge.overdue"] },
  autonomy: "act_with_approval",
  entities: ["leases", "charges", "payments"],
  actions: ["leases.send_reminder", "leases.offer_payment_plan", "leases.refer_to_legal"],
  maxProposals: 8,
  async collect(ctx, trigger) {
    const input = (trigger.input ?? {}) as { lease_id?: string };
    const res = await ctx.call<{ rows: Delinquent[]; total: number; total_balance_cents: number }>("ledger.delinquency", { min_days: 5, limit: 50 });
    const rows = input.lease_id ? res.rows.filter((r) => r.lease_id === input.lease_id) : res.rows;
    // At most three legal referrals per run, so reminders and plans for newer balances still go out.
    let legal = 0;
    return rows.filter((d) => d.days_late <= 90 || legal++ < 3).map((d): Candidate => {
      const facts = {
        resident: d.resident, property: d.property, unit: d.unit, language: d.language, balance_cents: d.balance_cents, days_late: d.days_late,
        oldest_due_on: d.oldest_due_on, aging_90p_cents: d.aging.d90p, ...planSplit(d.balance_cents), risk_score: d.risk_score,
      };
      const base = { entity: "leases" as const, entityId: d.lease_id, propertyId: d.property_id, facts, evidence: [{ entity_type: "leases", entity_id: d.lease_id, label: `${d.resident} · ${d.property} #${d.unit}` }] };
      const party = d.resident_id ? { party_kind: "resident" as const, party_id: d.resident_id } : null;
      if (d.days_late > 90) {
        return {
          ...base, action: "leases.refer_to_legal", title: `Review ${d.resident} for legal action — ${money(d.balance_cents)}, ${d.days_late} days late`,
          why: [`${money(d.balance_cents)} owed; oldest unpaid charge due ${d.oldest_due_on} (${d.days_late} days)`, `${money(d.aging.d90p)} is over 90 days old`, d.open_plan ? "A payment plan is already open and isn't being kept" : "No payment plan on file"],
          confidence: 0.85, risk: "High", category: "Legal", alwaysHuman: true, mandatory: true, priority: 3000 + d.days_late,
          effects: [{ kind: "task", title: `Legal review: ${d.resident}, ${d.property} #${d.unit}`, detail: `Balance ${money(d.balance_cents)}, ${d.days_late} days late. Check state notice rules before any filing.`, assignee_role: "property_manager", priority: "High", due_on: addDays(ctx.today, 3) }],
        };
      }
      if (d.days_late > 30 && !d.open_plan && party) {
        return {
          ...base, action: "leases.offer_payment_plan", title: `Offer ${d.resident} a 3-payment plan for ${money(d.balance_cents)}`,
          why: [`${money(d.balance_cents)} owed, ${d.days_late} days late`, "No payment plan on file", facts.installment_cents === facts.final_installment_cents ? `Three payments of ${money(facts.installment_cents)}` : `Two payments of ${money(facts.installment_cents)} and a final ${money(facts.final_installment_cents)}`],
          confidence: 0.8, risk: "Medium", priority: 2000 + d.days_late,
          message: { ...party, ...planMessage(d) },
          effects: [{ kind: "task", title: `Payment plan follow-up: ${d.resident}`, detail: `Offered 3 payments totalling ${money(d.balance_cents)}.`, assignee_role: "property_manager", due_on: addDays(ctx.today, 7) }],
        };
      }
      return {
        ...base, action: "leases.send_reminder", title: `Remind ${d.resident} — ${money(d.balance_cents)}, ${d.days_late} days late`,
        why: [`${money(d.balance_cents)} owed since ${d.oldest_due_on}`, d.risk_score != null ? `Delinquency risk score ${d.risk_score}/100` : "First reminder this cycle"],
        confidence: 0.92, risk: "Low", priority: 1000 + d.days_late,
        message: party ? { ...party, ...reminder(d) } : undefined, effects: [],
      };
    });
  },
});
