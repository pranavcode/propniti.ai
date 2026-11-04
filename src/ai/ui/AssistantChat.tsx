"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { BookOpen, Check, ChevronRight, Database, History, Loader2, Maximize2, MessageSquare, Plus, Search, Wand2, X } from "lucide-react";
import { AIBadge, ApprovalItem, AskBox } from "@/components/app/ai";
import { RelativeDate } from "@/components/app/display";
import { useShellMaybe, type AssistantContext } from "@/components/app/shell/context";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { loadFacts } from "@/components/app/guide/ChatBubble";
import { api, useRunStream } from "./client";
import { demoDay, hiddenToday, hideToday, rightNowItems, type RightNowItem } from "./rightNow";

// The assistant conversation, used in the ⌘J dock and on /app/copilot. It sends the current page
// (and record) as context, shows what it looked up, renders tables and links, and turns action
// requests into proposals the person confirms here. In the dock, the persona's current thread is
// remembered in this browser and reopened from the server, with a menu of recent conversations.

type Mode = "chat" | "actions" | "help";
type Reply = {
  threadId: string; messageId: string; runId: string; mode: Mode; answer: string; source: string; model: string; live: boolean;
  table?: { columns: { key: string; label: string; align?: "right" }[]; rows: Record<string, unknown>[] };
  citations: { label: string; href?: string; help?: string }[];
  trace: { tool: string; input: unknown; summary: string; ms?: number; ok: boolean }[];
  proposals: { id: string; title: string; why: string[]; risk: string; queue_state: string; action: string; decision?: string | null }[];
  run?: { id: string; agent: string; label: string; already: boolean };
  note?: string;
};
type Turn = { role: "user"; text: string; mode?: Mode } | { role: "assistant"; reply: Reply } | { role: "error"; text: string };

const MODES: { key: Mode | "auto"; label: string; icon: typeof MessageSquare }[] = [
  { key: "auto", label: "Auto", icon: Wand2 },
  { key: "chat", label: "Ask", icon: MessageSquare },
  { key: "actions", label: "Do", icon: Database },
  { key: "help", label: "Help", icon: BookOpen },
];
const TOOL_LABEL: Record<string, string> = {
  "ledger.delinquency": "Rent owed by lease", "ledger.lookup": "Lease ledger", "records.search": "Records", "records.get": "Record", "records.related": "Related records",
  "metrics.monthly": "Monthly metrics", "metrics.explain_noi": "NOI drivers", "data.issues": "Data issues", "policy.lookup": "Approval policies and state rules", "help.search": "Help articles",
};

const DECIDED: Record<string, "approved" | "rejected" | "snoozed"> = { Approved: "approved", Edited: "approved", Rejected: "rejected", Snoozed: "snoozed" };
const RESET_NOTE = "Your last conversation was cleared with the nightly demo reset (midnight Pacific), so this is a fresh one.";
type Saved = { thread: { id: string; title: string }; turns: Turn[]; more: boolean };
type ThreadRow = { id: string; title: string; updated_at: string; sample?: boolean };
type Card = { type: string; title: string; href: string; status?: string; facts: { label: string; value: string }[]; summary?: { text: string; source: string; model: string }; questions: string[] };

// Sends a question and reads the streamed progress ({"status"} lines) until the reply arrives.
async function askStreaming(body: unknown, onStatus: (s: string) => void): Promise<Reply> {
  const res = await fetch("/api/ai/assistant", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    return data as Reply;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += value ?? "";
    const lines = buf.split("\n");
    buf = done ? "" : lines.pop()!;
    for (const line of lines.filter((l) => l.trim())) {
      const msg = JSON.parse(line) as { status?: string; reply?: Reply; error?: string };
      if (msg.status) onStatus(msg.status);
      if (msg.error) throw new Error(msg.error);
      if (msg.reply) return msg.reply;
    }
    if (done) throw new Error("The answer didn't arrive. Try again.");
  }
}

