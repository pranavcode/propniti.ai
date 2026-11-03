"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Clock, DoorOpen, Loader2, MapPin, Pause, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/display";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD, useAction } from "./client";
import { AddPhoto } from "./controls";

export type TechJob = {
  id: string; title: string; description: string; status: string; priority: string; category: string; sla_due_at: string | null; permission_to_enter: boolean;
  property: string; street: string | null; unit: string | null; past_sla: boolean; minutes: number; photos: { url: string; result: string | null; confidence: number | null }[];
};

const TONE = { Emergency: "danger", Urgent: "warning", Normal: "neutral", Low: "neutral" } as const;
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

// One job on the technician's phone: big touch targets, status in one tap, time and photos inline.
export function TechJobCard({ job, photos }: { job: TechJob; photos: { url: string; label: string }[] }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(job.status === "In progress");
  const [note, setNote] = useState("");
  const status = (s: string) => run("work_orders", job.id, "work_orders.set_status", { status: s, ...(note.trim() ? { note: note.trim() } : {}) }).then((o) => o && setNote(""));
  const time = (minutes: number) => run("work_orders", job.id, "work_orders.log_time", { minutes });
  const flagged = job.photos.filter((p) => p.result && p.result !== "Matches").length;
  return (
    <article className={cn("rounded-xl border bg-card", job.status === "In progress" && "border-primary/40 ring-1 ring-primary/20")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 p-3.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge value={job.status} />
            <StatusBadge value={job.priority} tone={TONE[job.priority as keyof typeof TONE] ?? "neutral"} />
            {job.past_sla && <span className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-tone-danger"><TriangleAlert className="size-3" />Past SLA</span>}
          </div>
          <h3 className="mt-1.5 text-[15px] leading-snug font-semibold">{job.title}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground"><MapPin className="size-3.5 shrink-0" />{job.property}{job.unit ? ` · ${job.unit}` : " · common area"}</p>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3.5 pt-3 pb-3.5">
          {job.description && <p className="text-[13px] leading-relaxed">{job.description}</p>}
          <dl className="grid grid-cols-2 gap-2 text-[12px]">
            <div><dt className="text-muted-foreground">Due</dt><dd className={cn("font-medium", job.past_sla && "text-tone-danger")}>{job.sla_due_at ? formatRelative(job.sla_due_at) : "No SLA"}</dd></div>
            <div><dt className="text-muted-foreground">Entry</dt><dd className="flex items-center gap-1 font-medium"><DoorOpen className="size-3.5" />{job.permission_to_enter ? "OK to enter" : "Call first"}</dd></div>
            <div><dt className="text-muted-foreground">Time logged</dt><dd className="font-medium tabular-nums">{job.minutes ? hm(job.minutes) : "None yet"}</dd></div>
            <div><dt className="text-muted-foreground">Photos</dt><dd className="font-medium">{job.photos.length}{flagged ? <span className="text-tone-warning"> · {flagged} flagged</span> : ""}</dd></div>
          </dl>
          {job.photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {job.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element -- 400px static thumb
                <img key={p.url} src={p.url.replace(/(?<!-400)\.webp$/, "-400.webp")} alt="" className={cn("size-16 shrink-0 rounded-md object-cover ring-1", p.result && p.result !== "Matches" ? "ring-tone-warning" : "ring-border")} />
              ))}
            </div>
          )}
          <label className="grid gap-1 text-[12px] text-muted-foreground">Note with the update (optional)
            <input className={cn(FIELD, "h-10 text-[14px]")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Replaced the wax ring, tested 3 flushes" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {job.status !== "In progress"
              ? <Button className="h-11" disabled={!!busy} onClick={() => status("In progress")}>{busy === "work_orders.set_status" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Start job</Button>
              : <Button className="h-11" variant="outline" disabled={!!busy} onClick={() => status("On hold")}><Pause className="size-4" />Pause</Button>}
            <Button className="h-11" variant={job.status === "In progress" ? "default" : "outline"} disabled={!!busy} onClick={() => status("Completed")}><CheckCircle2 className="size-4" />Mark done</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Clock className="size-3.5" />Log time</span>
            {[15, 30, 60, 120].map((m) => <Button key={m} size="sm" variant="outline" className="h-9 min-w-14" disabled={!!busy} onClick={() => time(m)}>{hm(m)}</Button>)}
            <span className="flex-1" />
            <AddPhoto woId={job.id} photos={photos} />
          </div>
          <Link href={`/app/maintenance/work-orders/${encodeURIComponent(job.id)}`} className="block text-[12px] text-primary hover:underline">Full work order {job.id}</Link>
        </div>
      )}
    </article>
  );
}
