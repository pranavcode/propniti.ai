"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import { newKey, runAction, usd } from "./client";

const METHODS = ["Check", "Money order", "Cash", "ACH", "Card"] as const;

export type PayableCharge = { id: string; description: string; open: number; due_on?: string };

// Record a payment received in the office against one charge. The idempotency key is made once per
// dialog, so a double click or a retry after a timeout records the payment once.
export function RecordPaymentButton({ charge, size = "sm", variant = "outline", label = "Record payment" }: { charge: PayableCharge; size?: "xs" | "sm" | "default"; variant?: "outline" | "default" | "ghost"; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [amount, setAmount] = useState(String(charge.open));
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Check");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const invalid = !(value > 0) ? "Enter an amount above $0." : value > charge.open + 0.001 ? `Only ${usd(charge.open)} is open on this charge.` : null;

  const show = (o: boolean) => {
    setOpen(o);
    if (o) {
      setKey(newKey());
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
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button size={size} variant={variant} onClick={() => show(true)}><Banknote />{label}</Button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Record payment</DialogTitle>
              <DialogDescription>{charge.description} · {usd(charge.open)} open{charge.due_on ? ` · due ${charge.due_on}` : ""}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor={`amt-${charge.id}`}>Amount received</FieldLabel>
              <Input id={`amt-${charge.id}`} name="amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={!!invalid} className="tabular-nums" />
              <FieldDescription>{invalid ?? (value < charge.open ? `Partial payment; ${usd(charge.open - value)} stays open.` : "Pays the charge in full.")}</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor={`m-${charge.id}`}>Method</FieldLabel>
                <Select value={method} onValueChange={(v) => setMethod(v as (typeof METHODS)[number])}>
                  <SelectTrigger id={`m-${charge.id}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`ref-${charge.id}`}>Reference</FieldLabel>
                <Input id={`ref-${charge.id}`} name="reference" autoComplete="off" maxLength={60} placeholder={method === "Check" ? "Check #…" : "Optional…"} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <p className="rounded-md bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">Deposited to the property’s operating trust today. The {Math.round(MANAGEMENT_FEE_RATE * 100)}% management fee is taken from it automatically.</p>
            {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => show(false)}>Cancel</Button>
              <Button type="submit" disabled={!!invalid || busy}>{busy && <Loader2 className="animate-spin" />}{busy ? "Recording…" : `Record ${value > 0 ? usd(value) : "payment"}`}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
