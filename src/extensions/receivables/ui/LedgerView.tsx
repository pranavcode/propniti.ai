import "server-only";
import Link from "next/link";
import { CircleAlert, Info } from "lucide-react";
import { can } from "@/entities";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QueryCtx } from "@/server/query";
import { leaseFor, leaseLedger, leasesOfHousehold, returnedFeeCents, settleDue } from "../queries";
import { MarkReturnedButton } from "./MarkReturned";
import { RecordPaymentButton } from "./RecordPayment";

// A lease's ledger: every charge, payment and credit with a running balance. Each figure in the
// summary links to the rows it adds up; each row links to its record.

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export async function LedgerView({ ctx, leaseId, highlight, switchHref }: { ctx: QueryCtx; leaseId: string; highlight?: string; switchHref?: (leaseId: string) => string }) {
  await settleDue(ctx);
  const lease = await leaseFor(ctx, leaseId);
  if (!lease) return <EmptyState compact kind="table" title="No ledger to show" description="This lease isn't in your scope, or it doesn't exist." />;
  const [{ rows, totals }, siblings] = await Promise.all([leaseLedger(ctx, leaseId), switchHref ? leasesOfHousehold(ctx, lease.household_id) : Promise.resolve([])]);
  const canRecord = can(ctx.actor.role, "charges.record_payment", "charges");
  const canReturn = can(ctx.actor.role, "payments.mark_returned", "payments");
  const fee = canReturn ? await returnedFeeCents(ctx, lease.property_id) : 0;
  const actions = canRecord || canReturn;
  const lf = { "f.lease_id": leaseId };
  const figures = [
    { label: "Charged", value: totals.charged, href: `/app/receivables/charges?${q(lf)}`, hint: "All charges on this lease" },
    { label: "Paid", value: totals.paid, href: `/app/receivables/payments?${q({ ...lf, "f.nsf": "false" })}`, hint: "Payments, excluding returned ones" },
    { label: "Credits", value: totals.credited, href: `/app/receivables/credits?${q(lf)}`, hint: "Concessions, adjustments, deposits applied and write-offs" },
    { label: "Past due", value: totals.pastDue, href: `/app/receivables/charges?${q({ ...lf, "f.status": "Overdue" })}`, hint: "Open balance on charges whose due date has passed", tone: totals.pastDue > 0 ? "danger" : undefined },
    { label: "Balance", value: totals.balance, href: `/app/receivables/charges?${q({ ...lf, "f.balance.min": "0.01" })}`, hint: totals.unapplied ? `Charged − paid − credits. Includes ${(totals.unapplied / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} paid on account but not applied to a charge.` : "Charged − paid − credits", strong: true },
  ];
  const newestFirst = [...rows].reverse();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px]">
          <Link href={`/app/leases/${lease.id}`} className="font-medium hover:text-primary hover:underline">{lease.id}</Link>
          <span className="text-muted-foreground"> · {lease.household} · {lease.property} #{lease.unit} · {lease.status} · rent <Money value={lease.rent_cents} cents style="whole" tone="none" />/mo</span>
        </div>
        {siblings.length > 1 && switchHref && (
          <nav aria-label="Leases for this household" className="flex flex-wrap gap-1">
            {siblings.map((s) => (
              <Link key={s.id} href={switchHref(s.id)} aria-current={s.id === leaseId ? "page" : undefined} className={cn("rounded-md border px-2 py-0.5 text-[12px]", s.id === leaseId ? "border-primary/40 bg-primary/5 font-medium" : "text-muted-foreground hover:text-foreground")}>
                {s.id} · {s.status}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
        {figures.map((f) => (
          <div key={f.label} className="bg-card px-3 py-2">
            <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {f.label}
              <Tooltip>
                <TooltipTrigger asChild><button type="button" aria-label={`What ${f.label} includes`} className="rounded text-muted-foreground/60 hover:text-foreground"><Info className="size-3" /></button></TooltipTrigger>
                <TooltipContent className="max-w-64">{f.hint}</TooltipContent>
              </Tooltip>
            </dt>
            <dd className="mt-0.5"><Link href={f.href} aria-label={`${f.label}: ${formatMoney(f.value / 100)}. Show the rows`} className={cn("text-[15px] font-medium tabular-nums hover:underline", f.strong && "font-semibold", f.tone === "danger" && "text-tone-danger")}><Money value={f.value} cents tone="none" /></Link></dd>
          </div>
        ))}
      </dl>
      {totals.nsf > 0 && (
        <p className="flex items-center gap-1.5 text-[12.5px]"><CircleAlert className="size-3.5 text-tone-warning" />{totals.nsf} returned payment{totals.nsf === 1 ? "" : "s"} on this lease. Returned payments show struck through and don’t reduce the balance.</p>
      )}

      {rows.length === 0 ? <EmptyState compact kind="table" title="No ledger activity yet" description="Charges appear here when rent is billed." /> : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Ledger for lease {lease.id}, newest first</caption>
            <thead className="sticky top-0 z-10 bg-muted/80 text-[11.5px] text-muted-foreground backdrop-blur">
              <tr>
                <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Date</th>
                <th scope="col" className="w-[34%] px-3 py-2 text-left font-medium">Item</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Charge</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Payment / credit</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                {actions && <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((r) => (
                <tr key={`${r.kind}-${r.id}`} id={r.id} className={cn("h-[var(--row-h,36px)] scroll-mt-10 border-t", r.id === highlight && "bg-primary/[0.06]", r.nsf && "text-muted-foreground")}>
                  <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">{formatDate(r.date, "always")}</td>
                  <td className="max-w-0 px-3 py-1.5">
                    <Link href={r.href} className={cn("block truncate font-medium hover:text-primary hover:underline", r.nsf && "line-through")}>{r.description}</Link>
                    {r.detail && <span className="block truncate text-[11.5px] text-muted-foreground">{r.detail}</span>}
                  </td>
                  <td className="px-3 text-right">{r.debit ? <Money value={r.debit} cents tone="none" /> : null}</td>
                  <td className="px-3 text-right">{r.kind !== "charge" ? <Money value={r.nsf ? r.returned : r.credit} cents tone="none" className={cn(r.nsf && "line-through")} /> : null}{r.nsf && <span className="sr-only">returned, not counted</span>}</td>
                  <td className="px-3 text-right font-medium"><Money value={r.balance} cents tone="none" /></td>
                  <td className="px-3">{r.status ? <StatusBadge value={r.status} /> : null}{r.kind === "charge" && (r.open ?? 0) > 0 && r.status !== "Due" && <span className="ml-1.5 text-[11.5px] text-muted-foreground tabular-nums"><Money value={r.open} cents tone="none" /> open</span>}</td>
                  {actions && (
                    <td className="px-2 text-right">
                      {canReturn && r.kind === "payment" && !r.nsf && <MarkReturnedButton payment={{ id: r.id, label: `${r.description} on ${formatDate(r.date, "always")}`, amount: r.credit / 100 }} fee={fee / 100} state={lease.state} />}
                      {canRecord && r.kind === "charge" && (r.open ?? 0) > 0 && r.status !== "Processing" && <RecordPaymentButton size="xs" variant="ghost" label="Record" charge={{ id: r.id, description: r.description, open: (r.open ?? 0) / 100, due_on: r.date }} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground">{rows.length} entries · newest first · the running balance adds up from the oldest entry</p>
    </div>
  );
}
