"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Add a note or a task to any record (POST /api/e/<entity>/<id>/notes|tasks), then re-render.
export function Composer({ entity, id, kind }: { entity: string; id: string; kind: "notes" | "tasks" }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const body = kind === "notes" ? { body: text } : { title: text, priority, ...(due ? { due_on: due } : {}) };
    const res = await fetch(`/api/e/${entity}/${encodeURIComponent(id)}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast.error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save. Try again.");
    setText("");
    setDue("");
    toast.success(kind === "notes" ? "Note added" : "Task added");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border bg-card p-3">
      {kind === "notes"
        ? <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note. Mention a teammate with @[Name](staff:id)." rows={3} maxLength={4000} aria-label="Note" />
        : <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="What needs doing?" maxLength={200} aria-label="Task" />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {kind === "tasks" && (
          <>
            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">Due <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-36" /></label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority" className="h-8 rounded-md border bg-background px-2 text-[12.5px]">
              <option>High</option><option>Normal</option><option>Low</option>
            </select>
          </>
        )}
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>{busy ? "Saving…" : kind === "notes" ? "Add note" : "Add task"}</Button>
      </div>
    </form>
  );
}
