import { guarded, json, writeSession } from "@/ai/http";
import { explainScenario, ScenarioRequest } from "@/extensions/portfolio/whatif-narrate";

// POST: the AI narrative for a what-if scenario, as a traced Owner Reporting run.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, ScenarioRequest, "ai");
    if (w instanceof Response) return w;
    const r = await explainScenario(w.s, w.body);
    return json({ text: r.text, bullets: r.bullets, source: r.source, model: r.model, runId: r.runId, note: r.note }, { setCookie: w.s.setCookie });
  });
}
