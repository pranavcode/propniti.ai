"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Archive, CornerDownRight, FileText, Loader2, MailCheck, RotateCcw, Send, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AIBadge, Confidence } from "@/components/app/ai";
import { apiJson } from "@/components/app/forms/api";
import { cn } from "@/lib/utils";
import { fillTemplate } from "../lib";
import { runAction } from "../ui/client";

export type Suggestion = { id: string; body: string; why: string[]; confidence: number; model: string; source: "live" | "rules" | "precomputed"; runId: string | null; createdAt: string; agent: string };
type Template = { id: string; name: string; category: string; channel: string; language: string; body: string };

const CHANNELS = ["Email", "SMS", "Portal"] as const;

export function ThreadActions({ id, status, unread }: { id: string; status: string; unread: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); router.refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Nothing changed"); } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-1">
      {unread && <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(() => runAction("message_threads", id, "message_threads.mark_read"), "Marked read")}><MailCheck />Mark read</Button>}
      {status === "Closed"
        ? <Button size="sm" variant="outline" disabled={busy} onClick={() => go(() => apiJson("PATCH", `/api/e/message_threads/${encodeURIComponent(id)}`, { status: "Open" }), "Reopened")}><RotateCcw />Reopen</Button>
        : <Button size="sm" variant="outline" disabled={busy} onClick={() => go(() => apiJson("PATCH", `/api/e/message_threads/${encodeURIComponent(id)}`, { status: "Closed" }), "Conversation closed")}><Archive />Close</Button>}
    </div>
  );
}

