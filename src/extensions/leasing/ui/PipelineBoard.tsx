"use client";

import Link from "next/link";
import { PeekLink } from "@/components/app/peek/PeekLink";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronDown, Clock3, GripVertical, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Money } from "@/components/app/display";
import { cn } from "@/lib/utils";
import { COLUMNS, COLUMN_KEYS, planMove, type Column } from "../pipeline";
import type { Card } from "../data";
import { callAction } from "./client";
import type { Role } from "@/entities/types";

const PER_COLUMN = 40;
const TONE: Record<Column, string> = { lead: "bg-tone-neutral", tour: "bg-tone-info", applied: "bg-tone-warning", screening: "bg-tone-warning", approved: "bg-tone-success", leased: "bg-tone-success" };

// The leasing pipeline. Drag a card one column (or use its menu: keyboard friendly); the move runs
// the prospects.move_stage action, updates the board at once and rolls back if the server refuses.
export function PipelineBoard({ cards: initial, role }: { cards: Card[]; role: Role }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [over, setOver] = useState<Column | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const byCol = useMemo(() => Object.fromEntries(COLUMN_KEYS.map((k) => [k, cards.filter((c) => c.column === k)])) as Record<Column, Card[]>, [cards]);

  const check = (c: Card, to: Column) => planMove(c.column, to, { role, hasApplication: !!c.appId, toured: c.stage === "Toured" || !!c.nextTour });

  const move = async (c: Card, to: Column) => {
    const plan = check(c, to);
    if (!plan.ok) return toast.error(plan.error);
    const before = cards;
    setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, column: to, stale: false, days: 0 } : x)));
    setBusy(c.id);
    try {
      await callAction("prospects", c.id, "move_stage", { to });
      toast.success(`${c.name} moved to ${COLUMNS.find((x) => x.key === to)!.label}`, { description: "Saved to the lead and its application, with your name in the activity." });
      router.refresh();
    } catch (e) {
      setCards(before);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-tour="pipeline-board" role="list" aria-label="Leasing pipeline">
      {COLUMNS.map((col) => {
        const list = byCol[col.key];
        const allowed = dragging ? check(dragging, col.key).ok : false;
        return (
          <section
            key={col.key}
            role="listitem"
            aria-label={`${col.label}: ${list.length}`}
            onDragOver={(e) => { if (dragging && allowed) { e.preventDefault(); setOver(col.key); } }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) void move(dragging, col.key); setDragging(null); }}
            className={cn("flex w-[268px] shrink-0 flex-col rounded-lg border bg-muted/40 transition-colors", dragging && (allowed ? "border-dashed border-primary/50" : "opacity-60"), over === col.key && "bg-primary/5")}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className={cn("size-2 rounded-full", TONE[col.key])} aria-hidden />
              <h2 className="text-[13px] font-semibold">{col.label}</h2>
              <span className="ml-auto rounded-full bg-background px-2 py-px text-[11.5px] text-muted-foreground tabular-nums ring-1 ring-border">{list.length}</span>
            </header>
            <ol className="flex max-h-[calc(100vh-260px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {list.slice(0, PER_COLUMN).map((c) => (
                <li
                  key={c.id}
                  draggable={busy !== c.id && c.column !== "leased"}
                  onDragStart={(e) => { setDragging(c); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  className={cn("group rounded-md border bg-card p-2.5 shadow-xs transition-shadow hover:shadow-sm", dragging && "select-none", busy === c.id && "opacity-60", c.column !== "leased" && "cursor-grab active:cursor-grabbing")}
                >
                  <div className="flex items-start gap-1.5">
                    <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <PeekLink entity={c.appId ? "applications" : "prospects"} id={c.appId ?? c.id} href={c.appId ? `/app/leasing/applications/${c.appId}` : `/app/leasing/prospects/${c.id}`} className="block truncate text-[13px] font-medium hover:text-primary hover:underline" draggable={false}>{c.name}</PeekLink>
                      <p className="truncate text-[11.5px] text-muted-foreground">{c.property}</p>
                    </div>
                    {c.column !== "leased" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="-m-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label={`Move ${c.name}`}><ChevronDown className="size-3.5" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Move to</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                          {COLUMNS.filter((x) => x.key !== c.column).map((x) => {
                            const p = check(c, x.key);
                            return (
                              <DropdownMenuItem key={x.key} disabled={!p.ok} onSelect={() => void move(c, x.key)} className="flex-col items-start gap-0">
                                {x.label}
                                {!p.ok && <span className="max-w-56 text-[11px] text-muted-foreground">{p.error}</span>}
                              </DropdownMenuItem>
                            );
                          })}
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[11.5px] text-muted-foreground">
                    {c.beds != null && <span>{c.beds === 0 ? "Studio" : `${c.beds} bed`}</span>}
                    {c.budget != null && <span>≤ <Money value={c.budget} style="whole" /></span>}
                    {c.source && <span>{c.source}</span>}
                    {c.score != null && <span className="inline-flex items-center gap-0.5 text-tone-ai"><Sparkles className="size-3" />Score {c.score}</span>}
                    {c.appStage && c.column !== "leased" && <span className="rounded bg-muted px-1">{c.appStage}</span>}
                  </div>
                  {(c.nextTour || c.stale) && (
                    <div className="mt-1.5 flex items-center gap-2 pl-5 text-[11.5px]">
                      {c.nextTour && <span className="inline-flex items-center gap-1 text-tone-info"><CalendarClock className="size-3" />{c.nextTour}</span>}
                      {c.stale && <span className="inline-flex items-center gap-1 text-tone-warning"><Clock3 className="size-3" />No contact in {c.days}d</span>}
                    </div>
                  )}
                </li>
              ))}
              {list.length === 0 && <li className="rounded-md border border-dashed px-3 py-6 text-center text-[12px] text-muted-foreground">{dragging && allowed ? "Drop here" : "No one here"}</li>}
            </ol>
            {list.length > PER_COLUMN && (
              <Button asChild variant="ghost" size="sm" className="m-2 mt-0"><Link href={`/app/leasing/prospects?view=open`}>{list.length - PER_COLUMN} more in the list</Link></Button>
            )}
          </section>
        );
      })}
    </div>
  );
}
