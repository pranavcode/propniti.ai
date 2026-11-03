"use client";

import { useState } from "react";
import { CreditCard, Lock } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePortalAction } from "../usePortalAction";

// Pays the application fee by the card on file. The server pays each application once.
export function PayFee({ me, cents, property }: { me: string; cents: number; property: string }) {
  const { run, busy } = usePortalAction("applicants", me);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)}><CreditCard />Pay {formatMoney(cents / 100)}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay the {formatMoney(cents / 100)} application fee?</DialogTitle>
            <DialogDescription>Charged to your card on file for {property}. The fee covers screening and isn&apos;t refundable once screening starts.</DialogDescription>
          </DialogHeader>
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3" />Demo payment: no real card is charged.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!!busy} onClick={async () => { if ((await run("pay_fee", {})).ok) setOpen(false); }}>{busy ? "Paying…" : `Pay ${formatMoney(cents / 100)}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
