import { z } from "zod";
import { can } from "@/entities";
import { guarded, json, writeSession } from "@/ai/http";
import { narrate } from "@/extensions/portfolio/ai";
import { EXPLAINABLE, explainMetric, isExplainable } from "@/extensions/portfolio/explain";
import { canReadModuleOf } from "@/server/query";

// POST /app/portfolio/explain: "Explain this number" on a KPI. Runs the Owner Reporting Agent
// over computed facts for the persona's scope (optionally one property) and returns the wording,
// its source and the run id. Same origin, AI rate limit and the visitor's own workspace.
const Body = z.object({
  metric: z.string().max(60).refine(isExplainable, "This number can't be explained yet"),
  property: z.string().regex(/^p\d{2}$/).optional(),
});

// Explanations that need no ledger figures; the rest need journal-entry access.
const NO_MONEY = new Set(["portfolio.occupancy", "maintenance.sla", "intelligence.ai_minutes_saved"]);

export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "ai");
    if (w instanceof Response) return w;
    const { s, body } = w;
    const metric = body.metric as keyof typeof EXPLAINABLE;
    if (!canReadModuleOf(s.actor.role, metric)) return json({ error: "You can't view this number" }, { status: 403 });
    if (body.property && s.actor.propertyIds !== "all" && !s.actor.propertyIds.includes(body.property)) return json({ error: "That property isn't in your scope" }, { status: 404 });
    if (!NO_MONEY.has(metric) && !can(s.actor.role, "read", "journal_entries")) return json({ error: "You don't have access to journal entries" }, { status: 403 });
    const r = await narrate(s, {
      input: { metric, property: body.property ?? null },
      task: `Explain why ${EXPLAINABLE[metric].label} changed month over month and which properties or drivers moved it most.`,
      compute: (ctx) => explainMetric(ctx, metric, body.property ? [body.property] : undefined),
    });
    return json(r, { setCookie: s.setCookie });
  });
}
