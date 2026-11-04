"use client";

import Link from "@/components/Link";
import { useId } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDelta } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatValue } from "./fmt";
import type { ValueFormat } from "./types";

export type KpiCardProps = {
  label: string;
  value: number | null;
  format?: ValueFormat;
  previous?: number | null;            // value last period; drives the delta
  deltaLabel?: string;                 // "vs last month"
  goodWhen?: "up" | "down";
  spark?: number[];                    // oldest → newest
  help?: string;
  href?: string;                       // drill to the rows behind the number
  loading?: boolean;
  footnote?: React.ReactNode;          // small line under the value: "of $1.42M scheduled"
  className?: string;
};

export function Sparkline({ data, tone = "neutral", className, width = 96, height = 28 }: { data: number[]; tone?: "good" | "bad" | "neutral"; className?: string; width?: number; height?: number }) {
  const id = useId();
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const color = tone === "good" ? "var(--tone-success)" : tone === "bad" ? "var(--tone-danger)" : "var(--chart-1)";
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn("overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.25" fill={color} />
    </svg>
  );
}

export function KpiCard({ label, value, format = "count", previous, deltaLabel = "vs last month", goodWhen = "up", spark, help, href, loading, footnote, className }: KpiCardProps) {
  if (loading) {
    return (
      <div className={cn("rounded-lg border bg-card p-4", className)} aria-busy>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-6 w-28" />
        <div className="mt-3 flex items-end justify-between"><Skeleton className="h-3 w-20" /><Skeleton className="h-6 w-24" /></div>
      </div>
    );
  }
  const delta = value != null && previous != null ? formatDelta(value, previous) : null;
  const up = value != null && previous != null && value >= previous;
  const good = delta ? (up ? goodWhen === "up" : goodWhen === "down") : null;
  const flat = value != null && previous != null && value === previous;

  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {help && (
          <Tooltip>
            <TooltipTrigger asChild><span tabIndex={0} onClick={(e) => e.preventDefault()} className="text-muted-foreground/60 hover:text-foreground"><Info className="size-3" /></span></TooltipTrigger>
            <TooltipContent className="max-w-64">{help}</TooltipContent>
          </Tooltip>
        )}
        {href && <ArrowUpRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover/kpi:opacity-60" />}
      </div>
      <div className="mt-1.5 text-[22px] leading-7 font-semibold tracking-[-0.015em] tabular-nums">{formatValue(value, format)}</div>
      {footnote && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{footnote}</div>}
      <div className="mt-2 flex items-end justify-between gap-2">
        {delta ? (
          <span className="flex min-w-0 items-center gap-1 text-[12px]">
            <span className={cn("inline-flex items-center rounded px-1 font-medium tabular-nums", flat ? "bg-muted text-muted-foreground" : good ? "bg-tone-success/10 text-tone-success" : "bg-tone-danger/10 text-tone-danger")}>
              {flat ? "▬" : up ? "▲" : "▼"} {delta.replace(/^[+−]/, "")}
            </span>
            <span className="truncate text-muted-foreground">{deltaLabel}</span>
          </span>
        ) : <span />}
        {spark && <Sparkline data={spark} tone={good == null || flat ? "neutral" : good ? "good" : "bad"} />}
      </div>
    </>
  );
  const cls = cn("group/kpi block rounded-lg border bg-card p-4 transition-[border-color,box-shadow]", href && "hover:border-foreground/20 hover:shadow-[0_1px_3px_oklch(0_0_0/0.06)] focus-visible:ring-2 focus-visible:ring-ring/60 outline-none", className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
