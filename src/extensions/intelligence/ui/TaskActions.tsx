"use client";

import { useEffect, useId, useState } from "react";
import { AlarmClock, Cpu, Loader2, Mail, MoreHorizontal, UserRoundPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiJson } from "@/components/app/forms/api";
import type { Row } from "@/components/app/data-table/types";

// Row menu and dialogs for My tasks: snooze to a date, reassign to someone at the task's property,
// and, on notice-of-entry tasks, a drafted notice a person reviews and sends. Every change runs a
// tasks action, so the server checks scope, state and double clicks.

export type Staff = { id: string; name: string; title: string };
type Recipient = { id: string; name: string; channel: "Email" | "SMS" | "Portal" };
type Draft = { recipients: Recipient[]; resident_id: string; channel: Recipient["channel"]; subject: string; body: string; entry_on: string; source: "rules" };

export const isNotice = (r: Row) => r.entity_type === "units" && /^Send notice of entry\b/i.test(String(r.title ?? ""));
const FIELD = "h-9 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type Pending = { kind: "snooze"; ids: string[]; title: string; done?: (snoozed: boolean) => void } | { kind: "reassign"; row: Row } | { kind: "notice"; row: Row } | null;

export function TaskMenu({ row, onPick }: { row: Row; onPick: (p: Pending) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`More actions for ${String(row.title)}`} onClick={(e) => e.stopPropagation()}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {isNotice(row) && <DropdownMenuItem onSelect={() => onPick({ kind: "notice", row })}><Mail />Draft notice</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => onPick({ kind: "snooze", ids: [String(row.id)], title: String(row.title) })}><AlarmClock />Snooze…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick({ kind: "reassign", row })}><UserRoundPen />Reassign…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Out = { ok?: number; failed?: number; results?: { status: number; error?: string }[]; message?: string };

export function TaskDialogs({ pending, onClose, today, staff, onDone }: { pending: Pending; onClose: () => void; today: string; staff: Staff[]; onDone: (msg: string, error?: boolean) => void }) {
  return (
    <>
      <SnoozeDialog pending={pending?.kind === "snooze" ? pending : null} onClose={onClose} today={today} onDone={onDone} />
      <ReassignDialog row={pending?.kind === "reassign" ? pending.row : null} onClose={onClose} staff={staff} onDone={onDone} />
      <NoticeDialog row={pending?.kind === "notice" ? pending.row : null} onClose={onClose} onDone={onDone} />
    </>
  );
}

