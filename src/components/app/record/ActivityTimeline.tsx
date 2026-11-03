"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowRight, Bot, ChevronRight, CircleDollarSign, FilePlus2, MessageSquare, Pencil, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMonth, toDate } from "@/lib/format";
import { useMounted } from "@/hooks/use-mounted";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar, RelativeDate } from "../display";
import { humanize } from "../status";

// Record activity (activity_events + audit). Grouped by day bucket; field changes show as
// "Status: Open → Paid"; runs of agent/system events fold into "N automation events" (Attio).

export type ActivityEvent = {
  id: string;
  at: string;
  actor_kind: "staff" | "resident" | "vendor" | "owner" | "agent" | "system" | string;
  actor_id: string;
  actor_name?: string;
  verb: string;
  summary: string;
  data?: string | Record<string, unknown> | null;
};

type Change = { field: string; from: unknown; to: unknown };

function parse(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "object") return v as Record<string, unknown>;
  try { const o = JSON.parse(String(v)); return o && typeof o === "object" ? o : null; } catch { return null; }
}

export function changesOf(e: ActivityEvent): Change[] {
  const d = parse(e.data);
  if (!d) return [];
  if (Array.isArray(d.changes)) return d.changes as Change[];
  const before = parse(d.before), after = parse(d.after);
  if (!after) return [];
  return Object.keys(after).filter((k) => !["updated_at", "workspace_id", "seq", "deleted"].includes(k) && JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null)).slice(0, 4).map((k) => ({ field: k, from: before?.[k] ?? null, to: after[k] ?? null }));
}

const fmt = (v: unknown) => (v == null || v === "" ? "empty" : typeof v === "number" ? v.toLocaleString("en-US") : String(v));
const isAuto = (e: ActivityEvent) => e.actor_kind === "agent" || e.actor_kind === "system";

function bucket(at: string, now: Date) {
  const d = toDate(at);
  if (!d) return "Earlier";
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This week";
  return formatMonth(d);
}

function VerbIcon({ e }: { e: ActivityEvent }) {
  if (isAuto(e)) return <span className="flex size-6 items-center justify-center rounded-full bg-tone-ai/10 text-tone-ai ring-4 ring-background">{e.actor_kind === "agent" ? <Sparkles className="size-3" /> : <Bot className="size-3" />}</span>;
  const Icon = /paid|payment|charge|fee/i.test(e.verb) ? CircleDollarSign : /comment|note/i.test(e.verb) ? MessageSquare : /creat/i.test(e.verb) ? FilePlus2 : /updat|status|chang/i.test(e.verb) ? Pencil : UserRound;
  return <span className="flex size-6 items-center justify-center rounded-full border bg-card text-muted-foreground ring-4 ring-background"><Icon className="size-3" /></span>;
}

function Item({ e, people }: { e: ActivityEvent; people?: Record<string, string> }) {
  const who = e.actor_name ?? people?.[e.actor_id] ?? (isAuto(e) ? `${humanize(e.actor_id)} agent` : e.actor_id);
  const changes = changesOf(e);
  const d = parse(e.data);
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <VerbIcon e={e} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-1.5 leading-snug">
          {!isAuto(e) && <PersonAvatar name={who} size={16} className="self-center" />}
          <span className="font-medium">{who}</span>
          <span className="text-muted-foreground">{e.summary}</span>
          <span className="ml-auto pl-2 text-[11.5px] text-muted-foreground"><RelativeDate value={e.at} /></span>
        </div>
        {changes.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {changes.map((c) => (
              <li key={c.field} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="text-muted-foreground">{humanize(c.field)}</span>
                <span className="rounded bg-muted px-1.5 py-px text-muted-foreground line-through decoration-muted-foreground/40">{fmt(c.from)}</span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <span className="rounded bg-primary/[0.07] px-1.5 py-px font-medium">{fmt(c.to)}</span>
              </li>
            ))}
          </ul>
        )}
        {isAuto(e) && typeof d?.model === "string" && <div className="mt-1 text-[11px] text-muted-foreground">Model {d.model}</div>}
      </div>
    </li>
  );
}

export function ActivityTimeline({ events, people, loading, className }: { events: ActivityEvent[]; people?: Record<string, string>; loading?: boolean; className?: string }) {
  const mounted = useMounted();
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const now = new Date();
    const sorted = [...events].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const out: { label: string; runs: ActivityEvent[][] }[] = [];
    for (const e of sorted) {
      const label = mounted ? bucket(e.at, now) : formatMonth(e.at);
      let g = out[out.length - 1];
      if (!g || g.label !== label) out.push((g = { label, runs: [] }));
      const last = g.runs[g.runs.length - 1];
      if (last && isAuto(e) && isAuto(last[0]!)) last.push(e); else g.runs.push([e]);
    }
    return out;
  }, [events, mounted]);

  if (loading) {
    return (
      <div className={cn("space-y-4", className)} aria-busy>
        {[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-3"><Skeleton className="size-6 rounded-full" /><div className="flex-1 space-y-1.5 pt-1"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase" suppressHydrationWarning>{g.label}</h3>
          <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-3 before:w-px before:bg-border">
            {g.runs.map((run) => {
              if (run.length < 3) return <Fragment key={run[0]!.id}>{run.map((e) => <Item key={e.id} e={e} people={people} />)}</Fragment>;
              const key = run[0]!.id;
              const open = openRuns.has(key);
              return (
                <Fragment key={key}>
                  <li className="relative flex gap-3 pb-4">
                    <span className="flex size-6 items-center justify-center rounded-full bg-tone-ai/10 text-tone-ai ring-4 ring-background"><Sparkles className="size-3" /></span>
                    <button
                      onClick={() => setOpenRuns((s) => { const n = new Set(s); if (open) n.delete(key); else n.add(key); return n; })}
                      aria-expanded={open}
                      className="flex items-center gap-1 pt-0.5 text-[12.5px] text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                      {run.length} automation events
                      <span className="text-muted-foreground/70">· {[...new Set(run.map((e) => e.actor_name ?? humanize(e.actor_id)))].slice(0, 2).join(", ")}</span>
                    </button>
                  </li>
                  {open && run.map((e) => <Item key={e.id} e={e} people={people} />)}
                </Fragment>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
