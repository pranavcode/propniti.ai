"use client";

import { Building2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/entities/types";
import { formatDate, formatDue, formatFull, formatMoney, formatPct, formatRelative, initials, type DateInput, type MoneyStyle } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMounted } from "@/hooks/use-mounted";
import { humanize, TONE_CLASS, TONE_DOT, toneFor } from "./status";

// Small display atoms used by tables, record pages and dashboards. Every number is tabular.

export function StatusBadge({ value, tone, label, dot = true, className, enumDef }: {
  value: unknown;
  tone?: Tone;
  label?: string;
  dot?: boolean;
  className?: string;
  enumDef?: { value: string; tone: Tone; label?: string }[];
}) {
  if (value == null || value === "") return <span className="text-muted-foreground">—</span>;
  const t = tone ?? toneFor(value, enumDef);
  const text = label ?? enumDef?.find((e) => e.value === String(value))?.label ?? humanize(value);
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset", TONE_CLASS[t], className)}>
      {t === "ai" ? <Sparkles className="size-3" aria-hidden /> : dot && <span className={cn("size-1.5 rounded-full", TONE_DOT[t])} aria-hidden />}
      {text}
    </span>
  );
}

export function Money({ value, style = "full", tone = "auto", className, cents }: {
  value: number | null | undefined;
  style?: MoneyStyle;
  tone?: "auto" | "none";
  className?: string;
  cents?: boolean; // value is in cents
}) {
  const v = value == null ? value : cents ? value / 100 : value;
  const negative = v != null && v < 0;
  const text = formatMoney(v, style);
  // Mercury-style: whole dollars full weight, cents lighter.
  const dot = style === "full" || style === "accounting" ? text.lastIndexOf(".") : -1;
  return (
    <span className={cn("tabular-nums whitespace-nowrap", tone === "auto" && negative && "text-tone-danger", tone === "auto" && v === 0 && "text-muted-foreground/70", className)}>
      {dot > 0 ? <>{text.slice(0, dot)}<span className="opacity-60">{text.slice(dot)}</span></> : text}
    </span>
  );
}

export function Pct({ value, digits, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatPct(value, digits)}</span>;
}

// Relative date ("3 days ago") with the exact timestamp in a tooltip.
export function RelativeDate({ value, className, mode = "relative" }: { value: DateInput; className?: string; mode?: "relative" | "date" | "due" }) {
  const mounted = useMounted();
  if (value == null || value === "") return <span className="text-muted-foreground">—</span>;
  let text: string, late = false, soon = false;
  if (!mounted) text = formatDate(value);
  else if (mode === "due") ({ text, late, soon } = formatDue(value));
  else text = mode === "date" ? formatDate(value) : formatRelative(value);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time suppressHydrationWarning className={cn("tabular-nums whitespace-nowrap decoration-dotted underline-offset-2 hover:underline", late && "font-medium text-tone-danger", soon && "text-tone-warning", className)}>{text}</time>
      </TooltipTrigger>
      <TooltipContent suppressHydrationWarning>{formatFull(value)}</TooltipContent>
    </Tooltip>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-border bg-muted px-1 font-sans text-[10.5px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]", className)}>{children}</kbd>;
}

const AVATAR_TONES = ["bg-[oklch(0.93_0.03_195)] text-[oklch(0.38_0.07_195)]", "bg-[oklch(0.93_0.03_250)] text-[oklch(0.4_0.09_250)]", "bg-[oklch(0.94_0.04_75)] text-[oklch(0.45_0.09_60)]", "bg-[oklch(0.93_0.03_320)] text-[oklch(0.42_0.08_320)]", "bg-[oklch(0.93_0.03_150)] text-[oklch(0.4_0.08_150)]"];
export function PersonAvatar({ name, size = 24, className, src }: { name: string; size?: number; className?: string; src?: string }) {
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return src
    // eslint-disable-next-line @next/next/no-img-element -- small avatar, no optimisation needed
    ? <img src={src} alt="" width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} />
    : <span style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold dark:brightness-90", tone, className)} aria-hidden>{initials(name)}</span>;
}

// Square thumbnail for asset rows (properties, units). Falls back to an icon tile.
export function Thumb({ src, size = 28, className, icon: Icon = Building2 }: { src?: string | null; size?: number; className?: string; icon?: typeof Building2 }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element -- table thumbnails are pre-sized WebP
    ? <img src={src} alt="" width={size} height={size} loading="lazy" className={cn("shrink-0 rounded-[5px] bg-muted object-cover ring-1 ring-border", className)} style={{ width: size, height: size }} />
    : <span style={{ width: size, height: size }} className={cn("inline-flex shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground ring-1 ring-border", className)}><Icon className="size-3.5" /></span>;
}

// Tiny progress bar for percentages in table cells (occupancy, collections).
// `bare`: the bar alone, where the same figure is already printed beside it.
export function Meter({ value, tone, className, bare }: { value: number; tone?: Tone; className?: string; bare?: boolean }) {
  const pct = Math.max(0, Math.min(1, Math.abs(value) <= 1.5 ? value : value / 100));
  const t = tone ?? (pct >= 0.93 ? "success" : pct >= 0.85 ? "warning" : "danger");
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {bare ? <span className="sr-only">{formatPct(pct)}</span> : <span className="tabular-nums w-11 text-right">{formatPct(pct)}</span>}
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", TONE_DOT[t])} style={{ width: `${pct * 100}%` }} /></span>
    </span>
  );
}
