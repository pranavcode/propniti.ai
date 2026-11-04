"use client";

import Link from "@/components/Link";
import { pickFilter } from "@/components/app/ResultsSummary";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { fillTemplate } from "@/components/app/data-table/params";
import { formatCountDelta, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { monthTick } from "@/components/app/dashboard/fmt";
import { cn } from "@/lib/utils";
import { useImprove } from "@/components/app/ai/ImproveWithAI";
import { Term } from "@/components/app/Term";

// KPI tiles and chart panels fed by metrics() (plain data). Every tile and chart point links to
// the rows behind it (KpiDef.drill / ChartDef.drill templates).
// TODO(lane B): swap for KpiCard / ChartCard from src/components/app/dashboard when they land.

export type Fmt = "money" | "count" | "pct" | "days";
const fmt = (v: number | null | undefined, f: Fmt | undefined, compact = false) =>
  v == null ? "—" : f === "money" ? formatMoney(v, compact ? "compact" : "whole") : f === "pct" ? formatPct(v) : f === "days" ? `${formatNumber(v)} d` : formatNumber(v, { compact });

const monthLabel = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}$/.test(s)) return s;
  return monthTick(s);
};

function Spark({ values, good }: { values: number[]; good: boolean | null }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-24" aria-hidden>
      <polyline points={pts} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={good === false ? "stroke-tone-danger" : "stroke-primary"} />
    </svg>
  );
}

export type KpiData = { key: string; metric?: string; property?: string; label: string; format: Fmt; value: number | null; previous: number | null; spark: number[]; goodWhen?: "up" | "down"; drill?: string; help?: string; asOf?: string; error?: string };

export function KpiTile({ k }: { k: KpiData }) {
  const imp = useImprove({ metric: k.metric ?? "", property: k.property, label: k.label, value: k.error ? null : k.value, previous: k.previous, goodWhen: k.goodWhen, format: k.format });
  const tile = <Tile k={k} improving={imp.shown} />;
  return imp.strip ? <div className="flex min-w-0 flex-col [&>*:first-child]:flex-1">{tile}{imp.strip}</div> : tile;
}

function Tile({ k, improving }: { k: KpiData; improving: boolean }) {
  const delta = k.value != null && k.previous != null && k.previous !== 0 ? (k.value - k.previous) / Math.abs(k.previous) : null;
  const pctPoints = k.format === "pct" && k.value != null && k.previous != null ? (k.value - k.previous) * 100 : null;
  // Counts move by how many: a percentage of a small base ("380%") says little.
  const countChange = k.format === "count" && k.value != null && k.previous != null ? formatCountDelta(k.value, k.previous) : null;
  const up = (pctPoints ?? delta ?? 0) > 0 || (countChange != null && k.value! > k.previous!);
  const flat = countChange != null ? k.value === k.previous : (pctPoints ?? delta ?? 0) === 0;
  const good = flat || !k.goodWhen ? null : (up && k.goodWhen === "up") || (!up && k.goodWhen === "down");
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  // The tile drills through a link stretched over it (same pattern as KpiCard).
  return (
    <div className={cn("group/kpi relative flex h-full flex-col justify-between gap-2 rounded-lg border bg-card p-3.5 transition-colors", k.drill && "hover:border-primary/40 has-[>a:focus-visible]:ring-2 has-[>a:focus-visible]:ring-ring", improving && "rounded-b-none")}>
      {k.drill && <Link href={k.drill} onClick={pickFilter} aria-label={`${k.label}: open the records behind this number`} className="absolute inset-0 rounded-lg outline-none" />}
      <div className="-mt-1 flex h-6 items-center gap-1.5">
        <span className="min-w-0 truncate text-[12px] font-medium text-muted-foreground"><Term help={k.help} className="relative z-10">{k.label}</Term></span>
        {(k.asOf || k.drill) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {k.asOf && <span className="text-[10.5px] text-muted-foreground/70">{monthLabel(k.asOf)}</span>}
            {k.drill && <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground/50 transition-colors group-hover/kpi:text-foreground" />}
          </span>
        )}
      </div>
      {k.error ? <span className="text-[12px] text-muted-foreground">{k.error}</span> : (
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">{fmt(k.value, k.format, true)}</div>
            {(delta != null || pctPoints != null || countChange != null) && (
              <div className={cn("mt-1.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium tabular-nums", good == null ? "text-muted-foreground" : good ? "text-tone-success" : "text-tone-danger")}>
                <Icon className="size-3.5" />
                {pctPoints != null ? `${Math.abs(pctPoints).toFixed(1)} pts` : countChange != null ? countChange.replace(/^[+−]/, "") : `${Math.abs(delta! * 100).toFixed(1)}%`}
                <span className="font-normal text-muted-foreground">vs last month</span>
              </div>
            )}
          </div>
          <Spark values={k.spark} good={good} />
        </div>
      )}
    </div>
  );
}

