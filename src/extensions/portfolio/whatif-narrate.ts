import "server-only";
import { z } from "zod";
import type { Facts } from "@/entities/types";
import type { AiSession } from "@/ai/session";
import { formatMoney } from "@/lib/format";
import { narrate } from "./ai";
import { loadBaselines } from "./whatif-data";
import { simulateAll, type Levers } from "./whatif";

// "Explain this scenario": the server recomputes the scenario from the levers (the browser's
// numbers are never trusted), then the Owner Reporting run words the computed facts.

export const ScenarioRequest = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("portfolio") }),
    z.object({ kind: z.literal("metro"), metro: z.enum(["Austin", "Dallas", "Atlanta", "Phoenix"]) }),
    z.object({ kind: z.literal("property"), property: z.string().regex(/^p\d{2}$/) }),
  ]),
  levers: z.object({
    rentPct: z.number().min(-20).max(20),
    opexPct: z.number().min(-30).max(30),
    occTarget: z.number().min(50).max(100).nullable(),
    occDeltaPts: z.number().min(-20).max(20),
  }),
});
export type ScenarioRequest = z.infer<typeof ScenarioRequest>;

const usd = (cents: number) => Math.round(cents / 100);
const pct1 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);

export async function explainScenario(s: AiSession, req: ScenarioRequest) {
  return narrate(s, {
    input: req,
    task: "Explain what this rent, occupancy and operating-expense scenario does to net operating income over a year, which properties move most, and the risk it implies.",
    async compute(ctx) {
      const all = await loadBaselines(s.db, s.ws, s.actor.propertyIds);
      const rows = all.rows.filter((b) => req.scope.kind === "portfolio" || (req.scope.kind === "metro" ? b.metro === req.scope.metro : b.property_id === req.scope.property));
      if (!rows.length) throw new Error("No properties in your scope match this scenario");
      // The run trace shows the monthly figures the baseline was built from.
      await ctx.call("metrics.monthly", { property_ids: rows.slice(0, 30).map((r) => r.property_id), months: 12 });
      const levers: Levers = req.levers;
      const { rows: res, totals: t } = simulateAll(rows, levers);
      const byDelta = [...res].sort((a, b) => b.delta_cents - a.delta_cents);
      const top = byDelta[0];
      const low = byDelta.at(-1)!;
      const revenueEffect = t.scenario_revenue_cents - t.revenue_cents;
      const opexEffect = -(t.scenario_opex_cents - t.opex_cents);
      const label = req.scope.kind === "portfolio" ? "the portfolio in your scope" : req.scope.kind === "metro" ? req.scope.metro : rows[0].name;
      const facts: Facts = {
        scope: label, properties: t.properties, period: `${all.from} to ${all.to}`,
        rent_change_pct: levers.rentPct, opex_change_pct: levers.opexPct,
        occupancy_baseline_pct: pct1(t.occupancy), occupancy_scenario_pct: pct1(t.scenario_occupancy),
        baseline_noi_usd: usd(t.noi_cents), scenario_noi_usd: usd(t.scenario_noi_cents), delta_usd: usd(t.delta_cents), delta_pct: t.delta_pct,
        revenue_effect_usd: usd(revenueEffect), opex_effect_usd: usd(opexEffect),
        margin_baseline_pct: pct1(t.revenue_cents ? t.noi_cents / t.revenue_cents : null), margin_scenario_pct: pct1(t.margin),
        break_even_occupancy_pct: pct1(t.break_even_occupancy),
        ...(res.length > 1 ? { top_gainer: top.name, top_gainer_delta_usd: usd(top.delta_cents), top_loser: low.name, top_loser_delta_usd: usd(low.delta_cents) } : {}),
      };
      const dir = t.delta_cents >= 0 ? "up" : "down";
      const money = (c: number) => formatMoney(usd(c), "whole");
      const signedUsd = (c: number) => (c > 0 ? "+" : "") + money(c);
      const rentText = levers.rentPct ? `rent ${levers.rentPct > 0 ? "+" : ""}${levers.rentPct}%` : "current rent";
      const bullets = [
        `Revenue ${revenueEffect >= 0 ? "rises" : "falls"} by ${money(Math.abs(revenueEffect))} a year at ${rentText} and ${pct1(t.scenario_occupancy)}% occupancy.`,
        opexEffect !== 0 ? `Operating expenses ${opexEffect < 0 ? "rise" : "fall"} by ${money(Math.abs(opexEffect))} a year (${levers.opexPct > 0 ? "+" : ""}${levers.opexPct}%).` : "Operating expenses stay at the T12 level.",
        ...(res.length > 1 ? [`${top.name} ${top.delta_cents >= 0 ? "gains most" : "holds up best"} (${signedUsd(top.delta_cents)}); ${low.name} ${low.delta_cents < 0 ? "loses most" : "gains least"} (${signedUsd(low.delta_cents)}).`] : []),
        t.break_even_occupancy != null ? `NOI reaches zero at ${pct1(t.break_even_occupancy)}% occupancy under this scenario.` : "NOI stays positive at any occupancy under this scenario.",
      ];
      return {
        facts,
        detail: { totals: t },
        rules: {
          headline: `Scenario NOI for ${label} is ${money(t.scenario_noi_cents)} a year, ${dir} ${money(Math.abs(t.delta_cents))} (${Math.abs(t.delta_pct ?? 0)}%) from the T12 baseline of ${money(t.noi_cents)}.`,
          bullets,
        },
      };
    },
  });
}
