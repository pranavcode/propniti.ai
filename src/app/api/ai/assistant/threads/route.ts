import { threads } from "@/ai/assistant";
import { dataOf, guarded, json, readSession } from "@/ai/http";

export async function GET(request: Request) {
  return guarded(async () => {
    const s = await readSession(request);
    if (s instanceof Response) return s;
    if (s.ws === "base") return json({ threads: [] });
    return json({ threads: await threads(dataOf(s), s.persona.id) });
  });
}
