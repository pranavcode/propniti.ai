import { PERMISSIONS } from "@/auth/personas";
import { getAgent } from "@/ai/agents";
import { guarded, json, waitUntil, writeSession } from "@/ai/http";
import { startRun } from "@/ai/orchestrator";

// "Run now": creates the run, answers with its id at once, and finishes the run in the background
// (ctx.waitUntil). The page follows it live on /api/ai/runs/<id>/stream.
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return guarded(async () => {
    const { key } = await params;
    const def = getAgent(key);
    if (!def) return json({ error: "Unknown agent" }, { status: 404 });
    const w = await writeSession(request, null, "ai", { staff: true });
    if (w instanceof Response) return w;
    const { s } = w;
    if ((PERMISSIONS[s.actor.role].intelligence ?? "none") === "none") return json({ error: `${s.persona.title} can't run agents` }, { status: 403 });
    const { runId } = await startRun({ db: s.db, ws: s.ws, actor: s.actor, agent: def.key, trigger: { kind: "manual" }, waitUntil });
    return json({ runId, href: `/app/ai/runs/${runId}` }, { status: 202, setCookie: s.setCookie });
  });
}
