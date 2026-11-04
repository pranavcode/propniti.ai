import { z } from "zod";
import { guarded, json, staffSession, writeSession } from "@/ai/http";
import { rateLimit } from "@/lib/guard";
import { canImprove, improveKeyFor, isImproveKey, type ImproveKey } from "@/ai/improve/meta";
import { executePlan, PlanConflict, planSummary, preview, type Shown } from "@/ai/improve";
import type { AiSession } from "@/ai/session";

// "Improve with AI" on a red KPI.
//   GET  ?metric=&property=&view=full     why it's red, the plan and any plan already running
//   GET  ?metric=&property=               just the running plan's progress (for the card)
//   POST { metric, property }             have the agents propose the plan's actions
// Staff who can run agents and act on the metric's module; everything stays in their scope.

const Property = z.string().regex(/^p\d{2}$/);
// The steps and records the panel showed; the server acts only on those the fresh plan still has.
const Body = z.object({
  metric: z.string().max(60),
  property: Property.optional(),
  steps: z.array(z.object({ action: z.string().max(80), ids: z.array(z.string().max(80)).max(50) })).max(10),
});

function resolve(s: AiSession, metric: string, property: string | undefined): { key: ImproveKey; property: string | null } | Response {
  const key = isImproveKey(metric) ? metric : improveKeyFor(metric);
  if (!key) return json({ error: "This number has no improvement plan yet" }, { status: 400 });
  if (!canImprove(s.actor.role, key, !!s.persona.portal)) return json({ error: `${s.persona.title} can't ask agents to work on this` }, { status: 403 });
  if (property && s.actor.propertyIds !== "all" && !s.actor.propertyIds.includes(property)) return json({ error: "That property isn't in your scope" }, { status: 404 });
  return { key, property: property ?? null };
}

export async function GET(request: Request) {
  return guarded(async () => {
    const sp = new URL(request.url).searchParams;
    const property = sp.get("property") || undefined;
    if (property && !Property.safeParse(property).success) return json({ error: "Unknown property" }, { status: 400 });
    const full = sp.get("view") === "full";
    if (full) {
      const limited = await rateLimit(request, "write");
      if (limited) return limited;
    }
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const r = resolve(s, (sp.get("metric") ?? "").slice(0, 60), property);
    if (r instanceof Response) return r;
    return json(full ? await preview(s, r.key, r.property) : { plan: await planSummary(s, r.key, r.property) });
  });
}

export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "ai", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    const r = resolve(s, body.metric, body.property);
    if (r instanceof Response) return r;
    try {
      return json(await executePlan(s, r.key, r.property, body.steps as Shown), { setCookie: s.setCookie });
    } catch (err) {
      if (err instanceof PlanConflict) return json({ error: err.message }, { status: 409, setCookie: s.setCookie });
      throw err;
    }
  });
}
