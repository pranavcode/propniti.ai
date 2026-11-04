"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { Bot, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Autonomy } from "@/ai/types";
import { RelativeDate } from "../display";
import { modelName } from "./model";

export type AgentStatus = "idle" | "running" | "waiting_approval" | "failed" | "paused";

export type AgentCardProps = {
  name: string;
  goal: string;
  icon?: React.ReactNode;
  status: AgentStatus;
  lastRun?: string | null;
  nextRun?: string | null;
  successRate?: number;                  // 0–1 over the last 30 days
  proposed?: number;
  approved?: number;
  autoApplied?: number;
  autonomy: Autonomy;
  enabled?: boolean;
  href?: string;                         // agent detail / runs
  model?: string;
  onToggle?: (enabled: boolean) => void;
  onRunNow?: () => void | Promise<unknown>;
  className?: string;
};

const STATUS: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  idle: { label: "Idle", dot: "bg-tone-success", text: "text-muted-foreground" },
  running: { label: "Running", dot: "bg-tone-ai animate-pulse motion-reduce:animate-none", text: "text-tone-ai" },
  waiting_approval: { label: "Waiting on approval", dot: "bg-tone-warning", text: "text-tone-warning" },
  failed: { label: "Last run failed", dot: "bg-tone-danger", text: "text-tone-danger" },
  paused: { label: "Paused", dot: "bg-tone-neutral", text: "text-muted-foreground" },
};

// Two levels. A saved "suggest" shows as "Approve first", as in the Agents center.
const AUTONOMY: { key: Autonomy; label: string; tip: string }[] = [
  { key: "act_with_approval", label: "Approve first", tip: "Prepares actions; a person approves each one." },
  { key: "auto_within_policy", label: "Auto within policy", tip: "Acts on its own below the approval-policy limits; anything above goes to a person." },
];

export function AutonomyMeter({ value, className }: { value: Autonomy; className?: string }) {
  const idx = AUTONOMY.findIndex((a) => a.key === (value === "suggest" ? "act_with_approval" : value));
  return (
    <div className={cn("inline-flex rounded-md border bg-muted/40 p-0.5", className)} role="img" aria-label={`Autonomy: ${AUTONOMY[idx]?.label}`}>
      {AUTONOMY.map((a, i) => (
        <Tooltip key={a.key}>
          <TooltipTrigger asChild>
            <span className={cn("rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium", i === idx ? "bg-background text-tone-ai shadow-xs ring-1 ring-tone-ai/25" : i < idx ? "text-tone-ai/70" : "text-muted-foreground/70")}>{a.label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-56">{a.tip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export function AgentCard({ name, goal, icon, status, lastRun, nextRun, successRate, proposed = 0, approved = 0, autoApplied = 0, autonomy, enabled = true, href, model, onToggle, onRunNow, className }: AgentCardProps) {
  const [on, setOn] = useState(enabled);
  const [running, setRunning] = useState(false);
  const st = STATUS[running ? "running" : on ? status : "paused"];
  const run = async () => { setRunning(true); try { await onRunNow?.(); } finally { setRunning(false); } };
  const pct = successRate != null ? Math.round(successRate * 100) : null;

  return (
    <article className={cn("flex flex-col rounded-lg border bg-card transition-colors", !on && "bg-muted/30", className)}>
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset [&_svg]:size-4", on ? "bg-tone-ai/[0.08] text-tone-ai ring-tone-ai/20" : "bg-muted text-muted-foreground ring-border")}>{icon ?? <Bot />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {href ? <Link href={href} className="truncate font-semibold hover:underline">{name}</Link> : <span className="truncate font-semibold">{name}</span>}
          </div>
          <div className={cn("mt-0.5 flex items-center gap-1.5 text-[12px]", st.text)}><span className={cn("size-1.5 rounded-full", st.dot)} />{st.label}</div>
        </div>
        <Switch className="self-center" checked={on} onCheckedChange={(v) => { setOn(v); onToggle?.(v); }} aria-label={`${on ? "Pause" : "Enable"} ${name}`} />
      </div>
      <p className="line-clamp-2 px-4 text-[12.5px] text-muted-foreground">{goal}</p>

      <dl className="mt-3 grid grid-cols-3 border-y text-center">
        {[["Proposed", proposed], ["Approved", approved], ["Auto-applied", autoApplied]].map(([l, v]) => (
          <div key={l as string} className="border-r py-2 last:border-0">
            <dd className="text-[15px] font-semibold tabular-nums">{formatNumber(v as number)}</dd>
            <dt className="text-[11px] text-muted-foreground">{l}</dt>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2.5 p-4 pt-3 text-[12px]">
        {pct != null && (
          <div className="flex items-center gap-2">
            <span className="w-20 text-muted-foreground">Success</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", pct >= 90 ? "bg-tone-success" : pct >= 75 ? "bg-tone-warning" : "bg-tone-danger")} style={{ width: `${pct}%` }} /></span>
            <span className="w-9 text-right font-medium tabular-nums">{pct}%</span>
          </div>
        )}
        <div className="flex items-center gap-2"><span className="w-20 text-muted-foreground">Autonomy</span><AutonomyMeter value={autonomy} /></div>
        <div className="flex items-center gap-2"><span className="w-20 text-muted-foreground">Last run</span>{lastRun ? <RelativeDate value={lastRun} /> : <span className="text-muted-foreground">Never</span>}</div>
        <div className="flex items-center gap-2"><span className="w-20 text-muted-foreground">Next run</span>{on && nextRun ? <RelativeDate value={nextRun} /> : <span className="text-muted-foreground">{on ? "On events" : "Paused"}</span>}</div>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t px-4 py-2.5">
        {model && <span className="truncate text-[11px] text-muted-foreground" title={model}>{modelName(model)}</span>}
        <Button size="sm" variant="outline" className="ml-auto" disabled={!on || running || !onRunNow} onClick={() => void run()}>
          {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? "Running…" : "Run now"}
        </Button>
      </div>
    </article>
  );
}
