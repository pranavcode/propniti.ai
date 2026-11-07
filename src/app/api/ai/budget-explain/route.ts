import { z } from "zod";
import { can } from "@/entities";
import { guarded, json, writeSession } from "@/ai/http";
import { bvaData, explainVariance } from "@/extensions/accounting/budget/data";

// "Explain a variance" on the budget page: a click posts here (AI rate limit, same origin), so a
// page render or link prefetch never calls the model. Figures are recomputed in the caller's scope.
const Body = z.object({
  year: z.number().int().min(2000).max(2100),
  type: z.enum(["Income", "Expense"]),
  property: z.string().max(40).nullable(),
  key: z.string().max(60),
});

export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "ai", { staff: true });
    if (w instanceof Response) return w;
    if (!can(w.s.actor.role, "read", "budgets")) return json({ error: `${w.s.persona.title} can't view budgets` }, { status: 403 });
    const ctx = { db: w.s.db, ws: w.s.ws, actor: w.s.actor };
    const data = await bvaData(ctx, { year: w.body.year, type: w.body.type, property: w.body.property });
    const explanation = await explainVariance(ctx, data, w.body.key);
    return explanation ? json({ explanation }, { setCookie: w.s.setCookie }) : json({ error: "Nothing to explain for that row and period" }, { status: 404, setCookie: w.s.setCookie });
  });
}
