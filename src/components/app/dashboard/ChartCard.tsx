"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fillTemplate } from "../data-table/params";
import { EmptyState } from "../states";
import { formatValue, seriesColor } from "./fmt";
import type { ChartKind, ChartPoint, ChartSeries } from "./types";

export function ChartSkeleton({ kind = "bar", height = 240 }: { kind?: ChartKind; height?: number }) {
  if (kind === "donut") {
    return <div className="flex items-center gap-4" style={{ height }} aria-busy><Skeleton className="aspect-square rounded-full" style={{ height: height * 0.85 }} /><div className="flex-1 space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-3" style={{ width: `${80 - i * 12}%` }} />)}</div></div>;
  }
  if (kind === "hbar" || kind === "funnel") {
    return <div className="flex flex-col justify-around" style={{ height }} aria-busy>{[92, 78, 64, 51, 40, 30].map((w, i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-4" style={{ width: `${w * 0.75}%` }} /></div>)}</div>;
  }
  const bars = [46, 58, 52, 70, 64, 78, 74, 86, 80, 92, 88, 96];
  return (
    <div className="flex items-end gap-2 border-b pb-1" style={{ height }} aria-busy>
      {bars.map((h, i) => <Skeleton key={i} className="flex-1 rounded-b-none" style={{ height: `${h * 0.85}%` }} />)}
    </div>
  );
}

const Recharts = dynamic(() => import("./Charts"), { ssr: false, loading: () => <ChartSkeleton /> });

export type ChartCardProps = {
  title: string;
  description?: React.ReactNode;
  kind: ChartKind;
  data: ChartPoint[];
  x: string;                             // category field (month, property, stage, bucket)
  series: ChartSeries[];
  drill?: string;                        // href template; {field} from the clicked point
  height?: number;
  loading?: boolean;
  help?: string;
  actions?: React.ReactNode;             // e.g. an "Explain" button, a period select
  legend?: boolean;                      // default: on when there is more than one series
  footer?: React.ReactNode;
  // heatmap only: the column field and the value field (rows are `x`)
  heatmap?: { col: string; value: string; format?: ChartSeries["format"] };
  empty?: string;
  className?: string;
};

export function ChartCard({ title, description, kind, data, x, series, drill, height = 240, loading, help, actions, legend, footer, heatmap, empty, className }: ChartCardProps) {
  const router = useRouter();
  const onPoint = drill ? (p: ChartPoint) => router.push(fillTemplate(drill, p)) : undefined;
  const showLegend = (legend ?? series.length > 1) && kind !== "donut" && kind !== "funnel" && kind !== "heatmap";

  let body: React.ReactNode;
  if (loading) body = <ChartSkeleton kind={kind} height={height} />;
  else if (!data.length) body = <EmptyState compact kind="chart" title="No data for this period" description={empty ?? "Change the date range or filters."} className="py-6" />;
  else if (kind === "funnel") body = <Funnel data={data} x={x} series={series[0]!} onPoint={onPoint} />;
  else if (kind === "heatmap" && heatmap) body = <Heatmap data={data} row={x} {...heatmap} onPoint={onPoint} />;
  else if (kind !== "heatmap") body = <Recharts kind={kind} data={data} x={x} series={series} height={height} onPoint={onPoint} />;

  return (
    <div className={cn("flex min-w-0 flex-col rounded-lg border bg-card", className)}>
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13px] font-semibold tracking-tight">{title}</h3>
            {help && (
              <Tooltip>
                <TooltipTrigger asChild><button className="text-muted-foreground/60 hover:text-foreground" aria-label={`About ${title}`}><Info className="size-3" /></button></TooltipTrigger>
                <TooltipContent className="max-w-64">{help}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {description && <p className="truncate text-[12px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {showLegend && !loading && data.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2 text-[11.5px] text-muted-foreground">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={cn("shrink-0 rounded-[2px]", s.dashed ? "h-0.5 w-3" : "size-2")} style={{ background: seriesColor(i, s.color) }} />{s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="px-4 pt-3 pb-4">{body}</div>
      {footer && <div className="border-t px-4 py-2 text-[12px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

// Leasing funnel: each stage's bar is relative to the first; conversion from the previous stage.
function Funnel({ data, x, series, onPoint }: { data: ChartPoint[]; x: string; series: ChartSeries; onPoint?: (p: ChartPoint) => void }) {
  const first = Number(data[0]?.[series.key]) || 1;
  return (
    <ol className="space-y-1.5">
      {data.map((d, i) => {
        const v = Number(d[series.key]) || 0;
        const prev = i ? Number(data[i - 1]![series.key]) || 0 : null;
        const conv = prev ? Math.round((v / prev) * 100) : null;
        return (
          <li key={String(d[x])}>
            <button type="button" disabled={!onPoint} onClick={() => onPoint?.(d)} className="group/f grid w-full grid-cols-[96px_1fr_56px_40px] items-center gap-3 text-left text-[12.5px]">
              <span className="truncate text-muted-foreground group-enabled/f:group-hover/f:text-foreground">{String(d[x])}</span>
              <span className="relative h-6 overflow-hidden rounded bg-muted/60">
                <span className="absolute inset-y-0 left-0 rounded transition-[filter] group-enabled/f:group-hover/f:brightness-110" style={{ width: `${Math.max(2, (v / first) * 100)}%`, background: "var(--chart-1)", opacity: 1 - i * 0.11 }} />
              </span>
              <span className="text-right font-medium tabular-nums">{formatValue(v, series.format)}</span>
              <span className="text-right text-[11.5px] text-muted-foreground tabular-nums" title="Conversion from the previous stage">{conv != null ? `${conv}%` : ""}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// Heatmap-lite: rows × columns grid, colour = value relative to the max. Values in a title tooltip.
function Heatmap({ data, row, col, value, format, onPoint }: { data: ChartPoint[]; row: string; col: string; value: string; format?: ChartSeries["format"]; onPoint?: (p: ChartPoint) => void }) {
  const rows = [...new Set(data.map((d) => String(d[row])))];
  const cols = [...new Set(data.map((d) => String(d[col])))];
  const max = Math.max(1, ...data.map((d) => Number(d[value]) || 0));
  const at = (r: string, c: string) => data.find((d) => String(d[row]) === r && String(d[col]) === c);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr><th />{cols.map((c) => <th key={c} scope="col" className="font-normal text-muted-foreground">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" className="pr-1.5 text-left font-normal whitespace-nowrap text-muted-foreground">{r}</th>
              {cols.map((c) => {
                const d = at(r, c);
                const v = Number(d?.[value]) || 0;
                return (
                  <td key={c} className="p-0">
                    <button
                      type="button"
                      disabled={!onPoint || !d}
                      onClick={() => d && onPoint?.(d)}
                      title={`${r} · ${c}: ${formatValue(v, format)}`}
                      aria-label={`${r} ${c}: ${formatValue(v, format)}`}
                      className="block h-6 w-full min-w-6 rounded-[3px] ring-inset enabled:hover:ring-2 enabled:hover:ring-foreground/30"
                      style={{ background: v ? `color-mix(in oklch, var(--chart-1) ${Math.round(12 + (v / max) * 88)}%, var(--card))` : "var(--muted)" }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        Fewer
        {[12, 34, 56, 78, 100].map((p) => <span key={p} className="size-2.5 rounded-[2px]" style={{ background: `color-mix(in oklch, var(--chart-1) ${p}%, var(--card))` }} />)}
        More
      </div>
    </div>
  );
}
