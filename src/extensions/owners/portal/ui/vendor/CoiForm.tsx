"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePortalAction } from "../usePortalAction";

// Upload a certificate of insurance: carrier, general liability limit, workers' comp and expiry.
export function CoiForm({ me, today }: { me: string; today: string }) {
  const { run, busy } = usePortalAction("vendors", me);
  const [file, setFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState("");
  const [limit, setLimit] = useState("1000000");
  const [wc, setWc] = useState(true);
  const [expires, setExpires] = useState("");
  const valid = file && carrier.trim().length > 1 && Number(limit) >= 1000 && expires > today;
  return (
    <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!valid) return;
      const r = await run("upload_coi", { carrier: carrier.trim(), glLimitCents: Math.round(Number(limit) * 100), workersComp: wc, expiresOn: expires, fileName: file!.name });
      if (r.ok) { setFile(null); setCarrier(""); setExpires(""); }
    }}>
      <h2 className="text-[14px] font-semibold">Upload a new certificate</h2>
      <label htmlFor="coi-file" className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 hover:border-primary/40">
        <Upload className="size-4 text-muted-foreground" />
        <span className="text-[13px]">{file ? file.name : "Choose the certificate (PDF or photo)"}</span>
        <input id="coi-file" type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="coi-carrier">Insurance carrier</Label><Input id="coi-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. Travelers…" maxLength={120} autoComplete="organization" /></div>
        <div className="space-y-1.5"><Label htmlFor="coi-limit">General liability limit ($)</Label><Input id="coi-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))} className="tabular-nums" /></div>
        <div className="space-y-1.5"><Label htmlFor="coi-exp">Expires on</Label><Input id="coi-exp" type="date" min={today} value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        <div className="flex items-center gap-2 pt-6"><Switch id="coi-wc" checked={wc} onCheckedChange={setWc} /><Label htmlFor="coi-wc">Includes workers&apos; compensation</Label></div>
      </div>
      <Button type="submit" disabled={!valid || !!busy}>{busy ? "Saving…" : "Save certificate"}</Button>
    </form>
  );
}
