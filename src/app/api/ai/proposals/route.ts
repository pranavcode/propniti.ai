import { dataOf, guarded, json, staffSession } from "@/ai/http";
import { proposalsPage, type Queue } from "@/ai/views";

const QUEUES = new Set(["needs_you", "auto_handled", "waiting", "decided"]);

// Approvals inbox: needs_you | auto_handled | waiting | decided, with counts for the tabs.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const sp = new URL(request.url).searchParams;
    const q = sp.get("queue") ?? "needs_you";
    return json(await proposalsPage(dataOf(s), { queue: (QUEUES.has(q) ? q : "needs_you") as Queue, agent: sp.get("agent") ?? undefined, risk: sp.get("risk") ?? undefined, page: Number(sp.get("page")) || 1, size: Number(sp.get("size")) || 25 }));
  });
}
