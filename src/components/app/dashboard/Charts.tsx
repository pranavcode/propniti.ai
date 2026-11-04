"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { categoryLabel, formatTick, formatValue, seriesColor } from "./fmt";
import type { ChartKind, ChartPoint, ChartSeries } from "./types";

// Recharts lives only in this module. ChartCard loads it with next/dynamic (ssr: false), so the
// server/Worker bundle never includes Recharts.

export type RechartsProps = { kind: Exclude<ChartKind, "funnel" | "heatmap">; data: ChartPoint[]; x: string; series: ChartSeries[]; height: number; onPoint?: (p: ChartPoint) => void };

const tick = { fontSize: 11, fill: "var(--muted-foreground)" };

type TipItem = { dataKey?: string | number; name?: string | number; value?: unknown; color?: string; payload?: ChartPoint };
function Tip({ active, payload, label, series, x }: { active?: boolean; payload?: TipItem[]; label?: unknown; series: ChartSeries[]; x: string }) {
  if (!active || !payload?.length) return null;
  const head = label ?? payload[0]?.payload?.[x];
  const total = payload.length > 1 ? payload.reduce((a, p) => a + (Number(p.value) || 0), 0) : null;
  const fmt = series[0]?.format;
  return (
    <div className="min-w-40 rounded-md border bg-popover px-2.5 py-2 text-[12px] text-popover-foreground shadow-lg">
      {head != null && <div className="mb-1 font-medium">{categoryLabel(head)}</div>}
      <div className="flex flex-col gap-0.5">
        {payload.map((p) => {
          const s = series.find((s) => s.key === p.dataKey) ?? series.find((s) => s.key === p.name);
          return (
            <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: p.color ?? (p.payload?.fill as string) }} />
              <span className="flex-1 text-muted-foreground">{s?.label ?? String(p.name)}</span>
              <span className="font-medium tabular-nums">{formatValue(Number(p.value), s?.format ?? fmt)}</span>
            </div>
          );
        })}
        {total != null && <div className="mt-1 flex justify-between border-t pt-1 text-muted-foreground"><span>Total</span><span className="font-medium text-foreground tabular-nums">{formatValue(total, fmt)}</span></div>}
      </div>
    </div>
  );
}

