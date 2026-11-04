"use client";

import { useState } from "react";
import { Loader2, ScanText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AIBadge, Confidence } from "@/components/app/ai";
import { formatDate } from "@/lib/format";
import { usePortalAction } from "../usePortalAction";

// Upload a certificate of insurance: carrier, general liability limit, workers' comp and expiry.
// Carrier, limit and workers' comp start from the certificate on file. Choosing the file asks AI to
// read it (live model only); read values are labelled and the vendor confirms them before sending.
// Staff verify every certificate before it counts, whoever typed the values.

type OnFile = { carrier: string; gl_limit_cents: number; workers_comp: number | boolean; expires_on: string } | null;
type Field = "carrier" | "glLimit" | "workersComp" | "expiresOn";
type Read = { state: "idle" | "reading" | "read" | "none"; confidence?: number; note?: string; issues?: string[] };

export function CoiForm({ me, today, onFile }: { me: string; today: string; onFile?: OnFile }) {
  const { run, busy } = usePortalAction("vendors", me);
  const [file, setFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState(onFile?.carrier ?? "");
  const [limit, setLimit] = useState(onFile ? String(Math.round(onFile.gl_limit_cents / 100)) : "");
  const [wc, setWc] = useState(!!onFile?.workers_comp);
  const [expires, setExpires] = useState("");
  const [read, setRead] = useState<Read>({ state: "idle" });
  const [ai, setAi] = useState<Field[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const typed = (f: Field) => setAi((xs) => xs.filter((x) => x !== f));
  const valid = file && carrier.trim().length > 1 && Number(limit) >= 1000 && expires > today && (!ai.length || confirmed);

  const onChoose = async (f: File | null) => {
    setFile(f);
    setAi([]);
    setConfirmed(false);
    if (!f) return setRead({ state: "idle" });
    setRead({ state: "reading" });
    try {
      const form = new FormData();
      form.append("kind", "coi");
      form.append("file", f);
      const res = await fetch("/api/ai/extract", { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      const c = out.coi as { isCertificate: boolean; carrier: string; glLimit: number; workersComp: boolean; expiresOn: string; confidence: number; issues: string[] } | undefined;
      if (!res.ok || !c) return setRead({ state: "none", note: out.error ?? out.note ?? "We couldn't read the file automatically." });
      if (!c.isCertificate) return setRead({ state: "none", note: "This file doesn't look like a certificate of insurance. Check you chose the right one." });
      const got: Field[] = [];
      if (c.carrier) { setCarrier(c.carrier); got.push("carrier"); }
      if (c.glLimit) { setLimit(String(c.glLimit)); got.push("glLimit"); }
      setWc(c.workersComp); got.push("workersComp");
      if (c.expiresOn) { setExpires(c.expiresOn); got.push("expiresOn"); }
      setAi(got);
      setRead({ state: "read", confidence: c.confidence, issues: c.issues });
    } catch {
      setRead({ state: "none", note: "Upload failed. Enter the values yourself." });
    }
  };

  const tag = (f: Field, fromFile: boolean) => ai.includes(f)
    ? <span className="inline-flex items-center gap-1 text-[11px] text-tone-ai"><ScanText className="size-3" />Read by AI</span>
    : fromFile ? <span className="text-[11px] text-muted-foreground">From your certificate on file</span> : null;
  const onFileCarrier = !!onFile && carrier === onFile.carrier;
  const onFileLimit = !!onFile && limit === String(Math.round(onFile.gl_limit_cents / 100));
  const onFileWc = !!onFile && wc === !!onFile.workers_comp;

  return (
    <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!valid) return;
      const r = await run("upload_coi", {
        carrier: carrier.trim(), glLimitCents: Math.round(Number(limit) * 100), workersComp: wc, expiresOn: expires, fileName: file!.name,
        read: ai.length ? { source: "live", ...(read.confidence != null ? { confidence: read.confidence } : {}), fields: ai } : { source: "manual" },
      });
      if (r.ok) { setFile(null); setExpires(""); setAi([]); setConfirmed(false); setRead({ state: "idle" }); }
    }}>
      <h2 className="text-[14px] font-semibold">Upload a new certificate</h2>
      <label htmlFor="coi-file" className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 hover:border-primary/40 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/60">
        <Upload className="size-4 text-muted-foreground" />
        <span className="text-[13px]">{file ? file.name : "Choose the certificate (PDF or photo). AI reads the values for you."}</span>
        <input id="coi-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => onChoose(e.target.files?.[0] ?? null)} />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]" aria-live="polite">
        {read.state === "reading" && <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading your certificate…</span>}
        {read.state === "read" && <><AIBadge source="live" size="xs" /><span>Filled in from your file. Check each value against the certificate.</span>{read.confidence != null && <Confidence value={read.confidence} />}</>}
        {read.state === "none" && <span className="text-muted-foreground">{read.note} Check the values below.</span>}
        {read.state === "idle" && onFile && <span className="text-muted-foreground">Carrier, limit and workers&apos; comp start from your certificate on file (expires {formatDate(onFile.expires_on, "always")}). Change anything that&apos;s different.</span>}
      </div>
      {read.issues && read.issues.length > 0 && <ul className="rounded-md border border-tone-warning/30 bg-tone-warning/5 px-3 py-2 text-[12px]">{read.issues.map((i) => <li key={i}>Check: {i}</li>)}</ul>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="coi-carrier">Insurance carrier</Label><Input id="coi-carrier" value={carrier} onChange={(e) => { setCarrier(e.target.value); typed("carrier"); }} placeholder="e.g. Travelers…" maxLength={120} autoComplete="organization" />{tag("carrier", onFileCarrier)}</div>
        <div className="space-y-1.5"><Label htmlFor="coi-limit">General liability limit ($)</Label><Input id="coi-limit" inputMode="numeric" value={limit} onChange={(e) => { setLimit(e.target.value.replace(/[^\d]/g, "")); typed("glLimit"); }} placeholder="e.g. 1000000" className="tabular-nums" />{tag("glLimit", onFileLimit)}</div>
        <div className="space-y-1.5"><Label htmlFor="coi-exp">Expires on</Label><Input id="coi-exp" type="date" min={today} value={expires} onChange={(e) => { setExpires(e.target.value); typed("expiresOn"); }} />{tag("expiresOn", false)}</div>
        <div className="space-y-1.5 pt-6"><div className="flex items-center gap-2"><Switch id="coi-wc" checked={wc} onCheckedChange={(v) => { setWc(v); typed("workersComp"); }} /><Label htmlFor="coi-wc">Includes workers&apos; compensation</Label></div>{tag("workersComp", onFileWc)}</div>
      </div>
      {ai.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <Checkbox id="coi-confirm" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
          <Label htmlFor="coi-confirm" className="text-[12.5px] leading-snug font-normal">I checked the values AI read against my certificate. Our team verifies it with your carrier before it counts.</Label>
        </div>
      )}
      <Button type="submit" disabled={!valid || !!busy} className="max-md:h-11">{busy ? "Saving…" : "Save certificate"}</Button>
    </form>
  );
}
