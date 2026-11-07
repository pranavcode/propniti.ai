"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/app/display";
import { Textarea } from "@/components/ui/textarea";
import { SignRenewal } from "./SignRenewal";
import { usePortalAction } from "../usePortalAction";
import type { Offer } from "../../resident-data";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Decision = "Accepted" | "Countered" | "Declined";

// Renewal terms the office sent, side by side, with accept, counter or decline (confirmed first),
// then the e-signature once accepted.
export function RenewalOffers({ me, offers, name }: { me: string; offers: Offer[]; name: string }) {
  const { run, busy } = usePortalAction("residents", me);
  const [pending, setPending] = useState<{ offer: Offer; decision: Decision } | null>(null);
  const [note, setNote] = useState("");
  const open = offers.filter((o) => o.status === "Sent");
  const accepted = offers.find((o) => o.status === "Accepted");
  return (
    <>
      {open.length === 0 && accepted && !accepted.signed_at && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><p className="text-[13px]">You accepted {accepted.term_months} months at {usd(accepted.rent_cents)}.</p><SignRenewal me={me} offer={accepted} name={name} /></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {open.map((o) => {
          const change = o.rent_cents - o.current_rent_cents;
          return (
            <div key={o.id} className="flex flex-col rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">{o.term_months}-month renewal</p>
                <StatusBadge value="Offer" tone="info" label={o.expires_on ? `Respond by ${day(o.expires_on)}` : "Open"} />
              </div>
              <p className="mt-2 text-[26px] leading-none font-semibold tabular-nums">{usd(o.rent_cents)}<span className="text-[13px] font-normal text-muted-foreground"> / month</span></p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground tabular-nums">
                {change === 0 ? "Same as today" : `${change > 0 ? "+" : "−"}${usd(Math.abs(change))} vs your ${usd(o.current_rent_cents)} today (${((change / o.current_rent_cents) * 100).toFixed(1)}%)`}
              </p>
              {o.market_rent_cents != null && <p className="text-[12.5px] text-muted-foreground tabular-nums">New residents pay about {usd(o.market_rent_cents)} for this floor plan.</p>}
              <div className="mt-4 flex gap-2">
                <Button className="flex-1 max-md:h-11" disabled={!!busy} onClick={() => setPending({ offer: o, decision: "Accepted" })}>Accept</Button>
                <Button variant="outline" className="max-md:h-11" disabled={!!busy} onClick={() => { setNote(""); setPending({ offer: o, decision: "Countered" }); }}>Counter</Button>
                <Button variant="ghost" className="max-md:h-11" disabled={!!busy} onClick={() => setPending({ offer: o, decision: "Declined" })}>Decline</Button>
              </div>
            </div>
          );
        })}
      </div>
      <Dialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>{pending.decision === "Accepted" ? `Accept ${pending.offer.term_months} months at ${usd(pending.offer.rent_cents)}?` : pending.decision === "Countered" ? "Ask for different terms" : "Decline this renewal?"}</DialogTitle>
                <DialogDescription>
                  {pending.decision === "Accepted"
                    ? `You'll sign the renewal here next. Any other offer is withdrawn.`
                    : pending.decision === "Countered" ? "Say what would work for you. The office replies here with updated terms."
                    : "Then give your move-out notice on this page. You can message the office if you change your mind."}
                </DialogDescription>
              </DialogHeader>
              {pending.decision === "Countered" && <Textarea aria-label="Your counter-offer" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={`For example: ${pending.offer.term_months} months at ${usd(pending.offer.current_rent_cents)}, my current rent`} className="min-h-20 text-[13px]" />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
                <Button variant={pending.decision === "Declined" ? "destructive" : "default"} disabled={!!busy || (pending.decision === "Countered" && note.trim().length < 3)} onClick={async () => {
                  const r = await run("respond_renewal", { offerId: pending.offer.id, decision: pending.decision, note: note.trim() });
                  if (r.ok) setPending(null);
                }}>{busy ? "Saving…" : pending.decision === "Accepted" ? "Accept renewal" : pending.decision === "Countered" ? "Send counter-offer" : "Decline renewal"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
