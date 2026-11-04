import { aboutCard } from "@/ai/about";
import { dataOf, guarded, json, readSession } from "@/ai/http";

// "Ask about this": the record card and suggested questions the panel opens with. No model call.
export async function GET(request: Request) {
  return guarded(async () => {
    const sp = new URL(request.url).searchParams;
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const c = await aboutCard(dataOf(s), (sp.get("entity") ?? "").slice(0, 40), (sp.get("id") ?? "").slice(0, 80)).catch(() => null);
    return c ? json(c) : json({ error: "Record not found" }, { status: 404 });
  });
}
