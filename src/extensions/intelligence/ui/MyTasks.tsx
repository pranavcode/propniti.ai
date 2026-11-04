"use client";

import Link from "@/components/Link";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable } from "@/components/app/data-table/DataTable";
import type { BulkAction, DataColumn, EmptyCopy, Facet, Row } from "@/components/app/data-table/types";
import { RelativeDate } from "@/components/app/display";
import { TONE_DOT } from "@/components/app/status";
import { apiJson } from "@/components/app/forms/api";
import { openPeek } from "@/components/app/peek/usePeek";
import { isModifiedClick } from "@/components/app/peek/url";
import { TaskDialogs, TaskMenu, type Pending, type Staff } from "./TaskActions";
import { agentName } from "@/ai/ui/labels";

// My tasks (client half): the view tabs, the task table with one-click done / reopen, a row menu
// (snooze, reassign, draft notice), bulk done / snooze, and the New task sheet. Rows, counts and facets come from the server page; every change goes through
// the tasks actions or POST /app/tasks/create, then the page re-renders.

export type TaskView = "open" | "overdue" | "today" | "upcoming" | "done";
type Related = { entity: string; id: string; label: string; title: string | null; href: string | null };

const VIEWS: { value: TaskView; label: string; tone?: "danger" | "warning" | "info" | "success" }[] = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue", tone: "danger" },
  { value: "today", label: "Today", tone: "warning" },
  { value: "upcoming", label: "Upcoming", tone: "info" },
  { value: "done", label: "Done", tone: "success" },
];

const EMPTY: Record<TaskView, EmptyCopy> = {
  open: { title: "Nothing on your list", description: "Tasks assigned to you or your role show up here: follow-ups from people, automations and AI agents.", action: { label: "New task", href: "/app/tasks?new=1" } },
  overdue: { title: "Nothing overdue", description: "Tasks past their due date show up here first." },
  today: { title: "Nothing due today", description: "Tasks due on today's date show up here." },
  upcoming: { title: "Nothing upcoming", description: "Tasks due later, or with no due date, show up here." },
  done: { title: "No completed tasks yet", description: "Tasks you mark done move here, newest first. Reopen one to put it back on your list." },
};

const isDone = (r: Row) => r.status === "Done" || r.status === "Cancelled";

// A link to the full record that opens it in the peek drawer instead. Unlike PeekLink it isn't a
// list row, so J/K in the drawer keeps stepping through tasks.
function RecordLink({ entity, id, href, children, className }: { entity: string; id: string; href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} className={cn("truncate text-foreground underline-offset-2 hover:text-primary hover:underline", className)}
      onClick={(e) => { e.stopPropagation(); if (isModifiedClick(e)) return; e.preventDefault(); openPeek({ entity, id }); }}>
      {children}
    </a>
  );
}

function DoneToggle({ row, onDone }: { row: Row; onDone: (row: Row, next: "complete" | "reopen") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const done = isDone(row);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async (e) => { e.stopPropagation(); setBusy(true); await onDone(row, done ? "reopen" : "complete"); setBusy(false); }}
      aria-label={done ? `Reopen ${String(row.title)}` : `Mark ${String(row.title)} done`}
      className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50", done || busy ? "border-tone-success bg-tone-success text-white" : "border-input hover:border-tone-success hover:bg-tone-success/10")}
    >
      {(done || busy) && <Check className="size-2.5" strokeWidth={3.5} />}
    </button>
  );
}

function Source({ row, me }: { row: Row; me: string }) {
  if (row.source === "Agent") {
    const label = typeof row.agent === "string" ? agentName(row.agent) : "AI agent";
    const body = <><Sparkles className="size-3 shrink-0" />{label}</>;
    return row.run_id
      ? <Link href={`/app/ai/runs/${encodeURIComponent(String(row.run_id))}`} onClick={(e) => e.stopPropagation()} title="Open the run that created this task" className="inline-flex min-w-0 items-center gap-1 truncate text-tone-ai underline-offset-2 hover:underline">{body}</Link>
      : <span className="inline-flex min-w-0 items-center gap-1 truncate text-tone-ai">{body}</span>;
  }
  if (row.source === "Automation" || row.source === "Preventive") return <span className="inline-flex items-center gap-1 text-muted-foreground"><Workflow className="size-3" />{row.source === "Preventive" ? "Preventive schedule" : "Automation"}</span>;
  return <span className="truncate text-muted-foreground">{row.created_by === me ? "You" : (row.created_by__label as string | null) ?? "A person"}</span>;
}

