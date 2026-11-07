"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/app/forms/DateInput";
import { usePortalAction } from "../usePortalAction";

// Notice to vacate: a move-out date at least `minDate` out, and an optional reason.
export function GiveNotice({ me, minDate, suggested }: { me: string; minDate: string; suggested: string }) {
  const { run, busy } = usePortalAction("residents", me);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(suggested);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" className="max-md:h-11" onClick={() => setOpen(true)}><LogOut data-icon="inline-start" />Give move-out notice</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); if (date >= minDate && (await run("give_notice", { moveOutOn: date, reason: reason.trim() })).ok) setOpen(false); }}>
            <DialogHeader>
              <DialogTitle>Give move-out notice</DialogTitle>
              <DialogDescription>Your lease asks for 30 days&apos; notice. The team then books your move-out inspection, and your deposit statement follows after you move out.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="mo-date">Move-out date</Label>
              <DateInput id="mo-date" min={minDate} value={date} onChange={setDate} />
              {date && date < minDate && <p className="text-[12px] text-tone-danger" role="alert">Pick {minDate} or later.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mo-reason">Reason <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="mo-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-16 text-[13px]" placeholder="For example: buying a home" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Button>
              <Button type="submit" disabled={!date || date < minDate || !!busy}>{busy ? "Sending…" : "Send notice"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
