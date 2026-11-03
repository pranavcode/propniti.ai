"use client";

import { useState } from "react";
import { AlertCircle, Brain, ChevronRight, FileOutput, ListChecks, Loader2, MessageSquare, Send, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber, formatTime } from "@/lib/format";
import { useMounted } from "@/hooks/use-mounted";
import type { RunStatus, Step, StepKind } from "@/ai/types";
import { StatusBadge } from "../display";

// Step-by-step view of one agent run (agent_runs + agent_steps). `live` marks the run as still
// streaming: the last step pulses and a "Running…" row follows.

export type TraceStep = Step & { tokens?: number; summary?: string };

export type RunTraceProps = {
  steps: TraceStep[];
  agent?: string;
  status?: RunStatus;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
  live?: boolean;
  compact?: boolean;                    // assistant dock: no header
  className?: string;
};

const KIND: Record<StepKind, { label: string; icon: typeof Wrench; cls: string }> = {
  plan: { label: "Plan", icon: ListChecks, cls: "text-tone-ai bg-tone-ai/10" },
  tool_call: { label: "Tool call", icon: Wrench, cls: "text-tone-info bg-tone-info/10" },
  tool_result: { label: "Result", icon: FileOutput, cls: "text-muted-foreground bg-muted" },
  reasoning_summary: { label: "Reasoning", icon: Brain, cls: "text-tone-ai bg-tone-ai/10" },
  proposal: { label: "Proposal", icon: Send, cls: "text-tone-warning bg-tone-warning/12" },
  message: { label: "Answer", icon: MessageSquare, cls: "text-foreground bg-muted" },
};

const STATUS_TONE: Record<RunStatus, "info" | "ai" | "warning" | "success" | "danger"> = { queued: "info", running: "ai", waiting_approval: "warning", done: "success", failed: "danger" };

function stepTitle(s: TraceStep) {
  if (s.summary) return s.summary;
  if (s.toolKey) return s.toolKey;
  if (typeof s.output === "string") return s.output;
  if (s.output && typeof s.output === "object" && "text" in s.output) return String((s.output as { text: unknown }).text);
  return KIND[s.kind].label;
}

export function RunTrace({ steps, agent, status, model, tokensIn, tokensOut, costCents, live, compact, className }: RunTraceProps) {
  const totalMs = steps.reduce((a, s) => a + (s.latencyMs ?? 0), 0);
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      {!compact && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-[12px]">
          {agent && <span className="font-semibold">{agent}</span>}
          {status && <StatusBadge value={status === "waiting_approval" ? "Waiting approval" : status} tone={live ? "ai" : STATUS_TONE[status]} />}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 text-muted-foreground tabular-nums">
            {model && <span>{model}</span>}
            {(tokensIn != null || tokensOut != null) && <span title="Tokens in / out">{formatNumber(tokensIn ?? 0)} in · {formatNumber(tokensOut ?? 0)} out</span>}
            {costCents != null && <span>{formatMoney(costCents / 100)}</span>}
            <span>{(totalMs / 1000).toFixed(1)}s</span>
            <span>{steps.length} steps</span>
          </span>
        </div>
      )}
      <ol className="relative py-1">
        {steps.map((s, i) => <StepRow key={s.idx} step={s} last={i === steps.length - 1 && !live} pulsing={!!live && i === steps.length - 1} />)}
        {live && (
          <li className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-tone-ai">
            <span className="flex size-6 items-center justify-center"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /></span>
            Running…
          </li>
        )}
      </ol>
    </div>
  );
}

function StepRow({ step, last, pulsing }: { step: TraceStep; last: boolean; pulsing: boolean }) {
  const [open, setOpen] = useState(false);
  const k = KIND[step.kind];
  const Icon = step.ok ? k.icon : AlertCircle;
  const hasBody = step.input !== undefined || (step.output !== undefined && typeof step.output !== "string");
  return (
    <li className="relative">
      {!last && <span className="absolute top-8 bottom-0 left-[23px] w-px bg-border" aria-hidden />}
      <button
        type="button"
        onClick={() => hasBody && setOpen((o) => !o)}
        aria-expanded={hasBody ? open : undefined}
        className={cn("flex w-full items-start gap-2.5 px-3 py-1.5 text-left", hasBody && "hover:bg-muted/50")}
      >
        <span className={cn("relative z-[1] mt-px flex size-6 shrink-0 items-center justify-center rounded-md ring-2 ring-card", step.ok ? k.cls : "bg-tone-danger/10 text-tone-danger")}>
          <Icon className="size-3.5" />
          {pulsing && <span className="absolute inset-0 animate-ping rounded-md bg-tone-ai/30 motion-reduce:hidden" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{k.label}</span>
            {step.toolKey && step.summary && <code className="truncate rounded bg-muted px-1 font-mono text-[11px]">{step.toolKey}</code>}
          </span>
          <span className={cn("block text-[12.5px] leading-snug", step.kind === "tool_call" && !step.summary ? "font-mono text-[12px]" : "", !step.ok && "text-tone-danger")}>{stepTitle(step)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {step.tokens != null && <span>{formatNumber(step.tokens)} tok</span>}
          {step.latencyMs != null && <span>{step.latencyMs < 1000 ? `${step.latencyMs}ms` : `${(step.latencyMs / 1000).toFixed(1)}s`}</span>}
          <StepTime at={step.at} />
          {hasBody && <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pr-3 pb-2 pl-[46px]">
          {step.input !== undefined && <Json label="Input" value={step.input} />}
          {step.output !== undefined && typeof step.output !== "string" && <Json label="Output" value={step.output} />}
        </div>
      )}
    </li>
  );
}

const LIMIT = 900;
// Clock times depend on the viewer's time zone, so they render after hydration.
function StepTime({ at }: { at: string }) {
  const mounted = useMounted();
  return <span className="hidden min-w-[52px] sm:inline">{mounted ? formatTime(at) : ""}</span>;
}

function Json({ label, value }: { label: string; value: unknown }) {
  const [all, setAll] = useState(false);
  const text = JSON.stringify(value, null, 2) ?? "null";
  const long = text.length > LIMIT;
  return (
    <div className="overflow-hidden rounded-md border bg-muted/40">
      <div className="flex items-center justify-between border-b px-2 py-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {long && <button onClick={() => setAll((a) => !a)} className="normal-case tracking-normal text-primary hover:underline">{all ? "Show less" : `Show all (${formatNumber(text.length)} chars)`}</button>}
      </div>
      <pre className="max-h-72 overflow-auto p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{all || !long ? text : `${text.slice(0, LIMIT)}\n…`}</pre>
    </div>
  );
}
