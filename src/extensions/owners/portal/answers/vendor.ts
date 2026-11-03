import "server-only";
import { AS_OF } from "@/seed/constants";
import type { Answer, Lookup } from "../ask";
import type { PortalCtx } from "../context";
import { cois, invoices, jobs, payouts } from "../vendor-data";

// The vendor's questions about jobs, invoices, payments and insurance, from their own records.

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "not yet scheduled");

export async function answerVendor(c: PortalCtx, q: string): Promise<Answer> {
  const trace: Lookup[] = [];
  if (/invoice|unpaid|owe|bill/i.test(q)) {
    const inv = await invoices(c, 1, 50);
    const open = inv.rows.filter((r) => r.status === "Awaiting approval" || r.status === "Approved" || r.status === "On its way");
    trace.push({ label: "Your invoices", detail: `${inv.total} on file, ${open.length} not paid yet` });
    return {
      answer: open.length
        ? `${open.length} invoice${open.length === 1 ? " is" : "s are"} not paid yet, ${usd(open.reduce((a, r) => a + Number(r.total_cents), 0))} in total: ${open.slice(0, 4).map((r) => `${r.invoice_number} for ${r.title} (${usd(Number(r.total_cents))}, ${r.status.toLowerCase()})`).join("; ")}. Approved invoices are paid by ACH and usually arrive in 1–2 business days.`
        : "All your invoices are paid. Nothing is waiting.",
      facts: { open: open.length, amounts: open.map((r) => usd(Number(r.total_cents))) }, trace, links: [{ label: "Invoices", href: "/portal/vendor/invoices" }],
    };
  }
  if (/pay|paid|payment|money|deposit|1099/i.test(q)) {
    const p = await payouts(c, 1, 5);
    trace.push({ label: "Your payments", detail: `${p.total} payouts, ${usd(p.ytd_cents)} in ${p.year}` });
    const last = p.rows[0];
    return {
      answer: `You've been paid ${usd(p.ytd_cents)} so far in ${p.year}.${last ? ` The latest payment was ${usd(last.amount_cents)} for ${last.ref} (${last.status === "Pending" ? "on its way" : `paid ${last.created.slice(0, 10)}`}).` : ""}${p.pending_cents ? ` ${usd(p.pending_cents)} is on its way now.` : ""} Your 1099-NEC for each year is under Payments.`,
      facts: { ytd: usd(p.ytd_cents), pending: usd(p.pending_cents), last: last ? usd(last.amount_cents) : null, last_date: last?.created.slice(0, 10) ?? null }, trace, links: [{ label: "Payments", href: "/portal/vendor/payments" }],
    };
  }
  if (/insur|coi|certificate|expire/i.test(q)) {
    const list = await cois(c);
    const cur = list[0];
    trace.push({ label: "Your insurance certificates", detail: `${list.length} on file` });
    return {
      answer: !cur ? "We don't have an insurance certificate for you. Upload one under Insurance so we can keep assigning jobs." : cur.status === "Expired" ? `Your certificate from ${cur.carrier} expired on ${cur.expires_on}. Upload the renewal under Insurance; new jobs are held until we have it.` : `Your certificate from ${cur.carrier} is valid until ${cur.expires_on} (${cur.days} days from today).${cur.status === "Expiring" ? " That's within 30 days, so please upload the renewal soon." : ""}`,
      facts: cur ? { carrier: cur.carrier, expires_on: cur.expires_on, days: cur.days } : {}, trace, links: [{ label: "Insurance", href: "/portal/vendor/insurance" }],
    };
  }
  const [fresh, active] = await Promise.all([jobs(c, "new"), jobs(c, "active")]);
  const week = active.rows.filter((j) => j.scheduled_at && j.scheduled_at.slice(0, 10) <= new Date(Date.parse(AS_OF) + 7 * 86_400_000).toISOString().slice(0, 10));
  trace.push({ label: "Your jobs", detail: `${fresh.total} new, ${active.total} scheduled or in progress` });
  return {
    answer: `${fresh.total ? `${fresh.total} new job${fresh.total === 1 ? " needs" : "s need"} you to accept or decline. ` : ""}${active.total ? `You have ${active.total} job${active.total === 1 ? "" : "s"} scheduled or in progress${week.length ? `, ${week.length} this week: ${week.slice(0, 4).map((j) => `${j.title} at ${j.property} (${day(j.scheduled_at)})`).join("; ")}` : ""}.` : "Nothing is scheduled right now."}`,
    facts: { new: fresh.total, active: active.total, dates: week.map((j) => j.scheduled_at?.slice(0, 10)) }, trace, links: [{ label: "Jobs", href: "/portal/vendor/jobs" }],
  };
}
