import type { Facts } from "@/entities/types";
import { formatDate, formatMoney } from "@/lib/format";

// Rules summaries for the common record types: plain sentences built only from the record's facts
// (the same figures the facts panel shows), used when no model summary matches the current record.
// Each entity def points its ai.rulesSummary here; other entities use rulesSummary in summaries.ts.

type V = Facts[string];
const num = (v: V) => (v == null || v === "" ? null : Number(v));
const str = (v: V) => (v == null || v === "" ? null : String(v));
const low = (v: V) => String(v ?? "").toLowerCase();
const money = (v: V) => formatMoney(Number(v), "whole");
const date = (v: V) => formatDate(String(v));
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sentences = (...s: (string | null | false)[]) => s.filter(Boolean).join(" ");

export function workOrderSentence(f: Facts): string {
  const where = str(f.where) ? ` at ${f.where}` : "";
  const age = num(f.age_days) ?? 0;
  const status = String(f.status);
  if (status === "Cancelled") return `Cancelled ${f.trade} job${where}.`;
  if (status === "Completed" || status === "Paid") {
    return sentences(
      `${status} ${f.trade} job${where} ${f.vendor ? `by ${f.vendor}` : "in-house"}, ${low(f.priority)} priority, finished ${f.past_sla ? "past" : "within"} SLA after ${count(age, "day")}.`,
      f.cost != null && `Cost ${money(f.cost)}.`,
    );
  }
  const state = f.vendor
    ? (status === "Assigned" ? `assigned to ${f.vendor}` : `${low(status)} with ${f.vendor}`)
    : (status === "New" || status === "Triaged" ? `${low(status)} and not yet assigned` : `${low(status)}, in-house`);
  return sentences(
    `${f.priority} ${f.trade} job${where}, ${state}.`,
    `${age === 0 ? "Opened today" : `Open ${count(age, "day")}`}, ${f.past_sla ? "past its SLA" : "within SLA"}.`,
    f.estimate != null && `Estimate ${money(f.estimate)}.`,
  );
}

export function leaseSentence(f: Facts): string {
  const rent = num(f.rent), market = num(f.market_rent), balance = num(f.balance) ?? 0, left = num(f.days_to_end);
  return sentences(
    `${f.status} lease for ${f.lease}, ${date(f.start)} to ${f.end ? date(f.end) : "month to month"}, at ${money(rent)} a month${market != null && market !== rent ? ` (market ${money(market)})` : ""}.`,
    `${count(num(f.residents) ?? 0, "resident")} on the lease.`,
    balance > 0 ? `${money(balance)} is owed.` : "No balance owed.",
    f.status === "Active" && left != null && left >= 0 && (left === 0 ? "It ends today." : `It ends in ${count(left, "day")}.`),
  );
}

export function residentSentence(f: Facts): string {
  const balance = num(f.balance) ?? 0, nsf = num(f.nsf_payments) ?? 0;
  return sentences(
    `${f.resident}${f.unit ? ` in ${f.unit}` : ""} is ${f.status === "Current" ? "a current resident" : `listed as ${low(f.status)}`}${f.lease_end ? ` with a lease ending ${date(f.lease_end)}` : ""}.`,
    balance > 0 ? `Owes ${money(balance)}.` : "No balance owed.",
    `${f.autopay ? "On autopay" : "Not on autopay"}${nsf ? `, with ${count(nsf, "returned payment")}` : ""}.`,
    f.risk_score != null && `Delinquency risk score ${f.risk_score}.`,
  );
}

export function unitSentence(f: Facts): string {
  const beds = num(f.beds) ?? 0, wo = num(f.open_work_orders) ?? 0;
  return sentences(
    `${f.unit} is ${low(f.status)}, ${beds ? `a ${beds}-bed unit with market rent` : "market rent"} ${money(f.market_rent)}.`,
    str(f.resident) && `Leased to ${f.resident}${f.lease_rent != null ? ` at ${money(f.lease_rent)} a month` : ""}${f.lease_end ? ` until ${date(f.lease_end)}` : ""}.`,
    wo ? `${count(wo, "open work order")}.` : "No open work orders.",
  );
}

export function billSentence(f: Facts): string {
  return `${f.status} bill from ${f.vendor ?? "an unnamed vendor"}${f.property ? ` for ${f.property}` : ""}: ${money(f.amount)}, due ${date(f.due_on)}${f.gl ? `, coded to ${f.gl}` : ""}.`;
}

export function prospectSentence(f: Facts): string {
  const beds = num(f.desired_beds), budget = num(f.budget), since = num(f.days_since_contact);
  const home = beds == null ? "a home" : beds === 0 ? "a studio" : `a ${beds}-bed home`;
  return sentences(
    `${f.prospect} is at the ${low(f.stage)} stage${f.source ? `, from ${f.source}` : ""}.`,
    (beds != null || budget != null) && `Looking for ${home}${budget != null ? ` with a budget of ${money(budget)}` : ""}.`,
    since != null && `Last contacted ${since === 0 ? "today" : since === 1 ? "yesterday" : `${since} days ago`}.`,
  );
}

export function complianceSentence(f: Facts): string {
  const head = `${f.item} (${low(f.kind)})`;
  if (f.completed_on) return `${head} was completed ${date(f.completed_on)}.`;
  const d = num(f.days_to_due) ?? 0;
  // Days overdue isn't a fact (days_to_due is negative), so an overdue item names its due date.
  return `${head} is ${low(f.status)}, ${d < 0 ? `past its due date of ${date(f.due_on)}` : `due ${date(f.due_on)}, ${d === 0 ? "today" : `in ${count(d, "day")}`}`}.`;
}
