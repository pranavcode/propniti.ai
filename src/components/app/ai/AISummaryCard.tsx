"use client";

import { useState } from "react";
import { MessageCircleQuestion, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { RelativeDate } from "../display";
import { useShellMaybe } from "../shell/context";
import { AIBadge, type AISource } from "./AIBadge";

export type AISummaryCardProps = {
  title?: string;                        // "Resident summary"
  bullets: string[];
  generatedAt?: string;
  source?: AISource;
  model?: string;
  loading?: boolean;
  onRegenerate?: () => void | Promise<unknown>;
  onFeedback?: (good: boolean) => void;
  ask?: { entity?: string; id?: string; title?: string; prompt?: string }; // "Ask about this" context
  className?: string;
};

// Record summary for the right rail (HubSpot Breeze pattern): what matters about this record now.
export function AISummaryCard({ title = "AI summary", bullets, generatedAt, source = "precomputed", model, loading, onRegenerate, onFeedback, ask, className }: AISummaryCardProps) {
  const shell = useShellMaybe();
  const [vote, setVote] = useState<boolean | null>(null);
  const [regen, setRegen] = useState(false);
  const busy = loading || regen;
  const regenerate = async () => { setRegen(true); try { await onRegenerate?.(); } finally { setRegen(false); } };

  return (
    <section className={cn("rounded-lg border border-tone-ai/20 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--tone-ai)_5%,var(--card)),var(--card)_55%)]", className)} aria-busy={busy}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Sparkles className="size-3.5 text-tone-ai" />
        <h3 className="flex-1 text-[12.5px] font-semibold">{title}</h3>
        <AIBadge source={source} model={model} size="xs" />
      </div>
      <div className="px-3 py-2.5">
        {busy ? (
          <div className="space-y-2">{[92, 84, 70].map((w) => <Skeleton key={w} className="h-3 bg-tone-ai/10" style={{ width: `${w}%` }} />)}</div>
        ) : (
          <ul className="space-y-1.5 text-[12.5px] leading-snug">
            {bullets.map((b) => <li key={b} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-tone-ai/60" />{b}</li>)}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-tone-ai/10 px-2 py-1.5 text-[11.5px] text-muted-foreground">
        {generatedAt && <span className="px-1">Generated <RelativeDate value={generatedAt} /></span>}
        {onRegenerate && <button onClick={() => void regenerate()} disabled={busy} className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label="Regenerate"><RefreshCw className={cn("size-3", regen && "animate-spin motion-reduce:animate-none")} /></button>}
        <span className="ml-auto flex items-center">
          {[true, false].map((good) => {
            const I = good ? ThumbsUp : ThumbsDown;
            return <button key={String(good)} onClick={() => { setVote(good); onFeedback?.(good); }} aria-pressed={vote === good} aria-label={good ? "Helpful" : "Not helpful"} className={cn("rounded p-1 hover:bg-muted hover:text-foreground", vote === good && "text-tone-ai")}><I className="size-3" /></button>;
          })}
          {shell && (
            <button onClick={() => shell.assistant.ask(ask?.prompt ?? `Tell me more about ${ask?.title ?? "this record"}`, { entity: ask?.entity, id: ask?.id, title: ask?.title })} className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-tone-ai hover:bg-tone-ai/10">
              <MessageCircleQuestion className="size-3" /> Ask about this
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
