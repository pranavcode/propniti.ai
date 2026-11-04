import { describe, expect, it, vi } from "vitest";
import type { Row } from "@/entities/types";
import type { AgentCtx } from "@/ai/runtime";
import type { AiSession } from "@/ai/session";
import { cleanNarrative, hasTokens } from "./narrative";
import { EXPLAINABLE, explainMetric, type ExplainableKey } from "./explain";
import type { Baseline } from "./whatif";

// The what-if narrative runs its compute() directly here (no run, no model) over fixed baselines.
vi.mock("./ai", () => ({ narrate: (_s: unknown, o: { compute: (ctx: unknown) => unknown }) => o.compute({ call: async () => ({ rows: [] }) }) }));
const b = (id: string, name: string, over: Partial<Baseline> = {}): Baseline => ({
  property_id: id, name, metro: "Austin", units: 100, occupancy: 0.94, gpr_cents: 300_000_000, collected_cents: 280_000_000,
  vacancy_loss_cents: 18_000_000, concessions_cents: 2_000_000, opex_cents: 120_000_000, noi_cents: 161_000_000, ...over,
});
vi.mock("./whatif-data", () => ({ loadBaselines: async () => ({ rows: [b("p01", "The Lofts"), b("p02", "Barton Creek Commons", { opex_cents: 150_000_000, noi_cents: 131_000_000 })], from: "2025-11", to: "2026-10" }) }));

// maintenance.sla per property (registered by the extensions at runtime): two properties, any month.
vi.mock("@/extensions/metrics", () => ({ getMetric: () => ({ run: async (_c: unknown, p: { month: string }) => ({ points: [
  { property_id: "p01", name: "The Lofts", due: 30, met: p.month === "2026-10" ? 27 : 25, missed: p.month === "2026-10" ? 3 : 5, sla: null },
  { property_id: "p02", name: "Barton Creek Commons", due: 20, met: 18, missed: 2, sla: null },
] }) }) }));

const texts = (r: { headline: string; bullets: string[] }) => [r.headline, ...r.bullets];

describe("narrative tokens", () => {
  it("turns copied unit suffixes into readable units", () => {
    expect(cleanNarrative("NOI rises 5.2_pct to 1,234_usd, up 1.3_pts")).toBe("NOI rises 5.2% to $1,234, up 1.3 pts");
  });

  it("flags fact keys, unit suffixes and placeholders", () => {
    expect(hasTokens("NOI rose 5.2_pct")).toBe(true);
    expect(hasTokens("NOI rose {delta_pct} this month")).toBe(true);
    expect(hasTokens("delta_pct was high")).toBe(true);
    expect(hasTokens("NOI rose 5.2% to $1,234 (1.3 pts)")).toBe(false);
  });

  it("leaves no tokens in any explain-this-number rules text", async () => {
    const rows: Row[] = ["2026-09", "2026-10", "2026-11"].flatMap((month, i) => ["p01", "p02"].map((p, j) => ({
      month, property_id: p, property: p === "p01" ? "The Lofts" : "Barton Creek Commons", noi_cents: 10_000_000 + i * 300_000 - j * 500_000,
      units: 100, occupied: 94 - i + j, occupancy_econ: 0.93, gpr_cents: 20_000_000, collected_cents: 19_000_000 + i * 100_000, charged_cents: 19_500_000,
      aging_0_30_cents: 100_000 * (i + 1), aging_31_60_cents: 0, aging_61_90_cents: 0, aging_90p_cents: 50_000, vacancy_loss_cents: 600_000 - i * 1000,
      wo_opened: 30, wo_sla_breach: 5 + i, ai_minutes_saved: 600 * (i + 1),
    })));
    const noi = { month: "2026-10", prior_month: "2026-09", noi_cents: 1, prior_noi_cents: 1, change_pct: 1.5, budget_noi_cents: 19_000_000, by_property: [],
      drivers: [{ label: "Rent collected", delta_cents: 200_000, detail: "" }, { label: "Operating expenses", delta_cents: -50_000, detail: "" }], expense_lines: [{ gl: "Repairs", delta_cents: 50_000, month_cents: 1, prior_cents: 1 }] };
    const ctx = { today: "2026-11-04", ws: "base", step: async () => "s", actor: { propertyIds: "all", scope: { label: "Texas · 14 properties" } }, call: async (k: string) => (k === "metrics.explain_noi" ? noi : { rows }) } as unknown as AgentCtx;
    for (const key of Object.keys(EXPLAINABLE) as ExplainableKey[]) {
      for (const property of [undefined, ["p01"]]) {
        const r = await explainMetric(ctx, key, property);
        for (const t of texts(r.rules)) expect(hasTokens(t), `${key}: ${t}`).toBe(false);
      }
    }
  });

  it("leaves no tokens in the what-if rules narrative", async () => {
    const { explainScenario } = await import("./whatif-narrate");
    for (const levers of [{ rentPct: 3, opexPct: 5, occTarget: null, occDeltaPts: -2 }, { rentPct: 0, opexPct: 0, occTarget: 95, occDeltaPts: 0 }, { rentPct: -5.2, opexPct: -3, occTarget: null, occDeltaPts: 0 }]) {
      const r = (await explainScenario({ actor: { propertyIds: "all" } } as AiSession, { scope: { kind: "portfolio" }, levers })) as unknown as { rules: { headline: string; bullets: string[] } };
      for (const t of texts(r.rules)) expect(hasTokens(t), t).toBe(false);
    }
  });
});
