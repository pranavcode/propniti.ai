"use client";

import Link from "@/components/Link";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatFull, formatNumber } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Meter, Money, Pct, RelativeDate, StatusBadge, Thumb } from "../display";
import { DataHealthBadge } from "../ai/DataHealthBadge";
import { fillTemplate } from "./params";
import type { DataColumn, Row } from "./types";

const empty = <span className="text-muted-foreground/60">—</span>;

export function Cell({ col, row }: { col: DataColumn; row: Row }) {
  if (col.render) return <>{col.render(row)}</>;
  const v = row[col.key];

  if (col.primary) {
    const title = String(v ?? row._title ?? row.id ?? "");
    const sub = row._subtitle ? String(row._subtitle) : null;
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        {col.thumbnail && <Thumb src={(row._image as string) ?? null} size={sub ? 30 : 24} />}
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-medium text-foreground">{title}</span>
          {sub && <span className="block truncate text-[11.5px] text-muted-foreground">{sub}</span>}
        </span>
      </span>
    );
  }

  const linked = (node: React.ReactNode) =>
    col.href && v != null && v !== ""
      ? <Link href={fillTemplate(col.href, row)} onClick={(e) => e.stopPropagation()} className="truncate text-foreground underline-offset-2 hover:text-primary hover:underline">{node}</Link>
      : node;

  switch (col.kind) {
    case "money": return <Money value={v as number | null} style={col.moneyStyle ?? "full"} />;
    case "number": return v == null ? empty : <span className="tabular-nums">{formatNumber(Number(v))}</span>;
    case "pct": return v == null ? empty : <Pct value={Number(v)} />;
    case "meter": return v == null ? empty : <Meter value={Number(v)} />;
    case "date": return v ? <Tooltip><TooltipTrigger asChild><span suppressHydrationWarning className="tabular-nums whitespace-nowrap">{formatDate(v as string, "always")}</span></TooltipTrigger><TooltipContent>{formatFull(v as string)}</TooltipContent></Tooltip> : empty;
    case "datetime": return v ? <span suppressHydrationWarning className="tabular-nums whitespace-nowrap">{formatDateTime(v as string)}</span> : empty;
    case "relative": return <RelativeDate value={v as string} />;
    case "due": return <RelativeDate value={v as string} mode="due" />;
    case "enum": return <StatusBadge value={v} enumDef={col.enum} />;
    case "bool": return v == null ? empty : v ? <Check className="size-3.5 text-tone-success" aria-label="Yes" /> : <Minus className="size-3.5 text-muted-foreground/60" aria-label="No" />;
    case "image": return <Thumb src={(v as string) ?? null} size={24} />;
    case "health": return <DataHealthBadge issues={Array.isArray(v) ? (v as never) : Number(v ?? 0)} compact />;
    case "ref": {
      const label = row[`${col.key}__label`] ?? v;
      return label == null || label === "" ? empty : linked(<span className="truncate">{String(label)}</span>);
    }
    case "json": return v == null ? empty : <span className="truncate font-mono text-[11.5px] text-muted-foreground">{JSON.stringify(v)}</span>;
    default: return v == null || v === "" ? empty : linked(<span className={cn("truncate", col.align === "right" && "tabular-nums")}>{String(v)}</span>);
  }
}

export const isRight = (c: DataColumn) => c.align === "right" || (c.align == null && ["money", "number", "pct", "meter"].includes(c.kind ?? ""));
