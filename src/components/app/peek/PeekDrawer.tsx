"use client";

import Link from "@/components/Link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatRelative } from "@/lib/format";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ActionBar } from "@/components/entity/RecordActions";
import type { PeekData } from "@/components/entity/peek";
import { DataHealthBadge } from "../ai/DataHealthBadge";
import { Cell } from "../data-table/cells";
import type { Row } from "../data-table/types";
import { Kbd, StatusBadge, Thumb } from "../display";
import { ActivityTimeline, type ActivityEvent } from "../record/ActivityTimeline";
import { ErrorBanner } from "../states";
import { peekRowElement, usePeek } from "./usePeek";
import type { PeekTarget } from "./url";

// The record peek drawer, mounted once in the app layout. Reads ?peek=… and shows a compact
// record: header, facts, AI summary, related counts, actions and the last five activity events,
// from the same record API and role checks as the full page.

type Loaded = { row: Row; peek: PeekData; activity: ActivityEvent[] | null };
// No state for the current key means it is loading; after a write the old data stays up until
// the reload lands.
type State = { key: string; status: "error"; message: string } | { key: string; status: "ready"; data: Loaded };

const MIN_W = 480, MAX_W = 960, DEFAULT_W = 560;
const keyOf = (t: PeekTarget) => `${t.entity}:${t.id}`;

async function load(t: PeekTarget, signal: AbortSignal): Promise<Loaded> {
  const base = `/api/e/${encodeURIComponent(t.entity)}/${encodeURIComponent(t.id)}`;
  const [rec, act] = await Promise.all([
    fetch(`${base}?peek=1`, { signal }),
    fetch(`${base}/activity?size=5`, { signal }).catch(() => null),
  ]);
  const body = await rec.json().catch(() => ({}));
  if (!rec.ok || !body.peek) throw new Error(body.error ?? "This record couldn't load.");
  const events = act?.ok ? ((await act.json().catch(() => null))?.rows as ActivityEvent[] | undefined) : undefined;
  return { row: body.row, peek: body.peek, activity: events ? events.slice(0, 5) : null };
}

export function PeekDrawer() {
  const { target, close, step } = usePeek();
  const mobile = useIsMobile();
  const [width, setWidth] = useLocalStorage<number>("pn_peek_w", DEFAULT_W);
  const [state, setState] = useState<State | null>(null);
  const [reload, setReload] = useState(0);
  const last = useRef<PeekTarget | null>(null);
  const key = target ? keyOf(target) : null;
  useEffect(() => { if (target) last.current = target; });

  useEffect(() => {
    if (!target) return;
    const ac = new AbortController();
    const k = keyOf(target);
    load(target, ac.signal).then(
      (data) => setState({ key: k, status: "ready", data }),
      (e) => { if (!ac.signal.aborted) setState({ key: k, status: "error", message: e instanceof Error ? e.message : "This record couldn't load." }); },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch per record and after writes
  }, [key, reload]);

  // J/K and arrows walk the rows of the list behind the drawer. Not while a confirm or edit
  // dialog is open on top of it.
  const move = (dir: 1 | -1) => (document.querySelectorAll("[role=dialog]").length > 1 ? false : step(dir));
  useHotkeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1) }, !!target);

  const onChanged = useCallback((deleted: boolean) => { if (deleted) close(); else setReload((n) => n + 1); }, [close]);

  // Drag the left edge to resize (desktop).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => setWidth(Math.round(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX))));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const current = state && state.key === key ? state : null;
  const data = current?.status === "ready" ? current.data : null;

  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        data-peek-drawer=""
        aria-describedby={undefined}
        style={mobile ? undefined : { width: `min(${width}px, 100vw)` }}
        className={cn("gap-0 p-0", mobile ? "data-[side=bottom]:h-[85dvh] rounded-t-xl" : "max-w-none data-[side=right]:sm:max-w-none")}
        onCloseAutoFocus={(e) => {
          // Back to the row the drawer was showing last (it may have moved with J/K).
          const el = last.current && peekRowElement(last.current);
          if (el instanceof HTMLElement) { e.preventDefault(); el.focus(); }
        }}
      >
        {!mobile && (
          <div role="separator" aria-orientation="vertical" aria-label="Resize panel" onPointerDown={startResize} onDoubleClick={() => setWidth(DEFAULT_W)}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-transparent after:transition-colors hover:after:bg-primary/50" />
        )}
        {mobile && <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/25" />}

        {!data && current?.status !== "error" && <PeekSkeleton />}
        {current?.status === "error" && (
          <>
            <SheetHeader className="pr-12"><SheetTitle>Record unavailable</SheetTitle></SheetHeader>
            <div className="px-4"><ErrorBanner title="Couldn't open this record" message={current.message} onRetry={() => setReload((n) => n + 1)} /></div>
          </>
        )}
        {data && <PeekBody data={data} onChanged={onChanged} onAsk={close} />}
      </SheetContent>
    </Sheet>
  );
}

