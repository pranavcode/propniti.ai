"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runAction, usd } from "./client";

const REASONS = ["NSF", "Account closed", "Stop payment", "Other"] as const;
const LABEL: Record<(typeof REASONS)[number], string> = { NSF: "Insufficient funds (NSF)", "Account closed": "Account closed", "Stop payment": "Stop payment", Other: "Other" };

// Mark a payment returned by the bank. The dialog states what will happen in money terms: the amount
// leaves trust, and the state-capped fee is charged. The server refuses a second return (409).
export function MarkReturnedButton({ payment, fee, state }: { payment: { id: string; label: string; amount: number }; fee: number; state: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("NSF");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = (o: boolean) => {
    if (!o && busy) return;
    setOpen(o);
    if (o) setError(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || (reason === "Other" && !note.trim())) return;
    setBusy(true);
    const r = await runAction("payments", payment.id, "mark_returned", { reason, note });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(r.message ?? "Payment marked returned");
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => show(true)} aria-label={`Mark ${payment.label} returned`}><Ban data-icon="inline-start" />Returned</Button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Mark {usd(payment.amount)} returned?</DialogTitle>
              <DialogDescription>
                {payment.label}. {usd(payment.amount)} comes back out of the property&apos;s trust account, the charges it paid reopen, and a {usd(fee)} returned-payment fee is charged ({state} cap). The resident is notified.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`rr-${payment.id}`}>Reason</FieldLabel>
                <Select value={reason} onValueChange={(v) => setReason(v as (typeof REASONS)[number])}>
                  <SelectTrigger id={`rr-${payment.id}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{REASONS.map((x) => <SelectItem key={x} value={x}>{LABEL[x]}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`rn-${payment.id}`}>Note {reason === "Other" ? "" : "(optional)"}</FieldLabel>
                <Input id={`rn-${payment.id}`} name="note" autoComplete="off" maxLength={160} placeholder="Bank return code or details…" value={note} onChange={(e) => setNote(e.target.value)} />
                {reason === "Other" && <FieldDescription>Say why the bank returned it.</FieldDescription>}
              </Field>
            </FieldGroup>
            {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => show(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy || (reason === "Other" && !note.trim())}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}{busy ? "Marking…" : `Mark returned and charge ${usd(fee)}`}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
