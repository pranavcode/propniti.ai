import "server-only";
import { AS_OF } from "@/seed/constants";
import type { Answer, Lookup } from "../ask";
import type { PortalCtx } from "../context";
import { currentLease, daysUntil, insurance, me, offers, OPEN_WO, openCharges, requests } from "../resident-data";
import { formatDate, formatMonth } from "@/lib/format";

// The resident's AI help, answered from their own lease, ledger and requests.

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
// "Rent 2026-11" reads "Rent Nov 2026".
const chargeName = (s: string) => s.replace(/\b(\d{4}-\d{2})\b(?!-)/g, (m) => formatMonth(`${m}-01`));
const nextFirst = () => {
  const [y, m] = AS_OF.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

export async function answerResident(c: PortalCtx, q: string): Promise<Answer> {
  const r = await me(c);
  if (!r) return { answer: "I couldn't find your resident record. Please message the office.", facts: {}, trace: [] };
  const lease = await currentLease(c, r.household_id);
  const trace: Lookup[] = [{ label: "Resident", detail: `${r.first_name} ${r.last_name} (${r.id})` }];
  if (lease) trace.push({ label: "Lease", detail: `${lease.id}: ${lease.property} #${lease.unit}, ${usd(lease.rent_cents)}/month, ${formatDate(lease.start_on, "always")} to ${lease.end_on ? formatDate(lease.end_on, "always") : "month-to-month"}` });
  const text = q.toLowerCase();

  if (/\b(rent|due|balance|owe|pay|payment|late|fee)\b/.test(text)) {
    const open = await openCharges(c, r.household_id);
    const total = open.reduce((a, x) => a + x.balance_cents, 0);
    const overdue = open.filter((x) => x.status === "Overdue");
    const processing = open.filter((x) => x.status === "Processing");
    trace.push({ label: "Open charges", detail: open.length ? open.map((x) => `${chargeName(x.description)} ${usd(x.balance_cents)} (${x.status.toLowerCase()}, due ${formatDate(x.due_on, "always")})`).join("; ") : "None" });
    let answer: string;
    if (!open.length) answer = `You're all paid up. Your next rent of ${lease ? usd(lease.rent_cents) : "your monthly rent"} is due on ${day(nextFirst())}.`;
    else {
      answer = `You owe ${usd(total)} right now across ${open.length} charge${open.length === 1 ? "" : "s"}.`;
      if (overdue.length) answer += ` ${overdue.map((x) => `${chargeName(x.description)} (${usd(x.balance_cents)})`).join(", ")} ${overdue.length === 1 ? "was" : "were"} due on ${day(overdue[0].due_on)} and ${overdue.length === 1 ? "is" : "are"} now past due.`;
      if (processing.length) answer += ` A payment of ${usd(processing.reduce((a, x) => a + x.balance_cents, 0))} is already processing.`;
      answer += " You can pay by ACH on the Pay page.";
    }
    answer += r.autopay ? " Autopay is on, so rent is paid on the 1st." : " Autopay is off.";
    return { answer, facts: { total_cents: total, open: open.length, autopay: !!r.autopay, next_due: nextFirst() }, trace, links: [{ label: "Pay rent", href: "/portal/resident/pay" }] };
  }

  if (/\b(autopay|auto-pay|automatic)\b/.test(text)) {
    return { answer: r.autopay ? "Autopay is on. Rent is paid from your bank account on file on the 1st of each month. You can turn it off on the Pay page." : "Autopay is off. Turn it on from the Pay page and rent will be paid on the 1st each month.", facts: { autopay: !!r.autopay }, trace, links: [{ label: "Autopay settings", href: "/portal/resident/pay" }] };
  }

  if (/\b(repair|maintenance|fix|broken|leak|ac|a\/c|heat|hvac|request|work order|technician|scheduled)\b/.test(text)) {
    const list = await requests(c, lease?.unit_id ?? null, lease?.move_in_on ?? lease?.start_on ?? null);
    const open = list.filter((w) => OPEN_WO.includes(w.status));
    trace.push({ label: "Maintenance requests", detail: list.length ? list.slice(0, 5).map((w) => `${w.id} ${w.title} (${w.status})`).join("; ") : "None on file" });
    const topic = /\b(ac|a\/c|cool|hvac|heat)\b/.test(text) ? open.find((w) => w.category === "HVAC") : undefined;
    const w = topic ?? open[0];
    let answer: string;
    if (!w) answer = list.length ? `You have no open requests. Your last one, "${list[0].title}" (${list[0].id}), is ${list[0].status.toLowerCase()}.` : "You have no maintenance requests on file. You can start one on the Requests page.";
    else {
      answer = `"${w.title}" (${w.id}) is ${w.status.toLowerCase()}.`;
      if (w.scheduled_at) answer += ` A visit is scheduled for ${day(w.scheduled_at)}${w.vendor ? ` with ${w.vendor}` : ""}.`;
      else answer += " It isn't scheduled yet; the team will confirm a time.";
      if (open.length > 1) answer += ` You have ${open.length} open requests in total.`;
    }
    return { answer, facts: { open: open.length, scheduled_at: w?.scheduled_at ?? null }, trace, links: [{ label: "My requests", href: "/portal/resident/requests" }] };
  }

  if (/\b(renew|renewal|lease end|move out|moving|expire)\b/.test(text) && lease) {
    const list = await offers(c, lease.id);
    const sent = list.filter((o) => o.status === "Sent");
    trace.push({ label: "Renewal offers", detail: list.length ? list.map((o) => `${o.term_months} months at ${usd(o.rent_cents)} (${o.status})`).join("; ") : "None yet" });
    const answer = sent.length
      ? `Your lease ends on ${lease.end_on ? day(lease.end_on) : "—"}. You have ${sent.length} renewal offer${sent.length === 1 ? "" : "s"}: ${sent.map((o) => `${o.term_months} months at ${usd(o.rent_cents)} a month`).join(" or ")}${sent[0].expires_on ? `, open until ${day(sent[0].expires_on)}` : ""}. Accept one on the Lease page.`
      : `Your lease ends on ${lease.end_on ? day(lease.end_on) : "—"}${lease.end_on ? ` (in ${daysUntil(lease.end_on)} days)` : ""}. There's no renewal offer yet; the office usually sends one 60 to 90 days before the end date. You can ask for one in Messages.`;
    return { answer, facts: { end_on: lease.end_on, offers: sent.length }, trace, links: [{ label: "My lease", href: "/portal/resident/lease" }] };
  }

  if (/\b(insurance|renters|policy|liability)\b/.test(text) && lease) {
    const i = await insurance(c, lease.id);
    trace.push({ label: "Renters insurance", detail: i ? `${i.carrier} ${i.policy_number}, ${usd(i.liability_cents)} liability, expires ${formatDate(i.expires_on, "always")} (${i.status})` : "No policy on file" });
    const answer = !i
      ? "We don't have a renters insurance policy on file for you. Your lease requires one. Message the office and they'll tell you how to send your declarations page."
      : `Your policy with ${i.carrier} has ${usd(i.liability_cents)} of liability cover and expires on ${day(i.expires_on)}.${daysUntil(i.expires_on) <= 30 ? " That's soon: send us the renewal so you stay covered." : ""}`;
    return { answer, facts: { expires_on: i?.expires_on ?? null }, trace, links: [{ label: "My lease", href: "/portal/resident/lease" }] };
  }

  return {
    answer: "I can help with your balance and rent due dates, autopay, maintenance requests, your renewal and renters insurance. For anything else, message the office.",
    facts: {},
    trace,
    links: [{ label: "Message the office", href: "/portal/resident/messages" }],
  };
}
