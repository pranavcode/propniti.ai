"use client";

import { useState } from "react";
import { Check, ImageOff, Sparkles, Star, X } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIBadge, Confidence } from "@/components/app/ai";
import { StatusBadge } from "@/components/app/display";
import type { Approval } from "../owner-data";
import { extraDetail } from "../text";
import { usePortalAction } from "./usePortalAction";

const usd = (cents: number) => formatMoney(cents / 100);

// One repair over the owner's limit: photos, cost against the limit and past jobs, the triage
// reasons, and Approve / Decline with an optional note.
export function ApprovalCard({ a, me }: { a: Approval; me: string }) {
  const { run, busy } = usePortalAction("owners", me);
  const mounted = useMounted();
  const detail = extraDetail(a.title, a.description);
  const day = (v: string) => (mounted ? formatDate(v) : v.slice(0, 10));
  const [decision, setDecision] = useState<"Approved" | "Declined" | null>(null);
  const [note, setNote] = useState("");
  const over = a.amount_cents - a.limit_cents;
  const why = [
    `${usd(a.amount_cents)} is ${usd(over)} over your ${usd(a.limit_cents)} approval limit`,
    a.similar.median_cents != null ? `Similar ${a.category.toLowerCase()} jobs cost ${usd(a.similar.median_cents)} at the median (${a.similar.count} done at this property)` : `No past ${a.category.toLowerCase()} jobs at this property to compare`,
    `${a.priority} priority${a.priority === "Emergency" || a.priority === "Urgent" ? ": waiting could cause more damage" : ""}`,
  ];
  const ratio = a.similar.median_cents ? a.amount_cents / a.similar.median_cents : null;
  const confidence = ratio == null ? 0.6 : ratio < 1.5 ? 0.85 : ratio < 2.5 ? 0.65 : 0.45;
  return (
    <article className="overflow-hidden rounded-xl border bg-card" aria-labelledby={`ap-${a.id}`}>
      <div className="grid md:grid-cols-[220px_1fr]">
        <div className="relative bg-muted">
          {a.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- static webp or a resident's upload
            <img src={a.photos[0].url.startsWith("/") ? a.photos[0].url.replace(/(?<!-400)\.webp$/, "-400.webp") : a.photos[0].url} alt={a.photos[0].caption || a.title} className="h-44 w-full object-cover md:h-full" loading="lazy" />
          ) : <div className="flex h-32 items-center justify-center text-muted-foreground md:h-full"><ImageOff className="size-6" aria-label="No photo" /></div>}
          {a.photos.length > 1 && <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">+{a.photos.length - 1} photo{a.photos.length > 2 ? "s" : ""}</span>}
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 id={`ap-${a.id}`} className="text-[15px] font-semibold text-balance">{a.title}</h3>
              <p className="text-[12.5px] text-muted-foreground">{a.property}{a.unit ? ` · Unit ${a.unit}` : " · Common area"} · {a.id} · opened {day(a.opened_at)}</p>
            </div>
            <div className="text-right">
              <p className="text-[18px] font-semibold tabular-nums">{usd(a.amount_cents)}</p>
              <p className="text-[11.5px] text-muted-foreground">estimate</p>
            </div>
          </div>
          {detail && <p className="mt-2 text-[13px] text-pretty">{detail}</p>}
          <div className="mt-3 rounded-lg border border-tone-ai/20 bg-tone-ai/[0.04] p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Sparkles className="size-3.5 text-tone-ai" />
              <span className="text-[12.5px] font-medium">Why this needs you</span>
              <AIBadge source="rules" size="xs" />
              <Confidence value={confidence} />
            </div>
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-muted-foreground">{why.map((w) => <li key={w}>{w}</li>)}</ul>
            {a.vendor && <p className="mt-1.5 flex items-center gap-1 text-[12.5px]">Vendor: <span className="font-medium">{a.vendor}</span>{a.vendor_rating != null && <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Star className="size-3 fill-current" />{a.vendor_rating.toFixed(1)}</span>}</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {a.decision ? (
              <>
                <StatusBadge value={a.decision} tone={a.decision === "Approved" ? "success" : "danger"} label={`You ${a.decision.toLowerCase()} this${a.decided_at ? ` on ${day(a.decided_at)}` : ""}`} />
                {a.note && <span className="text-[12.5px] text-muted-foreground">&ldquo;{a.note}&rdquo;</span>}
              </>
            ) : (
              <>
                <Button className="max-md:h-11" onClick={() => setDecision("Approved")} disabled={!!busy}><Check />Approve {usd(a.amount_cents)}</Button>
                <Button variant="outline" className="max-md:h-11" onClick={() => setDecision("Declined")} disabled={!!busy}><X />Decline</Button>
              </>
            )}
          </div>
        </div>
      </div>
      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "Approved" ? `Approve ${usd(a.amount_cents)} for ${a.title}?` : `Decline ${a.title}?`}</DialogTitle>
            <DialogDescription>{decision === "Approved" ? "The property team schedules the work. The cost appears on your statement once the vendor is paid." : "The work stays on hold. The property team will contact you about other options."}</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the property team (optional)…" aria-label="Note" name="note" maxLength={500} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button variant={decision === "Declined" ? "destructive" : "default"} disabled={!!busy} onClick={async () => {
              const r = await run("decide_spend", { workOrderId: a.id, decision, note });
              if (r.ok) setDecision(null);
            }}>{busy ? "Saving…" : decision === "Approved" ? "Approve" : "Decline"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
