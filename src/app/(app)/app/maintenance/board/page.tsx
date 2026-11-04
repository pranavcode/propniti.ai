import Link from "next/link";
import { PeekLink } from "@/components/app/peek/PeekLink";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardPlus, KanbanSquare, TriangleAlert } from "lucide-react";
import { can } from "@/entities";
import type { Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AS_OF } from "@/seed/constants";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { boardData, calendarData, intakeOptions } from "@/extensions/maintenance/queries";
import { FIELD } from "@/extensions/maintenance/ui/client";

export const metadata = { title: "Work-order board · Propniti" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const PRIORITY_DOT: Record<string, string> = { Emergency: "bg-tone-danger", Urgent: "bg-tone-warning", Normal: "bg-tone-info", Low: "bg-muted-foreground/40" };
const COLUMN_HINT: Record<string, string> = { New: "Waiting for triage", Triaged: "Ready to dispatch", Assigned: "Vendor or tech assigned", Scheduled: "Visit booked", "In progress": "On site", "On hold": "Parts, access or owner approval", Submitted: "Invoice to approve" };
const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

function qs(sp: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) out.set(k, v);
  const s = out.toString();
  return s ? `?${s}` : "";
}

function Card({ w }: { w: Row }) {
  return (
    <PeekLink entity="work_orders" id={String(w.id)} href={`/app/maintenance/${["New", "Triaged"].includes(String(w.status)) ? "intake" : "work-orders"}/${encodeURIComponent(String(w.id))}`}
      className="block rounded-md border bg-card p-2.5 shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", PRIORITY_DOT[String(w.priority)])} title={`${w.priority} priority`} />
        <span className="min-w-0 flex-1 text-[13px] leading-snug font-medium">{String(w.title)}</span>
        {w.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- 400px static thumb
          <img src={String(w.photo).replace(/\.webp$/, "-400.webp")} alt="" className="size-8 shrink-0 rounded object-cover" loading="lazy" />
        ) : null}
      </div>
      <p className="mt-1 truncate pl-4 text-[11.5px] text-muted-foreground">{String(w.property)}{w.unit ? ` · ${w.unit}` : ""}</p>
      <div className="mt-1.5 flex items-center gap-2 pl-4 text-[11.5px]">
        <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{String(w.id)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{String(w.vendor ?? w.technician ?? "Unassigned")}</span>
        {w.past_sla ? <span className="inline-flex shrink-0 items-center gap-0.5 font-medium whitespace-nowrap text-tone-danger"><TriangleAlert className="size-3" />Past SLA</span>
          : w.sla_due_at ? <span className="shrink-0 whitespace-nowrap text-muted-foreground">Due {formatRelative(String(w.sla_due_at))}</span> : null}
      </div>
    </PeekLink>
  );
}