export function Composer({ threadId, channel: initialChannel, closed, suggestion, templates, vars, language }: {
  threadId: string; channel: string; closed: boolean; suggestion: Suggestion | null; templates: Template[]; vars: Record<string, string | null>; language: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // In the inbox, keep this conversation open after it leaves the current filter (Open → Waiting).
  const stay = () => {
    if (!pathname.endsWith("/communications/inbox") || search.get("t") === threadId) return router.refresh();
    const sp = new URLSearchParams(search.toString());
    sp.set("t", threadId);
    // Write ?t= through the history API (the router syncs it) and re-render once: refresh also
    // updates the layout's Inbox count, which a search-param navigation would leave alone.
    window.history.replaceState(null, "", `${pathname}?${sp}`);
    router.refresh();
  };
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<string>(CHANNELS.includes(initialChannel as (typeof CHANNELS)[number]) ? initialChannel : "Email");
  const [from, setFrom] = useState<{ kind: "ai"; id: string; text: string } | { kind: "template"; id: string } | null>(null);
  const [busy, setBusy] = useState<"send" | "close" | "draft" | null>(null);
  const [hidden, setHidden] = useState(false);
  const smsOver = channel === "SMS" && body.length > 320;

  const draft = async () => {
    setBusy("draft");
    try {
      const r = await runAction("message_threads", threadId, "message_threads.suggest_reply");
      toast.success(r.message ?? "Reply drafted");
      setHidden(false);
      stay();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft a reply");
    } finally {
      setBusy(null);
    }
  };

  const send = async (close: boolean) => {
    setBusy(close ? "close" : "send");
    try {
      const ai = from?.kind === "ai" ? from : null;
      const r = await runAction("message_threads", threadId, "message_threads.reply", {
        body, channel, close, template_id: from?.kind === "template" ? from.id : undefined,
        proposal_id: ai?.id, edited: ai ? ai.text.trim() !== body.trim() : undefined,
      });
      toast.success(r.message ?? "Sent");
      setBody("");
      setFrom(null);
      stay();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not sent. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const groups = [...new Set(templates.map((t) => t.category))];
  return (
    <div className="border-t bg-card">
      {suggestion && !hidden && from?.kind !== "ai" && (
        <div className="mx-3 mt-3 overflow-hidden rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04]" data-tour="suggested-reply">
          <div className="flex items-center gap-2 border-b border-tone-ai/15 px-3 py-1.5 text-[12px]">
            <Sparkles className="size-3.5 text-tone-ai" /><span className="font-medium">Suggested reply</span>
            <AIBadge source={suggestion.source} model={suggestion.model} size="xs" />
            <Confidence value={suggestion.confidence} className="ml-auto" />
          </div>
          <p className="whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed">{suggestion.body}</p>
          <ul className="flex flex-col gap-0.5 px-3 pb-2 text-[11.5px] text-muted-foreground">
            {suggestion.why.map((w) => <li key={w} className="flex gap-1.5"><CornerDownRight className="mt-0.5 size-3 shrink-0 opacity-60" />{w}</li>)}
          </ul>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-tone-ai/15 px-3 py-1.5">
            <Button size="sm" onClick={() => { setBody(suggestion.body); setFrom({ kind: "ai", id: suggestion.id, text: suggestion.body }); }}>Use reply</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={draft}>{busy === "draft" ? <Loader2 className="animate-spin" /> : <RotateCcw />}Regenerate</Button>
            <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>Hide</Button>
            {suggestion.runId && <Link href={`/app/ai/runs/${encodeURIComponent(suggestion.runId)}`} className="ml-auto text-[11.5px] text-primary hover:underline">View run</Link>}
          </div>
        </div>
      )}
      <div className="p-3">
        {from && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {from.kind === "ai" ? <><Sparkles className="size-3 text-tone-ai" />From the AI suggestion{body.trim() !== from.text.trim() ? " · edited" : ""}</> : <><FileText className="size-3" />From template {templates.find((t) => t.id === from.id)?.name}</>}
            <button type="button" className="ml-1 inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => { setBody(""); setFrom(null); }}><Undo2 className="size-3" />Clear</button>
          </div>
        )}
        <label htmlFor={`reply-${threadId}`} className="sr-only">Reply</label>
        <Textarea id={`reply-${threadId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} placeholder={closed ? "This conversation is closed. Reply to reopen it…" : `Write a reply${language === "es" ? " (resident prefers Spanish)" : ""}…`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim() && !busy) void send(false); }} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ToggleGroup type="single" variant="outline" size="sm" aria-label="Channel" value={channel} onValueChange={(v) => v && setChannel(v)}>
            {CHANNELS.map((ch) => <ToggleGroupItem key={ch} value={ch}>{ch}</ToggleGroupItem>)}
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><FileText />Templates</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
              {templates.length === 0 && <DropdownMenuLabel className="font-normal text-muted-foreground">No templates yet</DropdownMenuLabel>}
              {groups.map((g, i) => (
                <DropdownMenuGroup key={g}>
                  {i > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">{g}</DropdownMenuLabel>
                  {templates.filter((t) => t.category === g).map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => { setBody(fillTemplate(t.body, vars)); setFrom({ kind: "template", id: t.id }); if (CHANNELS.includes(t.channel as (typeof CHANNELS)[number])) setChannel(t.channel); }}>
                      <span className="min-w-0 flex-1 truncate">{t.name}</span><span className="text-[11px] text-muted-foreground">{t.language === "es" ? "ES" : t.channel}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {!suggestion && !closed && <Button size="sm" variant="ghost" disabled={!!busy} onClick={draft}>{busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-tone-ai" />}Suggest a reply</Button>}
          {suggestion && hidden && <Button size="sm" variant="ghost" onClick={() => setHidden(false)}><Sparkles className="text-tone-ai" />Show suggestion</Button>}
          <span className={cn("ml-auto text-[11px] tabular-nums", smsOver ? "text-tone-warning" : "text-muted-foreground")}>{channel === "SMS" ? `${body.length}/320` : ""}</span>
          <Button size="sm" variant="outline" disabled={!body.trim() || !!busy || smsOver} onClick={() => send(true)}>{busy === "close" ? <Loader2 className="animate-spin" /> : <Archive />}Send and close</Button>
          <Button size="sm" disabled={!body.trim() || !!busy || smsOver} onClick={() => send(false)}>{busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}Send</Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Sending is simulated in this demo: the message is recorded on the conversation and the audit trail, and nothing leaves the system. ⌘↵ sends.</p>
      </div>
    </div>
  );
}
