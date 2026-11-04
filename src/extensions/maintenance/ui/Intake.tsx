"use client";
import { demoNow } from "@/lib/clock";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDashed, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FIELD, postAction } from "./client";

// New maintenance request: a plain-language description and a photo. Saving creates the work order
// through the generic API, attaches the photo (which runs the photo check), then runs the
// Maintenance Triage Agent and opens its suggestion.

type Step = "idle" | "saving" | "photo" | "triage";
const STEPS: { key: Exclude<Step, "idle">; label: string }[] = [
  { key: "saving", label: "Saving the request" },
  { key: "photo", label: "Checking the photo" },
  { key: "triage", label: "Maintenance Triage Agent: trade, urgency, estimate, vendors" },
];

const firstSentence = (s: string) => {
  const t = s.trim().split(/(?<=[.!?])\s|\n/)[0]!.trim().replace(/[.!?]+$/, "");
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
};

export function IntakeForm({ properties, photos, examples }: { properties: { id: string; name: string; metro: string }[]; photos: { url: string; label: string }[]; examples: string[] }) {
  const router = useRouter();
  const [property, setProperty] = useState(properties[0]?.id ?? "");
  const [units, setUnits] = useState<{ id: string; label: string }[]>([]);
  const [unit, setUnit] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [enter, setEnter] = useState(true);
  const [step, setStep] = useState<Step>("idle");

  useEffect(() => {
    if (!property) return;
    let live = true;
    fetch(`/api/e/units?f.property_id=${encodeURIComponent(property)}&size=100&sort=label`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: { id: string; label?: string; _title?: string }[] }) => live && setUnits((d.rows ?? []).map((u) => ({ id: u.id, label: String(u.label ?? u._title ?? u.id) }))))
      .catch(() => live && setUnits([]));
    return () => { live = false; };
  }, [property]);

  const busy = step !== "idle";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const description = text.trim();
    setStep("saving");
    const now = demoNow();
    const res = await fetch("/api/e/work_orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: firstSentence(description), description, property_id: property, unit_id: unit || null, category: "General", priority: "Normal", status: "New", source: "Staff",
        opened_at: now.toISOString(), sla_due_at: new Date(now.getTime() + 72 * 3_600_000).toISOString(), permission_to_enter: enter,
      }),
    }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || !out.row?.id) {
      setStep("idle");
      return toast.error(out.error ?? "The request wasn't saved. Try again.");
    }
    const id = String(out.row.id);
    if (photo) {
      setStep("photo");
      const p = await postAction("work_orders", id, "work_orders.add_photo", { url: photo, stage: "Before" });
      if (p.status !== 200) toast.error(p.error ?? "The photo wasn't attached");
    }
    setStep("triage");
    const t = await postAction("work_orders", id, "work_orders.run_triage");
    if (t.status !== 200) toast.error(t.error ?? "Triage didn't finish. You can run it again from the request.");
    router.push(t.href ?? `/app/maintenance/intake/${encodeURIComponent(id)}`);
  };

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]" data-tour="mx-intake">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[12.5px] font-medium">Property
            <select className={cn(FIELD, "h-9")} value={property} onChange={(e) => { setProperty(e.target.value); setUnit(""); }} disabled={busy} required>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.metro}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12.5px] font-medium">Unit
            <select className={cn(FIELD, "h-9")} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={busy}>
              <option value="">Common area (no unit)</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-[12.5px] font-medium">What&apos;s wrong?
          <textarea autoComplete="off" className={cn(FIELD, "h-36 resize-y py-2 text-[14px] leading-relaxed")} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} required minLength={8} maxLength={2000}
            placeholder="Water is dripping from the kitchen ceiling under unit 312. It started this morning and there's a brown stain spreading near the light fixture…" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[12px] text-muted-foreground">Try:</span>
          {examples.map((x) => <button key={x} type="button" disabled={busy} onClick={() => setText(x)} className="rounded-full border px-2.5 py-0.5 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground">{x.length > 48 ? `${x.slice(0, 46)}…` : x}</button>)}
        </div>
        <fieldset disabled={busy}>
          <legend className="mb-1.5 text-[12.5px] font-medium">Photo <span className="font-normal text-muted-foreground">(sample photos in the demo)</span></legend>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Photo">
            {photos.map((p) => (
              <button key={p.url} type="button" role="radio" aria-checked={photo === p.url} aria-label={p.label} title={p.label} onClick={() => setPhoto(photo === p.url ? null : p.url)}
                className={cn("relative overflow-hidden rounded-md ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", photo === p.url && "ring-2 ring-primary")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public */}
                <img src={p.url.replace(/\.webp$/, "-400.webp")} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                {photo === p.url && <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={enter} onChange={(e) => setEnter(e.target.checked)} disabled={busy} />Resident gave permission to enter</label>
      </div>

      <aside className="flex flex-col gap-3">
        <div className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04] p-4">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="size-4 text-tone-ai" />What happens next</h2>
          <ol className="mt-2 flex flex-col gap-2" aria-live="polite">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex((x) => x.key === step);
              const done = busy && i < at;
              const active = s.key === step;
              return (
                <li key={s.key} className={cn("flex items-start gap-2 text-[12.5px]", !busy && "text-muted-foreground", s.key === "photo" && !photo && "opacity-50")}>
                  {done ? <Check className="mt-0.5 size-3.5 text-tone-success" /> : active ? <Loader2 className="mt-0.5 size-3.5 animate-spin text-tone-ai" /> : <CircleDashed className="mt-0.5 size-3.5" />}
                  {s.label}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[12px] text-muted-foreground">Under your auto-approve limit the agent assigns the vendor and you can change it on the next screen. Above the limit, nothing is dispatched until you choose. Spend over the owner&apos;s limit waits for the owner.</p>
        </div>
        <Button type="submit" size="lg" disabled={busy || text.trim().length < 8 || !property}>{busy ? <><Loader2 className="size-4 animate-spin" />Working…</> : <><Sparkles className="size-4" />Save and triage</>}</Button>
      </aside>
    </form>
  );
}