export default async function BoardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { actor, ws } = await currentSession();
  if (!can(actor.role, "read", "work_orders")) return <main className="p-6"><EmptyState title="Work orders aren't part of your role" action={{ label: "Go to your home", href: "/app" }} /></main>;
  const db = getPlatform().db;
  const calendar = sp.view === "calendar";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : AS_OF.slice(0, 7);
  const f = { property: sp.property || undefined, priority: sp.priority || undefined, q: sp.q?.slice(0, 80) || undefined };
  const [props, columns, days] = await Promise.all([
    intakeOptions(db, ws, actor),
    calendar ? Promise.resolve(null) : boardData(db, ws, actor, f),
    calendar ? calendarData(db, ws, actor, month) : Promise.resolve(null),
  ]);
  const total = columns?.reduce((a, c) => a + c.total, 0) ?? days?.length ?? 0;

  const toggle = (
    <div className="inline-flex rounded-md border bg-card p-0.5" role="tablist" aria-label="View">
      <Link role="tab" aria-selected={!calendar} href={`/app/maintenance/board${qs(sp, { view: undefined, month: undefined })}`} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px]", !calendar ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}><KanbanSquare className="size-3.5" />Board</Link>
      <Link role="tab" aria-selected={calendar} href={`/app/maintenance/board${qs(sp, { view: "calendar" })}`} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px]", calendar ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}><CalendarDays className="size-3.5" />Calendar</Link>
    </div>
  );

  return (
    <main>
      <PageHeader title="Work orders" meta={<><span>{actor.scope.label}</span><span>·</span><span className="tabular-nums">{total} open</span></>}
        actions={<>{toggle}{can(actor.role, "create", "work_orders") && <Button asChild size="sm"><Link href="/app/maintenance/intake"><ClipboardPlus />New request</Link></Button>}</>}>
        {!calendar && (
          <form className="flex flex-wrap items-center gap-2" action="/app/maintenance/board">
            <input autoComplete="off" name="q" defaultValue={sp.q ?? ""} placeholder="Search title or WO number…" aria-label="Search work orders" className={cn(FIELD, "w-60")} />
            <select name="property" defaultValue={sp.property ?? ""} aria-label="Property" className={cn(FIELD, "w-56")}>
              <option value="">All properties</option>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select name="priority" defaultValue={sp.priority ?? ""} aria-label="Priority" className={cn(FIELD, "w-36")}>
              <option value="">Any priority</option>{["Emergency", "Urgent", "Normal", "Low"].map((p) => <option key={p}>{p}</option>)}
            </select>
            <Button type="submit" size="sm" variant="outline">Apply</Button>
            {(sp.q || sp.property || sp.priority) && <Button asChild size="sm" variant="ghost"><Link href="/app/maintenance/board">Clear</Link></Button>}
          </form>
        )}
      </PageHeader>
      <PageBody>
        {columns ? (
          <div data-tour="mx-board" className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
            {columns.map((c) => (
              <section key={c.status} className="flex w-[272px] shrink-0 snap-start flex-col rounded-lg bg-muted/50" aria-label={`${c.status}, ${c.total} work orders`}>
                <header className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
                  <StatusBadge value={c.status} enumDef={[{ value: c.status, tone: c.status === "New" || c.status === "On hold" || c.status === "Submitted" ? "warning" : "info" }]} />
                  <span className="text-[12px] text-muted-foreground tabular-nums">{c.total}</span>
                </header>
                <p className="px-2.5 pb-2 text-[11.5px] text-muted-foreground">{COLUMN_HINT[c.status]}</p>
                <div className="flex max-h-[calc(100vh-260px)] flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {c.items.length ? c.items.map((w) => <Card key={String(w.id)} w={w} />) : <p className="rounded-md border border-dashed px-2 py-6 text-center text-[12px] text-muted-foreground">Nothing here</p>}
                  {c.total > c.items.length && <Link href={`/app/maintenance/work-orders?f.status=${encodeURIComponent(c.status)}${f.property ? `&f.property_id=${f.property}` : ""}${f.priority ? `&f.priority=${f.priority}` : ""}`} className="rounded-md px-2 py-1.5 text-center text-[12px] text-primary hover:bg-card">See all {c.total} in the list</Link>}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <Calendar month={month} rows={days ?? []} sp={sp} />
        )}
      </PageBody>
    </main>
  );
}

function Calendar({ month, rows, sp }: { month: string; rows: Row[]; sp: Record<string, string | undefined> }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => i - lead + 1);
  const byDay = new Map<number, Row[]>();
  for (const r of rows) { const d = Number(String(r.day).slice(8, 10)); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
  const label = first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div data-tour="mx-board" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button asChild size="icon-sm" variant="outline"><Link href={`/app/maintenance/board${qs(sp, { view: "calendar", month: addMonth(month, -1) })}`} aria-label="Previous month"><ChevronLeft /></Link></Button>
        <h2 className="w-40 text-center text-[14px] font-semibold">{label}</h2>
        <Button asChild size="icon-sm" variant="outline"><Link href={`/app/maintenance/board${qs(sp, { view: "calendar", month: addMonth(month, 1) })}`} aria-label="Next month"><ChevronRight /></Link></Button>
        <span className="ml-2 text-[12px] text-muted-foreground">Open work orders on their scheduled date, or their SLA due date when not yet scheduled.</span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-lg border bg-border [gap:1px]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="bg-muted/60 px-2 py-1 text-[11.5px] font-medium text-muted-foreground">{d}</div>)}
          {cells.map((d, i) => {
            const items = d >= 1 && d <= daysIn ? byDay.get(d) ?? [] : [];
            const date = `${month}-${String(d).padStart(2, "0")}`;
            const today = date === AS_OF;
            return (
              <div key={i} className={cn("min-h-28 bg-card p-1.5", (d < 1 || d > daysIn) && "bg-muted/30")}>
                {d >= 1 && d <= daysIn && (
                  <>
                    <div className={cn("mb-1 flex size-5 items-center justify-center rounded-full text-[11.5px] tabular-nums", today ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground")}>{d}</div>
                    <ul className=".5">
                      {items.slice(0, 3).map((w) => (
                        <li key={String(w.id)}>
                          <PeekLink entity="work_orders" id={String(w.id)} href={`/app/maintenance/work-orders/${encodeURIComponent(String(w.id))}`} title={`${w.id} · ${w.title} · ${w.property}`}
                            className={cn("flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11.5px] hover:bg-muted", !!w.past_sla && "text-tone-danger")}>
                            <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[String(w.priority)])} />
                            <span className="truncate">{w.scheduled ? "" : "Due: "}{String(w.title)}</span>
                          </PeekLink>
                        </li>
                      ))}
                    </ul>
                    {items.length > 3 && <Link href={`/app/maintenance/work-orders?f.sla_due_at.min=${date}&f.sla_due_at.max=${date}T23:59:59Z`} className="mt-0.5 block px-1 text-[11px] text-primary hover:underline">+{items.length - 3} more</Link>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
