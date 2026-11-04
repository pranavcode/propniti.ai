import Link from "@/components/Link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { ledger, me, openCharges } from "@/extensions/owners/portal/resident-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { AutopaySwitch, PayPanel } from "@/extensions/owners/portal/ui/resident/PayPanel";
import { Card, fmtDay } from "@/extensions/owners/portal/ui/resident/bits";

export default async function ResidentPay({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const c = await portalCtx("resident");
  if (!c) return null;
  const r = await me(c);
  if (!r) return null;
  const page = Math.max(1, Math.floor(Number((await searchParams).page)) || 1);
  const [charges, led] = await Promise.all([openCharges(c, r.household_id), ledger(c, r.household_id, page)]);
  const pages = Math.max(1, Math.ceil(led.total / led.size));
  return (
    <>
      <PortalTitle title="Pay rent" description="Pay by ACH from your bank account. Payments usually clear in 1–2 business days." />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <PayPanel me={c.me} charges={charges} />
        <Card><div id="autopay" className="scroll-mt-20"><AutopaySwitch me={c.me} enabled={!!r.autopay} /></div></Card>
      </div>

      <section id="ledger" className="mt-6 scroll-mt-20" aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="mb-2 text-[15px] font-semibold tracking-tight">Ledger</h2>
        {led.total ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Charges and payments, newest first</caption>
              <thead>
                <tr className="border-b text-left text-[11.5px] text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2 font-medium">Description</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
                  <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">Balance</th>
                </tr>
              </thead>
              <tbody>
                {led.rows.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">{fmtDay(l.at, true)}</td>
                    <td className="px-4 py-2.5"><span className="font-medium">{l.kind === "Charge" ? l.description : l.kind === "Payment" ? "Payment" : "Credit"}</span>{l.kind !== "Charge" && <span className="ml-1.5 text-muted-foreground">{l.description}</span>}</td>
                    <td className="px-4 py-2.5 text-right"><Money value={l.amount_cents} cents tone={l.amount_cents < 0 ? "none" : "auto"} className={l.amount_cents < 0 ? "text-tone-success" : ""} /></td>
                    <td className="hidden px-4 py-2.5 text-right sm:table-cell"><Money value={l.balance_cents} cents /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-[12px] text-muted-foreground">
              <span className="tabular-nums">{(page - 1) * led.size + 1}–{Math.min(page * led.size, led.total)} of {led.total}</span>
              <div className="flex gap-1 whitespace-nowrap">
                <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>{page > 1 ? <Link href={`?page=${page - 1}#ledger`}><ChevronLeft />Newer</Link> : <span><ChevronLeft />Newer</span>}</Button>
                <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>{page < pages ? <Link href={`?page=${page + 1}#ledger`}>Older<ChevronRight /></Link> : <span>Older<ChevronRight /></span>}</Button>
              </div>
            </div>
          </div>
        ) : <p className="rounded-xl border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">No charges or payments yet.</p>}
      </section>
    </>
  );
}
