import type { ActionKey } from "@/entities/types";
import { sql } from "../data";
import { delinquency, type Delinquent } from "../facts";
import { collectionsAction, LEGAL_PER_RUN, MIN_DAYS_LATE } from "../agents/collections";
import { THRESHOLDS, type Driver, type Estimate } from "./meta";
import { addDays, monthYear, onProperty, openProposals, pct, pick, plural, rateEstimate, usd, type ImproveCtx, type Improver, type StepDraft } from "./shared";

// Past-due rent: where the balance sits (age, property, household) and what the Collections Agent
// can do about it, with expected effects from what past reminders and payment plans recovered.

const CAP = 10;
const WINDOW = 30;
const over30 = (d: Delinquent) => d.aging.d31_60 + d.aging.d61_90 + d.aging.d90p;

// Approved proposals of one action whose 30-day window has closed, and what the lease paid in it.
async function history(c: ImproveCtx, action: ActionKey) {
  const cutoff = addDays(c.today, -WINDOW);
  const props = await sql<{ lease_id: string; day: string; amount: number | null }>(c.data,
    `SELECT p.entity_id AS lease_id, substr(d.decided_at, 1, 10) AS day, coalesce(p.amount_cents, json_extract(p.payload, '$.facts.balance_cents')) AS amount
     FROM {ai_proposals} p JOIN {ai_decisions} d ON d.proposal_id = p.id
     WHERE p.action = ? AND d.decision IN ('Approved', 'Edited') AND substr(d.decided_at, 1, 10) <= ?`,
    [action, cutoff]);
  if (!props.length) return { props, paid: () => 0, first: null as string | null };
  const first = props.reduce((m, p) => (p.day < m ? p.day : m), props[0].day);
  const pays = await sql<{ lease_id: string; received_on: string; amount_cents: number }>(c.data,
    "SELECT lease_id, received_on, amount_cents FROM {payments} WHERE nsf = 0 AND received_on > ? AND lease_id IN (SELECT value FROM json_each(?))",
    [first, JSON.stringify([...new Set(props.map((p) => p.lease_id))])]);
  const paid = (p: { lease_id: string; day: string }) => {
    const end = addDays(p.day, WINDOW);
    return pays.filter((x) => x.lease_id === p.lease_id && x.received_on > p.day && x.received_on <= end).reduce((s, x) => s + x.amount_cents, 0);
  };
  return { props, paid, first };
}

async function reminderEstimate(c: ImproveCtx, n: number): Promise<Estimate | null> {
  const h = await history(c, "leases.send_reminder");
  const hits = h.props.filter((p) => h.paid(p) > 0).length;
  const r = rateEstimate(hits, h.props.length);
  if (!r || !n) return null;
  const value = Math.round(r.rate * n);
  return {
    kind: "count", value, text: `About ${value} of ${plural(n, "household")} pay something within ${WINDOW} days`, confidence: r.confidence, sample: h.props.length,
    basis: `${pct(r.rate)} of ${h.props.length} reminders approved in your properties since ${monthYear(h.first!)} were followed by a payment within ${WINDOW} days.`,
  };
}

async function planEstimate(c: ImproveCtx, balanceCents: number): Promise<Estimate | null> {
  const h = await history(c, "leases.offer_payment_plan");
  const offered = h.props.filter((p) => Number(p.amount) > 0);
  const total = offered.reduce((s, p) => s + Number(p.amount), 0);
  const recovered = offered.reduce((s, p) => s + Math.min(h.paid(p), Number(p.amount)), 0);
  const base = rateEstimate(0, offered.length);
  if (!base || !total || !balanceCents) return null;
  const r = { ...base, rate: recovered / total };
  const value = Math.round(r.rate * balanceCents);
  return {
    kind: "money", value, text: `About ${usd(value)} of ${usd(balanceCents)} recovered within ${WINDOW} days`, confidence: r.confidence, sample: offered.length,
    basis: `Past payment-plan offers in your properties recovered ${pct(r.rate)} of the offered balance within ${WINDOW} days (${offered.length} offers since ${monthYear(h.first!)}).`,
  };
}

