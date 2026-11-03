"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "./client";

export type PolicyRow = { id: string; label: string; summary: string };

// Runs a late-fee policy for the month. Safe to press twice: each lease gets at most one fee per
// month (the server refuses a second run), and every fee is capped by the state's limit.
export function LateFeeRunner({ policies, period }: { policies: PolicyRow[]; period: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<PolicyRow | null>(null);
  const [busy, setBusy] = useState(false);
  if (!policies.length) {
    return (
      <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
        No late-fee policy yet. <Link href="/app/receivables/late-fees?new=1" className="font-medium text-primary hover:underline">Create the organization default</Link> to post fees; state caps still apply.
      </div>
    );
  }
  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    const r = await runAction("late_fee_policies", confirm.id, "post_late_fees", { period });
    setBusy(false);
    setConfirm(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? "Late fees posted", r.href ? { action: { label: "See the fees", onClick: () => router.push(r.href!) } } : undefined);
    router.refresh();
  };
  return (
    <>
      <ul className="divide-y">
        {policies.slice(0, 4).map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <Link href={`/app/receivables/late-fees/${p.id}`} className="block truncate text-[13px] font-medium hover:text-primary hover:underline">{p.label}</Link>
              <span className="block truncate text-[11.5px] text-muted-foreground">{p.summary}</span>
            </div>
            <Button size="xs" variant="outline" onClick={() => setConfirm(p)}>Post for {period}</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Post {period} late fees?</DialogTitle>
            <DialogDescription>{confirm?.label}: {confirm?.summary}. Fees go only on rent still unpaid after the grace period, at most one per lease this month, and never above the state cap.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={busy} onClick={run}>{busy && <Loader2 className="animate-spin" />}{busy ? "Posting…" : "Post late fees"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