// The record "Ask about this" opened the dock on: what it is, its key facts and current summary.
function RecordCard({ card }: { card: Card | "loading" | "missing" }) {
  if (card === "loading") return <div className="space-y-2 rounded-lg border bg-card p-3" aria-busy="true"><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-3 w-full animate-pulse rounded bg-muted" /><div className="h-3 w-5/6 animate-pulse rounded bg-muted" /></div>;
  if (card === "missing") return <p className="text-[12px] text-muted-foreground">I can&apos;t open that record&apos;s details, but you can still ask about it.</p>;
  return (
    <section aria-label={`About this ${card.type.toLowerCase()}`} className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <span>{card.type}</span>
        {card.status && <span className="rounded-full border px-1.5 py-px text-[11px] text-foreground/80">{card.status}</span>}
      </div>
      <Link href={card.href} className="block font-semibold leading-snug hover:text-primary hover:underline">{card.title}</Link>
      {card.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
          {card.facts.map((f) => <div key={f.label} className="min-w-0"><dt className="text-muted-foreground">{f.label}</dt><dd className="truncate" title={f.value}>{f.value}</dd></div>)}
        </dl>
      )}
      {card.summary && (
        <div className="space-y-1 border-t pt-2">
          <AIBadge size="xs" source={card.summary.source === "rules" ? "rules" : card.summary.source === "live" ? "live" : "precomputed"} model={card.summary.model} />
          <p className="text-[12.5px] text-muted-foreground">{card.summary.text}</p>
        </div>
      )}
    </section>
  );
}

// The thread each persona last used in the dock, kept in this browser. Storage can be blocked.
const threadKey = (persona: string) => `pn_ai_thread:${persona}`;
function remembered(persona: string) {
  try { return localStorage.getItem(threadKey(persona)); } catch { return null; }
}
function remember(persona: string, id: string | undefined) {
  try { if (id) localStorage.setItem(threadKey(persona), id); else localStorage.removeItem(threadKey(persona)); } catch { /* not saved */ }
}

// Record pages are /app/<route>/<id>; the last segment is the record when the page has one.
function contextFromPath(path: string): AssistantContext {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 3 ? { path, id: decodeURIComponent(parts[parts.length - 1]) } : { path };
}

