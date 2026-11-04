"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { modelName } from "@/components/app/ai/model";
import { formatRelative } from "@/lib/format";
import type { AiSummary } from "./peek";

// The AI summary card on the record page and in the peek drawer. When no model has written a
// summary for the record's current figures (none, or only the rules sentence), "Summarize with AI"
// calls the summary API (same scope checks, AI rate limit, figure checks and rules fallback), which
// stores the result in the visitor's workspace, so a reload shows it. "Ask about this" is in the header.
export function RecordSummary({ entity, id, label, initial, heading: H = "h2" }: {
  entity: string; id: string; label: string; initial: AiSummary | null; heading?: "h2" | "h3";
}) {
  const [made, setMade] = useState<AiSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = made ?? initial;
  const offer = !made && (!summary || summary.source === "rules");

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
        : <p className="mt-1.5 text-[12.5px] text-muted-foreground">No summary yet for this {label.toLowerCase()}.</p>}
      {error && <p role="alert" className="mt-1.5 text-[12px] text-tone-danger">{error}</p>}
      {offer && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void summarize()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin text-tone-ai motion-reduce:animate-none" /> : <Sparkles className="text-tone-ai" />}
          {busy ? "Summarizing…" : "Summarize with AI"}
        </Button>
      )}
    </section>
  );
}
