import "server-only";
import type { Facts, Row } from "@/entities/types";
import type { AgentCtx } from "@/ai/runtime";
import type { NoiExplanation } from "@/ai/facts";
import { formatMoney, formatPct } from "@/lib/format";
import { getMetric } from "@/extensions/metrics";

// "Explain this number": the change in a KPI between the last closed month and the one before,
// split by property (and, for NOI, by income/expense driver). Everything is computed here from
// metrics_monthly via the AI read tools, so the run trace shows what was looked up.

type Agg = { num: (r: Row) => number; den?: (r: Row) => number; kind: "money" | "pct" | "count" };
const n = (r: Row, k: string) => Number(r[k] ?? 0);
const addMonths = (ym: string, k: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1)).toISOString().slice(0, 7);

export const EXPLAINABLE = {
  "portfolio.noi": { label: "NOI", goodWhen: "up", agg: { num: (r) => n(r, "noi_cents") / 100, kind: "money" } },
  "portfolio.occupancy": { label: "Physical occupancy", goodWhen: "up", agg: { num: (r) => n(r, "occupied"), den: (r) => n(r, "units"), kind: "pct" } },
  "portfolio.economic_occupancy": { label: "Economic occupancy", goodWhen: "up", agg: { num: (r) => n(r, "occupancy_econ") * n(r, "gpr_cents"), den: (r) => n(r, "gpr_cents"), kind: "pct" } },
  "receivables.collections_rate": { label: "Collections rate", goodWhen: "up", agg: { num: (r) => n(r, "collected_cents"), den: (r) => n(r, "charged_cents"), kind: "pct" } },
  "receivables.delinquency": { label: "Delinquent balance", goodWhen: "down", agg: { num: (r) => (n(r, "aging_0_30_cents") + n(r, "aging_31_60_cents") + n(r, "aging_61_90_cents") + n(r, "aging_90p_cents")) / 100, kind: "money" } },
  "leasing.vacancy_loss": { label: "Vacancy loss", goodWhen: "down", agg: { num: (r) => n(r, "vacancy_loss_cents") / 100, kind: "money" } },
  "maintenance.sla": { label: "Work orders within SLA", goodWhen: "up", agg: { num: (r) => n(r, "met"), den: (r) => n(r, "due"), kind: "pct" } },
  "intelligence.ai_minutes_saved": { label: "Staff hours saved by AI", goodWhen: "up", agg: { num: (r) => Math.round(n(r, "ai_minutes_saved") / 60), kind: "count" } },
} satisfies Record<string, { label: string; goodWhen: "up" | "down"; agg: Agg }>;
export type ExplainableKey = keyof typeof EXPLAINABLE;
export const isExplainable = (k: string): k is ExplainableKey => Object.hasOwn(EXPLAINABLE, k);

export type Mover = { property_id: string; property: string; value: number | null; prior: number | null; change: number; impact: number };
export type ExplainDetail = {
  metric: ExplainableKey; label: string; kind: Agg["kind"]; goodWhen: "up" | "down"; scope: string; month: string; prior_month: string;
  value: number | null; prior: number | null; change: number | null; movers: Mover[]; drivers?: NoiExplanation["drivers"]; expense_lines?: NoiExplanation["expense_lines"]; budget?: number | null;
};

function value(agg: Agg, rows: Row[]): number | null {
  if (!rows.length) return null;
  const num = rows.reduce((s, r) => s + agg.num(r), 0);
  if (!agg.den) return num;
  const den = rows.reduce((s, r) => s + agg.den!(r), 0);
  return den ? num / den : null;
}

const monthName = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmt = (kind: Agg["kind"], v: number | null) => (v == null ? "n/a" : kind === "money" ? formatMoney(v, "whole") : kind === "pct" ? formatPct(v, 1) : String(Math.round(v)));
const fmtChange = (kind: Agg["kind"], d: number) => (kind === "pct" ? `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pts` : `${d >= 0 ? "+" : "−"}${fmt(kind, Math.abs(d))}`);

// Driver deltas are signed by their effect on NOI: for a cost line, a positive effect means it fell.
function driverText(d: NoiExplanation["drivers"][number]) {
  const amt = formatMoney(Math.abs(d.delta_cents) / 100, "whole");
  const income = d.label === "Rent collected";
  const moved = income === d.delta_cents > 0 ? "rose" : "fell";
  return `${d.label} ${moved}, ${d.delta_cents > 0 ? "adding" : "taking"} ${amt} ${d.delta_cents > 0 ? "to" : "from"} NOI.`;
}

// SLA comes from work orders (maintenance.sla), not metrics_monthly, so the explanation matches
// the number on every home. Same row shape as metrics.monthly: one row per property per month.
async function slaRows(ctx: AgentCtx, propertyIds?: string[]): Promise<{ rows: Row[] }> {
  const m = getMetric("maintenance.sla_by_property")!;
  const mctx = { db: ctx.db, ws: ctx.ws === "base" ? null : ctx.ws, actor: ctx.actor, propertyIds: ctx.actor.propertyIds, asOf: ctx.today };
  const closed = addMonths(ctx.today.slice(0, 7), -1);
  const months = [addMonths(closed, -1), closed];
  const rows = (await Promise.all(months.map(async (month) => (await m.run(mctx, { month })).points.map((p): Row => ({ ...p, month, property: p.name })))))
    .flat().filter((r) => !propertyIds?.length || propertyIds.includes(String(r.property_id)));
  await ctx.step({ kind: "message", output: { looked_up: "maintenance.sla_by_property", months, properties: new Set(rows.map((r) => r.property_id)).size }, ok: true });
  return { rows };
}