function PeekBody({ data, onChanged, onAsk }: { data: Loaded; onChanged: (deleted: boolean) => void; onAsk: () => void }) {
  const { row, peek: p, activity } = data;
  const id = String(row.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto max-md:overscroll-contain">
      <SheetHeader className="shrink-0 gap-3 border-b pr-12">
        <div className="flex min-w-0 items-start gap-3">
          {p.image && <Thumb src={p.image} size={48} className="rounded-md" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] text-muted-foreground">{p.label.one} · {id}</p>
            <SheetTitle className="mt-0.5 flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-tight text-balance">
              <span className="min-w-0 break-words">{p.title}</span>
              {p.status && <StatusBadge value={row[p.status.key]} enumDef={p.status.enum} />}
              {p.health && <DataHealthBadge issues={p.health} />}
            </SheetTitle>
            {p.subtitle ? <SheetDescription className="mt-0.5 truncate text-[13px]">{p.subtitle}</SheetDescription> : <SheetDescription className="sr-only">{p.label.one} details</SheetDescription>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm"><Link href={p.href}>Open full page<ArrowUpRight data-icon="inline-end" /></Link></Button>
          <ActionBar key={id} entity={p.entity} id={id} title={p.title} label={p.label} routeBase={p.route} actions={p.actions}
            edit={p.edit?.length ? { fields: p.edit, initial: row } : undefined} canDelete={p.canDelete} onChanged={onChanged} onAsk={onAsk} />
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
        {p.facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
            {p.facts.map((f) => (
              <div key={f.key} className="min-w-0 bg-card px-3 py-2 odd:last:col-span-2">
                <dt className="truncate text-[11px] text-muted-foreground">{f.label}</dt>
                <dd className="mt-0.5 truncate text-[13.5px] font-medium"><Cell col={f} row={row} /></dd>
              </div>
            ))}
          </dl>
        )}

        {p.summary !== false && (
          <section className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04] p-3">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Sparkles className="size-3.5 text-tone-ai" />AI summary</h3>
            {p.summary
              ? <>
                  <p className="mt-1.5 text-[13px] leading-relaxed">{p.summary.summary}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">{p.summary.source === "rules" ? "Rules · from this record's current figures" : `${p.summary.source === "live" ? "Generated" : "Precomputed"} · ${p.summary.model} · ${formatRelative(p.summary.generated_at)}`}</p>
                </>
              : <p className="mt-1.5 text-[12.5px] text-muted-foreground">No summary yet for this {p.label.one.toLowerCase()}. Ask the assistant about it instead.</p>}
          </section>
        )}

        {p.health && p.health.length > 0 && (
          <section className="rounded-lg border border-tone-warning/30 bg-tone-warning/[0.05] p-3">
            <h3 className="text-[12.5px] font-semibold">Data health</h3>
            <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px]">{p.health.map((i) => <li key={i.id}><Link href={`/app/data-health?f.entity_id=${encodeURIComponent(id)}`} className="hover:underline">{i.summary}</Link></li>)}</ul>
          </section>
        )}

        {p.related.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[12.5px] font-semibold">Related</h3>
            <ul className="divide-y rounded-lg border">
              {p.related.map((r) => (
                <li key={r.name}>
                  <Link href={r.href} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px] hover:bg-muted/50">
                    <span className="text-muted-foreground">{r.label}</span>
                    {r.kind === "many"
                      ? <span className="font-medium tabular-nums">{formatNumber(r.total)}</span>
                      : <span className="min-w-0 truncate font-medium">{r.title ?? "None"}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {activity && (
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[12.5px] font-semibold">Recent activity</h3>
              {activity.length > 0 && <Link href={`${p.href}?tab=activity`} className="text-[12px] text-primary hover:underline">All activity</Link>}
            </div>
            {activity.length ? <ActivityTimeline events={activity} /> : <p className="text-[12.5px] text-muted-foreground">No activity yet.</p>}
          </section>
        )}
      </div>

      <Separator />
      <div className="hidden items-center gap-3 px-4 py-2 text-[11.5px] text-muted-foreground md:flex">
        <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> next / previous</span>
        <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
        <span className="ml-auto flex items-center gap-1">
          <StepButton dir={-1} />
          <StepButton dir={1} />
        </span>
      </div>
    </div>
  );
}

function StepButton({ dir }: { dir: 1 | -1 }) {
  const { step } = usePeek();
  const label = dir === 1 ? "Next record" : "Previous record";
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={label} onClick={() => step(dir)}>{dir === 1 ? <ChevronDown /> : <ChevronUp />}</Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function PeekSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-4" aria-busy aria-label="Loading record">
      <SheetTitle className="sr-only">Loading record</SheetTitle>
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 rounded-md" />
        <div className="flex flex-1 flex-col gap-2 pt-1"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      </div>
      <div className="flex gap-2"><Skeleton className="h-8 w-32" /><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-20" /></div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border">{Array.from({ length: 6 }, (_, i) => <div key={i} className="flex flex-col gap-1.5 px-3 py-2"><Skeleton className="h-2.5 w-16" /><Skeleton className="h-3.5 w-24" /></div>)}</div>
      <Skeleton className="h-24 w-full" />
      <div className="flex flex-col gap-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
    </div>
  );
}
