"use client";

import { useState } from "react";
import { FileSignature, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortalAction } from "../usePortalAction";

export type LeaseTerms = { property: string; unit: string; rent: string; moveIn: string; name: string };

// The demo e-signature: the lease's key terms, the applicant types their full name and agrees.
export function SignLease({ me, terms }: { me: string; terms: LeaseTerms }) {
  const { run, busy } = usePortalAction("applicants", me);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const valid = name.trim().replace(/\s+/g, " ").toLowerCase() === terms.name.toLowerCase() && agree;
  const rows: [string, string][] = [["Home", `${terms.property}, unit ${terms.unit}`], ["Monthly rent", terms.rent], ["Term", "12 months"], ["Requested move-in", terms.moveIn]];
  return (
    <>
      <Button className="max-md:h-11" onClick={() => setOpen(true)}><FileSignature data-icon="inline-start" />Read and sign lease</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <form className="flex flex-col gap-4" onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            if ((await run("sign_lease", { signature: name.trim(), agree: true })).ok) setOpen(false);
          }}>
            <DialogHeader>
              <DialogTitle>Sign your lease</DialogTitle>
              <DialogDescription>Check the terms, then type your full name to sign.</DialogDescription>
            </DialogHeader>
            <dl className="divide-y rounded-lg border text-[13px]">
              {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>)}
            </dl>
            <div className="space-y-1.5">
              <Label htmlFor="sign-name">Type your full name</Label>
              <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={terms.name} autoComplete="name" className="max-md:h-11" />
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox id="sign-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
              <Label htmlFor="sign-agree" className="text-[13px] leading-snug font-normal">I&apos;ve read the lease and agree that typing my name is my electronic signature.</Label>
            </div>
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3" aria-hidden />Demo e-signature: nothing is legally signed.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Button>
              <Button type="submit" disabled={!valid || !!busy}>{busy ? "Signing…" : "Sign lease"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
