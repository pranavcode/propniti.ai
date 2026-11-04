"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIBadge } from "@/components/app/ai";
import { StatusBadge } from "@/components/app/display";
import { usePortalAction } from "../usePortalAction";

type Triage = { trade: string; priority: string; safety: boolean; why: string[]; cost: { low_cents: number; high_cents: number; jobs: number } | null };

const LOCATIONS = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Laundry", "Balcony or patio", "Whole apartment", "Outside or common area"];
const MAX_CHARS = 30_000;
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

// Phone photos are several MB; shrink them in the browser so two fit in one request.
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("Not an image"));
      i.src = url;
    });
    for (const [max, q] of [[480, 0.55], [360, 0.45], [280, 0.4]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= MAX_CHARS) return data;
    }
    throw new Error("That photo is too large to send. Try a different photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// New maintenance request: description, where, permission to enter, up to two photos, and a live
// AI triage preview (trade, urgency, typical cost) before it is sent.
export function RequestForm({ me, onDone }: { me: string; onDone?: () => void }) {
  const router = useRouter();
  const { run, busy } = usePortalAction("residents", me);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [enter, setEnter] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [triage, setTriage] = useState<Triage | null>(null);
  const [thinking, setThinking] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const text = `${location} ${description}`.trim();

  useEffect(() => {
    if (description.trim().length < 8) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setThinking(true);
      try {
        const res = await fetch("/portal/resident/requests/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: ctl.signal });
        if (res.ok) setTriage(await res.json());
      } catch {
        // Aborted by the next keystroke, or offline; the preview just stays as it was.
      } finally {
        if (!ctl.signal.aborted) setThinking(false);
      }
    }, 500);
    return () => {
      clearTimeout(t);
      ctl.abort();
      setThinking(false);
    };
  }, [text, description]);

  const addPhotos = async (files: FileList | null) => {
    setPhotoError(null);
    for (const f of Array.from(files ?? []).slice(0, 2 - photos.length)) {
      try {
        const d = await shrink(f);
        setPhotos((p) => [...p, d].slice(0, 2));
      } catch (e) {
        setPhotoError(e instanceof Error ? e.message : "Couldn't read that photo");
      }
    }
    if (file.current) file.current.value = "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run("request_maintenance", { description, location, permissionToEnter: enter, photos });
    if (r.ok) {
      onDone?.();
      router.replace(r.href ?? "/portal/resident/requests");
    }
  };

  const valid = description.trim().length >= 8;
  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="req-desc">What&apos;s wrong?</Label>
          <Textarea id="req-desc" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={1000} required
            placeholder="For example: the AC is running but blowing warm air, since last night…" />
          <p className="text-[11.5px] text-muted-foreground">Say what you see and when it started. {description.length > 800 && <span className="tabular-nums">{1000 - description.length} characters left.</span>}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="req-loc">Where</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger id="req-loc" className="w-full"><SelectValue placeholder="Choose a room…" /></SelectTrigger>
              <SelectContent>{LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <Label htmlFor="req-enter" className="text-[13px] leading-snug font-normal">OK to enter if I&apos;m not home</Label>
            <Switch id="req-enter" checked={enter} onCheckedChange={setEnter} />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">Photos <span className="font-normal text-muted-foreground">(optional, up to 2)</span></p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the resident's own photo */}
                <img src={p} alt={`Photo ${i + 1}`} className="size-20 rounded-lg object-cover ring-1 ring-border" />
                <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background after:absolute after:-inset-3 after:content-['']"><X className="size-3" /></button>
              </div>
            ))}
            {photos.length < 2 && (
              <button type="button" onClick={() => file.current?.click()} className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                <Camera className="size-5" />Add photo
              </button>
            )}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" className="hidden" aria-label="Add photos" onChange={(e) => addPhotos(e.target.files)} />
          </div>
          {photoError && <p className="text-[12px] text-tone-danger" role="alert">{photoError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!valid || !!busy}>{busy ? "Sending…" : "Send request"}</Button>
          {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}
        </div>
      </div>

      <aside className="h-fit rounded-xl border border-tone-ai/25 bg-tone-ai/[0.04] p-4" aria-live="polite" aria-label="AI first read">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="size-4 text-tone-ai" />AI&apos;s first read</p>
          {valid && triage && <AIBadge source="rules" size="xs" />}
        </div>
        {!valid && !triage && <p className="text-[12.5px] text-muted-foreground">Start describing the problem and we&apos;ll suggest the trade, how urgent it is and a typical cost.</p>}
        {valid && thinking && !triage && <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading your description…</p>}
        {valid && triage && (
          <div className={`space-y-3 transition-opacity ${thinking ? "opacity-60" : ""}`}>
            {triage.safety && (
              <p className="flex items-start gap-2 rounded-lg bg-tone-danger/10 p-2.5 text-[12.5px] font-medium text-tone-danger" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />If you smell gas, see smoke or sparks, or water is near outlets, leave the apartment and call 911 first.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
              <div><dt className="text-muted-foreground">Trade</dt><dd className="font-medium">{triage.trade}</dd></div>
              <div><dt className="text-muted-foreground">Urgency</dt><dd><StatusBadge value={triage.priority} tone={triage.priority === "Emergency" ? "danger" : triage.priority === "Urgent" ? "warning" : "neutral"} /></dd></div>
              {triage.cost && <div className="col-span-2"><dt className="text-muted-foreground">Typical repair cost here</dt><dd className="font-medium tabular-nums">{usd(triage.cost.low_cents)}–{usd(triage.cost.high_cents)} <span className="font-normal text-muted-foreground">({triage.cost.jobs} past jobs)</span></dd></div>}
            </dl>
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted-foreground">{triage.why.map((w) => <li key={w}>{w}</li>)}</ul>
            <p className="border-t pt-2 text-[11px] text-muted-foreground">A person on the maintenance team confirms this before anyone is sent.</p>
          </div>
        )}
      </aside>
    </form>
  );
}
