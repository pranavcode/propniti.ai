"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageSquarePlus, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/display";
import { usePortalAction } from "./usePortalAction";
import type { MessageRow, ThreadRow } from "../messages";

// Conversations with the management team: a thread list and the open thread with a reply box.
// On phones the list and the thread are separate screens (?thread= in the URL).
export function Messages({ base, entity, me, threads, active, messages, teamName = "Summit Residential" }: {
  base: string;                // e.g. /portal/owner/messages
  entity: string;              // owners | residents | vendors | applicants
  me: string;
  threads: ThreadRow[];
  active: ThreadRow | null;
  messages: MessageRow[];
  teamName?: string;
}) {
  const router = useRouter();
  const mounted = useMounted();
  const { run, busy } = usePortalAction(entity, me);
  const [body, setBody] = useState("");
  const [composing, setComposing] = useState(!threads.length);
  const [subject, setSubject] = useState("");

  const send = async () => {
    if (!body.trim()) return;
    const r = await run("send_message", active && !composing ? { threadId: active.id, body } : { subject: subject || "Question", body });
    if (r.ok) {
      setBody("");
      setSubject("");
      setComposing(false);
      const t = r.href?.match(/thread=([^&]+)/)?.[1];
      if (t) router.replace(`${base}?thread=${t}`);
    }
  };

  const composer = (
    <div className="border-t bg-card p-3">
      {(composing || !active) && (
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" name="subject" autoComplete="off" className="mb-2" />
      )}
      <div className="flex items-end gap-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={active && !composing ? "Write a reply…" : "How can we help?"} aria-label="Message" name="message" rows={2} className="min-h-[44px] resize-none"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
        <Button onClick={send} disabled={!body.trim() || !!busy} aria-label="Send message"><Send />{busy ? "Sending…" : "Send"}</Button>
      </div>
    </div>
  );

  return (
    <div className="grid min-h-[60vh] overflow-hidden rounded-xl border bg-card md:grid-cols-[320px_1fr]">
      <aside className={cn("border-r md:block", active || composing ? "hidden" : "block")} aria-label="Conversations">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-[13px] font-semibold">Conversations</p>
          <Button size="sm" variant="outline" onClick={() => { setComposing(true); router.replace(base); }}><MessageSquarePlus />New</Button>
        </div>
        {threads.length ? (
          <ul className="divide-y">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`${base}?thread=${t.id}`} aria-current={active?.id === t.id ? "page" : undefined} onClick={() => setComposing(false)}
                  className={cn("block px-3 py-2.5 hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", active?.id === t.id && "bg-primary/[0.06]")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-[13px]", t.unread ? "font-semibold" : "font-medium")}>{t.subject}</p>
                    <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={t.last_message_at} title={mounted ? formatDateTime(t.last_message_at) : undefined}>{mounted ? formatRelative(t.last_message_at) : t.last_message_at.slice(0, 10)}</time>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{t.preview}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="px-3 py-6 text-[13px] text-muted-foreground">No conversations yet.</p>}
      </aside>

      <section className={cn("flex min-w-0 flex-col", !active && !composing && "hidden md:flex")} aria-label="Conversation">
        {active && !composing ? (
          <>
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <Button asChild variant="ghost" size="icon-sm" className="md:hidden"><Link href={base} aria-label="Back to conversations"><ArrowLeft /></Link></Button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{active.subject}</p>
                <p className="text-[11.5px] text-muted-foreground">{active.property ?? teamName} · {active.count} messages</p>
              </div>
              <StatusBadge value={active.status} tone={active.status === "Closed" ? "neutral" : active.status === "Waiting" ? "warning" : "info"} label={active.status === "Waiting" ? "Waiting on you" : undefined} />
            </div>
            <ol className="flex-1 space-y-3 overflow-y-auto bg-muted/20 px-3 py-4">
              {messages.map((m) => {
                const mine = m.direction === "in";
                return (
                  <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card")}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className={cn("mt-1 flex items-center gap-1 text-[10.5px]", mine ? "text-primary-foreground/75" : "text-muted-foreground")}>
                        {!mine && <>{teamName}{m.drafted_by_agent && <span className="inline-flex items-center gap-0.5"> · <Sparkles className="size-2.5" />drafted with AI, sent by staff</span>} · </>}
                        <time dateTime={m.sent_at}>{mounted ? formatDateTime(m.sent_at) : m.sent_at.slice(0, 10)}</time>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {composer}
          </>
        ) : composing ? (
          <>
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              {threads.length > 0 && <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to conversations" onClick={() => setComposing(false)}><ArrowLeft /></Button>}
              <p className="text-[13.5px] font-semibold">New message to {teamName}</p>
            </div>
            <div className="flex-1" />
            {composer}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6"><EmptyState kind="inbox" title="Pick a conversation" description="Or start a new one." compact /></div>
        )}
      </section>
    </div>
  );
}
