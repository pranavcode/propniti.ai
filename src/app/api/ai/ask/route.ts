import { ask, AskRequest } from "@/ai/assistant";
import { dataOf, guarded, json, waitUntil, writeSession } from "@/ai/http";

// v1 path, kept for the eval runner and old clients: the same assistant as /api/ai/assistant,
// with the v1 field names added (suggestedActions, source "mock" when rules answered).
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, AskRequest, "ai");
    if (w instanceof Response) return w;
    const { s, body } = w;
    const r = await ask({ data: dataOf(s), persona: s.persona, question: body.question, mode: body.mode, threadId: body.threadId, context: body.context, waitUntil });
    return json({ ...r, suggestedActions: [], source: r.live ? r.model : "mock", label: r.source }, { setCookie: s.setCookie });
  });
}
