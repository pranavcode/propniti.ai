"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { Check, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePortalAction } from "../usePortalAction";

// Accept (with a proposed visit time) or decline a new assignment; invoice a scheduled or done job.
export function JobActions({ me, id, title, status, invoiced, compact }: { me: string; id: string; title: string; status: string; invoiced: boolean; compact?: boolean }) {
  const { run, busy } = usePortalAction("vendors", me);
  const [mode, setMode] = useState<"accept" | "decline" | null>(null);
  const [visit, setVisit] = useState("");
  const [note, setNote] = useState("");
  const size = compact ? "sm" : "default";
  if (status === "Assigned") {
    return (
      <>
        <div className="flex flex-wrap gap-2">
          <Button size={size} className="max-md:h-11" onClick={() => setMode("accept")} disabled={!!busy}><Check />Accept</Button>
          <Button size={size} variant="outline" className="max-md:h-11" onClick={() => setMode("decline")} disabled={!!busy}><X />Decline</Button>
        </div>
        <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{mode === "accept" ? `Accept ${id}?` : `Decline ${id}?`}</DialogTitle>
              <DialogDescription>{title}. {mode === "accept" ? "Add a visit time if you have one. The property team sees it right away." : "The job goes back to the property team to reassign."}</DialogDescription>
            </DialogHeader>
            {mode === "accept" && (
              <div className="space-y-1.5">
                <Label htmlFor={`visit-${id}`}>Visit time (optional)</Label>
                <Input id={`visit-${id}`} type="datetime-local" value={visit} onChange={(e) => setVisit(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`note-${id}`}>Note for the property team (optional)</Label>
              <Textarea id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={mode === "decline" ? "e.g. Booked solid until next week…" : "e.g. Bringing a replacement valve…"} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
              <Button variant={mode === "decline" ? "destructive" : "default"} disabled={!!busy} onClick={async () => {
                const r = await run("respond_job", { workOrderId: id, decision: mode, note, ...(mode === "accept" && visit ? { visitAt: `${visit}:00.000Z` } : {}) });
                if (r.ok) setMode(null);
              }}>{busy ? "Saving…" : mode === "accept" ? "Accept job" : "Decline job"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  if (!invoiced && ["Scheduled", "In progress", "Completed", "On hold"].includes(status)) {
    return <Button asChild size={size} variant={status === "Completed" ? "default" : "outline"}><Link href={`/portal/vendor/invoices?new=1&wo=${id}`}><Receipt />Send invoice</Link></Button>;
  }
  return null;
}
