"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AIBadge, AskBox } from "@/components/app/ai";
import type { AskReply } from "../ask";

export const ASK_EVENT = "propniti:ask";
export const askPortal = (q: string) => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: q }));

type Turn = { q: string; a?: AskReply; error?: string };

// The portal's AI help: a floating button and a side panel. Anything on the page can open it with
// a question (askPortal / the ASK_EVENT event). Answers show what was looked up and their source.
export function PortalAssistant({ endpoint, prompts, title = "Ask Propniti" }: { endpoint: string; prompts: string[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  const inflight = useRef(0);

  const ask = async (q: string) => {
    setOpen(true);
    setBusy(true);
    inflight.current += 1;
    // Each answer goes back to its own question, even if another was asked meanwhile.
    const idx = count.current++;
    setTurns((t) => [...t, { q }]);
    let next: Turn;
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const out = await res.json().catch(() => ({}));
      next = res.ok ? { q, a: out } : { q, error: out.error ?? "I couldn't answer that just now." };
    } catch {
      next = { q, error: "You seem to be offline." };
    }
    setTurns((t) => t.map((x, i) => (i === idx ? next : x)));
    inflight.current -= 1;
    if (!inflight.current) setBusy(false);
  };

  useEffect(() => {
    const on = (e: Event) => void ask(String((e as CustomEvent).detail ?? ""));
    window.addEventListener(ASK_EVENT, on);
    return () => window.removeEventListener(ASK_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask only reads stable setters and props
  }, [endpoint]);
  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [turns]);

  return (
    <>
      <Button data-tour="portal-ask" onClick={() => setOpen(true)} className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 h-11 rounded-full px-4 shadow-lg md:bottom-6 print:hidden">
        <Sparkles />Ask AI
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-[15px]"><Sparkles className="size-4 text-tone-ai" />{title}</SheetTitle>
            <SheetDescription className="text-[12.5px]">Answers come from your own records. Every answer shows what was looked up.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {!turns.length && (
              <div className="space-y-2">
                <p className="text-[12.5px] font-medium text-muted-foreground">Try asking</p>
                {prompts.map((p) => (
                  <button key={p} type="button" onClick={() => ask(p)} className="block w-full rounded-lg border bg-card px-3 py-2.5 text-left text-[13px] transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">{p}</button>
                ))}
              </div>
            )}
            {turns.map((t, i) => <TurnView key={i} t={t} />)}
            {busy && <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Looking through your records…</p>}
            <div ref={end} />
          </div>
          <div className="border-t p-3">
            <AskBox onAsk={ask} busy={busy} size="md" placeholder="Ask about your account…" />
            <p className="mt-2 text-[11px] text-muted-foreground">AI can make mistakes. For anything urgent, call the office.</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TurnView({ t }: { t: Turn }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[13px] text-primary-foreground">{t.q}</p>
      {t.error && <p className="rounded-lg border border-tone-danger/30 bg-tone-danger/5 px-3 py-2 text-[13px] text-tone-danger">{t.error}</p>}
      {t.a && (
        <div className="rounded-2xl rounded-bl-sm border bg-card px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2"><AIBadge source={t.a.source} model={t.a.model} size="xs" /></div>
          <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-pretty">{t.a.answer}</p>
          {!!t.a.links?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.a.links.map((l) => <Button key={l.href} asChild variant="outline" size="xs"><Link href={l.href}>{l.label}</Link></Button>)}
            </div>
          )}
          {!!t.a.trace.length && (
            <div className="mt-2 border-t pt-2">
              <button type="button" onClick={() => setShow(!show)} aria-expanded={show} className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground">
                <Search className="size-3" />Looked up {t.a.trace.length} {t.a.trace.length === 1 ? "record set" : "record sets"}<ChevronDown className={`size-3 transition-transform ${show ? "rotate-180" : ""}`} />
              </button>
              {show && (
                <ol className="mt-1.5 space-y-1 border-l pl-3">
                  {t.a.trace.map((x, i) => <li key={i} className="text-[11.5px]"><span className="font-medium">{x.label}: </span><span className="text-muted-foreground">{x.detail}</span></li>)}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
