import { dataOf, guarded, json, staffSession } from "@/ai/http";
import { runsPage } from "@/ai/views";

export async function GET(request: Request) {
  return guarded(async () => {
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const sp = new URL(request.url).searchParams;
    return json(await runsPage(dataOf(s), { agent: sp.get("agent") ?? undefined, status: sp.get("status") ?? undefined, trigger: sp.get("trigger") ?? undefined, page: Number(sp.get("page")) || 1, size: Number(sp.get("size")) || 25 }));
  });
}
