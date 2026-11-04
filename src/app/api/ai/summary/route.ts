import { z } from "zod";
import { cachedSummary, generateSummary } from "@/ai/summaries";
import { dataOf, guarded, json, readSession, writeSession } from "@/ai/http";

// Record summary for the AISummaryCard: GET returns the cached one (precomputed or regenerated);
// POST regenerates it live (AI rate limit) and caches it in the visitor's workspace.
export async function GET(request: Request) {
  return guarded(async () => {
    const sp = new URL(request.url).searchParams;
    const entity = sp.get("entity") ?? "";
    const id = sp.get("id") ?? "";
    const s = await readSession(request);
    if (s instanceof Response) return s;
    return json({ summary: await cachedSummary(dataOf(s), entity, id) });
  });
}

const Body = z.object({ entity: z.string().max(40), id: z.string().max(80) });
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "ai");
    if (w instanceof Response) return w;
    const r = await generateSummary(dataOf(w.s), w.body.entity, w.body.id);
    return r ? json({ summary: r }, { setCookie: w.s.setCookie }) : json({ error: "Record not found" }, { status: 404 });
  });
}