function SnoozeDialog({ pending, onClose, today, onDone }: { pending: Extract<Pending, { kind: "snooze" }> | null; onClose: () => void; today: string; onDone: (msg: string, error?: boolean) => void }) {
  const uid = useId();
  const [date, setDate] = useState(addDays(today, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = pending?.ids.length ?? 0;
  const close = (snoozed = false) => { setError(null); pending?.done?.(snoozed); onClose(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (n === 1) {
        const out = await apiJson<Out>("POST", `/api/e/tasks/${encodeURIComponent(pending.ids[0])}/actions/snooze`, { due_on: date });
        onDone(out.message ?? "Snoozed");
      } else {
        const out = await apiJson<Out>("POST", "/api/e/tasks/actions/snooze", { ids: pending.ids, input: { due_on: date } });
        onDone(`Snoozed ${out.ok} of ${n} tasks${out.failed ? `, ${out.failed} skipped (${out.results?.find((r) => r.status !== 200)?.error ?? "not open"})` : ""}`);
      }
      close(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't snooze. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const quick = [["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]] as const;
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Snooze {n === 1 ? "task" : `${n} tasks`}</DialogTitle>
          <DialogDescription>{n === 1 ? `"${pending?.title}" comes back on your list as due on this date.` : "They come back on the list as due on this date."}</DialogDescription>
        </DialogHeader>
        <form id={`${uid}-f`} onSubmit={submit} className="space-y-3">
          <div className="flex flex-wrap gap-1.5">{quick.map(([l, d]) => <Button key={l} type="button" size="xs" variant={date === addDays(today, d) ? "secondary" : "outline"} onClick={() => setDate(addDays(today, d))}>{l}</Button>)}</div>
          <label htmlFor={`${uid}-d`} className="block text-[12.5px] font-medium">Due on</label>
          <Input id={`${uid}-d`} type="date" min={addDays(today, 1)} value={date} onChange={(e) => setDate(e.target.value)} required className="tabular-nums" />
          {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close()}>Cancel</Button>
          <Button type="submit" form={`${uid}-f`} disabled={busy || !date}>{busy && <Loader2 className="animate-spin" />}Snooze</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({ row, onClose, staff, onDone }: { row: Row | null; onClose: () => void; staff: Staff[]; onDone: (msg: string, error?: boolean) => void }) {
  const uid = useId();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setError(null); setTo(""); onClose(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row || !to) return;
    setBusy(true);
    setError(null);
    try {
      const out = await apiJson<Out>("POST", `/api/e/tasks/${encodeURIComponent(String(row.id))}/actions/reassign`, { assignee_id: to });
      onDone(out.message ?? "Reassigned");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reassign. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const options = staff.filter((s) => s.id !== row?.assignee_id);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reassign task</DialogTitle>
          <DialogDescription>&quot;{String(row?.title ?? "")}&quot; moves to their list. Only people who work at the task&apos;s property can take it.</DialogDescription>
        </DialogHeader>
        <form id={`${uid}-f`} onSubmit={submit} className="space-y-2">
          <label htmlFor={`${uid}-s`} className="block text-[12.5px] font-medium">Assign to</label>
          <select id={`${uid}-s`} value={to} onChange={(e) => setTo(e.target.value)} required className={FIELD}>
            <option value="">Choose…</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.title}</option>)}
          </select>
          {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" form={`${uid}-f`} disabled={busy || !to}>{busy && <Loader2 className="animate-spin" />}Reassign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoticeDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: (msg: string, error?: boolean) => void }) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = row ? String(row.id) : null;

  useEffect(() => {
    if (!id) return;
    let live = true;
    apiJson<{ draft: Draft }>("POST", "/app/tasks/notice", { task_id: id })
      .then((out) => { if (live) setDraft(out.draft); })
      .catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : "Couldn't draft the notice"); });
    return () => { live = false; };
  }, [id]);

  const close = () => { setDraft(null); setLoadError(null); setError(null); onClose(); };
  const set = (k: "resident_id" | "channel" | "subject" | "body") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !id) return;
    setBusy(true);
    setError(null);
    try {
      const out = await apiJson<Out>("POST", `/api/e/tasks/${encodeURIComponent(id)}/actions/send_notice`, { resident_id: draft.resident_id, channel: draft.channel, subject: draft.subject, body: draft.body });
      onDone(out.message ?? "Notice sent");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notice of entry</DialogTitle>
          <DialogDescription>Check the date, time and wording, then send. Sending completes the task.</DialogDescription>
        </DialogHeader>
        {!draft && !loadError && <p className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />Drafting the notice…</p>}
        {loadError && <p role="alert" className="rounded-md border border-tone-danger/25 bg-tone-danger/5 px-3 py-2 text-[12.5px] text-tone-danger">{loadError}</p>}
        {draft && (
          <form id={`${uid}-f`} onSubmit={send} className="space-y-3">
            <p className="text-[12px] text-muted-foreground"><span className="mr-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-foreground"><Cpu className="size-3" />Template draft</span>Drafted from the notice template and the unit&apos;s current lease, then checked by the message rules. Nothing is sent until you press Send.</p>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-to`} className="block text-[12.5px] font-medium">To</label>
                <select id={`${uid}-to`} value={draft.resident_id} onChange={set("resident_id")} className={FIELD}>{draft.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-ch`} className="block text-[12.5px] font-medium">Channel</label>
                <select id={`${uid}-ch`} value={draft.channel} onChange={set("channel")} className={FIELD}>{["Email", "SMS", "Portal"].map((c) => <option key={c}>{c}</option>)}</select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-sub`} className="block text-[12.5px] font-medium">Subject</label>
              <Input id={`${uid}-sub`} value={draft.subject} onChange={set("subject")} maxLength={160} required />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-b`} className="block text-[12.5px] font-medium">Message</label>
              <Textarea id={`${uid}-b`} value={draft.body} onChange={set("body")} rows={8} maxLength={2000} required />
            </div>
            {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
          </form>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" form={`${uid}-f`} disabled={busy || !draft}>{busy && <Loader2 className="animate-spin" />}Send notice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
