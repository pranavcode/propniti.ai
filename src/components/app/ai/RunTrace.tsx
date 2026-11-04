"use client";

import { useId, useState } from "react";
import { AlertCircle, Brain, ChevronRight, FileOutput, ListChecks, Loader2, MessageSquare, Send, Wrench } from "lucide-react";
import Link from "@/components/Link";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber, formatTime } from "@/lib/format";
import { useMounted } from "@/hooks/use-mounted";
import { runStatusLabel } from "@/ai/ui/labels";
import { describeSteps, type Part, type TraceRefs, type TraceRow } from "@/ai/trace";
import type { RunStatus, Step, StepKind } from "@/ai/types";
import { StatusBadge } from "../display";
import { modelName } from "./model";

// One agent run (agent_runs + agent_steps) in plain words: each row is a sentence built from the
// step data, with the records it touched linked by name. The raw input and output, durations and
// tokens sit under "Technical details" on each row. `live` marks the run as still streaming: the
// last row pulses and a "Running…" row follows.

export type TraceStep = Step & { tokens?: number; summary?: string };

export type RunTraceProps = {
  steps: TraceStep[];
  refs?: TraceRefs;                     // record names and links, from the server (src/ai/views.ts)
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
  tool_result: { label: "Tool result", icon: FileOutput, cls: "text-muted-foreground bg-muted" },
  reasoning_summary: { label: "Model reasoning", icon: Brain, cls: "text-tone-ai bg-tone-ai/10" },
  proposal: { label: "Proposal", icon: Send, cls: "text-tone-warning bg-tone-warning/12" },
  message: { label: "Message", icon: MessageSquare, cls: "text-foreground bg-muted" },
};
const kindOf = (k: string) => KIND[k as StepKind] ?? KIND.message;

const STATUS_TONE: Record<RunStatus, "info" | "ai" | "warning" | "success" | "danger"> = { queued: "info", running: "ai", waiting_approval: "warning", done: "success", failed: "danger" };
const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

export function RunTrace({ steps, refs, agent, status, model, tokensIn, tokensOut, costCents, live, compact, className }: RunTraceProps) {
  const totalMs = steps.reduce((a, s) => a + (s.latencyMs ?? 0), 0);
  const rows = describeSteps(steps, refs, { model, live });
  const tokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      {!compact && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-[12px]">
          {agent && <span className="font-semibold">{agent}</span>}
          {status && <StatusBadge value={status} label={runStatusLabel(status)} tone={live ? "ai" : STATUS_TONE[status]} />}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 text-muted-foreground tabular-nums">
            {model && model !== "…" && <span title={model}>{model === "rules" ? "Rules, no model" : modelName(model)}</span>}
            {tokens > 0 && <span title={`${formatNumber(tokensIn ?? 0)} tokens in · ${formatNumber(tokensOut ?? 0)} out`}>{formatNumber(tokens)} tokens</span>}
            {costCents != null && <span title="Model cost">{formatMoney(costCents / 100)}</span>}
            <span title="Time spent in steps">{(totalMs / 1000).toFixed(1)} s</span>
            <span>{rows.length} {rows.length === 1 ? "step" : "steps"}</span>
          </span>
        </div>
      )}
      <ol className="relative py-1">
        {rows.map((r, i) => <TraceRowItem key={r.main.idx} row={r} last={i === rows.length - 1 && !live} pulsing={!!live && i === rows.length - 1} />)}
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

function SentenceParts({ parts }: { parts: Part[] }) {
  return parts.map((p, i) =>
    typeof p === "string" ? <span key={i}>{p}</span> : p.href ? <Link key={i} href={p.href} className="font-medium text-primary hover:underline">{p.text}</Link> : <span key={i} className="font-medium">{p.text}</span>,
  );
}

function TraceRowItem({ row, last, pulsing }: { row: TraceRow; last: boolean; pulsing: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const main = row.main;
  const k = row.main.toolKey?.startsWith("model.") ? KIND.reasoning_summary : kindOf(main.kind);
  const failed = row.status === "failed";
  const Icon = failed ? AlertCircle : k.icon;
  return (
    <li className="relative" data-trace-row>
      {!last && <span className="absolute top-8 bottom-0 left-[23px] w-px bg-border" aria-hidden />}
      <div className="flex w-full items-start gap-2.5 px-3 py-1.5">
        <span className={cn("relative z-[1] mt-px flex size-6 shrink-0 items-center justify-center rounded-md ring-2 ring-card", failed ? "bg-tone-danger/10 text-tone-danger" : k.cls)} title={k.label}>
          <Icon className="size-3.5" />
          {pulsing && <span className="absolute inset-0 animate-ping rounded-md bg-tone-ai/30 motion-reduce:hidden" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[12.5px] leading-snug", failed && "text-tone-danger")}><SentenceParts parts={row.sentence.parts} /></p>
          {row.sentence.quote && <p className="mt-1 line-clamp-3 border-l-2 pl-2 text-[12px] whitespace-pre-line text-muted-foreground">{row.sentence.quote}</p>}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={id}
            className="mt-0.5 inline-flex items-center gap-0.5 rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRight className={cn("size-3 transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
            Technical details
          </button>
          {open && (
            <div id={id} className="mt-1 flex flex-col gap-2 pb-1">
              {row.steps.map((s) => <StepDetails key={s.idx} step={s} />)}
            </div>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground tabular-nums"><StepTime at={main.at} /></span>
      </div>
    </li>
  );
}

function StepDetails({ step }: { step: TraceRow["steps"][number] }) {
  const facts = [`Step ${step.idx + 1}`, kindOf(step.kind).label, step.ok ? null : "failed", step.latencyMs != null ? ms(step.latencyMs) : null, step.tokens != null ? `${formatNumber(step.tokens)} tokens` : null].filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground tabular-nums">
        <span>{facts.join(" · ")}</span>
        {step.toolKey && <code className="rounded bg-muted px-1 font-mono text-[11px]">{step.toolKey}</code>}
      </div>
      {step.input !== undefined && <Json label="Input" value={step.input} />}
      {step.output !== undefined && <Json label="Output" value={step.output} />}
    </div>
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
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
  const long = text.length > LIMIT;
  return (
    <div className="overflow-hidden rounded-md border bg-muted/40">
      <div className="flex items-center justify-between border-b px-2 py-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {long && <button type="button" onClick={() => setAll((a) => !a)} className="normal-case tracking-normal text-primary hover:underline">{all ? "Show less" : `Show all (${formatNumber(text.length)} chars)`}</button>}
      </div>
      <pre className="max-h-72 overflow-auto p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{all || !long ? text : `${text.slice(0, LIMIT)}\n…`}</pre>
    </div>
  );
}