function NewTaskSheet({ open, onOpenChange, properties, needsProperty }: { open: boolean; onOpenChange: (o: boolean) => void; properties: { id: string; name: string }[]; needsProperty: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState({ title: "", detail: "", due_on: "", priority: "Normal", property_id: properties.length === 1 ? properties[0].id : "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { key, title: values.title, priority: values.priority, ...(values.detail.trim() ? { detail: values.detail } : {}), ...(values.due_on ? { due_on: values.due_on } : {}), ...(values.property_id ? { property_id: values.property_id } : {}) };
    try {
      await apiJson("POST", "/app/tasks/create", body);
      toast.success("Task added");
      setKey(crypto.randomUUID());
      setValues((v) => ({ ...v, title: "", detail: "", due_on: "" }));
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the task. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = "h-9 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>New task</SheetTitle>
          <SheetDescription>Assigned to you. Fields marked * are required.</SheetDescription>
        </SheetHeader>
        <form id={`${uid}-form`} onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-title`} className="text-[12.5px] font-medium">Task<span className="text-tone-danger"> *</span></label>
            <Input id={`${uid}-title`} value={values.title} onChange={set("title")} required maxLength={200} placeholder="e.g. Call the roofer about the leak in 204" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-detail`} className="text-[12.5px] font-medium">Details</label>
            <Textarea id={`${uid}-detail`} value={values.detail} onChange={set("detail")} rows={3} maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-due`} className="text-[12.5px] font-medium">Due</label>
              <Input id={`${uid}-due`} type="date" value={values.due_on} onChange={set("due_on")} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-priority`} className="text-[12.5px] font-medium">Priority</label>
              <select id={`${uid}-priority`} value={values.priority} onChange={set("priority")} className={field}>
                {["High", "Normal", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-property`} className="text-[12.5px] font-medium">Property{needsProperty && <span className="text-tone-danger"> *</span>}</label>
            <select id={`${uid}-property`} value={values.property_id} onChange={set("property_id")} required={needsProperty} className={field}>
              <option value="">{needsProperty ? "Choose…" : "None (org-wide)"}</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {error && <p role="alert" className="rounded-md border border-tone-danger/25 bg-tone-danger/5 px-3 py-2 text-[12.5px] text-tone-danger">{error}</p>}
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} disabled={busy}>{busy ? "Adding…" : "Add task"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function MyTasks({ me, view, columns, rows, total, page, size, counts, facets, error, properties, needsProperty, bulkActions, staff, today }: {
  me: string;
  view: TaskView;
  columns: DataColumn[];
  rows: Row[];
  total: number;
  page: number;
  size: number;
  counts: Record<string, number>;
  facets: Facet[];
  error: string | null;
  properties: { id: string; name: string }[];
  needsProperty: boolean;
  bulkActions: BulkAction[];
  staff: Staff[];
  today: string;
}) {
  const router = useRouter();
  const { params, set } = useUrlState();
  const [openLocal, setOpenLocal] = useState(false);
  const sheetOpen = openLocal || params.get("new") === "1";
  const setSheet = (o: boolean) => { setOpenLocal(o); if (!o && params.get("new")) set({ new: null }); };

  const change = async (row: Row, next: "complete" | "reopen") => {
    try {
      const out = await apiJson<{ message?: string }>("POST", `/api/e/tasks/${encodeURIComponent(String(row.id))}/actions/${next}`, {});
      toast.success(out.message ?? (next === "complete" ? "Task done" : "Task reopened"), next === "complete" ? { action: { label: "Undo", onClick: () => void change({ ...row, status: "Done" }, "reopen") } } : undefined);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the task");
    }
    router.refresh();
  };

  const [pending, setPending] = useState<Pending>(null);
  const done = (msg: string) => { toast.success(msg); router.refresh(); };

  // Bulk actions from the tasks entity config. Snooze asks for a date first; the bulk bar's
  // progress toast stays up until the dialog closes.
  const onBulkAction = async (key: string, target: string[] | "matching") => {
    // My tasks is scoped to the signed-in person and the open view, which the generic ids lookup can't reproduce.
    if (target === "matching") throw new Error("Select tasks on this page; acting on every matching task isn't available on My tasks.");
    const ids = target;
    if (key === "tasks.snooze") {
      const snoozed = await new Promise<boolean>((resolve) => setPending({ kind: "snooze", ids, title: "", done: resolve }));
      if (!snoozed) throw new Error("Snooze cancelled");
      return;
    }
    const res = await fetch(`/api/e/tasks/actions/${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    const out = (await res.json().catch(() => ({}))) as { ok?: number; failed?: number; error?: string; results?: { status: number; error?: string }[] };
    router.refresh();
    const why = out.error ?? out.results?.find((r) => r.status !== 200)?.error ?? "not available";
    if (!out.ok) throw new Error(`Nothing changed: ${why}`);
    if (out.failed) toast.info(`${out.failed} skipped: ${why}`);
  };

  const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));
  const cols: DataColumn[] = [
    { key: "done", label: "Done", sortable: false, width: 44, render: (r: Row) => <DoneToggle row={r} onDone={change} /> },
    { ...byKey.title, primary: true },
    { key: "related", label: "Related to", sortable: false, width: 220, render: (r: Row) => {
      const rel = r._related as Related | null;
      if (!rel) return <span className="text-muted-foreground/60">—</span>;
      return (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[11.5px] text-muted-foreground">{rel.label}</span>
          {rel.href ? <RecordLink entity={rel.entity} id={rel.id} href={rel.href}>{rel.title}</RecordLink> : <span className="truncate text-muted-foreground">{rel.id}</span>}
        </span>
      );
    } },
    { ...byKey.due_on, render: (r: Row) => isDone(r)
      ? <span className="text-muted-foreground">{r.completed_at ? <>Done <RelativeDate value={r.completed_at as string} /></> : "Done"}</span>
      : <RelativeDate value={r.due_on as string | null} mode="due" /> },
    byKey.priority,
    { ...byKey.property_id, render: (r: Row) => r.property_id
      ? <RecordLink entity="properties" id={String(r.property_id)} href={`/app/properties/${encodeURIComponent(String(r.property_id))}`}>{String(r.property_id__label ?? r.property_id)}</RecordLink>
      : <span className="text-muted-foreground">Org-wide</span> },
    { ...byKey.source, render: (r: Row) => <Source row={r} me={me} /> },
    { ...byKey.status, defaultHidden: true },
    { ...byKey.assignee_id, defaultHidden: true, href: undefined },
    { ...byKey.created_at, defaultHidden: true },
    { ...byKey.completed_at, defaultHidden: true },
    { key: "actions", label: "Actions", sortable: false, width: 44, render: (r: Row) => isDone(r) ? null : <TaskMenu row={r} onPick={setPending} /> },
  ].filter((c): c is DataColumn => !!c?.key);

  const open = (counts.overdue ?? 0) + (counts.today ?? 0) + (counts.upcoming ?? 0);
  return (
    <>
      <div role="tablist" aria-label="Due" className="-mb-px flex items-end gap-0.5 overflow-x-auto border-b [scrollbar-width:none]">
        {VIEWS.map((v) => {
          const on = view === v.value;
          const n = v.value === "open" ? open : counts[v.value] ?? 0;
          return (
            <button key={v.value} role="tab" aria-selected={on} onClick={() => set({ due: v.value === "open" ? null : v.value, page: null, sort: null })}
              className={cn("relative flex h-9 shrink-0 items-center gap-1.5 px-2.5 text-[13px] transition-colors", on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v.tone && <span className={cn("size-1.5 rounded-full", TONE_DOT[v.tone])} />}
              {v.label}
              <span className={cn("rounded px-1 text-[11px] tabular-nums", on ? "bg-foreground/[0.07] text-foreground" : "text-muted-foreground", v.value === "overdue" && n > 0 && "text-tone-danger")}>{formatNumber(n)}</span>
              {on && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-foreground" />}
            </button>
          );
        })}
      </div>
      <DataTable
        entity="tasks"
        label={{ one: "task", many: "tasks" }}
        columns={cols}
        rows={rows}
        total={total}
        page={page}
        size={size}
        facets={facets}
        rowHref="/app/tasks/{id}"
        searchPlaceholder="Search your tasks…"
        empty={EMPTY[view]}
        error={error}
        toolbar={<Button size="sm" onClick={() => setSheet(true)}><Plus className="size-4" />New task</Button>}
        bulkActions={view === "done" ? [] : bulkActions}
        onBulkAction={onBulkAction}
      />
      <TaskDialogs pending={pending} onClose={() => setPending(null)} today={today} staff={staff} onDone={done} />
      <NewTaskSheet open={sheetOpen} onOpenChange={setSheet} properties={properties} needsProperty={needsProperty} />
    </>
  );
}
