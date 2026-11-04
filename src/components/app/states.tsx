"use client";

import Link from "next/link";
import { AlertOctagon, RotateCw, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Designed empty, error and loading states (brief §3.5). Illustrations are small inline SVGs in
// the app's own tokens, so they follow dark mode.

type Illo = "table" | "filtered" | "inbox" | "chart" | "documents" | "tasks" | "notes" | "activity" | "agents";

export function Illustration({ kind, className }: { kind: Illo; className?: string }) {
  const stroke = "var(--border)";
  const ink = "var(--muted-foreground)";
  const accent = "var(--primary)";
  const common = { fill: "none", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 120 84" className={cn("h-[72px] w-[104px]", className)} aria-hidden>
      <rect {...common} x="10" y="8" width="100" height="68" rx="8" fill="var(--card)" stroke={stroke} />
      {kind === "table" && <>
        <path d="M10 22h100" stroke={stroke} {...common} />
        {[32, 44, 56].map((y, i) => <g key={y}><rect x="20" y={y - 3} width="8" height="6" rx="1.5" fill="var(--muted)" /><path d={`M34 ${y}h${36 - i * 8}`} stroke={ink} opacity={0.35} {...common} /><path d={`M86 ${y}h14`} stroke={ink} opacity={0.25} {...common} /></g>)}
        <circle {...common} cx="96" cy="64" r="11" fill="var(--background)" stroke={accent} /><path d="M96 59v10M91 64h10" stroke={accent} {...common} />
      </>}
      {kind === "filtered" && <>
        <path d="M10 22h100" stroke={stroke} {...common} />
        {[34, 46].map((y) => <path key={y} d={`M20 ${y}h60`} stroke={ink} opacity={0.18} strokeDasharray="3 4" {...common} />)}
        <circle {...common} cx="58" cy="52" r="13" fill="var(--background)" stroke={ink} opacity={0.7} /><path d="M67.5 61.5L76 70" stroke={ink} opacity={0.7} {...common} /><path d="M53 52h10" stroke={accent} {...common} />
      </>}
      {kind === "inbox" && <>
        <path d="M10 46h28l6 10h32l6-10h28" stroke={stroke} {...common} />
        <path d="M44 30l10 8 18-18" stroke={accent} {...common} />
      </>}
      {kind === "chart" && <>
        {[[24, 50], [40, 38], [56, 44], [72, 28], [88, 34]].map(([x, h]) => <rect key={x} x={x} y={66 - h * 0.8} width="10" height={h * 0.8} rx="2" fill="var(--muted)" />)}
        <path d="M24 44L40 32L56 38L72 20L96 26" stroke={accent} {...common} />
      </>}
      {kind === "documents" && <>
        <rect {...common} x="34" y="18" width="34" height="44" rx="4" fill="var(--background)" stroke={ink} opacity={0.5} />
        <rect {...common} x="50" y="24" width="34" height="44" rx="4" fill="var(--background)" stroke={ink} />
        {[36, 44, 52].map((y) => <path key={y} d={`M57 ${y}h20`} stroke={ink} opacity={0.35} {...common} />)}
        <path d="M80 60l6 6" stroke={accent} {...common} />
      </>}
      {kind === "tasks" && <>
        {[28, 42, 56].map((y, i) => <g key={y}><rect {...common} x="26" y={y - 5} width="10" height="10" rx="2.5" fill="var(--background)" stroke={i === 0 ? accent : ink} opacity={i === 0 ? 1 : 0.5} />{i === 0 && <path d={`M28.5 ${y}l2 2 3.5-4`} stroke={accent} {...common} />}<path d={`M44 ${y}h${44 - i * 10}`} stroke={ink} opacity={0.35} {...common} /></g>)}
      </>}
      {kind === "notes" && <>
        <path {...common} d="M24 26h56a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H44l-10 8v-8h-10a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z" fill="var(--background)" stroke={ink} opacity={0.6} />
        <path d="M32 37h40M32 45h26" stroke={ink} opacity={0.35} {...common} /><circle {...common} cx="92" cy="30" r="6" fill="var(--background)" stroke={accent} /><path d="M92 27.5v5M89.5 30h5" stroke={accent} {...common} />
      </>}
      {kind === "activity" && <>
        <path d="M30 18v52" stroke={stroke} {...common} />
        {[26, 44, 62].map((y, i) => <g key={y}><circle {...common} cx="30" cy={y} r="4" fill="var(--background)" stroke={i === 0 ? accent : ink} opacity={i === 0 ? 1 : 0.5} /><path d={`M42 ${y}h${50 - i * 12}`} stroke={ink} opacity={0.35} {...common} /></g>)}
      </>}
      {kind === "agents" && <>
        <rect {...common} x="42" y="26" width="36" height="28" rx="7" fill="var(--background)" stroke={ink} opacity={0.6} />
        <circle cx="53" cy="40" r="2.5" fill={accent} /><circle cx="67" cy="40" r="2.5" fill={accent} /><path d="M60 26v-7" stroke={ink} opacity={0.6} {...common} /><circle {...common} cx="60" cy="17" r="2.5" fill="var(--background)" stroke={accent} />
        <path d="M52 64h16" stroke={ink} opacity={0.35} {...common} />
      </>}
    </svg>
  );
}

export function EmptyState({ kind = "table", title, description, action, secondary, className, compact }: {
  kind?: Illo;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  secondary?: { label: string; href?: string; onClick?: () => void };
  className?: string;
  compact?: boolean;
}) {
  const btn = (a: NonNullable<typeof action>, variant: "default" | "outline") =>
    a.href ? <Button asChild size="sm" variant={variant}><Link href={a.href}>{a.label}</Link></Button> : <Button size="sm" variant={variant} onClick={a.onClick}>{a.label}</Button>;
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {kind === "filtered" && compact ? <SearchX className="size-6 text-muted-foreground" /> : <Illustration kind={kind} className={compact ? "h-14 w-20" : undefined} />}
      <div className="max-w-sm flex flex-col gap-1">
        <div className="text-[14px] font-semibold tracking-tight">{title}</div>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {(action || secondary) && <div className="mt-1 flex gap-2">{action && btn(action, "default")}{secondary && btn(secondary, "outline")}</div>}
    </div>
  );
}

// Inline error/blocked banner with the cause and a fix (brief §3.5).
export function ErrorBanner({ title = "Something went wrong", message, onRetry, action, tone = "danger", className }: {
  title?: string;
  message?: React.ReactNode;
  onRetry?: () => void;
  action?: { label: string; href: string };
  tone?: "danger" | "warning";
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5", tone === "danger" ? "border-tone-danger/25 bg-tone-danger/[0.05]" : "border-tone-warning/30 bg-tone-warning/[0.07]", className)}>
      <AlertOctagon className={cn("mt-0.5 size-4 shrink-0", tone === "danger" ? "text-tone-danger" : "text-tone-warning")} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {message && <div className="text-muted-foreground">{message}</div>}
      </div>
      {action && <Button asChild size="sm" variant="outline"><Link href={action.href}>{action.label}</Link></Button>}
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RotateCw /> Retry</Button>}
    </div>
  );
}
