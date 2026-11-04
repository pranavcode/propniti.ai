"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { Check, CornerDownRight, Pencil, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RelativeDate } from "../display";
import { AIBadge, Confidence, type AISource } from "./AIBadge";

export type Evidence = { label: string; href?: string };

export type AISuggestionProps = {
  title: React.ReactNode;                // "Suggested: Plumbing · Urgent · Reliant Plumbing"
  why: string[];
  confidence: number;                    // 0–1
  evidence?: Evidence[];
  source?: AISource;
  model?: string;
  generatedAt?: string;
  onAccept?: () => void | Promise<unknown>;
  onEdit?: () => void;
  onReject?: () => void | Promise<unknown>;
  acceptLabel?: string;                  // verb: "Assign vendor", "Apply fix"
  state?: "open" | "accepted" | "rejected";
  className?: string;
};

// Inline suggestion inside a workflow (Linear triage pattern): what, why, how sure, from what.
export function AISuggestion({ title, why, confidence, evidence = [], source = "live", model, generatedAt, onAccept, onEdit, onReject, acceptLabel = "Accept", state: given, className }: AISuggestionProps) {
  const [local, setLocal] = useState<"open" | "accepted" | "rejected">("open");
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const state = given ?? local;
  const act = async (kind: "accept" | "reject") => {
    setBusy(kind);
    try { await (kind === "accept" ? onAccept : onReject)?.(); setLocal(kind === "accept" ? "accepted" : "rejected"); }
    finally { setBusy(null); }
  };

  if (state !== "open") {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[12.5px] text-muted-foreground", className)}>
        {state === "accepted" ? <Check className="size-3.5 text-tone-success" /> : <X className="size-3.5" />}
        <span className="min-w-0 flex-1 truncate">{state === "accepted" ? "Accepted" : "Dismissed"}: <span className="text-foreground">{title}</span></span>
        {!given && <button onClick={() => setLocal("open")} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"><Undo2 className="size-3" /> Undo</button>}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-tone-ai/25 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--tone-ai)_5%,var(--card)),var(--card)_70%)]", className)}>
      <span className="absolute inset-y-0 left-0 w-0.5 bg-tone-ai/70" aria-hidden />
      <div className="flex flex-col gap-2.5 py-3 pr-3 pl-3.5">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-tone-ai" />
          <div className="min-w-0 flex-1 font-medium leading-snug">{title}</div>
          <AIBadge source={source} model={model} size="xs" />
        </div>
        {why.length > 0 && (
          <ul className="flex flex-col gap-1 pl-5.5 text-[12.5px] text-muted-foreground">
            {why.map((w) => <li key={w} className="flex gap-1.5"><CornerDownRight className="mt-0.5 size-3 shrink-0 opacity-60" />{w}</li>)}
          </ul>
        )}
        {evidence.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pl-5.5">
            <span className="text-[11px] text-muted-foreground">Looked at</span>
            {evidence.map((e) => e.href
              ? <Link key={e.label} href={e.href} className="rounded border bg-background px-1.5 py-px text-[11.5px] hover:border-primary/40 hover:text-primary">{e.label}</Link>
              : <span key={e.label} className="rounded border bg-background px-1.5 py-px text-[11.5px]">{e.label}</span>)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pl-5.5">
          <Confidence value={confidence} />
          {generatedAt && <span className="text-[11px] text-muted-foreground">· <RelativeDate value={generatedAt} /></span>}
          <div className="ml-auto flex items-center gap-1">
            {onReject && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("reject")}><X /> Reject</Button>}
            {onEdit && <Button size="sm" variant="outline" disabled={!!busy} onClick={onEdit}><Pencil /> Edit</Button>}
            {onAccept && <Button size="sm" disabled={!!busy} onClick={() => void act("accept")}><Check /> {acceptLabel}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
