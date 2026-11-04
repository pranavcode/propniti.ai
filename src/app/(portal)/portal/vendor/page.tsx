import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { KpiCard } from "@/components/app/dashboard";
import { EmptyState } from "@/components/app/states";
import { portalCtx } from "@/extensions/owners/portal/context";
import { cois, invoices, jobCounts, jobs, payouts, vendorMe } from "@/extensions/owners/portal/vendor-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { PortalAsk } from "@/extensions/owners/portal/ui/PortalAsk";
import { CoiBanner } from "@/extensions/owners/portal/ui/vendor/CoiBanner";
import { JobRow } from "@/extensions/owners/portal/ui/vendor/JobRow";

// Vendor home: new assignments to accept, this week's jobs, money owed and paid, insurance status.
export default async function VendorHome() {
  const c = await portalCtx("vendor");
  if (!c) return null;
  const [me, counts, fresh, active, toInvoice, inv, pay, certs] = await Promise.all([vendorMe(c), jobCounts(c), jobs(c, "new", 1, 5), jobs(c, "active", 1, 5), jobs(c, "invoice", 1, 5), invoices(c, 1, 1), payouts(c, 1, 1), cois(c)]);
  const list = [...fresh.rows, ...active.rows, ...toInvoice.rows];
  return (
    <div className="space-y-5">
      <PortalTitle eyebrow={me?.company} title={`Hi ${c.persona.name.split(" ")[0]}`} description={`${counts.new} new assignment${counts.new === 1 ? "" : "s"}, ${counts.active} scheduled or in progress, ${counts.invoice} ready to invoice.`} />
      <CoiBanner coi={certs[0]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="New assignments" value={counts.new} format="count" href="/portal/vendor/jobs?tab=new" />
        <KpiCard label="Scheduled" value={counts.active} format="count" href="/portal/vendor/jobs?tab=active" />
        <KpiCard label="Awaiting payment" value={inv.unpaid_cents / 100} format="money" href="/portal/vendor/invoices" />
        <KpiCard label={`Paid in ${pay.year}`} value={pay.ytd_cents / 100} format="money" href="/portal/vendor/payments" footnote={pay.pending_cents ? <span>{`$${(pay.pending_cents / 100).toLocaleString("en-US")} on its way`}</span> : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="todo-h" className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3"><h2 id="todo-h" className="text-[14px] font-semibold">Needs you</h2><Link href="/portal/vendor/jobs" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">All jobs<ArrowRight className="size-3.5" /></Link></div>
          {list.length ? <ul className="divide-y">{list.map((j) => <JobRow key={j.id} j={j} me={c.me} />)}</ul> : <div className="p-4"><EmptyState kind="tasks" title="Nothing needs you right now" description="New assignments show up here first." compact /></div>}
        </section>
        <PortalAsk title="Ask about your jobs and payments" prompts={c.persona.assistantPrompts} />
      </div>
    </div>
  );
}
