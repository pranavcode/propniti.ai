import type { Actor, MetricKey, Role, Row } from "@/entities/types";
import type { Db } from "@/lib/platform/types";

// Chart and KPI data sources (KpiDef.metric, ChartDef.metric), served by GET /api/metrics/[key]
// and called directly by server components through metrics() in src/server/query.ts.
// Register from src/extensions/<module>/; keys are "<module>.<name>".

export type MetricParams = {
  property?: string;                     // narrow to one property (still within scope)
  months?: number;                       // trailing window, default 12
  month?: string;                        // 'YYYY-MM' point in time, default the demo's current month
};

// KPIs read value/previous/spark; charts read points (each point carries ChartDef.x and series keys).
export type MetricResult = { value?: number | null; previous?: number | null; spark?: number[]; points: Row[]; asOf?: string; source?: string };

export type MetricCtx = { db: Db; ws: string | null; actor: Actor; propertyIds: string[] | "all"; asOf: string };

export type MetricDef = { key: MetricKey; label: string; roles?: Role[]; run: (ctx: MetricCtx, params: MetricParams) => Promise<MetricResult> };

const metrics = new Map<MetricKey, MetricDef>();

export const registerMetric = (m: MetricDef) => (metrics.set(m.key, m), m);
export const getMetric = (key: string) => metrics.get(key as MetricKey);
export const allMetrics = () => [...metrics.values()];
