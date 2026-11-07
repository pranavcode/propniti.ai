"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "./client";

// Reject, with a reason the resident sees, a policy sent from the resident portal. Verifying is the
// record's header action (renters_insurance.verify).
export function InsuranceDecision({ id }: { id: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (action: string, body: unknown) => {
    setBusy(true);
    try {
      const r = await runAction("renters_insurance", id, action, body);
      toast.success(r.message ?? "Done");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  if (rejecting) {
    return (
      <div className="space-y-2">
        <label htmlFor="ri-reason" className="text-[12.5px] font-medium">Why can&apos;t it be verified?</label>
        <Textarea id="ri-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="For example: the named insured isn't on this lease" className="min-h-16 text-[13px]" />
        <p className="text-[11.5px] text-muted-foreground">The resident sees this in their portal.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => act("reject", { reason: reason.trim() })}><ShieldX />Reject policy</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted-foreground">Check the carrier, policy number, liability limit and dates against the page, then use Verify policy at the top. If something doesn&apos;t match, send it back with the reason.</p>
      <Button size="sm" variant="outline" className="text-tone-danger hover:text-tone-danger" disabled={busy} onClick={() => setRejecting(true)}><ShieldX />Reject</Button>
    </div>
  );
}
