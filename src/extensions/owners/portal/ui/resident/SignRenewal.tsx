"use client";

import { useState } from "react";
import { FileSignature, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortalAction } from "../usePortalAction";
import type { Offer } from "../../resident-data";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The demo e-signature on an accepted renewal.
export function SignRenewal({ me, offer, name }: { me: string; offer: Offer; name: string }) {
  const { run, busy } = usePortalAction("residents", me);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [agree, setAgree] = useState(false);
  const valid = agree && typed.trim().replace(/\s+/g, " ").toLowerCase() === name.toLowerCase();
  return (
    <>
      <Button className="max-md:h-11" onClick={() => setOpen(true)}><FileSignature data-icon="inline-start" />Sign renewal</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); if (valid && (await run("sign_renewal", { offerId: offer.id, signature: typed.trim(), agree: true })).ok) setOpen(false); }}>
            <DialogHeader>
              <DialogTitle>Sign your renewal</DialogTitle>
              <DialogDescription>{offer.term_months} months at {usd(offer.rent_cents)} a month. Type your full name to sign.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ren-name">Type your full name</Label>
              <Input id="ren-name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="name" className="max-md:h-11" />
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox id="ren-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
              <Label htmlFor="ren-agree" className="text-[13px] leading-snug font-normal">I agree to the renewal terms and that typing my name is my electronic signature.</Label>
            </div>
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3" aria-hidden />Demo e-signature: nothing is legally signed.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Button>
              <Button type="submit" disabled={!valid || !!busy}>{busy ? "Signing…" : "Sign renewal"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
