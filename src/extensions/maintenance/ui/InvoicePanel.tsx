"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileScan, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIBadge, Confidence } from "@/components/app/ai";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD, useAction } from "./client";

// Vendor invoice → validate against the PO → approve and pay (the v1 flow on v2 data).
// Reading a file goes through /api/ai/extract; the comparison and the payment run on the server.

type Line = { key: number; description: string; amount: string };
let nextKey = 0;
const line = (description: string, amount: string): Line => ({ key: ++nextKey, description, amount });
type Extract = {
  invoice?: { isInvoice: boolean; vendor: string; invoiceNumber: string; invoiceDate: string; lineItems: { description: string; amount: number }[]; total: number; currency: string; confidence: number; issues: string[] };
  checks: { label: string; ok: boolean }[];
  source: "anthropic" | "openai" | "workers-ai" | "mock";
  note?: string;
  error?: string;
};
export type Validation = { decision: "approve" | "review"; confidence: number; matched: string[]; issues: string[]; summary: string };

export function InvoiceEntry({ woId, initial, poLines }: { woId: string; initial?: { invoice_number: string; lines: { description: string; amount_cents: number }[] }; poLines: { description: string; amount_cents: number }[] }) {
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Extract | null>(null);
  const [number, setNumber] = useState(initial?.invoice_number ?? "");
  const [lines, setLines] = useState<Line[]>(
    () => (initial?.lines.length ? initial.lines : poLines).map((l) => line(l.description.split(":")[0], (l.amount_cents / 100).toFixed(2))),
  );
  const [source, setSource] = useState<"read" | "manual">("manual");
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  const readFile = async (file: File) => {
    setReading(true);
    setRead(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/ai/extract", { method: "POST", body: form }).catch(() => null);
    const out = (res ? await res.json().catch(() => ({ error: "Couldn't read the reply" })) : { error: "The upload didn't reach the server" }) as Extract;
    setReading(false);
    setRead(out);
    if (out.invoice?.isInvoice) {
      setNumber(out.invoice.invoiceNumber);
      setLines(out.invoice.lineItems.map((l) => line(l.description, l.amount.toFixed(2))));
      setSource("read");
    }
  };

  const save = () =>
    run("work_orders", woId, "work_orders.submit_invoice", {
      invoice_number: number.trim(), total: Math.round(total * 100) / 100, source,
      lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), amount: Number(l.amount) || 0 })),
      ...(source === "read" && read?.invoice ? { read_confidence: read.invoice.confidence } : {}),
    });

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Invoice file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
        <Button size="sm" variant="outline" disabled={reading} onClick={() => fileRef.current?.click()}>
          {reading ? <Loader2 className="size-3.5 animate-spin" /> : <FileScan className="size-3.5" />}{reading ? "Reading invoice…" : "Read invoice file"}
        </Button>
        <span className="text-[12px] text-muted-foreground">PDF or photo, up to 4 MB. Nothing is stored; the lines fill in below for you to check.</span>
      </div>

      {read && (
        <div className={cn("rounded-md border p-2.5 text-[12.5px]", read.invoice ? "border-tone-ai/25 bg-tone-ai/[0.04]" : "border-tone-warning/30 bg-tone-warning/[0.06]")} role="status">
          {read.invoice ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AIBadge source={read.source === "mock" ? "rules" : "live"} model={read.source} size="xs" />
                <span className="font-medium">{read.invoice.vendor || "Unknown vendor"} · {read.invoice.invoiceNumber || "no number"}</span>
                <Confidence value={read.invoice.confidence} />
              </div>
              <ul className="mt-1.5 grid gap-0.5 sm:grid-cols-2">
                {read.checks.map((c) => <li key={c.label} className="flex items-center gap-1.5">{c.ok ? <CheckCircle2 className="size-3.5 text-tone-success" /> : <XCircle className="size-3.5 text-tone-danger" />}{c.label}</li>)}
              </ul>
            </>
          ) : (
            <p>{read.error ?? read.note ?? "The file couldn't be read."} Enter the lines from the invoice below instead.</p>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <label className="grid gap-1 text-[12px] text-muted-foreground">Invoice number
          <input className={FIELD} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-20931" maxLength={40} />
        </label>
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-[11.5px] text-muted-foreground"><th className="pb-1 font-normal">Line</th><th className="w-32 pb-1 text-right font-normal">Amount ($)</th><th className="w-8" /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td className="py-0.5 pr-2"><input aria-label={`Line ${i + 1} description`} className={FIELD} value={l.description} maxLength={200} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
              <td className="py-0.5"><input aria-label={`Line ${i + 1} amount`} inputMode="decimal" className={cn(FIELD, "text-right tabular-nums")} value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "") } : x)))} /></td>
              <td className="py-0.5 pl-1"><Button size="icon-sm" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-1.5"><Button size="xs" variant="ghost" disabled={lines.length >= 20} onClick={() => setLines([...lines, line("", "")])}><Plus className="size-3" />Add line</Button></td>
            <td className="pt-1.5 text-right font-medium tabular-nums">{formatMoney(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="flex justify-end">
        <Button size="sm" disabled={!!busy || !number.trim() || !(total > 0)} onClick={save}>{busy && <Loader2 className="size-3.5 animate-spin" />}Record invoice and check against PO</Button>
      </div>
    </div>
  );
}

export function ApprovePay({ woId, amount, vendor, validation, policy, blocked }: { woId: string; amount: number; vendor: string; validation: Validation; policy: { level: string; text: string }; blocked?: string }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const needsNote = validation.issues.length > 0;
  const pay = async () => {
    const out = await run("work_orders", woId, "work_orders.approve_and_pay", { expected_cents: Math.round(amount * 100), ...(needsNote ? { note: note.trim() } : {}) });
    if (out) setOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3">
      <p className="max-w-xl text-[12.5px] text-muted-foreground">{blocked ?? policy.text}</p>
      <Button variant={needsNote ? "outline" : "default"} disabled={!!blocked} onClick={() => (blocked ? toast.error(blocked) : setOpen(true))}>
        <CheckCircle2 className="size-4" />{needsNote ? "Review and pay anyway" : `Approve and pay ${formatMoney(amount)}`}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay {formatMoney(amount)} to {vendor}?</DialogTitle>
            <DialogDescription>Paid from the property&apos;s trust account by ACH, arriving in 1 to 2 business days. The payment can only be made once.</DialogDescription>
          </DialogHeader>
          {needsNote && (
            <div className="space-y-2">
              <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-tone-danger">{validation.issues.map((i) => <li key={i}>{i}</li>)}</ul>
              <label className="grid gap-1 text-[12.5px]">Why pay despite these issues? (recorded in the audit log)
                <textarea className={cn(FIELD, "h-20 py-1.5")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Vendor called: trip charge agreed by phone with Marcus on Nov 2." />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={!!busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!!busy || (needsNote && note.trim().length < 8)} onClick={pay}>{busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Paying…" : "Approve and pay"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