export type ChartData = { key: string; title: string; kind: "line" | "area" | "bar" | "stacked" | "hbar" | "funnel" | "donut"; x: string; series: { key: string; label: string; format?: Fmt }[]; drill?: string; points: Record<string, unknown>[]; asOf?: string; source?: string; error?: string };

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function ChartPanel({ c }: { c: ChartData }) {
  const router = useRouter();
  const config = Object.fromEntries(c.series.map((s, i) => [s.key, { label: s.label, color: COLORS[i % COLORS.length] }])) satisfies ChartConfig;
  const f = c.series[0]?.format;
  const drill = (p: unknown) => {
    const point = (p as { payload?: Record<string, unknown> })?.payload ?? (p as Record<string, unknown>);
    if (c.drill && point) router.push(fillTemplate(c.drill, point));
  };
  const tick = (v: unknown) => fmt(Number(v), f, true);
  const isMonth = c.points.length > 0 && /^\d{4}-\d{2}$/.test(String(c.points[0][c.x]));
  const data = c.kind === "hbar" ? c.points.slice(0, 12) : c.points;

  let chart: React.ReactNode;
  if (c.kind === "line" || c.kind === "area") {
    chart = (
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={c.x} tickLine={false} axisLine={false} tickFormatter={isMonth ? monthLabel : undefined} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={tick} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => (isMonth ? monthLabel(l) : String(l))} formatter={(v, n) => <span className="flex w-full justify-between gap-3"><span className="text-muted-foreground">{config[String(n)]?.label ?? String(n)}</span><span className="font-medium tabular-nums">{fmt(Number(v), c.series.find((s) => s.key === n)?.format)}</span></span>} />} />
        {c.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {c.series.map((s) => <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={false} activeDot={{ r: 4, cursor: c.drill ? "pointer" : undefined, onClick: (_: unknown, e: unknown) => drill(e) }} connectNulls />)}
      </LineChart>
    );
  } else if (c.kind === "donut") {
    chart = (
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie data={data} dataKey={c.series[0].key} nameKey={c.x} innerRadius="55%" onClick={drill} cursor={c.drill ? "pointer" : undefined}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
      </PieChart>
    );
  } else {
    const horizontal = c.kind === "hbar" || c.kind === "funnel";
    chart = (
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={tick} />
            <YAxis type="category" dataKey={c.x} tickLine={false} axisLine={false} width={150} tick={{ fontSize: 11 }} />
          </>
        ) : (
          <>
            <XAxis dataKey={c.x} tickLine={false} axisLine={false} tickFormatter={isMonth ? monthLabel : undefined} minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={tick} />
          </>
        )}
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => (isMonth ? monthLabel(l) : String(l))} formatter={(v, n) => <span className="flex w-full justify-between gap-3"><span className="text-muted-foreground">{config[String(n)]?.label ?? String(n)}</span><span className="font-medium tabular-nums">{fmt(Number(v), c.series.find((s) => s.key === n)?.format)}</span></span>} />} />
        {c.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {c.series.map((s) => <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={3} stackId={c.kind === "stacked" ? "a" : undefined} onClick={drill} cursor={c.drill ? "pointer" : undefined} />)}
      </BarChart>
    );
  }

  return (
    <section className="flex h-full flex-col rounded-lg border bg-card">
      <header className="flex items-baseline justify-between gap-2 px-4 pt-3">
        <h3 className="text-[13px] font-semibold"><Term>{c.title}</Term></h3>
        {c.drill && <span className="text-[11px] text-muted-foreground">Click to drill in</span>}
      </header>
      {c.error || !c.points.length
        ? <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">{c.error ?? "No data for this period yet."}</p>
        : <div className={cn("relative flex-1", c.kind === "hbar" ? "min-h-80" : "min-h-56")}><ChartContainer config={config} className="absolute inset-0 aspect-auto px-2 pb-2">{chart}</ChartContainer></div>}
      {c.source && <footer className="border-t px-4 py-1.5 text-[10.5px] text-muted-foreground">Source: {c.source}{c.asOf ? ` · through ${monthLabel(c.asOf)}` : ""}</footer>}
    </section>
  );
}
