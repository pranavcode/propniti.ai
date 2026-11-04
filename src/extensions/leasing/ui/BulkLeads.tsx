"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { bulkSummary, runBulk, type BulkResult } from "./client";

// Bulk lead actions for the leasing homes. Each record runs through the same action as its own
// button (scope, stage and once-a-day checks, audit row); this only batches the requests.

export function SendFollowUps({ ids, label, who }: { ids: string[]; label: string; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const busy = done != null && !result;

  const send = async () => {
    setDone(0);
    const r = await runBulk("prospects", "prospects.follow_up", ids, { onProgress: setDone });
    setResult(r);
    if (r.ok) toast.success(bulkSummary(r, "Follow-ups sent:"));
    else toast.error(r.errors[0] ?? "No follow-ups were sent");
    router.refresh();
  };
  const close = (o: boolean) => {
    if (busy) return;
    setOpen(o);
    if (!o) { setDone(null); setResult(null); }
  };

  if (!ids.length) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Send data-icon="inline-start" />{label}</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {ids.length} follow-up{ids.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>Each of {who} gets the standard follow-up email from you, offering a tour. Leads already contacted today, or no longer open, are skipped. Every send is logged on the lead.</DialogDescription>
          </DialogHeader>
          {done != null && (
            <div className="flex flex-col gap-1.5" role="status">
              <Progress value={(done / ids.length) * 100} aria-label="Sending follow-ups" />
              <p className="text-[12.5px] text-muted-foreground tabular-nums">{result ? bulkSummary(result, "Sent") : `Sending ${done} of ${ids.length}…`}</p>
            </div>
          )}
          <DialogFooter>
            {result ? <Button onClick={() => close(false)}>Done</Button> : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => close(false)}>Cancel</Button>
                <Button disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}Send {ids.length}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
