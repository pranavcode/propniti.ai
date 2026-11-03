import "server-only";
import type { Answer, Lookup } from "../ask";
import type { PortalCtx } from "../context";
import { monthLabel, statementOf } from "../../statements";
import { ownerApprovals, ownerDistributions, ownerMonthly, ownerProperties } from "../owner-data";

// The owner's questions, answered from their statements, properties and approvals. Each branch
// computes its figures first; the words only arrange them.

const usd = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

export async function answerOwner(c: PortalCtx, q: string): Promise<Answer> {
  const trace: Lookup[] = [];
  if (/distribut|payout|paid|lower|higher|less|more|why/i.test(q) && !/repair|approv/i.test(q)) return distribution(c, trace);
  if (/repair|approv|maintenance|work order|spend/i.test(q)) return repairs(c, q, trace);
  if (/occupan|vacan|lease|noi|income|perform/i.test(q)) return performance(c, trace);
  const [d] = await ownerDistributions(c, 1);
  return {
    answer: `I can explain your statements and distributions, how your properties are performing (occupancy, NOI, collections) and which repairs need your approval.${d ? ` Your latest distribution was ${usd(d.amount_cents)} for ${monthLabel(d.period)}.` : ""}`,
    facts: d ? { latest_distribution: usd(d.amount_cents), period: d.period } : {},
    trace: [{ label: "Distributions", detail: d ? `${d.id}` : "none yet" }],
    links: [{ label: "Statements", href: "/portal/owner/statements" }, { label: "Approvals", href: "/portal/owner/approvals" }],
  };
}

async function distribution(c: PortalCtx, trace: Lookup[]): Promise<Answer> {
  const ds = await ownerDistributions(c, 6);
  const [now, before] = ds;
  trace.push({ label: "Your distributions", detail: ds.slice(0, 2).map((d) => `${d.id}: ${usd(d.amount_cents)}`).join("; ") || "none" });
  if (!now) return { answer: "You haven't received a distribution yet. The first one is sent after your first full month.", facts: {}, trace };
  if (!before) return { answer: `Your first distribution was ${usd(now.amount_cents)} for ${monthLabel(now.period)}.`, facts: { amount: usd(now.amount_cents) }, trace };
  const [a, b] = await Promise.all([statementOf(c, now.owner_entity_id, now.period), statementOf(c, before.owner_entity_id, before.period)]);
  trace.push({ label: "Statements compared", detail: `${monthLabel(now.period)} and ${monthLabel(before.period)}, rebuilt from the trust ledger` });
  const delta = now.amount_cents - before.amount_cents;
  const drivers = [
    { label: "rent collected", d: (now.income_cents - before.income_cents) },
    { label: "repairs and vendor payments", d: -(now.expense_cents - before.expense_cents) },
    { label: "the management fee", d: -(now.fee_cents - before.fee_cents) },
    { label: "the operating reserve", d: -(now.reserve_cents - before.reserve_cents) },
  ].filter((x) => Math.abs(x.d) >= 100).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const facts: Record<string, unknown> = { this_month: usd(now.amount_cents), last_month: usd(before.amount_cents), change: usd(delta) };
  let text = `Your ${monthLabel(now.period)} distribution was ${usd(now.amount_cents)}, ${usd(delta)} ${delta < 0 ? "less" : "more"} than ${monthLabel(before.period)} (${usd(before.amount_cents)}).`;
  if (drivers.length) {
    text += " " + drivers.slice(0, 3).map((x, i) => `${i === 0 ? "The main reason was" : "Also,"} ${x.label}: ${x.d < 0 ? "it lowered" : "it raised"} the payout by ${usd(x.d)}.`).join(" ");
    drivers.slice(0, 3).forEach((x) => (facts[x.label] = usd(x.d)));
  }
  if (a && b) {
    const vendorDelta = a.totals.vendor_cents - b.totals.vendor_cents;
    const top = a.payees[0];
    if (vendorDelta > 0 && top) {
      text += ` The largest vendor payment this month went to ${top.name} (${usd(top.amount_cents)}).`;
      facts.top_vendor = `${top.name} ${usd(top.amount_cents)}`;
      trace.push({ label: "Vendor payments", detail: a.payees.slice(0, 3).map((p) => `${p.name} ${usd(p.amount_cents)}`).join("; ") });
    }
    const props = a.properties.map((p) => ({ name: p.name, d: p.rent_cents - (b.properties.find((x) => x.property_id === p.property_id)?.rent_cents ?? 0) })).sort((x, y) => x.d - y.d);
    if (props[0] && props[0].d < -100 && delta < 0) {
      text += ` Rent collected fell most at ${props[0].name} (${usd(props[0].d)} lower).`;
      facts.weakest_property = `${props[0].name} ${usd(props[0].d)}`;
    }
    trace.push({ label: "Rent by property", detail: a.properties.map((p) => `${p.name} ${usd(p.rent_cents)}`).join("; ") });
  }
  return { answer: text, facts, trace, links: [{ label: `Open the ${monthLabel(now.period)} statement`, href: `/portal/owner/statements?entity=${now.owner_entity_id}&period=${now.period}` }] };
}

