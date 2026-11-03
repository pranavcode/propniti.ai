import { z } from "zod";
import { executeProposal } from "@/ai/effects";
import { canDecide, dataOf, guarded, json, writeSession } from "@/ai/http";
import { proposal } from "@/ai/views";

const Bulk = z.object({ ids: z.array(z.string().max(80)).min(1).max(50) });

// "Approve all safe": only low-risk proposals with no amount; anything else is skipped and listed.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Bulk);
    if (w instanceof Response) return w;
    const { s, body } = w;
    const data = dataOf(s);
    const by = { id: s.persona.id, name: s.persona.name, role: s.actor.role };
    const results: { id: string; ok: boolean; message: string }[] = [];
    for (const id of body.ids) {
      const p = await proposal(data, id);
      if (!p) { results.push({ id, ok: false, message: "Not found" }); continue; }
      if (p.risk !== "Low" || p.amount_cents != null) { results.push({ id, ok: false, message: "Needs an individual review (money, legal or higher risk)" }); continue; }
      const allowed = await canDecide(s, p);
      if (!allowed.ok) { results.push({ id, ok: false, message: allowed.error }); continue; }
      const r = await executeProposal(data, p, by, undefined, "Bulk approved (safe items)");
      results.push({ id, ok: r.ok, message: r.message });
    }
    return json({ approved: results.filter((r) => r.ok).length, results }, { setCookie: s.setCookie });
  });
}
