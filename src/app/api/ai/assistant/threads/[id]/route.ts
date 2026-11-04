import { threadMessages } from "@/ai/assistant";
import { dataOf, guarded, json, readSession } from "@/ai/http";

// One of the persona's conversations, last `limit` messages (default 30, at most 100).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const limit = Number(new URL(request.url).searchParams.get("limit")) || 30;
    const t = await threadMessages(dataOf(s), s.persona.id, id.slice(0, 80), limit);
    return t ? json(t) : json({ error: "Conversation not found" }, { status: 404 });
  });
}
