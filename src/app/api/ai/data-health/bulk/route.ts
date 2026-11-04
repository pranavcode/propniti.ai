import { z } from "zod";
import { applyFixes } from "@/ai/datafix";
import { dataOf, guarded, json, writeSession } from "@/ai/http";

const Body = z.object({ ids: z.array(z.string().max(80)).min(1).max(50) });

// "Apply all safe fixes": formatting and typo fixes only; money, fraud and legal fixes are skipped.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "write", { staff: true });
    if (w instanceof Response) return w;
    const r = await applyFixes(dataOf(w.s), w.s.persona, w.body.ids, { safeOnly: true });
    return json(r, { setCookie: w.s.setCookie });
  });
}