async function repairs(c: PortalCtx, q: string, trace: Lookup[]): Promise<Answer> {
  const all = await ownerApprovals(c);
  const waiting = all.filter((a) => !a.decision);
  trace.push({ label: "Repairs over your approval limit", detail: `${all.length} in the last 90 days, ${waiting.length} waiting` });
  const limit = all[0]?.limit_cents;
  let text = waiting.length
    ? `${waiting.length} repair${waiting.length === 1 ? " is" : "s are"} waiting for your approval: ${waiting.slice(0, 3).map((w) => `${w.title} at ${w.property} (${usd(w.amount_cents)})`).join("; ")}.`
    : "Nothing is waiting for your approval right now.";
  if (limit != null) text += ` Your approval limit is ${usd(limit)}; repairs below it are handled by the property team.`;
  const decided = all.filter((a) => a.decision);
  if (/quarter|month|happened|over/i.test(q) && decided.length) text += ` In the last 90 days you decided on ${decided.length}: ${decided.slice(0, 3).map((d) => `${d.title} (${d.decision?.toLowerCase()}, ${usd(d.amount_cents)})`).join("; ")}.`;
  return { answer: text, facts: { waiting: waiting.length, limit: limit != null ? usd(limit) : null, amounts: waiting.map((w) => usd(w.amount_cents)), decided: decided.map((d) => usd(d.amount_cents)) }, trace, links: waiting.length ? [{ label: "Review approvals", href: "/portal/owner/approvals" }] : [] };
}

async function performance(c: PortalCtx, trace: Lookup[]): Promise<Answer> {
  const [months, props] = await Promise.all([ownerMonthly(c, 6), ownerProperties(c)]);
  const last = months.at(-1);
  const first = months[0];
  trace.push({ label: "Monthly property metrics", detail: `${months.length} months for ${props.length} properties` });
  if (!last || !first) return { answer: "There isn't enough history yet to show a trend.", facts: {}, trace };
  const low = [...props].filter((p) => p.occupancy != null).sort((a, b) => (a.occupancy ?? 0) - (b.occupancy ?? 0))[0];
  let text = `Occupancy across your ${props.length} properties was ${pct(last.occupancy ?? 0)} in ${monthLabel(last.month)}, ${(last.occupancy ?? 0) >= (first.occupancy ?? 0) ? "up" : "down"} from ${pct(first.occupancy ?? 0)} in ${monthLabel(first.month)}.`;
  text += ` NOI for ${monthLabel(last.month)} was ${usd(last.noi * 100)}${last.budget != null ? ` against a budget of ${usd(last.budget * 100)}` : ""}.`;
  if (low?.occupancy != null) text += ` ${low.name} has the lowest occupancy at ${pct(low.occupancy)}.`;
  return { answer: text, facts: { occupancy_now: pct(last.occupancy ?? 0), occupancy_then: pct(first.occupancy ?? 0), noi: usd(last.noi * 100), budget: last.budget != null ? usd(last.budget * 100) : null, lowest: low ? `${low.name} ${pct(low.occupancy ?? 0)}` : null }, trace, links: [{ label: "Your properties", href: "/portal/owner/properties" }] };
}
