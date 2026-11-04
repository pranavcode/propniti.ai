import { cachedBriefing, generateBriefing } from "@/ai/summaries";
import { dataOf, guarded, json, readSession, writeSession } from "@/ai/http";

// Home "Good morning" briefing for the acting persona: GET returns the stored one (precomputed in
// base, or regenerated in the visitor's workspace) while it's current, else the rules sentence from
// current figures; POST regenerates it with the model.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const data = dataOf(s);
    return json({ briefing: await cachedBriefing(data, s.persona.id) });
  });
}

export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, null, "ai");
    if (w instanceof Response) return w;
    return json({ briefing: await generateBriefing(dataOf(w.s), w.s.persona.id) }, { setCookie: w.s.setCookie });
  });
}
