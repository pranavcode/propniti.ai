"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAction } from "./client";

// Sends today's past-due reminder for one lease. The server sends at most one a day per lease, so a
// second click (or another tab) answers "already sent" without sending again.
export function RemindButton({ leaseId, resident, sent }: { leaseId: string; resident: string; sent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(sent);
  if (done) return <span className="inline-flex h-7 items-center gap-1 px-2 text-[12px] text-muted-foreground"><Check className="size-3.5 text-tone-success" aria-hidden />Reminded today</span>;
  const send = async () => {
    setBusy(true);
    const r = await runAction("leases", leaseId, "remind");
    setBusy(false);
    if (!r.ok) {
      if (/already/.test(r.error)) setDone(true);
      return toast.error(r.error);
    }
    setDone(true);
    toast.success(r.message ?? "Reminder sent");
    router.refresh();
  };
  return (
    <Button size="xs" variant="outline" disabled={busy} onClick={send} aria-label={`Send a past-due reminder to ${resident}`}>
      {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}Remind
    </Button>
  );
}
