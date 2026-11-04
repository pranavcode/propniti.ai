"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { modelName } from "@/components/app/ai/model";
import { useShellMaybe } from "@/components/app/shell/context";
import { formatRelative } from "@/lib/format";
import type { AiSummary } from "./peek";

// The AI summary card on the record page and in the peek drawer. A record with no stored summary
// offers "Summarize with AI", which calls the summary API (same scope checks, AI rate limit, figure
// checks and rules fallback) and stores the result in the visitor's workspace, so a reload shows it.
export function RecordSummary({ entity, id, title, label, initial, heading: H = "h2", onAsk }: {
  entity: string; id: string; title: string; label: string; initial: AiSummary | null; heading?: "h2" | "h3"; onAsk?: () => void;
}) {
  const shell = useShellMaybe();
  const [made, setMade] = useState<AiSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = made ?? initial;

  const summarize = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.summary) throw new Error(body.error ?? "The summary couldn't be written. Try again.");
      setMade(body.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The summary couldn't be written. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04] p-3" aria-busy={busy}>
      <H className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Sparkles className="size-3.5 text-tone-ai" />AI summary</H>
      {summary
        ? <>
            <p className="mt-1.5 text-[13px] leading-relaxed">{summary.summary}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{summary.source === "rules" ? "Rules · from this record's current figures" : `${summary.source === "live" ? "Generated" : "Precomputed"} · ${modelName(summary.model)} · ${formatRelative(summary.generated_at)}`}</p>
          </>
        : <>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">No summary yet for this {label.toLowerCase()}.</p>
            {error && <p role="alert" className="mt-1.5 text-[12px] text-tone-danger">{error}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Button size="sm" variant="outline" onClick={() => void summarize()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin text-tone-ai motion-reduce:animate-none" /> : <Sparkles className="text-tone-ai" />}
                {busy ? "Summarizing…" : "Summarize with AI"}
              </Button>
              {shell && (
                <button type="button" onClick={() => { onAsk?.(); shell.assistant.ask(`Tell me about ${title}`, { entity, id, title }); }}
                  className="text-[12px] font-medium text-tone-ai hover:underline">Ask about this</button>
              )}
            </div>
          </>}
    </section>
  );
}
