"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { ArrowRight, Check, CornerDownRight, Lock, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Confidence } from "./AIBadge";

// A data-health fix: what changes, why, how sure, and who proposed it. Money and legal fixes are
// locked to a person with the right role (plan addendum 3); safe ones can be applied in bulk.

export type FixChange = { field: string; label?: string; before: unknown; after: unknown };

export type FixPreviewProps = {
  title: string;                         // "Lease end is before lease start"
  rule?: string;                         // RuleKey, e.g. "leases.end_before_start"; never shown
  changes: FixChange[];
  why: string[];
  confidence: number;
  source: "rule" | string;               // "rule" or the agent that proposed it
  needsPerson?: string | null;           // reason the fix can't be one-click: "Moves money: needs an accountant"
  nextStep?: { text: string; href?: string; label?: string }; // what a person does when there are no field changes
  onApply?: () => void | Promise<unknown>;
  onDismiss?: () => void | Promise<unknown>;
  className?: string;
};

const show = (v: unknown) => (v == null || v === "" ? <span className="italic text-muted-foreground">empty</span> : typeof v === "object" ? JSON.stringify(v) : String(v));

export function FixPreview({ title, changes, why, confidence, source, needsPerson, nextStep, onApply, onDismiss, className }: FixPreviewProps) {
  const [state, setState] = useState<"open" | "applied" | "queued" | "dismissed">("open");
  const [busy, setBusy] = useState(false);
  // The server decides whether a fix applied or went to the approvals inbox: onApply may return { queued }.
  const act = async (k: "applied" | "dismissed") => {
    setBusy(true);
    try {
      const r = await (k === "applied" ? onApply : onDismiss)?.();
      setState(k === "applied" && (r as { queued?: boolean } | undefined)?.queued ? "queued" : k);
    } finally { setBusy(false); }
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <div className="flex items-start gap-2 border-b px-3 py-2.5">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-tone-ai" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
            <span>Proposed by {source === "rule" ? "a fixed rule" : source}</span>
          </div>
        </div>
        <Confidence value={confidence} className="self-center" />
      </div>

      {changes.length > 0 && <table className="w-full border-b text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="w-1/4 px-3 py-1.5 font-medium">Field</th>
            <th className="px-3 py-1.5 font-medium">Before</th>
            <th className="w-4" />
            <th className="px-3 py-1.5 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field} className="border-t">
              <td className="px-3 py-1.5 text-muted-foreground">{c.label ?? c.field}</td>
              <td className="px-3 py-1.5"><span className="rounded bg-tone-danger/[0.08] px-1 py-px text-tone-danger line-through decoration-tone-danger/50 tabular-nums">{show(c.before)}</span></td>
              <td><ArrowRight className="size-3 text-muted-foreground" /></td>
              <td className="px-3 py-1.5"><span className="rounded bg-tone-success/10 px-1 py-px font-medium text-tone-success tabular-nums">{show(c.after)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>}

      <ul className="flex flex-col gap-1 px-3 py-2 text-[12.5px] text-muted-foreground">
        {why.map((w) => <li key={w} className="flex gap-1.5"><CornerDownRight className="mt-0.5 size-3 shrink-0 opacity-60" />{w}</li>)}
      </ul>

      {!onApply && (
        <div className="border-t px-3 py-2 text-[12.5px]">
          <p className="font-medium">No automatic fix — a person needs to check this.</p>
          {nextStep && <p className="mt-0.5 text-muted-foreground">{nextStep.text}{nextStep.href && <> <Link href={nextStep.href} className="font-medium text-primary hover:underline">{nextStep.label ?? "Open the record"}</Link></>}</p>}
        </div>
      )}

      <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2">
        {state === "open" ? (
          <>
            {needsPerson ? <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-tone-warning"><Lock className="size-3 shrink-0" /><span className="truncate">{needsPerson}</span></span>
              : changes.length > 0 ? <span className="text-[12px] text-muted-foreground">Logged to the audit trail with before and after values.</span> : null}
            <div className="ml-auto flex gap-1">
              {onDismiss && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("dismissed")}><X /> Dismiss</Button>}
              {onApply && <Button size="sm" disabled={busy} variant={needsPerson ? "outline" : "default"} onClick={() => void act("applied")}>{needsPerson ? <><Lock /> Send for approval</> : <><Check /> Apply fix</>}</Button>}
            </div>
          </>
        ) : (
          <span className={cn("flex items-center gap-1.5 text-[12px] font-medium", state === "applied" ? "text-tone-success" : "text-muted-foreground")}>
            {state === "applied" ? <><Check className="size-3.5" />Fix applied · logged</> : state === "queued" ? <><Lock className="size-3.5" />Sent for approval</> : <><X className="size-3.5" />Dismissed</>}
          </span>
        )}
      </div>
    </div>
  );
}
