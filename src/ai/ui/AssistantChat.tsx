"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, ChevronRight, Database, Loader2, MessageSquare, Search, Wand2 } from "lucide-react";
import { AIBadge, ApprovalItem, AskBox } from "@/components/app/ai";
import { useShellMaybe, type AssistantContext } from "@/components/app/shell/context";
import { cn } from "@/lib/utils";
import { api } from "./client";

// The assistant conversation, used in the ⌘J dock and on /app/copilot. It sends the current page
// (and record) as context, shows what it looked up, renders tables and links, and turns action
// requests into proposals the person confirms here.

type Mode = "chat" | "actions" | "help";
type Reply = {
  threadId: string; messageId: string; runId: string; mode: Mode; answer: string; source: string; model: string; live: boolean;
  table?: { columns: { key: string; label: string; align?: "right" }[]; rows: Record<string, unknown>[] };
  citations: { label: string; href?: string; help?: string }[];
  trace: { tool: string; input: unknown; summary: string; ms?: number; ok: boolean }[];
  proposals: { id: string; title: string; why: string[]; risk: "Low" | "Medium" | "High"; queue_state: string; action: string }[];
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
              <ApprovalItem key={p.id} variant="row" agent="Assistant" title={p.title} risk={p.risk} why={p.why} source="rules" runHref={`/app/ai/runs/${reply.runId}`} onApprove={() => decide(p.id, "approve")} onReject={() => decide(p.id, "reject")} />
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

export function AssistantChat({ threadId: initialThread, initialTurns = [], suggestions = [], page = false }: { threadId?: string; initialTurns?: Turn[]; suggestions?: string[]; page?: boolean }) {
  const shell = useShellMaybe();
  const pathname = usePathname();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [threadId, setThreadId] = useState(initialThread);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode | "auto">("auto");
  const end = useRef<HTMLDivElement>(null);
  const prompts = suggestions.length ? suggestions : shell?.data.assistantPrompts ?? [];

  const ask = useCallback(async (question: string, ctx?: AssistantContext) => {
    setTurns((t) => [...t, { role: "user", text: question, mode: mode === "auto" ? undefined : mode }]);
    setBusy(true);
    try {
      const context = ctx ?? (page ? undefined : contextFromPath(pathname));
      const reply = await api<Reply>("/api/ai/assistant", "POST", { question, threadId, mode: mode === "auto" ? undefined : mode, context });
      setThreadId(reply.threadId);
      setTurns((t) => [...t, { role: "assistant", reply }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }, [mode, page, pathname, threadId]);

  // Questions handed over from ⌘K, AskBox on a page, or "Ask about this" on a record.
  // Only the dock takes hand-overs; the full page would race it when both are open.
  const pending = page ? null : shell?.assistant.pending;
  const take = shell?.assistant.take;
  useEffect(() => {
    if (!pending || busy) return;
    take?.();
    void ask(pending.query, pending.context ? { ...pending.context, path: pending.context.path ?? pathname } : undefined);
  }, [pending, take, busy, ask, pathname]);

  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [turns, busy]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", page && "min-h-[calc(100vh-10rem)]")}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!turns.length && (
          <div className="space-y-1">
            <div className="text-[15px] font-semibold tracking-tight">What can I help with{shell ? `, ${shell.data.persona.name.split(" ")[0]}` : ""}?</div>
            <p className="text-muted-foreground">Ask about your data, tell me to do something, or ask how a feature works. I show every record I look up, and anything that moves money waits for your approval.</p>
          </div>
        )}
        {turns.map((t, i) => t.role === "user" ? (
          <div key={i} className="ml-8 rounded-lg bg-primary/8 px-3 py-2 whitespace-pre-line">{t.text}</div>
        ) : t.role === "error" ? (
          <div key={i} className="rounded-lg border border-tone-danger/30 bg-tone-danger/5 px-3 py-2 text-tone-danger">{t.text}</div>
        ) : (
          <div key={i} className="rounded-lg border bg-card px-3 py-2.5"><Answer reply={t.reply} /></div>
        ))}
        {busy && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Looking it up…</div>}
        <div ref={end} />
      </div>
      <div className="space-y-2 border-t p-3">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.key} role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)} className={cn("flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px]", mode === m.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
              <m.icon className="size-3.5" />{m.label}
            </button>
          ))}
          {threadId && <button className="ml-auto text-[12px] text-muted-foreground hover:text-foreground" onClick={() => { setTurns([]); setThreadId(undefined); }}>New conversation</button>}
        </div>
        <AskBox size="md" busy={busy} onAsk={(q) => void ask(q)} suggestions={turns.length ? [] : prompts} placeholder={mode === "help" ? "How do I…" : mode === "actions" ? "Remind everyone 30+ days late in Austin" : undefined} />
      </div>
    </div>
  );
}

// The ⌘J dock body on every /app page: the same conversation, with the current page as context.
export function AssistantDock() {
  return <AssistantChat />;
}
