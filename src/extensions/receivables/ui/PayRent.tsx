"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAction, usd } from "./client";

export type OpenCharge = { id: string; description: string; due_on: string; open: number; processing: boolean };

// Resident portal: pay each open charge by ACH. A charge shows Processing until the transfer clears;
// paying twice is refused by the server (one live rent:<charge> transfer).
export function PayRentPanel({ charges }: { charges: OpenCharge[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!charges.length) return <p className="flex items-center gap-2 rounded-lg border px-4 py-3 text-[13px]"><CheckCircle2 className="size-4 text-tone-success" />You’re all paid up. Thank you!</p>;
  const pay = async (c: OpenCharge) => {
    setBusy(c.id);
    const r = await runAction("charges", c.id, "pay_rent");
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? "Payment started");
    router.refresh();
  };
  return (
    <ul className="divide-y rounded-lg border">
      {charges.map((c) => (
        <li key={c.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-medium">{c.description}</p><p className="text-[12px] text-muted-foreground">Due {c.due_on}</p></div>
          <span className="text-[14px] font-semibold tabular-nums">{usd(c.open)}</span>
          {c.processing ? <span className="min-w-28 text-right text-[12px] text-tone-info">Processing</span> : <Button className="min-w-28" size="sm" disabled={busy === c.id} onClick={() => pay(c)}>{busy === c.id && <Loader2 className="animate-spin" />}Pay {usd(c.open)}</Button>}
        </li>
      ))}
    </ul>
  );
}
