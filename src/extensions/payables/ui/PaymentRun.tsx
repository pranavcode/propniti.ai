"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDollarSign, Inbox, Loader2, ShieldAlert } from "lucide-react";
import Link from "@/components/Link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { RunBill, RunResult, RunVendor } from "../paymentRun";

const CHUNK = 25;
const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (bills: RunBill[]) => bills.reduce((s, b) => s + b.amount_cents, 0);

// Build a payment run: pick approved past-due bills by vendor, review what will be paid and what
// goes to approvals, then pay. Held vendors can't be selected. Big runs are sent in chunks of 25;
// each bill pays once however often a chunk is sent.
export function PaymentRunBuilder({ vendors }: { vendors: RunVendor[] }) {
  const router = useRouter();
  const payable = useMemo(() => vendors.filter((v) => !v.hold).flatMap((v) => v.bills), [vendors]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(payable.map((b) => b.id)));
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = payable.filter((b) => picked.has(b.id));
  const payNow = selected.filter((b) => !b.over_limit);
  const toApprove = selected.filter((b) => b.over_limit);
  const held = vendors.filter((v) => v.hold);
  const toggle = (ids: string[], on: boolean) => setPicked((p) => {
    const n = new Set(p);
    for (const id of ids) if (on) n.add(id); else n.delete(id);
    return n;
  });

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ids = selected.map((b) => b.id);
    const out: RunResult[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      try {
        const res = await fetch("/api/payables/payment-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + CHUNK) }) });
        const body = await res.json().catch(() => ({}));
        if (body.results) out.push(...body.results);
        else { setError(body.error ?? "The run stopped. Bills already paid stay paid; run it again for the rest."); break; }
      } catch {
        setError("You're offline or the server didn't answer. Bills already paid stay paid; run it again for the rest.");
        break;
      }
    }
    setResults(out);
    setBusy(false);
    router.refresh();
  };

  const close = (o: boolean) => {
    if (busy) return;
    setReview(o);
    if (!o) setResults(null);
  };

  if (!vendors.length) return null;
  return (
    <>
      <div className="flex flex-col gap-3">
        {vendors.map((v) => {
          const ids = v.bills.map((b) => b.id);
          const all = !v.hold && ids.every((id) => picked.has(id));
          const some = !v.hold && ids.some((id) => picked.has(id));
          return (
            <section key={v.vendor_id} aria-label={v.vendor} className={cn("overflow-hidden rounded-lg border bg-card", v.hold && "border-tone-danger/30")}>
              <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <Checkbox aria-label={`Select all bills from ${v.vendor}`} checked={all ? true : some ? "indeterminate" : false} disabled={!!v.hold} onCheckedChange={(c) => toggle(ids, c === true)} />
                <h2 className="text-[13.5px] font-semibold">{v.vendor}</h2>
                <span className="text-[12px] text-muted-foreground">{plural(v.bills.length, "bill")}</span>
                {v.hold && <span className="inline-flex items-center gap-1 rounded-full bg-tone-danger/10 px-2 py-0.5 text-[11.5px] font-medium text-tone-danger"><ShieldAlert className="size-3" aria-hidden />Payment hold</span>}
                <span className="ml-auto text-[13px] font-semibold tabular-nums">{usd(v.total_cents)}</span>
              </header>
              {v.hold && (
                <p className="border-b bg-tone-danger/5 px-3 py-2 text-[12.5px]">
                  {v.hold} <Link href={`/app/payables/bills?f.vendor_id=${encodeURIComponent(v.vendor_id)}&f.status=Approved`} className="font-medium text-primary hover:underline">Verify on a bill →</Link>
                </p>
              )}
              <table className="w-full text-[13px]">
                <caption className="sr-only">Bills from {v.vendor}</caption>
                <tbody>
                  {v.bills.map((b) => (
                    <tr key={b.id} className={cn("border-t first:border-0", v.hold && "text-muted-foreground")}>
                      <td className="w-9 px-3 py-1.5"><Checkbox aria-label={`Select ${b.invoice_number}`} checked={picked.has(b.id)} disabled={!!v.hold} onCheckedChange={(c) => toggle([b.id], c === true)} /></td>
                      <td className="py-1.5 pr-2"><Link href={`/app/payables/bills/${encodeURIComponent(b.id)}`} className="font-medium hover:text-primary hover:underline">{b.invoice_number}</Link><span className="ml-2 text-[11.5px] text-muted-foreground">{b.property}</span></td>
                      <td className="hidden px-2 text-[12px] text-muted-foreground sm:table-cell">Due {b.due_on} · <span className="text-tone-danger">{plural(b.days_past_due, "day")} late</span></td>
                      <td className="px-2 text-right">{b.over_limit && <span className="whitespace-nowrap rounded-full bg-tone-warning/12 px-2 py-0.5 text-[11.5px] font-medium text-tone-warning">{b.over_limit.limit_cents == null ? "Needs approval" : `Over ${usd(b.over_limit.limit_cents)} limit`}</span>}</td>
                      <td className="w-32 px-3 text-right font-medium tabular-nums">{usd(b.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="text-[13px]">
          <span className="font-semibold">{plural(selected.length, "bill")} selected</span>
          <span className="text-muted-foreground"> · pay {usd(sum(payNow))} now{toApprove.length ? ` · ${plural(toApprove.length, "bill")} (${usd(sum(toApprove))}) to approvals` : ""}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={!selected.length}>Clear</Button>
          <Button size="sm" disabled={!selected.length} onClick={() => setReview(true)}><CircleDollarSign data-icon="inline-start" />Review payment run</Button>
        </div>
      </div>

      <Dialog open={review} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          {results ? <Outcome results={results} error={error} onDone={() => close(false)} /> : (
            <>
              <DialogHeader>
                <DialogTitle>Review payment run</DialogTitle>
                <DialogDescription>Nothing is paid until you confirm. Each bill leaves its property&apos;s trust account by ACH; a bill the trust can&apos;t cover is skipped and listed afterwards.</DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto text-[13px]">
                <div className="rounded-md border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 font-medium"><span>Pay now by ACH · {plural(payNow.length, "bill")}</span><span className="tabular-nums">{usd(sum(payNow))}</span></div>
                  <ul className="divide-y">
                    {groupByVendor(payNow).map(([vendor, bills]) => <li key={vendor} className="flex justify-between px-3 py-1"><span>{vendor} <span className="text-muted-foreground">({bills.length})</span></span><span className="tabular-nums">{usd(sum(bills))}</span></li>)}
                    {!payNow.length && <li className="px-3 py-1.5 text-muted-foreground">None</li>}
                  </ul>
                </div>
                {toApprove.length > 0 && (
                  <div className="rounded-md border border-tone-warning/30">
                    <div className="flex items-center justify-between border-b bg-tone-warning/10 px-3 py-1.5 font-medium"><span>Send to approvals · {plural(toApprove.length, "bill")}</span><span className="tabular-nums">{usd(sum(toApprove))}</span></div>
                    <p className="px-3 py-1.5 text-[12.5px] text-muted-foreground">Over the bill-payment approval limit, so they aren&apos;t paid in this run. Each waits in the approvals inbox for {[...new Set(toApprove.map((b) => (b.over_limit!.owner ? "the owner" : `the ${b.over_limit!.approver.replace(/_/g, " ")}`)))].join(" or ")}.</p>
                  </div>
                )}
                {held.length > 0 && <p className="text-[12.5px] text-muted-foreground">Not included: {held.map((v) => v.vendor).join(", ")} (payment hold until a bank change is verified).</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => close(false)} disabled={busy}>Back</Button>
                <Button onClick={pay} disabled={busy || !selected.length}>
                  {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <CircleDollarSign data-icon="inline-start" />}
                  {busy ? "Paying…" : `Pay ${usd(sum(payNow))}${toApprove.length ? ` and send ${toApprove.length} for approval` : ""}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function groupByVendor(bills: RunBill[]): [string, RunBill[]][] {
  const m = new Map<string, RunBill[]>();
  for (const b of bills) (m.get(b.vendor) ?? m.set(b.vendor, []).get(b.vendor)!).push(b);
  return [...m.entries()];
}

function Outcome({ results, error, onDone }: { results: RunResult[]; error: string | null; onDone: () => void }) {
  const by = (o: RunResult["outcome"]) => results.filter((r) => r.outcome === o);
  const paid = by("paid");
  const approvals = by("approval");
  const problems = results.filter((r) => ["failed", "held", "skipped"].includes(r.outcome));
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-4 text-tone-success" aria-hidden />Payment run sent</DialogTitle>
        <DialogDescription>
          {plural(paid.length, "bill")} paid ({usd(paid.reduce((s, r) => s + (r.amount_cents ?? 0), 0))}){approvals.length ? `; ${plural(approvals.length, "bill")} waiting for approval` : ""}{problems.length ? `; ${problems.length} not paid` : ""}. Payments settle by ACH; each is in the audit log.
        </DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
      {problems.length > 0 && (
        <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-md border text-[12.5px]">
          {problems.map((r) => <li key={r.id} className="px-3 py-1.5"><Link href={`/app/payables/bills/${encodeURIComponent(r.id)}`} className="font-medium hover:underline">{r.id}</Link>: {r.message}</li>)}
        </ul>
      )}
      <DialogFooter>
        {approvals.length > 0 && <Button asChild variant="outline"><Link href="/app/ai/approvals?agent=ap"><Inbox data-icon="inline-start" />Open approvals</Link></Button>}
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}