export const delinquencyImprover: Improver = {
  key: "delinquency",
  async analyze(c) {
    const { rows } = await delinquency(c.data, c.today, { minDays: 1, propertyIds: c.property ? [c.property] : undefined, limit: 100_000 });
    const total = rows.reduce((s, d) => s + d.balance_cents, 0);
    const late30 = rows.filter((d) => over30(d) > 0);
    const b30 = late30.reduce((s, d) => s + over30(d), 0);
    const late90 = rows.filter((d) => d.aging.d90p > 0);
    const b90 = late90.reduce((s, d) => s + d.aging.d90p, 0);
    const p = onProperty(c, "c");
    // The last closed month's charges, the same total the receivables page compares against.
    const lastMonth = new Date(Date.UTC(Number(c.today.slice(0, 4)), Number(c.today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const [roll] = await sql<{ cents: number }>(c.data, `SELECT coalesce(sum(c.amount_cents), 0) AS cents FROM {charges} c WHERE c.period = ?${p.sql}`, [lastMonth, ...p.params]);
    const rentRoll = Number(roll?.cents ?? 0);

    const drivers: Driver[] = [];
    if (total) drivers.push({ text: `${pct(b30 / total)} of the past-due balance is over 30 days late: ${usd(b30)} across ${plural(late30.length, "household")}.`, share: b30 / total, href: "/app/receivables/delinquency" });
    if (b30 && !c.property) {
      const byProp = new Map<string, { id: string; name: string; cents: number; n: number }>();
      for (const d of late30) {
        const x = byProp.get(d.property_id) ?? { id: d.property_id, name: d.property, cents: 0, n: 0 };
        x.cents += over30(d);
        x.n++;
        byProp.set(d.property_id, x);
      }
      for (const x of [...byProp.values()].sort((a, b) => b.cents - a.cents).slice(0, 2)) {
        drivers.push({ text: `${pct(x.cents / b30)} of the 30+ day balance is ${plural(x.n, "household")} at ${x.name} (${usd(x.cents)}).`, share: x.cents / b30, href: `/app/receivables/charges?f.property_id=${x.id}&f.status=Overdue` });
      }
    } else if (total) {
      for (const d of [...rows].sort((a, b) => b.balance_cents - a.balance_cents).slice(0, 2)) {
        drivers.push({ text: `${d.resident}, #${d.unit}: ${usd(d.balance_cents)}, ${d.days_late} days late (${pct(d.balance_cents / total)} of the balance).`, share: d.balance_cents / total, href: `/app/leases/${d.lease_id}` });
      }
    }
    if (b90) drivers.push({ text: `${usd(b90)} is over 90 days late across ${plural(late90.length, "household")}.`, share: total ? b90 / total : null, href: "/app/receivables/delinquency" });

    const reasons = rentRoll ? [`Balances over 30 days late are ${(b30 / rentRoll * 100).toFixed(1)}% of last month's charges; the alert line is ${THRESHOLDS.over30OfRentRoll * 100}%.`] : [];

    // The plan: the Collections Agent's own rule decides each lease's follow-up.
    const eligible = rows.filter((d) => d.days_late >= MIN_DAYS_LATE);
    const open = await openProposals(c, "collections", eligible.map((d) => d.lease_id));
    const of = (a: ActionKey) => eligible.filter((d) => collectionsAction(d) === a);
    const byBalance = (a: Delinquent, b: Delinquent) => b.balance_cents - a.balance_cents;
    const remind = pick(of("leases.send_reminder").sort(byBalance), (d) => d.lease_id, "leases.send_reminder", open, CAP);
    const plans = pick(of("leases.offer_payment_plan").sort(byBalance), (d) => d.lease_id, "leases.offer_payment_plan", open, CAP);
    const legal = pick(of("leases.refer_to_legal").sort((a, b) => b.days_late - a.days_late || byBalance(a, b)), (d) => d.lease_id, "leases.refer_to_legal", open, LEGAL_PER_RUN);
    const planBalance = plans.chosen.reduce((s, d) => s + d.balance_cents, 0);
    const steps: StepDraft[] = [];
    if (remind.eligible) steps.push({
      key: "remind", title: `Send rent reminders to ${plural(remind.chosen.length, "household")}`,
      detail: `Late ${MIN_DAYS_LATE}–30 days, or later with a payment plan already open. Largest balances first; written in the resident's language.`,
      agent: "collections", action: "leases.send_reminder", ids: remind.chosen.map((d) => d.lease_id), records: remind.chosen.length, eligible: remind.eligible, waiting: remind.waiting,
      href: "/app/receivables/delinquency", risk: "Low", estimate: await reminderEstimate(c, remind.chosen.length),
    });
    if (plans.eligible) steps.push({
      key: "plan", title: `Offer 3-payment plans to ${plural(plans.chosen.length, "household")}`,
      detail: "31–90 days late with no plan on file. The offer splits the balance into three payments; nothing is waived.",
      agent: "collections", action: "leases.offer_payment_plan", ids: plans.chosen.map((d) => d.lease_id), records: plans.chosen.length, eligible: plans.eligible, waiting: plans.waiting,
      href: "/app/receivables/delinquency", risk: "Medium", estimate: await planEstimate(c, planBalance), atStakeCents: planBalance,
    });
    if (legal.eligible) steps.push({
      key: "legal", title: `Refer ${plural(legal.chosen.length, "balance")} over 90 days for legal review`,
      detail: `A manager reviews each one and checks the state's notice rules first. The agent refers at most ${LEGAL_PER_RUN} per run.`,
      agent: "collections", action: "leases.refer_to_legal", ids: legal.chosen.map((d) => d.lease_id), records: legal.chosen.length, eligible: legal.eligible, waiting: legal.waiting,
      href: "/app/receivables/delinquency", risk: "High", alwaysHuman: true, estimate: null, atStakeCents: legal.chosen.reduce((s, d) => s + d.balance_cents, 0),
    });
    return {
      headline: total ? `${usd(total)} past due across ${plural(rows.length, "household")}; ${usd(b30)} of it is over 30 days late.` : "Nothing is past due right now.",
      reasons, drivers, steps,
    };
  },

  async outcome(c, since, ids) {
    const leases = [...new Set(Object.values(ids).flat())];
    if (!leases.length) return [];
    const [r] = await sql<{ n: number; cents: number }>(c.data,
      "SELECT count(DISTINCT lease_id) AS n, coalesce(sum(amount_cents), 0) AS cents FROM {payments} WHERE nsf = 0 AND received_on >= ? AND lease_id IN (SELECT value FROM json_each(?))",
      [since.slice(0, 10), JSON.stringify(leases)]);
    return [`${usd(Number(r?.cents ?? 0))} paid by ${Number(r?.n ?? 0)} of ${plural(leases.length, "household")} in the plan`];
  },
};
