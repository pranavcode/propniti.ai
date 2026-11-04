import { ask, AskRequest } from "@/ai/assistant";
import { dataOf, guarded, json, waitUntil, writeSession } from "@/ai/http";

// The assistant (⌘J and /app/copilot): chat about data, actions to confirm, and help.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, AskRequest, "ai");
    if (w instanceof Response) return w;
    const { s, body } = w;
    const reply = await ask({ data: dataOf(s), persona: s.persona, question: body.question, mode: body.mode, threadId: body.threadId, context: body.context, waitUntil });
    return json(reply, { setCookie: s.setCookie });
  });
}
