"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { runAction, usd } from "./client";

export type DispositionCharge = { id: string; description: string; due_on: string; open: number };
type Damage = { key: number; label: string; amount: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Itemised move-out disposition. Open charges on the lease are pre-selected as deductions (the
// deposit settles them first); damage lines become a move-out charge. The rest is refunded.
export function DispositionForm({ depositId, amount, leaseId, household, moveOut, dueOn, asOf, state, settled, openCharges, canSend }: {
  depositId: string; amount: number; leaseId: string; household: string; moveOut: string | null; dueOn: string | null; asOf: string; state: string;
  settled: { sentOn: string | null; status: string; refund: number; deductions: { label: string; amount: number }[] } | null;
  openCharges: DispositionCharge[]; canSend: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    // Oldest first until the deposit runs out.
    let left = amount;
    const out: Record<string, string> = {};
    for (const c of openCharges) {
      if (left <= 0) break;
      const a = Math.min(c.open, left);
      out[c.id] = a.toFixed(2);
      left -= a;
    }
    return out;
  });
  const [damages, setDamages] = useState<Damage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(() => [
    ...Object.entries(picked).map(([id, v]) => ({ id, label: openCharges.find((c) => c.id === id)?.description ?? id, amount: Number(v) || 0 })),
    ...damages.map((d) => ({ id: null, label: d.label.trim(), amount: Number(d.amount) || 0 })),
  ], [picked, damages, openCharges]);
  const deducted = lines.reduce((s, l) => s + l.amount, 0);
  const refund = Math.round((amount - deducted) * 100) / 100;
  const overCharge = Object.entries(picked).find(([id, v]) => Number(v) > (openCharges.find((c) => c.id === id)?.open ?? 0) + 0.001);
  const problem = refund < 0 ? `Deductions are ${usd(-refund)} more than the deposit.` : overCharge ? "A deduction is more than what's open on its charge." : damages.some((d) => !d.label.trim() || !(Number(d.amount) > 0)) ? "Each damage line needs a description and an amount." : lines.some((l) => l.amount <= 0) ? "Remove deductions of $0." : null;
  const daysLeft = dueOn ? daysBetween(asOf, dueOn) : null;

  if (settled) {
    const total = settled.deductions.reduce((s, d) => s + d.amount, 0);
    return (
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold"><CheckCircle2 className="size-4 text-tone-success" />Disposition {settled.status.toLowerCase()}{settled.sentOn ? ` on ${settled.sentOn}` : ""}</h3>
        <table className="w-full text-[13px]">
          <tbody>
            {settled.deductions.map((d, i) => <tr key={i} className="border-t"><td className="py-1.5">{d.label}</td><td className="py-1.5 text-right tabular-nums">{usd(d.amount)}</td></tr>)}
            <tr className="border-t font-medium"><td className="py-1.5">Deducted</td><td className="py-1.5 text-right tabular-nums">{usd(total)}</td></tr>
            <tr className="border-t font-semibold"><td className="py-1.5">Refunded to {household}</td><td className="py-1.5 text-right tabular-nums">{usd(settled.refund)}</td></tr>
          </tbody>
        </table>
      </section>
    );
  }

  const send = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    const r = await runAction("deposits", depositId, "send_disposition", { lines: lines.map((l) => ({ label: l.label, amount: Math.round(l.amount * 100) / 100, ...(l.id ? { charge_id: l.id } : {}) })) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(r.message ?? "Disposition sent");
    router.refresh();
  };

  return (
    <section className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-[13px]", daysLeft != null && daysLeft < 0 ? "border-tone-danger/30 bg-tone-danger/[0.05]" : daysLeft != null && daysLeft <= 7 ? "border-tone-warning/30 bg-tone-warning/[0.06]" : "bg-muted/40")}>
        <CalendarClock className="size-4 text-muted-foreground" />
        <span>{household} · lease {leaseId} · moved out {moveOut ?? "—"}</span>
        {dueOn && <span className="font-medium">{daysLeft! < 0 ? `${-daysLeft!} days past the ${state} deadline (${dueOn})` : `Due by ${dueOn} (${daysLeft} days left, ${state} rule)`}</span>}
      </div>

      {!moveOut && <p className="text-[13px] text-muted-foreground">The resident hasn’t moved out. The disposition opens after move-out.</p>}

      <div className="rounded-lg border">
        <div className="border-b px-3 py-2 text-[12.5px] font-semibold">Open charges on the lease</div>
        {openCharges.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted-foreground">Nothing open. The whole deposit is refundable unless you add damages.</p> : (
          <table className="w-full text-[13px]">
            <tbody>
              {openCharges.map((c) => {
                const on = c.id in picked;
                return (
                  <tr key={c.id} className="border-t first:border-0">
                    <td className="w-8 py-1.5 pl-3"><Checkbox aria-label={`Deduct ${c.description}`} checked={on} onCheckedChange={(v) => setPicked((p) => { const n = { ...p }; if (v) n[c.id] = c.open.toFixed(2); else delete n[c.id]; return n; })} /></td>
                    <td className="py-1.5"><span className="font-medium">{c.description}</span><span className="ml-2 text-[11.5px] text-muted-foreground">due {c.due_on} · {usd(c.open)} open</span></td>
                    <td className="w-36 py-1.5 pr-3"><Input aria-label={`Amount for ${c.description}`} disabled={!on} inputMode="decimal" className="h-7 text-right tabular-nums" value={picked[c.id] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value.replace(/[^0-9.]/g, "") }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[12.5px] font-semibold">Damages and cleaning</span>
          <Button size="xs" variant="outline" disabled={damages.length >= 10} onClick={() => setDamages((d) => [...d, { key: Date.now(), label: "", amount: "" }])}><Plus />Add line</Button>
        </div>
        {damages.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted-foreground">No damages itemised. Add a line for each repair or cleaning cost, with the amount you can document.</p> : (
          <div className="flex flex-col gap-2 p-3">
            {damages.map((d) => (
              <div key={d.key} className="flex items-center gap-2">
                <Input aria-label="Damage description" placeholder="Carpet replacement, bedroom 2…" maxLength={80} value={d.label} onChange={(e) => setDamages((all) => all.map((x) => (x.key === d.key ? { ...x, label: e.target.value } : x)))} />
                <Input aria-label="Damage amount" placeholder="0.00" inputMode="decimal" className="w-32 text-right tabular-nums" value={d.amount} onChange={(e) => setDamages((all) => all.map((x) => (x.key === d.key ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x)))} />
                <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={() => setDamages((all) => all.filter((x) => x.key !== d.key))}><Trash2 /></Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border text-[13px]">
        <div className="bg-card px-3 py-2"><dt className="text-[11px] text-muted-foreground">Deposit held</dt><dd className="mt-0.5 font-medium tabular-nums">{usd(amount)}</dd></div>
        <div className="bg-card px-3 py-2"><dt className="text-[11px] text-muted-foreground">Deductions</dt><dd className="mt-0.5 font-medium tabular-nums">{usd(deducted)}</dd></div>
        <div className="bg-card px-3 py-2"><dt className="text-[11px] text-muted-foreground">Refund to {household}</dt><dd className={cn("mt-0.5 font-semibold tabular-nums", refund < 0 && "text-tone-danger")}>{usd(refund)}</dd></div>
      </dl>

      {(problem || error) && <p role="alert" className="text-[12.5px] text-tone-danger">{error ?? problem}</p>}
      <div className="flex items-center gap-3">
        <Button disabled={!canSend || !moveOut || !!problem || busy} onClick={send}>{busy && <Loader2 className="animate-spin" />}{busy ? "Sending…" : `Send disposition and refund ${usd(Math.max(0, refund))}`}</Button>
        {!canSend && <span className="text-[12px] text-muted-foreground">Your role can view dispositions but not send them.</span>}
      </div>
    </section>
  );
}
