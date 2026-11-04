"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, Loader2 } from "lucide-react";
import Link from "@/components/Link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import { newKey, runAction, usd } from "./client";
import { formatDate } from "@/lib/format";

const METHODS = ["Check", "Money order", "Cash", "ACH", "Card"] as const;

export type PayableCharge = { id: string; description: string; open: number; due_on?: string };
// Where to go next once a payment is recorded: another payment at the same property, or the lease's ledger.
export type NextAfterPayment = { leaseId: string; propertyId: string };

// Record a payment received in the office against one charge. The idempotency key lives until a
// payment succeeds: a double click, a retry after a timeout, or closing and reopening the dialog
// mid-request all re-send the same key, so the payment is recorded once.
export function RecordPaymentButton({ charge, size = "sm", variant = "outline", label = "Record payment", next }: { charge: PayableCharge; size?: "xs" | "sm" | "default"; variant?: "outline" | "default" | "ghost"; label?: string; next?: NextAfterPayment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(newKey);
  const [amount, setAmount] = useState(String(charge.open));
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Check");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);
  const value = Number(amount);
  const invalid = !(value > 0) ? "Enter an amount above $0." : value > charge.open + 0.001 ? `Only ${usd(charge.open)} is open on this charge.` : null;

  const show = (o: boolean) => {
    if (!o && busy) return;
    setOpen(o);
    if (o) {
      setRecorded(null);
      setAmount(String(charge.open));
      setReference("");
      setError(null);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    const r = await runAction("charges", charge.id, "record_payment", { amount: Math.round(value * 100) / 100, method, reference, idempotencyKey: key });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(r.message ?? "Payment recorded");
    setKey(newKey());
    if (next) setRecorded(`${usd(value)} by ${method.toLowerCase()}${reference ? ` (${reference})` : ""}`);
    else setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button size={size} variant={variant} onClick={() => show(true)} aria-label={label === "Record payment" ? undefined : `Record payment for ${charge.description}`}><Banknote data-icon="inline-start" />{label}</Button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent className="sm:max-w-md">
          {recorded && next ? (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-4 text-tone-success" aria-hidden />Payment recorded</DialogTitle>
                <DialogDescription>{recorded} against {charge.description}. It&apos;s on the lease ledger and in today&apos;s trust deposit.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button asChild variant="outline"><Link href={`/app/receivables/ledger/${encodeURIComponent(next.leaseId)}`} onClick={() => setOpen(false)}>View ledger</Link></Button>
                <Button asChild><Link href={`/app/receivables/record-payment?property=${encodeURIComponent(next.propertyId)}`} onClick={() => setOpen(false)}>Record another</Link></Button>
              </DialogFooter>
            </div>
          ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Record payment</DialogTitle>
              <DialogDescription>{charge.description} · {usd(charge.open)} open{charge.due_on ? ` · due ${formatDate(charge.due_on, "always")}` : ""}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
            <Field data-invalid={!!invalid || undefined}>
              <FieldLabel htmlFor={`amt-${charge.id}`}>Amount received</FieldLabel>
              <Input id={`amt-${charge.id}`} name="amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => /^\d*(\.\d{0,2})?$/.test(e.target.value) && setAmount(e.target.value)} aria-invalid={!!invalid} className="tabular-nums" />
              {invalid ? <FieldError>{invalid}</FieldError> : <FieldDescription>{value < charge.open ? `Partial payment; ${usd(charge.open - value)} stays open.` : "Pays the charge in full."}</FieldDescription>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor={`m-${charge.id}`}>Method</FieldLabel>
                <Select value={method} onValueChange={(v) => setMethod(v as (typeof METHODS)[number])}>
                  <SelectTrigger id={`m-${charge.id}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`ref-${charge.id}`}>Reference</FieldLabel>
                <Input id={`ref-${charge.id}`} name="reference" autoComplete="off" maxLength={60} placeholder={method === "Check" ? "Check #…" : "Optional…"} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            </FieldGroup>
            <p className="rounded-md bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">Deposited to the property’s trust account today. The {Math.round(MANAGEMENT_FEE_RATE * 100)}% management fee is taken from it automatically.</p>
            {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => show(false)}>Cancel</Button>
              <Button type="submit" disabled={!!invalid || busy}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}{busy ? "Recording…" : `Record ${value > 0 ? usd(value) : "payment"}`}</Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
