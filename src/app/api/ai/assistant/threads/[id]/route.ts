import { threadMessages } from "@/ai/assistant";
import { dataOf, guarded, json, readSession } from "@/ai/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const t = s.ws === "base" ? null : await threadMessages(dataOf(s), s.persona.id, id);
    return t ? json(t) : json({ error: "Conversation not found" }, { status: 404 });
  });
}
