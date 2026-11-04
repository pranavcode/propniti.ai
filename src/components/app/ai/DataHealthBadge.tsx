"use client";

import { AlertTriangle, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// Data-health state of one record, from its open data_issues rows. Compact form is a table cell.
export type HealthIssue = { id: string; rule: string; severity: "info" | "warn" | "critical"; summary: string };

export function DataHealthBadge({ issues, compact, onFix, className }: { issues: HealthIssue[] | number; compact?: boolean; onFix?: (issue?: HealthIssue) => void; className?: string }) {
  const list = Array.isArray(issues) ? issues : [];
  const n = Array.isArray(issues) ? issues.length : issues;
  const critical = list.some((i) => i.severity === "critical");

  if (!n) {
    return compact
      ? <span className={cn("inline-block size-1.5 rounded-full bg-tone-success/40", className)} aria-label="No data issues" title="No data issues" />
      : <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md bg-tone-success/8 px-2 text-[12px] font-medium text-tone-success ring-1 ring-tone-success/15 ring-inset", className)}><ShieldCheck className="size-3.5" /> Data healthy</span>;
  }

  const Icon = critical ? ShieldAlert : AlertTriangle;
  const tone = critical ? "text-tone-danger bg-tone-danger/8 ring-tone-danger/20" : "text-tone-warning bg-tone-warning/10 ring-tone-warning/25";
  const badge = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onFix?.(list[0]); }}
      className={cn("inline-flex items-center gap-1 rounded-md font-medium ring-1 ring-inset", compact ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-[12px]", tone, className)}
    >
      <Icon className="size-3.5" />
      {compact ? n : `${n} data ${n === 1 ? "issue" : "issues"}`}
    </button>
  );
  if (!list.length) return badge;
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>{badge}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-[12px] font-medium">Data health · {n} open</div>
        <ul className="divide-y">
          {list.slice(0, 4).map((i) => (
            <li key={i.id} className="flex items-start gap-2 px-3 py-2">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", i.severity === "critical" ? "bg-tone-danger" : i.severity === "warn" ? "bg-tone-warning" : "bg-tone-info")} />
              <div className="min-w-0 flex-1">
                <div className="leading-snug">{i.summary}</div>
                <div className="font-mono text-[10.5px] text-muted-foreground">{i.rule}</div>
              </div>
              {onFix && <button onClick={() => onFix(i)} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-primary hover:bg-primary/10"><Sparkles className="size-3" /> Fix</button>}
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