function Trace({ reply }: { reply: Reply }) {
  const [open, setOpen] = useState(false);
  if (!reply.trace.length) return null;
  return (
    <div className="mt-2 rounded-md border bg-muted/30 text-[12px]">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
        <Search className="size-3.5" /> Looked up {reply.trace.length} thing{reply.trace.length === 1 ? "" : "s"}
        <ChevronRight className={cn("ml-auto size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <ol className="space-y-1 border-t px-2.5 py-2">
          {reply.trace.map((t, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", t.ok ? "bg-tone-success" : "bg-tone-danger")} />
              <span className="font-medium">{TOOL_LABEL[t.tool] ?? t.tool}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={JSON.stringify(t.input)}>{Object.entries((t.input as Record<string, unknown>) ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length + " items" : typeof v === "object" ? "…" : v}`).join(", ")}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{t.summary}{t.ms != null ? ` · ${t.ms} ms` : ""}</span>
            </li>
          ))}
          <li className="pt-1"><Link href={`/app/ai/runs/${reply.runId}`} className="text-primary hover:underline">Full trace</Link></li>
        </ol>
      )}
    </div>
  );
}

// An agent run started from Do mode, followed live (the same stream the run page uses).
function AgentRun({ id, label }: { id: string; label: string }) {
  const { run, steps, proposals } = useRunStream(id);
  const status = run?.status ?? "running";
  const tone = status === "failed" ? "text-tone-danger" : status === "running" ? "text-muted-foreground" : "text-tone-success";
  return (
    <div data-agent-run={status} className="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-[12px]">
      {status === "running" ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" /> : <span className={cn("mt-1 size-2 shrink-0 rounded-full", status === "failed" ? "bg-tone-danger" : "bg-tone-success")} />}
      <div className="min-w-0 flex-1">
        <div className={cn("font-medium", tone)}>
          {label} · {status === "running" ? `running, ${steps.length} step${steps.length === 1 ? "" : "s"} so far` : status === "failed" ? "stopped" : status === "waiting_approval" ? `finished, ${proposals.length} waiting for approval` : "finished"}
        </div>
        {run?.summary && status !== "running" && <p className="text-muted-foreground">{run.summary}</p>}
      </div>
    </div>
  );
}

function Answer({ reply }: { reply: Reply }) {
  const decide = async (id: string, decision: "approve" | "reject") => {
    try {
      const r = await api<{ message: string }>(`/api/ai/proposals/${id}`, "POST", { decision });
      toast.success(decision === "approve" ? r.message : "Cancelled");
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2"><AIBadge size="xs" source={reply.live ? "live" : "rules"} model={reply.source} /></div>
      <p className="whitespace-pre-line">{reply.answer}</p>
      {reply.run && <AgentRun id={reply.run.id} label={reply.run.label} />}
      {reply.table && reply.table.rows.length > 0 && (
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-muted text-left text-muted-foreground"><tr>{reply.table.columns.map((c) => <th key={c.key} className={cn("px-2 py-1 font-medium", c.align === "right" && "text-right")}>{c.label}</th>)}</tr></thead>
            <tbody>
              {reply.table.rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {reply.table!.columns.map((c, j) => (
                    <td key={c.key} className={cn("px-2 py-1", c.align === "right" && "text-right tabular-nums")}>{j === 0 && typeof r.href === "string" ? <Link className="text-primary hover:underline" href={r.href}>{String(r[c.key] ?? "")}</Link> : String(r[c.key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reply.proposals.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium">Confirm each action; nothing is sent until you do.</div>
          <div className="overflow-hidden rounded-md border">
            {reply.proposals.map((p) => (
              <ApprovalItem key={p.id} variant="row" agent="Assistant" title={p.title} risk={p.risk as "Low" | "Medium" | "High"} why={p.why} source="rules" runHref={`/app/ai/runs/${reply.runId}`} decided={DECIDED[p.decision ?? ""]} onApprove={() => decide(p.id, "approve")} onReject={() => decide(p.id, "reject")} />
            ))}
          </div>
        </div>
      )}
      {reply.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reply.citations.slice(0, 8).map((c, i) => c.href ? <Link key={i} href={c.href} className="rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:border-primary hover:text-primary">{c.help && <BookOpen className="mr-1 inline size-3" />}{c.label}</Link> : <span key={i} className="rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground">{c.label}</span>)}
        </div>
      )}
      <Trace reply={reply} />
      {reply.note && <p className="text-[11.5px] text-muted-foreground">{reply.note}</p>}
    </div>
  );
}

// "Right now": up to three one-click things from the bubble's counts (GET /api/guide, cached).
function RightNow({ persona, nav, onAsk }: { persona: string; nav: string[]; onAsk: (q: string) => void }) {
  const [items, setItems] = useState<RightNowItem[]>([]);
  const [hidden, setHidden] = useState(true);
  const navKey = nav.join("|");
  useEffect(() => {
    let live = true;
    const day = demoDay();
    if (hiddenToday(persona, day)) return;
    void loadFacts(persona).then((f) => { if (live) { setItems(rightNowItems(f, navKey.split("|"))); setHidden(false); } });
    return () => { live = false; };
  }, [persona, navKey]);
  if (hidden || !items.length) return null;
  return (
    <section aria-label="Right now" className="rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between px-3 pt-2 text-[12px]">
        <span className="font-medium">Right now</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => { hideToday(persona, demoDay()); setHidden(true); }}>Hide for today</button>
      </div>
      <ul className="divide-y px-3 pb-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1">{it.text}</span>
            {it.action.kind === "href"
              ? <Button asChild size="sm" variant="outline"><Link href={it.action.href}>{it.action.label}</Link></Button>
              : <Button size="sm" variant="outline" onClick={() => onAsk((it.action as { prompt: string }).prompt)}>{it.action.label}</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Marks a seeded sample conversation (ids smp-…) in the history lists.
export function SampleTag() {
  return <span title="A sample conversation that comes with the demo data. Its answers were computed from that data." className="rounded-sm border px-1 text-[10px] leading-[14px] font-medium text-muted-foreground">Sample</span>;
}

// The dock's history menu, rendered into the panel header: recent conversations, new, open as a page.
function RecentMenu({ current, onOpen, onNew }: { current?: string; onOpen: (id: string) => void; onNew: () => void }) {
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    setFailed(false);
    try { setRows((await api<{ threads: ThreadRow[] }>("/api/ai/assistant/threads?limit=10")).threads); } catch { setFailed(true); }
  };
  return (
    <DropdownMenu onOpenChange={(o) => { if (o) void load(); }}>
      <Tooltip>
        <TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Recent conversations"><History /></Button></DropdownMenuTrigger></TooltipTrigger>
        <TooltipContent>Recent conversations</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Recent conversations</DropdownMenuLabel>
        {rows === null && !failed && <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>}
        {failed && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">Couldn&apos;t load your conversations.</div>}
        {rows?.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No conversations yet today.</div>}
        {rows?.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => onOpen(t.id)} className="items-start gap-2">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate">{t.title}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><RelativeDate value={t.updated_at} />{t.sample && <SampleTag />}</span>
            </span>
            {t.id === current && <Check className="mt-0.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew}><Plus /> New conversation</DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={current ? `/app/copilot?thread=${encodeURIComponent(current)}` : "/app/copilot"}><Maximize2 /> Open in Copilot</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssistantChat({ threadId: initialThread, initialTurns = [], suggestions = [], page = false }: { threadId?: string; initialTurns?: Turn[]; suggestions?: string[]; page?: boolean }) {
  const shell = useShellMaybe();
  const pathname = usePathname();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [threadId, setThread] = useState(initialThread);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode | "auto">("auto");
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // "Ask about this": the record questions are about (removable), and its card until one is asked.
  const [about, setAbout] = useState<AssistantContext | null>(null);
  const [card, setCard] = useState<Card | "loading" | "missing" | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const prompts = suggestions.length ? suggestions : shell?.data.assistantPrompts ?? [];
  const persona = page ? null : shell?.data.persona.id ?? null;

  const setThreadId = useCallback((id: string | undefined) => {
    setThread(id);
    if (persona) remember(persona, id);
  }, [persona]);

  // Opens one of the persona's saved threads (the server checks it is theirs, in this workspace).
  const open = useCallback(async (id: string, restore = false) => {
    setRestoring(true);
    setNotice(null);
    try {
      const r = await fetch(`/api/ai/assistant/threads/${encodeURIComponent(id)}?limit=30`);
      if (r.status === 404) {
        setThreadId(undefined);
        setTurns([]);
        setMore(false);
        setNotice(restore ? RESET_NOTE : "That conversation no longer exists. Demo data resets at midnight Pacific.");
        return;
      }
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const t = (await r.json()) as Saved;
      setThreadId(t.thread.id);
      setTurns(t.turns);
      setMore(t.more);
    } catch {
      if (!restore) toast.error("Couldn't open that conversation. Try again.");
    } finally {
      setRestoring(false);
    }
  }, [setThreadId]);

  const reset = useCallback(() => { setTurns([]); setThreadId(undefined); setMore(false); setNotice(null); }, [setThreadId]);

  // The dock reopens the persona's last conversation, after a reload or in a new tab.
  useEffect(() => {
    if (!persona) return;
    const id = remembered(persona);
    if (id) void open(id, true);
  }, [persona, open]);

  useEffect(() => {
    // The panel header mounts with the dock, so its slot exists by now.
    if (persona) setSlot(document.getElementById("assistant-panel-actions"));
  }, [persona]);

  const ask = useCallback(async (question: string, ctx?: AssistantContext) => {
    setTurns((t) => [...t, { role: "user", text: question, mode: mode === "auto" ? undefined : mode }]);
    setBusy(true);
    setStatus(null);
    setCardOpen(false);
    try {
      const context = ctx ?? about ?? (page ? undefined : contextFromPath(pathname));
      const reply = await askStreaming({ question, threadId, mode: mode === "auto" ? undefined : mode, context }, setStatus);
      setThreadId(reply.threadId);
      setTurns((t) => [...t, { role: "assistant", reply }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [mode, page, pathname, threadId, setThreadId, about]);

  const focus = useCallback(async (ctx: AssistantContext) => {
    setAbout(ctx);
    setCardOpen(true);
    if (!ctx.entity || !ctx.id) return setCard(null);
    setCard("loading");
    try {
      setCard(await api<Card>(`/api/ai/assistant/about?entity=${encodeURIComponent(ctx.entity)}&id=${encodeURIComponent(ctx.id)}`));
    } catch {
      setCard("missing");
    }
  }, []);
  const clearAbout = () => { setAbout(null); setCard(null); };

  // Questions handed over from ⌘K, AskBox on a page, or "Ask about this" on a record.
  // Only the dock takes hand-overs; the full page would race it when both are open.
  const pending = page ? null : shell?.assistant.pending;
  const take = shell?.assistant.take;
  useEffect(() => {
    if (!pending || busy || restoring) return;
    take?.();
    const ctx = pending.context ? { ...pending.context, path: pending.context.path ?? pathname } : undefined;
    // "Ask about this" sends nothing: the person picks a suggested question or types one.
    if (pending.query === null) { if (ctx) void focus(ctx); return; }
    void ask(pending.query, ctx);
  }, [pending, take, busy, restoring, ask, focus, pathname]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, busy, card]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {slot && createPortal(<RecentMenu current={threadId} onOpen={(id) => void open(id)} onNew={reset} />, slot)}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {persona && shell && !shell.data.persona.portal && <RightNow persona={persona} nav={shell.data.nav.flatMap((s) => s.items.map((i) => i.href))} onAsk={(q) => void ask(q)} />}
        {notice && <p className="text-[12px] text-muted-foreground">{notice}</p>}
        {more && threadId && <p className="text-center text-[12px] text-muted-foreground">Earlier messages are in <Link href={`/app/copilot?thread=${encodeURIComponent(threadId)}`} className="text-primary hover:underline">Copilot</Link>.</p>}
        {restoring && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Opening your conversation…</div>}
        {!turns.length && !restoring && (
          <div className="space-y-1">
            <div className="text-[15px] font-semibold tracking-tight">What can I help with{shell ? `, ${shell.data.persona.name.split(" ")[0]}` : ""}?</div>
            <p className="text-muted-foreground">Ask about your data, tell me to do something, or ask how a feature works. I show every record I look up, and anything that moves money waits for your approval.</p>
          </div>
        )}
        {turns.map((t, i) => t.role === "user" ? (
          <div key={i} data-turn="user" className="ml-8 rounded-lg bg-primary/8 px-3 py-2 whitespace-pre-line">{t.text}</div>
        ) : t.role === "error" ? (
          <div key={i} className="rounded-lg border border-tone-danger/30 bg-tone-danger/5 px-3 py-2 text-tone-danger">{t.text}</div>
        ) : (
          <div key={i} className="rounded-lg border bg-card px-3 py-2.5"><Answer reply={t.reply} /></div>
        ))}
        {busy && <div data-assistant-busy className="flex items-center gap-2 text-muted-foreground" aria-live="polite"><Loader2 className="size-4 animate-spin" /> {status ?? "Looking it up…"}</div>}
        {card && cardOpen && !busy && <RecordCard card={card} />}
        <div ref={end} />
      </div>
      <div className="space-y-2 border-t p-3">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.key} role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)} className={cn("flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px]", mode === m.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
              <m.icon className="size-3.5" />{m.label}
            </button>
          ))}
          {threadId && <button className="ml-auto text-[12px] text-muted-foreground hover:text-foreground" onClick={reset}>New conversation</button>}
        </div>
        {about && (
          <div className="flex min-w-0 items-center gap-1 self-start rounded-full border border-tone-ai/30 bg-tone-ai/5 py-0.5 pr-0.5 pl-2 text-[12px]">
            <span className="min-w-0 truncate"><span className="text-muted-foreground">About:</span> {card && typeof card === "object" ? `${card.type} · ` : ""}{about.title ?? about.id}</span>
            <button onClick={clearAbout} aria-label="Remove record context, ask a general question" className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3" /></button>
          </div>
        )}
        <AskBox size="md" busy={busy || restoring} onAsk={(q) => void ask(q)} suggestions={cardOpen && card && typeof card === "object" ? card.questions : about ? [] : turns.length ? [] : prompts} placeholder={mode === "help" ? "How do I…" : mode === "actions" ? "Remind everyone 30+ days late in Austin" : undefined} />
      </div>
    </div>
  );
}

// The ⌘J dock body on every /app page: the same conversation, with the current page as context.
export function AssistantDock() {
  // Keyed by persona: switching persona shows that persona's own history.
  return <AssistantChat key={useShellMaybe()?.data.persona.id} />;
}
