import { threads } from "@/ai/assistant";
import { dataOf, guarded, json, readSession } from "@/ai/http";

// The persona's recent conversations (newest first), for the ⌘J panel's history list.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const limit = Number(new URL(request.url).searchParams.get("limit")) || 20;
    return json({ threads: await threads(dataOf(s), s.persona.id, limit) });
  });
}
