"use client";

import { useState } from "react";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortalAction } from "../usePortalAction";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const PROVIDER: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", "workers-ai": "Workers AI" };

type Fields = { carrier: string; policyNumber: string; liability: string; startsOn: string; expiresOn: string };
type Key = keyof Fields;
const EMPTY: Fields = { carrier: "", policyNumber: "", liability: "", startsOn: "", expiresOn: "" };
const LABELS: Record<Key, string> = { carrier: "Insurance company", policyNumber: "Policy number", liability: "Personal liability limit ($)", startsOn: "Coverage starts", expiresOn: "Coverage ends" };

// Upload a renters insurance declarations page: the AI reads it (when a model is configured), the
// resident checks every field, and the policy is sent to the office as Pending verification. The
// file is read and discarded; only its name is kept.
export function InsuranceUpload({ me, today, label = "Upload declarations page", variant = "default" }: { me: string; today: string; label?: string; variant?: "default" | "outline" }) {
  const { run, busy } = usePortalAction("residents", me);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [read, setRead] = useState<{ values: Partial<Fields>; source: string; confidence?: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reset = () => { setFile(null); setFields(EMPTY); setRead(null); setNote(null); };
  const show = (o: boolean) => {
    if (reading || busy) return;
    setOpen(o);
    if (!o) reset();
  };

  const onFile = async (f: File | null) => {
    reset();
    if (!f) return;
    if (f.type && !TYPES.includes(f.type)) return setNote("Upload a PDF or a photo (JPEG, PNG or WebP).");
    if (f.size > MAX_BYTES) return setNote("That file is over 4 MB. Upload a smaller scan or photo.");
    setFile(f);
    setReading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("kind", "insurance");
      const res = await fetch("/api/ai/extract", { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      const x = out.fields as { isDeclarations: boolean; carrier: string; policyNumber: string; liability: number; startsOn: string; expiresOn: string; confidence: number } | undefined;
      if (res.ok && x && x.isDeclarations) {
        const values: Partial<Fields> = {};
        if (x.carrier) values.carrier = x.carrier;
        if (x.policyNumber) values.policyNumber = x.policyNumber;
        if (x.liability) values.liability = String(x.liability);
        if (x.startsOn) values.startsOn = x.startsOn;
        if (x.expiresOn) values.expiresOn = x.expiresOn;
        setFields({ ...EMPTY, ...values });
        setRead({ values, source: out.source, confidence: x.confidence });
        if (Object.keys(values).length < 5) setNote("Some details couldn't be read. Fill in the empty fields from your declarations page.");
      } else {
        setNote(res.ok ? (x && !x.isDeclarations ? "This doesn't look like a renters insurance declarations page. Check the file, or type the details yourself." : out.note ?? "The page wasn't read automatically. Type the details from it.") : out.error ?? "We couldn't read that file. Type the details yourself.");
      }
    } catch {
      setNote("Upload failed. Type the details from your declarations page.");
    } finally {
      setReading(false);
    }
  };

  const aiKept = (k: Key) => read?.values[k] != null && read.values[k] === fields[k];
  const liability = Number(fields.liability);
  const valid = file && fields.carrier.trim().length > 1 && fields.policyNumber.trim() && Number.isInteger(liability) && liability >= 0 && fields.startsOn && fields.expiresOn > today && fields.startsOn < fields.expiresOn;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    const aiFields = (Object.keys(EMPTY) as Key[]).filter(aiKept);
    const r = await run("submit_insurance", { carrier: fields.carrier.trim(), policyNumber: fields.policyNumber.trim(), liability, startsOn: fields.startsOn, expiresOn: fields.expiresOn, fileName: file!.name, aiFields, source: read ? read.source : "manual" });
    if (r.ok) show(false);
  };

  const field = (k: Key, input: React.ReactNode) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`ri-${k}`}>{LABELS[k]}</Label>
        {aiKept(k) && <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-tone-ai"><Sparkles className="size-3" aria-hidden />Read by AI</span>}
      </div>
      {input}
    </div>
  );
  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [k]: k === "liability" ? e.target.value.replace(/[^\d]/g, "") : e.target.value }));

  return (
    <>
      <Button size="sm" variant={variant} className="max-md:h-11" onClick={() => show(true)}><Upload data-icon="inline-start" />{label}</Button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Send your renters insurance</DialogTitle>
              <DialogDescription>Upload the declarations page from your insurer. We read the details for you to check; the office verifies the policy before it counts.</DialogDescription>
            </DialogHeader>
            <label htmlFor="ri-file" className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 hover:border-primary/40 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/60">
              {reading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <Upload className="size-4 text-muted-foreground" aria-hidden />}
              <span className="text-[13px]">{reading ? `Reading ${file?.name}…` : file ? file.name : "Choose the declarations page (PDF or photo, up to 4 MB)"}</span>
              <input id="ri-file" type="file" accept={TYPES.join(",")} className="sr-only" disabled={reading} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
            {read && (
              <p className="flex items-start gap-1.5 rounded-md bg-tone-ai/10 px-3 py-2 text-[12px] text-tone-ai">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>Read by AI ({PROVIDER[read.source] ?? read.source}{read.confidence != null ? `, ${Math.round(read.confidence * 100)}% confident` : ""}). Check each field against your page before you send it.</span>
              </p>
            )}
            {note && <p role="status" className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">{note}</p>}
            {file && !reading && (
              <div className="grid gap-3 sm:grid-cols-2">
                {field("carrier", <Input id="ri-carrier" value={fields.carrier} onChange={set("carrier")} maxLength={120} autoComplete="off" />)}
                {field("policyNumber", <Input id="ri-policyNumber" value={fields.policyNumber} onChange={set("policyNumber")} maxLength={60} autoComplete="off" />)}
                {field("liability", <Input id="ri-liability" inputMode="numeric" value={fields.liability} onChange={set("liability")} placeholder="100000" className="tabular-nums" />)}
                <div className="hidden sm:block" />
                {field("startsOn", <Input id="ri-startsOn" type="date" value={fields.startsOn} onChange={set("startsOn")} />)}
                {field("expiresOn", <Input id="ri-expiresOn" type="date" min={today} value={fields.expiresOn} onChange={set("expiresOn")} />)}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => show(false)} disabled={reading || !!busy}>Cancel</Button>
              <Button type="submit" disabled={!valid || reading || !!busy}>{busy ? "Sending…" : "Confirm and send"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
