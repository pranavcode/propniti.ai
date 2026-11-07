"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { AIBadge } from "@/components/app/ai/AIBadge";
import { cn } from "@/lib/utils";
import type { BvaType, Explanation } from "./data";

// "Explain a variance": a ✦ click posts to /api/ai/budget-explain (AI rate limit). Nothing here is a
// link, so a page load or prefetch never asks the model.

type Ask = { year: number; type: BvaType; property: string | null };
type State = { key: string | null; loading: boolean; explanation: Explanation | null; error: string | null };
const ExplainCtx = createContext<{ state: State; explain: (key: string) => void } | null>(null);

export function ExplainProvider({ ask, children }: { ask: Ask; children: ReactNode }) {
  const [state, setState] = useState<State>({ key: null, loading: false, explanation: null, error: null });
  const explain = async (key: string) => {
    setState({ key, loading: true, explanation: null, error: null });
    // A later click wins; a slower earlier answer is dropped.
    const done = (next: Omit<State, "key" | "loading">) => setState((s) => (s.key === key ? { key, loading: false, ...next } : s));
    try {
      const res = await fetch("/api/ai/budget-explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...ask, key }) });
      const body = (await res.json().catch(() => ({}))) as { explanation?: Explanation; error?: string };
      done(res.ok && body.explanation ? { explanation: body.explanation, error: null } : { explanation: null, error: body.error ?? "Couldn't explain that variance. Try again." });
    } catch {
      done({ explanation: null, error: "Couldn't reach the server. Try again." });
    }
  };
  return <ExplainCtx.Provider value={{ state, explain }}>{children}</ExplainCtx.Provider>;
}

const useExplain = () => useContext(ExplainCtx)!;

export function ExplainButton({ rowId, label }: { rowId: string; label: string }) {
  const { state, explain } = useExplain();
  const active = state.key?.split("@")[0] === rowId;
  return (
    <button type="button" onClick={() => explain(rowId)} aria-label={`Explain the variance for ${label}`} title="Explain this variance"
      className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded text-tone-ai opacity-50 hover:bg-tone-ai/10 hover:opacity-100", active && "opacity-100")}>
      <Sparkles className="size-3" />
    </button>
  );
}

// worst: per row id, the closed months furthest off budget, as [YYYY-MM, label].
export function ExplainPanel({ worst }: { worst: Record<string, [string, string][]> }) {
  const { state, explain } = useExplain();
  const { explanation: e, key } = state;
  const rowId = key?.split("@")[0];
  return (
    <section className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.03] p-3" aria-live="polite" aria-busy={state.loading}>
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="size-3.5 text-tone-ai" />Explain a variance</h2>
      {state.loading ? (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">Reading the ledger and bills…</p>
      ) : state.error ? (
        <p className="mt-1.5 text-[12.5px] text-tone-danger">{state.error}</p>
      ) : e ? (
        <>
          <div className="mt-1 flex items-start justify-between gap-2">
            <p className="text-[12.5px] font-medium">{e.title}</p>
            <AIBadge source={e.source} model={e.model} size="xs" />
          </div>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed">{e.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          {rowId && !key?.includes("@") && worst[rowId]?.length ? (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
              Months to look at:
              {worst[rowId].map(([m, label]) => <button type="button" key={m} onClick={() => explain(`${rowId}@${m}`)} className="rounded border bg-card px-1.5 py-0.5 text-foreground hover:border-tone-ai/50">{label}</button>)}
            </p>
          ) : null}
          <details className="mt-2 text-[11.5px] text-muted-foreground">
            <summary className="cursor-pointer select-none">Facts used</summary>
            <dl className="mt-1 space-y-0.5">{Object.entries(e.facts).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="shrink-0 text-muted-foreground">{k.replace(/_/g, " ")}</dt><dd className="min-w-0 text-foreground">{String(v)}</dd></div>)}</dl>
          </details>
        </>
      ) : (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">Pick ✦ on any row to see why it&apos;s off budget. The figures come from the ledger and the bills behind it; the AI only words them.</p>
      )}
    </section>
  );
}
