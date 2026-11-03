"use client";
import { demoNowIso } from "@/lib/clock";

import { useState } from "react";
import { Check, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar, RelativeDate, StatusBadge } from "../display";
import { EmptyState, ErrorBanner } from "../states";
import { apiJson } from "../forms/api";
import { collabUrl, useCollab } from "./useCollab";

// Tasks on a record: quick add (POST …/tasks) and one-click complete (PATCH /api/e/tasks/{id}),
// both optimistic.

export type TaskRow = { id: string; title: string; detail?: string; due_on?: string | null; priority?: string; status: string; assignee_id?: string | null; assignee_name?: string; source?: string; created_at: string; pending?: boolean };

const done = (t: TaskRow) => t.status === "Done" || t.status === "Cancelled";

export function TasksPanel({ entity, id, people, initial }: { entity: string; id: string; people?: { id: string; name: string }[]; initial?: TaskRow[] }) {
  const { rows, setRows, loading, error, reload } = useCollab<TaskRow>(entity, id, "tasks", initial);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.name]));
  const open = rows.filter((t) => !done(t)).sort((a, b) => String(a.due_on ?? "9999").localeCompare(String(b.due_on ?? "9999")));
  const closed = rows.filter(done);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    const temp: TaskRow = { id: `tmp-${Date.now()}`, title: t, due_on: due || null, status: "Open", priority: "Normal", created_at: demoNowIso(), pending: true };
    setRows((r) => [temp, ...r]);
    setTitle(""); setDue("");
    try {
      const { row } = await apiJson<{ row: TaskRow }>("POST", collabUrl(entity, id, "tasks"), due ? { title: t, due_on: due } : { title: t });
      setRows((r) => r.map((x) => (x.id === temp.id ? row : x)));
      toast.success("Task added");
    } catch (e) {
      setRows((r) => r.filter((x) => x.id !== temp.id));
      setTitle(t);
      toast.error(e instanceof Error ? e.message : "Couldn't add the task");
    }
  };

  const toggle = async (task: TaskRow) => {
    const next = done(task) ? "Open" : "Done";
    setRows((r) => r.map((x) => (x.id === task.id ? { ...x, status: next } : x)));
    try {
      await apiJson("PATCH", `/api/e/tasks/${encodeURIComponent(task.id)}`, { status: next });
      if (next === "Done") toast.success("Task completed", { action: { label: "Undo", onClick: () => void toggle({ ...task, status: "Done" }) } });
    } catch (e) {
      setRows((r) => r.map((x) => (x.id === task.id ? task : x)));
      toast.error(e instanceof Error ? e.message : "Couldn't update the task");
    }
  };

  const item = (t: TaskRow) => (
    <li key={t.id} className={cn("group/task flex items-start gap-2.5 px-3 py-2 transition-opacity", t.pending && "opacity-60")}>
      <button
        onClick={() => void toggle(t)}
        disabled={t.pending}
        aria-label={done(t) ? `Reopen ${t.title}` : `Complete ${t.title}`}
        className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors", done(t) ? "border-tone-success bg-tone-success text-white" : "border-input hover:border-tone-success hover:bg-tone-success/10")}
      >
        {done(t) && <Check className="size-2.5" strokeWidth={3.5} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("leading-snug", done(t) && "text-muted-foreground line-through decoration-muted-foreground/40")}>{t.title}</div>
        {t.detail && !done(t) && <div className="line-clamp-1 text-[12px] text-muted-foreground">{t.detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[12px]">
        {t.source === "Agent" && <Sparkles className="size-3 text-tone-ai" aria-label="Created by an agent" />}
        {t.priority === "High" && !done(t) && <StatusBadge value="High" tone="danger" dot={false} />}
        {t.due_on && !done(t) && <RelativeDate value={t.due_on} mode="due" />}
        {t.assignee_id && <PersonAvatar name={t.assignee_name ?? names[t.assignee_id] ?? t.assignee_id} size={20} />}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex items-center gap-1.5 rounded-lg border bg-card p-1 pl-2.5 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task, e.g. Call resident about the move-out inspection…" aria-label="New task" className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/80" />
        <input autoComplete="off" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="h-7 rounded-md border bg-background px-1.5 text-[12px] text-muted-foreground tabular-nums outline-none focus:border-ring" />
        <Button size="sm" type="submit" disabled={!title.trim()}>Add</Button>
      </form>
      {error && <ErrorBanner title="Couldn't load tasks" message={error} onRetry={reload} />}
      {loading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : !rows.length && !error ? (
        <EmptyState compact kind="tasks" title="No tasks on this record" description="Add follow-ups here; agents add theirs too, marked with ✦." />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y">{open.map(item)}</ul>
          {closed.length > 0 && (
            <details className="border-t">
              <summary className="cursor-pointer px-3 py-2 text-[12px] text-muted-foreground select-none hover:text-foreground">{closed.length} completed</summary>
              <ul className="divide-y border-t">{closed.map(item)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
