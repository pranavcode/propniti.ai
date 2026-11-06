import { z } from "zod";
import { dataOf, guarded, json, waitUntil, writeSession } from "@/ai/http";
import { drainEvents, emitEvent } from "@/ai/orchestrator";

// Events raised by client-driven flows that have no server action of their own (the import wizard
// creates records through the entity API one by one). Only listed types are accepted, and the
// listening agents start in the background right away instead of waiting for the next sweep.
const Body = z.object({
  type: z.enum(["import.completed"]),
  payload: z.object({ properties: z.number().int().min(0).max(10_000), units: z.number().int().min(0).max(100_000) }).partial().default({}),
});

export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "ai", { staff: true });
    if (w instanceof Response) return w;
    const data = dataOf(w.s);
    await emitEvent(data, { type: w.body.type, payload: w.body.payload });
    waitUntil(drainEvents(w.s.db, w.s.ws, Date.now()).then((r) => Promise.all(r.runs.map((x) => x.done))));
    return json({ ok: true }, { status: 202, setCookie: w.s.setCookie });
  });
}
