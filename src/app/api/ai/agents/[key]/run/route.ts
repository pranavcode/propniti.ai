import { guarded, json, waitUntil, writeSession } from "@/ai/http";
import { runNow } from "@/ai/orchestrator";

// "Run now": creates the run, answers with its id at once, and finishes the run in the background
// (ctx.waitUntil). The page follows it live on /api/ai/runs/<id>/stream. A run of this agent that
// is still going is returned instead of starting a second one.
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return guarded(async () => {
    const { key } = await params;
    const w = await writeSession(request, null, "ai", { staff: true });
    if (w instanceof Response) return w;
    const { s } = w;
    const r = await runNow({ db: s.db, ws: s.ws, actor: s.actor, persona: s.persona, waitUntil }, key);
    if (!r.ok) return json({ error: r.status === 404 ? r.error : `${s.persona.title} can't run agents` }, { status: r.status });
    return json({ runId: r.runId, href: r.href, already: r.already }, { status: r.already ? 200 : 202, setCookie: s.setCookie });
  });
}
