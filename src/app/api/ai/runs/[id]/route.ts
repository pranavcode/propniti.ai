import { dataOf, guarded, json, staffSession } from "@/ai/http";
import { runDetail } from "@/ai/views";

// One run with its steps (after=<idx> returns only newer steps, for polling) and proposals.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const after = Number(new URL(request.url).searchParams.get("after") ?? -1);
    const r = await runDetail(dataOf(s), id, Number.isFinite(after) ? after : -1);
    return r ? json(r) : json({ error: "Run not found" }, { status: 404 });
  });
}
