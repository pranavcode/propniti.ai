import { z } from "zod";
import { triage } from "@/ai/rules";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";
import { AS_OF } from "@/seed/constants";
import { portalCtx, rows } from "@/extensions/owners/portal/context";

// POST { text } — the live triage preview on the new-request form: trade, urgency and a typical
// cost range from past completed jobs of that trade at the resident's property. Nothing is saved.

const Body = z.object({ text: z.string().trim().min(1).max(1000) });

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try {
    return !!origin && new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, "ai");
  if (limited) return limited;
  const body = await parseBody(request, Body, 4096);
  if (body instanceof Response) return body;
  const c = await portalCtx("resident");
  if (!c) return Response.json({ error: "Sign in to the resident portal first" }, { status: 403 });
  const t = triage(body.text, Number(AS_OF.slice(5, 7)));
  const costs = (await rows<{ cost: number }>(c, `SELECT w.cost_cents AS cost FROM {work_orders} w WHERE w.property_id = (SELECT r.property_id FROM {residents} r WHERE r.id = ?)
      AND w.category = ? AND w.status IN ('Completed', 'Paid') AND w.cost_cents > 0 ORDER BY w.cost_cents LIMIT 500`, c.me, t.trade)).map((r) => r.cost);
  const why: string[] = [];
  if (t.trade !== "General") why.push(`Your description mentions ${t.trade === "HVAC" ? "heating or cooling" : t.trade.toLowerCase()} words.`);
  else why.push("No specific trade words found, so a general technician looks first.");
  if (t.safety) why.push("It mentions a possible safety hazard, so it's treated as an emergency.");
  else if (t.priority === "Urgent") why.push("Leaks, no cooling or a broken lock get a 24-hour response.");
  else why.push("Routine requests get a response within 3 days.");
  if (costs.length >= 3) why.push(`Based on ${costs.length} similar completed jobs at your property.`);
  return Response.json({
    trade: t.trade, priority: t.priority, safety: t.safety, why,
    cost: costs.length >= 3 ? { low_cents: pct(costs, 0.25), high_cents: pct(costs, 0.75), jobs: costs.length } : null,
    source: "rules",
  }, { headers: { "Cache-Control": "no-store" } });
}
