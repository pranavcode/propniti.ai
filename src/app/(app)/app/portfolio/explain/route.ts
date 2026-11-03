import { z } from "zod";
import { guarded, json, writeSession } from "@/ai/http";
import { narrate } from "@/extensions/portfolio/ai";
import { EXPLAINABLE, explainMetric, isExplainable } from "@/extensions/portfolio/explain";

// POST /app/portfolio/explain: "Explain this number" on a KPI. Runs the Owner Reporting agent
// over computed facts for the persona's scope (optionally one property) and returns the wording,
// its source and the run id. Same origin, AI rate limit and the visitor's own workspace.
const Body = z.object({
  metric: z.string().max(60).refine(isExplainable, "This number can't be explained yet"),
  property: z.string().regex(/^p\d{2}$/).optional(),
});

export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "ai");
    if (w instanceof Response) return w;
    const { s, body } = w;
    const metric = body.metric as keyof typeof EXPLAINABLE;
    if (body.property && s.actor.propertyIds !== "all" && !s.actor.propertyIds.includes(body.property)) return json({ error: "That property isn't in your scope" }, { status: 404 });
    const r = await narrate(s, {
      input: { metric, property: body.property ?? null },
      task: `Explain why ${EXPLAINABLE[metric].label} changed month over month and which properties or drivers moved it most.`,
      compute: (ctx) => explainMetric(ctx, metric, body.property ? [body.property] : undefined),
    });
    return json(r, { setCookie: s.setCookie });
  });
}