export default function RechartsChart({ kind, data, x, series, height, onPoint }: RechartsProps) {
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: seriesColor(i, s.color) }]));
  const fmt = series[0]?.format;
  // Chart-level clicks carry the hovered index (Recharts 3); pie sectors carry the point itself.
  const click = onPoint ? (d: unknown) => {
    const e = d as { payload?: ChartPoint; activePayload?: { payload: ChartPoint }[]; activeTooltipIndex?: unknown; activeIndex?: unknown } | null;
    const idx = Number(e?.activeTooltipIndex ?? e?.activeIndex);
    const pt = e?.payload ?? e?.activePayload?.[0]?.payload ?? (Number.isInteger(idx) ? data[idx] : undefined);
    if (pt) onPoint(pt);
  } : undefined;
  const cursor = onPoint ? "cursor-pointer" : undefined;
  const tooltip = <ChartTooltip cursor={kind === "line" || kind === "area" ? { stroke: "var(--border)" } : { fill: "var(--muted)", opacity: 0.5 }} content={<Tip series={series} x={x} />} />;
  const yAxis = <YAxis tick={tick} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatTick(v, fmt)} />;
  const xAxis = <XAxis dataKey={x} tick={tick} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={categoryLabel} />;
  const grid = <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />;

  if (kind === "donut") {
    const s = series[0]!;
    const pieConfig: ChartConfig = Object.fromEntries(data.map((d, i) => [String(d[x]), { label: String(d[x]), color: seriesColor(i, d.color as string | undefined) }]));
    const total = data.reduce((a, d) => a + (Number(d[s.key]) || 0), 0);
    return (
      <div className="flex flex-wrap items-center gap-4">
        <ChartContainer config={pieConfig} className={cn("aspect-square shrink-0", cursor)} style={{ height, width: height }}>
          <PieChart>
            <ChartTooltip content={<Tip series={[{ ...s, label: s.label }]} x={x} />} />
            <Pie data={data} dataKey={s.key} nameKey={x} innerRadius="62%" outerRadius="92%" paddingAngle={0} stroke="var(--card)" strokeWidth={2} onClick={click} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={String(d[x])} fill={seriesColor(i, d.color as string | undefined)} />)}
            </Pie>
            <text x="50%" y="47%" textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular-nums">{formatValue(total, s.format, true)}</text>
            <text x="50%" y="59%" textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{s.label}</text>
          </PieChart>
        </ChartContainer>
        <ul className="flex min-w-52 flex-1 flex-col gap-1.5 text-[12.5px]">
          {data.map((d, i) => (
            <li key={String(d[x])}>
              <button type="button" disabled={!onPoint} onClick={() => onPoint?.(d)} className="flex w-full items-center gap-2 rounded text-left enabled:hover:text-primary">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: seriesColor(i, d.color as string | undefined) }} />
                <span className="flex-1 truncate">{String(d[x])}</span>
                <span className="font-medium tabular-nums">{formatValue(Number(d[s.key]), s.format)}</span>
                <span className="w-10 text-right text-muted-foreground tabular-nums">{total ? Math.round((Number(d[s.key]) / total) * 100) : 0}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (kind === "hbar") {
    return (
      <ChartContainer config={config} className={cn("size-full aspect-auto", cursor)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }} onClick={click} barCategoryGap="22%">
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatTick(v, fmt)} />
          <YAxis type="category" dataKey={x} tick={tick} tickLine={false} axisLine={false} width={132} interval={0} />
          {tooltip}
          {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={[0, 4, 4, 0]} isAnimationActive={false} />)}
        </BarChart>
      </ChartContainer>
    );
  }

  if (kind === "bar" || kind === "stacked") {
    const stacked = kind === "stacked";
    return (
      <ChartContainer config={config} className={cn("size-full aspect-auto", cursor)}>
        <BarChart data={data} margin={{ left: 0, right: 4, top: 4 }} onClick={click} barCategoryGap={stacked ? "28%" : "20%"}>
          {grid}{xAxis}{yAxis}{tooltip}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} stackId={stacked ? "a" : undefined} fill={`var(--color-${s.key})`} radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} stroke={stacked ? "var(--card)" : undefined} strokeWidth={stacked ? 2 : 0} isAnimationActive={false} />)}
        </BarChart>
      </ChartContainer>
    );
  }

  if (kind === "area") {
    return (
      <ChartContainer config={config} className={cn("size-full aspect-auto", cursor)}>
        <AreaChart data={data} margin={{ left: 0, right: 4, top: 4 }} onClick={click}>
          <defs>{series.map((s) => <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={`var(--color-${s.key})`} stopOpacity={0.22} /><stop offset="100%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} /></linearGradient>)}</defs>
          {grid}{xAxis}{yAxis}{tooltip}
          {series.map((s) => <Area key={s.key} dataKey={s.key} type={s.curve ?? "monotone"} stroke={`var(--color-${s.key})`} strokeWidth={2} fill={`url(#fill-${s.key})`} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />)}
        </AreaChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={config} className={cn("size-full aspect-auto", cursor)}>
      <LineChart data={data} margin={{ left: 0, right: 4, top: 4 }} onClick={click}>
        {/* Lines encode change, not magnitude, so the scale fits the data instead of starting at zero. */}
        {grid}{xAxis}<YAxis tick={tick} tickLine={false} axisLine={false} width={52} domain={["auto", "auto"]} tickFormatter={(v: number) => formatTick(v, fmt)} />{tooltip}
        {series.map((s) => <Line key={s.key} dataKey={s.key} type={s.curve ?? "monotone"} stroke={`var(--color-${s.key})`} strokeWidth={2} strokeDasharray={s.dashed ? "4 4" : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false} />)}
      </LineChart>
    </ChartContainer>
  );
}
