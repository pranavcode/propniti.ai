"use client";

import { useRef, useState } from "react";
import { ArrowUp, Loader2, Scale, Sparkles } from "lucide-react";
import { AIBadge } from "@/components/app/ai/AIBadge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AskReply } from "./ask";

type Turn = { q: string; reply?: AskReply; error?: string };

const SUGGESTED = ["What's the total to move in?", "Are pets allowed?", "Is there parking?", "What do I need to qualify?", "When can I move in?"];

// The public "Ask about this unit" box. No sign-in; the route is rate-limited and read-only.
export function AskUnit({ listingId, unit }: { listingId: string; unit: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setQ("");
    setTurns((t) => [...t.slice(-4), { q: text }]);
    let turn: Turn;
    try {
      const res = await fetch(`/listings/${encodeURIComponent(listingId)}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text.slice(0, 300) }) });
      const body = await res.json().catch(() => ({}));
      turn = res.ok ? { q: text, reply: body as AskReply } : { q: text, error: res.status === 429 ? "You've asked a lot of questions in a minute. Wait a moment and try again." : (body.error ?? "Couldn't get an answer. Try again.") };
    } catch {
      turn = { q: text, error: "You seem to be offline. Check your connection and try again." };
    }
    setTurns((t) => [...t.slice(0, -1), turn]);
    setBusy(false);
    input.current?.focus();
  }

  return (
    <TooltipProvider delayDuration={200}>
      <section aria-labelledby="ask-title" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex items-start gap-3 border-b bg-gradient-to-b from-tone-ai/[0.06] to-transparent p-4 sm:p-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-tone-ai/10 text-tone-ai"><Sparkles className="size-[18px]" aria-hidden /></span>
          <div className="min-w-0">
            <h2 id="ask-title" className="text-[16px] font-semibold">Ask about unit {unit}</h2>
            <p className="text-[13px] text-muted-foreground">Answers come only from this listing and our renter help articles. No account needed.</p>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] text-primary-foreground">{t.q}</p>
              {!t.reply && !t.error && <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Checking this listing…</p>}
              {t.error && <p role="alert" className="rounded-xl bg-tone-danger/10 px-3.5 py-2 text-[13.5px] text-tone-danger">{t.error}</p>}
              {t.reply && (
                <div className={cn("max-w-[92%] space-y-2 rounded-2xl rounded-bl-md border px-3.5 py-2.5", t.reply.source === "policy" && "border-tone-info/30 bg-tone-info/5")}>
                  <p className="text-[14px] leading-relaxed">{t.reply.answer}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                    {t.reply.source === "policy" ? (
                      <span className="inline-flex items-center gap-1 font-medium text-tone-info"><Scale className="size-3.5" aria-hidden />Fair housing policy</span>
                    ) : (
                      <AIBadge source={t.reply.source === "live" ? "live" : "rules"} model={t.reply.model} size="xs" />
                    )}
                    <span>Source: {t.reply.sources.map((s, j) => (
                      <span key={s.label}>{j > 0 && ", "}{s.href ? <a href={s.href} className="underline underline-offset-2 hover:text-foreground">{s.label}</a> : s.label}</span>
                    ))}</span>
                  </div>
                  {t.reply.note && <p className="text-[12px] text-muted-foreground">{t.reply.note}</p>}
                </div>
              )}
            </div>
          ))}

          {!turns.length && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} disabled={busy} className="rounded-full border px-3 py-1.5 text-[13px] hover:border-primary hover:bg-primary/5 disabled:opacity-50">{s}</button>
              ))}
            </div>
          )}

          <form onSubmit={(e) => (e.preventDefault(), ask(q))} className="relative">
            <label htmlFor="ask-input" className="sr-only">Your question about this home</label>
            <input
              id="ask-input"
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={300}
              placeholder="e.g. Is there a washer and dryer…"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-input bg-background pr-12 pl-3.5 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
            <button type="submit" disabled={busy || q.trim().length < 2} aria-label="Ask" className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
            </button>
          </form>
          <p className="text-[11.5px] text-muted-foreground">We don&apos;t answer questions about who lives nearby, area safety or school ratings (fair housing). Up to 20 questions a minute.</p>
        </div>
      </section>
    </TooltipProvider>
  );
}
