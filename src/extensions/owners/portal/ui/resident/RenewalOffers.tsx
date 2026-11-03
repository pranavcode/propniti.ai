"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/app/display";
import { usePortalAction } from "../usePortalAction";
import type { Offer } from "../../resident-data";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Renewal terms the office sent, side by side, with accept or decline (confirmed first).
export function RenewalOffers({ me, offers }: { me: string; offers: Offer[] }) {
  const { run, busy } = usePortalAction("residents", me);
  const [pending, setPending] = useState<{ offer: Offer; decision: "Accepted" | "Declined" } | null>(null);
  const open = offers.filter((o) => o.status === "Sent");
  const decided = offers.find((o) => o.status === "Accepted" || o.status === "Declined");
  return (
    <>
      {open.length === 0 && decided && <p className="text-[13px]">You {decided.status.toLowerCase()} the {decided.term_months}-month renewal at {usd(decided.rent_cents)}. {decided.status === "Accepted" ? "The office will send the renewal to sign." : "The office will contact you about move-out."}</p>}
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
                <Button variant="outline" className="max-md:h-11" disabled={!!busy} onClick={() => setPending({ offer: o, decision: "Declined" })}>Decline</Button>
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
                <DialogTitle>{pending.decision === "Accepted" ? `Accept ${pending.offer.term_months} months at ${usd(pending.offer.rent_cents)}?` : "Decline this renewal?"}</DialogTitle>
                <DialogDescription>
                  {pending.decision === "Accepted"
                    ? `The office will send the renewal for you to sign. Any other offer is withdrawn.`
                    : "The office will contact you about your move-out date and next steps. You can message them if you change your mind."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
                <Button variant={pending.decision === "Declined" ? "destructive" : "default"} disabled={!!busy} onClick={async () => {
                  const r = await run("respond_renewal", { offerId: pending.offer.id, decision: pending.decision });
                  if (r.ok) setPending(null);
                }}>{busy ? "Saving…" : pending.decision === "Accepted" ? "Accept renewal" : "Decline renewal"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
