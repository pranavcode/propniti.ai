"use client";

import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { fillTemplate } from "@/components/app/data-table/params";
import { formatMoney, formatNumber, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

// KPI tiles and chart panels fed by metrics() (plain data). Every tile and chart point links to
// the rows behind it (KpiDef.drill / ChartDef.drill templates).
// TODO(lane B): swap for KpiCard / ChartCard from src/components/app/dashboard when they land.

export type Fmt = "money" | "count" | "pct" | "days";
const fmt = (v: number | null | undefined, f: Fmt | undefined, compact = false) =>
  v == null ? "—" : f === "money" ? formatMoney(v, compact ? "compact" : "whole") : f === "pct" ? formatPct(v) : f === "days" ? `${formatNumber(v)} d` : formatNumber(v, { compact });

const monthLabel = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}$/.test(s)) return s;
  return new Date(`${s}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
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

export type KpiData = { key: string; label: string; format: Fmt; value: number | null; previous: number | null; spark: number[]; goodWhen?: "up" | "down"; drill?: string; help?: string; asOf?: string; error?: string };

export function KpiTile({ k }: { k: KpiData }) {
  const delta = k.value != null && k.previous != null && k.previous !== 0 ? (k.value - k.previous) / Math.abs(k.previous) : null;
  const pctPoints = k.format === "pct" && k.value != null && k.previous != null ? (k.value - k.previous) * 100 : null;
  const up = (pctPoints ?? delta ?? 0) > 0;
  const flat = (pctPoints ?? delta ?? 0) === 0;
  const good = flat || !k.goodWhen ? null : (up && k.goodWhen === "up") || (!up && k.goodWhen === "down");
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const body = (
    <div className="flex h-full flex-col justify-between gap-2 rounded-lg border bg-card p-3.5 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-muted-foreground" title={k.help}>{k.label}</span>
        {k.asOf && <span className="text-[10.5px] text-muted-foreground/70">{monthLabel(k.asOf)}</span>}
      </div>
      {k.error ? <span className="text-[12px] text-muted-foreground">{k.error}</span> : (
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">{fmt(k.value, k.format, true)}</div>
            {(delta != null || pctPoints != null) && (
              <div className={cn("mt-1.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium tabular-nums", good == null ? "text-muted-foreground" : good ? "text-tone-success" : "text-tone-danger")}>
                <Icon className="size-3.5" />
                {pctPoints != null ? `${Math.abs(pctPoints).toFixed(1)} pts` : `${Math.abs(delta! * 100).toFixed(1)}%`}
                <span className="font-normal text-muted-foreground">vs last month</span>
              </div>
            )}
          </div>
          <Spark values={k.spark} good={good} />
        </div>
      )}
    </div>
  );
  return k.drill ? <Link href={k.drill} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">{body}</Link> : body;
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
    <section className="flex flex-col rounded-lg border bg-card">
      <header className="flex items-baseline justify-between gap-2 px-4 pt-3">
        <h3 className="text-[13px] font-semibold">{c.title}</h3>
        {c.drill && <span className="text-[11px] text-muted-foreground">Click to drill in</span>}
      </header>
      {c.error || !c.points.length
        ? <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">{c.error ?? "No data for this period yet."}</p>
        : <ChartContainer config={config} className={cn("w-full px-2 pb-2", c.kind === "hbar" ? "h-80" : "h-56")}>{chart}</ChartContainer>}
      {c.source && <footer className="border-t px-4 py-1.5 text-[10.5px] text-muted-foreground">Source: {c.source}{c.asOf ? ` · through ${monthLabel(c.asOf)}` : ""}</footer>}
    </section>
  );
}
