"use client";
import { demoNowIso } from "@/lib/clock";

import { useMemo, useRef, useState } from "react";
import { AtSign, Pin } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { Button } from "@/components/ui/button";
import { PersonAvatar, RelativeDate } from "../display";
import { useShellMaybe } from "../shell/context";
import { EmptyState, ErrorBanner } from "../states";
import { ActivityTimeline } from "./ActivityTimeline";
import { collabUrl, useCollab } from "./useCollab";

// Notes on any record with @mentions (notes table). Bodies store mentions as @[Name](staff:id);
// the composer shows "@Name" and serializes on send.

export type Person = { id: string; name: string; title?: string };
export type NoteRow = { id: string; body: string; author_id: string; author_name?: string; created_at: string; pinned?: number | boolean; parent_id?: string | null; pending?: boolean };

const MENTION = /@\[([^\]]+)\]\((\w+):([^)]+)\)/g;

export function NoteBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    if (m.index! > last) parts.push(body.slice(last, m.index));
    parts.push(<span key={m.index} className="rounded bg-primary/10 px-1 font-medium text-primary">@{m[1]}</span>);
    last = m.index! + m[0].length;
  }
  parts.push(body.slice(last));
  return <p className="leading-relaxed break-words whitespace-pre-wrap">{parts}</p>;
}

export function NotesPanel({ entity, id, people = [], initial }: { entity: string; id: string; people?: Person[]; initial?: NoteRow[] }) {
  const { rows, setRows, loading, error, reload } = useCollab<NoteRow>(entity, id, "notes", initial);
  const me = useShellMaybe()?.data.persona;
  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.name])), [people]);
  const sorted = useMemo(() => [...rows].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.created_at).localeCompare(String(a.created_at))), [rows]);

  const add = async (body: string) => {
    const temp: NoteRow = { id: `tmp-${Date.now()}`, body, author_id: me?.id ?? "you", author_name: me?.name ?? "You", created_at: demoNowIso(), pending: true };
    setRows((r) => [temp, ...r]);
    try {
      const res = await fetch(collabUrl(entity, id, "notes"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      const data = (await res.json().catch(() => null)) as { row?: NoteRow; error?: string } | null;
      if (!res.ok || !data?.row) throw new Error(data?.error ?? "Couldn't add the note");
      setRows((r) => r.map((n) => (n.id === temp.id ? { ...data.row!, author_name: data.row!.author_name ?? temp.author_name } : n)));
      toast.success("Note added");
      return true;
    } catch (e) {
      setRows((r) => r.filter((n) => n.id !== temp.id));
      toast.error(e instanceof Error ? e.message : "Couldn't add the note");
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Composer people={people} onSend={add} />
      {error && <ErrorBanner title="Couldn't load notes" message={error} onRetry={reload} />}
      {loading ? <ActivityTimeline events={[]} loading /> : !sorted.length && !error ? (
        <EmptyState compact kind="notes" title="No notes yet" description="Leave context for the team. Type @ to mention someone; they get a notification." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sorted.map((n) => {
            const who = n.author_name ?? names[n.author_id] ?? n.author_id;
            return (
              <li key={n.id} className={cn("rounded-lg border bg-card px-3 py-2.5 transition-opacity", n.pending && "opacity-60", n.pinned && "border-tone-warning/30 bg-tone-warning/[0.04]")}>
                <div className="mb-1 flex items-center gap-2 text-[12.5px]">
                  <PersonAvatar name={who} size={20} />
                  <span className="font-medium">{who}</span>
                  {n.pinned ? <span className="inline-flex items-center gap-1 text-[11px] text-tone-warning"><Pin className="size-3" /> Pinned</span> : null}
                  <span className="ml-auto text-[11.5px] text-muted-foreground">{n.pending ? "Sending…" : <RelativeDate value={n.created_at} />}</span>
                </div>
                <NoteBody body={n.body} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Composer({ people, onSend }: { people: Person[]; onSend: (body: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const matches = query == null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onChange = (v: string, caret: number) => {
    setText(v);
    const m = /(^|\s)@([\p{L}\w]*)$/u.exec(v.slice(0, caret));
    setQuery(m ? m[2]! : null);
    setHi(0);
  };
  const pick = (p: Person) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([\p{L}\w]*)$/u, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentions((ms) => (ms.some((m) => m.id === p.id) ? ms : [...ms, p]));
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  const send = async () => {
    const plain = text.trim();
    if (!plain || busy) return;
    let body = plain;
    for (const p of mentions) body = body.split(`@${p.name}`).join(`@[${p.name}](staff:${p.id})`);
    setBusy(true);
    if (await onSend(body)) { setText(""); setMentions([]); }
    setBusy(false);
  };

  return (
    <div className="relative rounded-lg border bg-card shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15">
      <AutoTextarea autoComplete="off"
        ref={ref}
        value={text}
        rows={2}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[hi]!); return; }
            if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
        }}
        placeholder="Add a note. Type @ to mention a teammate…"
        aria-label="New note"
        className="block w-full bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <button type="button" onClick={() => { onChange(text + (text && !text.endsWith(" ") ? " @" : "@"), text.length + 2); ref.current?.focus(); }} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mention someone"><AtSign className="size-3.5" /></button>
        <span className="text-[11.5px] text-muted-foreground">⌘↵ to send</span>
        <Button size="sm" className="ml-auto" onClick={() => void send()} disabled={!text.trim() || busy}>Add note</Button>
      </div>
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Mention" className="absolute top-full left-2 z-20 mt-1 w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setHi(i)} className={cn("flex h-8 w-full items-center gap-2 rounded px-2 text-left", i === hi && "bg-muted")}>
                <PersonAvatar name={p.name} size={20} />
                <span className="flex-1 truncate">{p.name}</span>
                {p.title && <span className="truncate text-[11.5px] text-muted-foreground">{p.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
