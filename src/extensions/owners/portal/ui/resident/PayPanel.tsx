"use client";

import { useState } from "react";
import { Landmark, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, StatusBadge } from "@/components/app/display";
import { usePortalAction } from "../usePortalAction";
import type { OpenCharge } from "../../resident-data";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Choose open charges and pay them by ACH. Each charge is its own guarded transfer, so a double
// click or a retry can never pay one twice; the button is also disabled while the request runs.
export function PayPanel({ me, charges }: { me: string; charges: OpenCharge[] }) {
  const payable = charges.filter((c) => c.status !== "Processing");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(payable.map((c) => c.id)));
  const [confirm, setConfirm] = useState(false);
  const { run, busy } = usePortalAction("residents", me);
  const total = payable.filter((c) => picked.has(c.id)).reduce((a, c) => a + c.balance_cents, 0);
  const all = payable.length > 0 && picked.size === payable.length;
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const pay = async () => {
    const r = await run("pay_charges", { chargeIds: [...picked].filter((id) => payable.some((c) => c.id === id)) });
    if (r.ok) setConfirm(false);
  };

  if (!charges.length) {
    return (
      <div className="rounded-xl border bg-card px-5 py-10 text-center">
        <p className="text-[15px] font-semibold">You&apos;re all paid up</p>
        <p className="mt-1 text-[13px] text-muted-foreground">There&apos;s nothing to pay right now. New charges show up here on the 1st.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-2.5 text-[12px] text-muted-foreground">
        {payable.length > 0 && <Checkbox id="pick-all" checked={all} onCheckedChange={(v) => setPicked(v ? new Set(payable.map((c) => c.id)) : new Set())} aria-label="Select all charges" />}
        <label htmlFor="pick-all" className="flex-1">Charge</label>
        <span>Balance</span>
      </div>
      <ul className="divide-y">
        {charges.map((c) => {
          const disabled = c.status === "Processing";
          return (
            <li key={c.id}>
              <label className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${disabled ? "cursor-default opacity-80" : "hover:bg-muted/40"}`}>
                <Checkbox checked={!disabled && picked.has(c.id)} disabled={disabled} onCheckedChange={() => toggle(c.id)} aria-label={`Pay ${c.description}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{c.description}</span>
                  <span className="block text-[12px] text-muted-foreground">Due {day(c.due_on)}{c.balance_cents < c.amount_cents ? ` · ${usd(c.amount_cents - c.balance_cents)} already paid` : ""}</span>
                </span>
                <StatusBadge value={c.status} tone={c.status === "Overdue" ? "danger" : c.status === "Processing" ? "info" : "warning"} label={c.status === "Overdue" ? "Past due" : undefined} />
                <Money value={c.balance_cents} cents tone="none" className="w-24 text-right text-[13.5px] font-medium" />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3">
        <div>
          <p className="text-[12px] text-muted-foreground">Paying</p>
          <p className="text-[20px] font-semibold tabular-nums">{usd(total)}</p>
        </div>
        <Button size="lg" disabled={!total || !!busy} onClick={() => setConfirm(true)}><Lock />Pay {usd(total)} by ACH</Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay {usd(total)}?</DialogTitle>
            <DialogDescription>We&apos;ll take {usd(total)} from your bank account on file by ACH. It usually clears in 1–2 business days, and you&apos;ll get a receipt when it does.</DialogDescription>
          </DialogHeader>
          <p className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-[13px]"><Landmark className="size-4 text-muted-foreground" />From your bank account on file</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button disabled={!!busy} onClick={pay}>{busy ? "Paying…" : `Pay ${usd(total)}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AutopaySwitch({ me, enabled }: { me: string; enabled: boolean }) {
  const { run, busy } = usePortalAction("residents", me);
  const [on, setOn] = useState(enabled);
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor="autopay" className="text-[14px] font-semibold">Autopay</label>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{on ? "On. Rent is paid on the 1st from your bank account on file." : "Off. Turn it on and rent is paid on the 1st, so it's never late."}</p>
      </div>
      <Switch id="autopay" checked={on} disabled={!!busy} onCheckedChange={async (v) => {
        setOn(v);
        const r = await run("set_autopay", { enabled: v });
        if (!r.ok) setOn(!v);
      }} />
    </div>
  );
}
