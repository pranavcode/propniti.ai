import { agentCards, aiStatus } from "@/ai/views";
import { dataOf, guarded, json, staffSession, waitUntil } from "@/ai/http";
import { maybeSweep } from "@/ai/sweep";

// Agents command center data: one card per agent, plus the model in use and the last sweep.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    maybeSweep(s.db, waitUntil);
    const data = dataOf(s);
    const [agents, status] = await Promise.all([agentCards(data), aiStatus(data)]);
    return json({ agents, status });
  });
}
