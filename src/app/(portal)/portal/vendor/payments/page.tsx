import { formatDate } from "@/lib/format";
import { KpiCard } from "@/components/app/dashboard";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { portalCtx } from "@/extensions/owners/portal/context";
import { forms1099, paidByPayer, payouts, vendorMe } from "@/extensions/owners/portal/vendor-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { Pager } from "@/extensions/owners/portal/ui/vendor/Pager";

type Props = { searchParams: Promise<{ page?: string }> };

// ACH payouts and 1099-NEC forms. Each owner entity that paid the vendor files its own 1099.
export default async function VendorPayments({ searchParams }: Props) {
  const c = await portalCtx("vendor");
  if (!c) return null;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [me, pay, forms] = await Promise.all([vendorMe(c), payouts(c, page), forms1099(c)]);
  const lastYear = String(Number(pay.year) - 1);
  const summary = forms.length ? null : await paidByPayer(c, lastYear);
  return (
    <>
      <PortalTitle title="Payments" description={`ACH to the account ending ${me?.bank_last4 || "on file"}. Payments usually arrive 1–2 business days after an invoice is approved.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Paid in ${pay.year}`} value={pay.ytd_cents / 100} format="money" />
        <KpiCard label="On its way" value={pay.pending_cents / 100} format="money" />
        <KpiCard label="Payments received" value={pay.total} format="count" />
        <KpiCard label="Last payment" value={null} footnote={<span>{pay.last ? formatDate(pay.last) : "None yet"}</span>} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-xl border bg-card">
          <h2 className="border-b px-4 py-3 text-[14px] font-semibold">Payment history</h2>
          {pay.rows.length ? (
            <ul className="divide-y">
              {pay.rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{p.ref}</p><p className="truncate text-[12px] text-muted-foreground">{p.property ?? "—"} · {formatDate(p.created)}</p></div>
                  <StatusBadge value={p.status === "Pending" ? "On its way" : "Paid"} tone={p.status === "Pending" ? "info" : "success"} />
                  <Money value={p.amount_cents} cents className="w-24 text-right font-medium" />
                </li>
              ))}
            </ul>
          ) : <div className="p-4"><EmptyState title="No payments yet" description="Your first payment appears here once an invoice is approved." compact /></div>}
          <Pager base="/portal/vendor/payments" params={{}} page={page} size={pay.size} total={pay.total} />
        </section>
        <section aria-labelledby="t-h" className="rounded-xl border bg-card">
          <h2 id="t-h" className="border-b px-4 py-3 text-[14px] font-semibold">Tax forms (1099-NEC)</h2>
          {forms.length ? (
            <ul className="divide-y">
              {forms.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{f.year} · {f.payer}</p><p className="text-[12px] text-muted-foreground">{f.filed_on ? `Filed ${formatDate(f.filed_on)}` : "Not filed yet"}</p></div>
                  <StatusBadge value={f.status} tone={f.status === "Filed" ? "success" : "neutral"} />
                  <Money value={f.amount_cents} cents className="w-24 text-right" />
                </li>
              ))}
            </ul>
          ) : summary?.length ? (
            <div className="px-4 py-3">
              <p className="text-[12.5px] text-muted-foreground">Your {lastYear} forms aren&apos;t issued yet. This is what each owner entity paid you in {lastYear} (nonemployee compensation, box 1):</p>
              <ul className="mt-2 divide-y text-[13px]">{summary.map((s) => <li key={s.owner_entity_id} className="flex justify-between gap-3 py-1.5"><span className="truncate">{s.payer}</span><Money value={s.amount_cents} cents /></li>)}</ul>
            </div>
          ) : <div className="p-4"><EmptyState kind="documents" title="No tax forms yet" description="1099-NEC forms appear here each January." compact /></div>}
        </section>
      </div>
    </>
  );
}