export async function explainMetric(ctx: AgentCtx, metric: ExplainableKey, propertyIds?: string[]) {
  const def = EXPLAINABLE[metric];
  const agg: Agg = def.agg;
  const { rows } = metric === "maintenance.sla" ? await slaRows(ctx, propertyIds) : await ctx.call<{ rows: Row[] }>("metrics.monthly", { months: 3, ...(propertyIds?.length ? { property_ids: propertyIds } : {}) });
  // Compare whole months: the last closed one against the month before.
  const months = [...new Set(rows.map((r) => String(r.month)))].sort().filter((m) => m < ctx.today.slice(0, 7));
  const month = months.at(-1) ?? "";
  const prior = months.at(-2) ?? "";
  const at = (m: string) => rows.filter((r) => r.month === m);
  const cur = value(agg, at(month));
  const prev = value(agg, at(prior));
  const change = cur != null && prev != null ? cur - prev : null;

  const ids = [...new Set(rows.map((r) => String(r.property_id)))];
  const totalDen = agg.den ? at(month).reduce((s, r) => s + agg.den!(r), 0) : 0;
  const movers: Mover[] = ids.map((id) => {
    const a = at(month).filter((r) => r.property_id === id);
    const b = at(prior).filter((r) => r.property_id === id);
    const va = value(agg, a);
    const vb = value(agg, b);
    const d = va != null && vb != null ? va - vb : 0;
    // For a rate, a property's pull on the total is its own change weighted by its share.
    const impact = agg.den ? d * (totalDen ? a.reduce((s, r) => s + agg.den!(r), 0) / totalDen : 0) : d;
    return { property_id: id, property: String(a[0]?.property ?? b[0]?.property ?? id), value: va, prior: vb, change: d, impact };
  }).filter((m) => m.change !== 0).sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact)).slice(0, 8);

  const noi = metric === "portfolio.noi" ? await ctx.call<NoiExplanation | { error: string }>("metrics.explain_noi", { month, ...(propertyIds?.length ? { property_ids: propertyIds } : {}) }) : null;
  const x = noi && !("error" in noi) ? noi : null;

  const scope = propertyIds?.length === 1 ? movers[0]?.property ?? String(rows.find((r) => r.property_id === propertyIds[0])?.property ?? "this property") : ctx.actor.scope.label.split(" · ")[0];
  const detail: ExplainDetail = { metric, label: def.label, kind: agg.kind, goodWhen: def.goodWhen, scope, month, prior_month: prior, value: cur, prior: prev, change, movers, drivers: x?.drivers, expense_lines: x?.expense_lines, budget: x?.budget_noi_cents != null ? x.budget_noi_cents / 100 : null };

  // Flat facts for the model: dollars as whole numbers (_usd), rates as percents to one decimal (_pct).
  const unit = agg.kind === "money" ? "usd" : agg.kind === "pct" ? "pct" : "count";
  const num = (v: number | null) => (v == null ? null : agg.kind === "pct" ? Math.round(v * 1000) / 10 : Math.round(v));
  const facts: Facts = {
    metric: def.label, scope, month: monthName(month), prior_month: monthName(prior),
    [`value_${unit}`]: num(cur), [`prior_value_${unit}`]: num(prev),
    [agg.kind === "pct" ? "change_pts" : `change_${unit}`]: change == null ? null : agg.kind === "pct" ? Math.round(change * 1000) / 10 : Math.round(change),
    change_pct: cur != null && prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null,
  };
  movers.slice(0, 4).forEach((m, i) => {
    facts[`mover_${i + 1}`] = m.property;
    facts[`mover_${i + 1}_change_${agg.kind === "pct" ? "pts" : unit}`] = agg.kind === "pct" ? Math.round(m.change * 1000) / 10 : Math.round(m.change);
  });
  x?.drivers.filter((d) => d.delta_cents).slice(0, 3).forEach((d, i) => { facts[`driver_${i + 1}`] = d.label; facts[`driver_${i + 1}_effect_usd`] = Math.round(d.delta_cents / 100); });
  if (x?.expense_lines[0]) { facts.top_expense_line = x.expense_lines[0].gl; facts.top_expense_line_change_usd = Math.round(x.expense_lines[0].delta_cents / 100); }
  if (detail.budget != null && cur != null) { facts.budget_usd = Math.round(detail.budget); facts.vs_budget_usd = Math.round(cur - detail.budget); }

  const dir = change == null || change === 0 ? "held steady" : change > 0 ? "rose" : "fell";
  const headline = change == null
    ? `${def.label} for ${scope} has no prior month to compare yet.`
    : `${def.label} ${dir} in ${monthName(month)}: ${fmt(agg.kind, cur)}, ${fmtChange(agg.kind, change)} from ${fmt(agg.kind, prev)} in ${monthName(prior)}.`;
  const bullets = [
    ...(x ? x.drivers.filter((d) => d.delta_cents).slice(0, 2).map(driverText) : []),
    ...movers.slice(0, propertyIds?.length === 1 ? 0 : 3).map((m) => `${m.property}: ${fmtChange(agg.kind, m.change)} (${fmt(agg.kind, m.prior)} → ${fmt(agg.kind, m.value)}).`),
    ...(x?.expense_lines[0] && x.expense_lines[0].delta_cents ? [`Largest expense change: ${x.expense_lines[0].gl}, ${x.expense_lines[0].delta_cents > 0 ? "+" : "−"}${formatMoney(Math.abs(x.expense_lines[0].delta_cents) / 100, "whole")}.`] : []),
  ].slice(0, 4);
  return { facts, detail, rules: { headline, bullets } };
}
