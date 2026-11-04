"use client";

import Link from "@/components/Link";
import { useId } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCountDelta, formatDelta } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Term } from "../Term";
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
  actions?: React.ReactNode;           // header buttons beside the drill arrow, e.g. "Explain"
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

// The one KPI tile layout, shared by KpiCard and the entity Metrics tile. Fixed rows: a label that
// wraps to two lines (the row is always two lines tall), the value, an optional footnote, and the
// delta with its sparkline pinned to the bottom. Values sit at the same height in every tile, and
// tiles in a grid row stretch to one height.
// The full text of a truncated value or footnote, on hover.
const plain = (n: React.ReactNode) => (typeof n === "string" || typeof n === "number" ? String(n) : undefined);

export function KpiFrame({ label, linkLabel, href, onClick, aside, value, footnote, delta, spark, className }: {
  label: React.ReactNode;
  linkLabel: string;                   // accessible name of the drill link
  href?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  aside?: React.ReactNode;             // header extras beside the drill arrow
  value: React.ReactNode;
  footnote?: React.ReactNode;
  delta?: React.ReactNode;
  spark?: React.ReactNode;
  className?: string;
}) {
  // The whole tile drills through a link stretched over it, so header buttons (Explain, the
  // definition tip) can sit in the same row without nesting interactive elements in a link.
  return (
    <div data-kpi className={cn("group/kpi @container/kpi relative flex h-full min-w-0 flex-col rounded-lg border bg-card p-4 transition-[border-color,box-shadow]", href && "hover:border-foreground/20 hover:shadow-[0_1px_3px_oklch(0_0_0/0.06)] has-[>a:focus-visible]:ring-2 has-[>a:focus-visible]:ring-ring/60", className)}>
      {href && <Link href={href} onClick={onClick} aria-label={linkLabel} className="absolute inset-0 rounded-lg outline-none" />}
      <div className="-mt-1 flex h-8 items-start gap-1.5 text-[12px] leading-4 font-medium text-muted-foreground">
        <span className="line-clamp-2 min-w-0 pt-px [&_[data-term]>span]:whitespace-normal">{label}</span>
        {(aside || href) && (
          <span className="ml-auto flex h-4 shrink-0 items-center gap-1">
            {aside && <span className="relative z-10 flex items-center">{aside}</span>}
            {href && <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground/50 transition-colors group-hover/kpi:text-foreground" />}
          </span>
        )}
      </div>
      <div data-kpi-value title={plain(value)} className="mt-1 truncate text-[22px] leading-7 font-semibold tracking-[-0.015em] tabular-nums">{value}</div>
      {footnote && <div title={plain(footnote)} className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{footnote}</div>}
      <div className="mt-auto flex min-h-9 items-end justify-between gap-2 pt-2">
        {delta ?? <span />}
        {spark}
      </div>
    </div>
  );
}

export function KpiCard({ label, value, format = "count", previous, deltaLabel = "vs last month", goodWhen = "up", spark, help, href, loading, footnote, actions, className }: KpiCardProps) {
  if (loading) {
    return (
      <div className={cn("flex h-full flex-col rounded-lg border bg-card p-4", className)} aria-busy>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-6 h-6 w-28" />
        <div className="mt-auto flex items-end justify-between pt-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-6 w-24" /></div>
      </div>
    );
  }
  const delta = value != null && previous != null ? (format === "count" ? formatCountDelta(value, previous) : formatDelta(value, previous)) : null;
  const up = value != null && previous != null && value >= previous;
  const good = delta ? (up ? goodWhen === "up" : goodWhen === "down") : null;
  const flat = value != null && previous != null && value === previous;

  return (
    <KpiFrame
      className={className}
      label={<Term help={help} className="relative z-10">{label}</Term>}
      linkLabel={`${label}: open the records behind this number`}
      href={href}
      aside={actions}
      value={formatValue(value, format)}
      footnote={footnote}
      delta={delta ? (
        <span className="flex min-w-0 items-center gap-1 text-[12px]">
          <span className={cn("inline-flex shrink-0 items-center rounded px-1 font-medium whitespace-nowrap tabular-nums", flat ? "bg-muted text-muted-foreground" : good ? "bg-tone-success/10 text-tone-success" : "bg-tone-danger/10 text-tone-danger")}>
            {flat ? "▬" : up ? "▲" : "▼"} {delta.replace(/^[+−]/, "")}
          </span>
          <span className="truncate text-muted-foreground">{deltaLabel}</span>
        </span>
      ) : undefined}
      spark={spark ? <Sparkline className="shrink-0 @max-[10rem]/kpi:hidden" data={spark} tone={good == null || flat ? "neutral" : good ? "good" : "bad"} /> : undefined}
    />
  );
}
