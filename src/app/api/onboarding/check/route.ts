import { z } from "zod";
import { demoNowIso } from "@/lib/clock";
import { handle, json, writeCtx } from "@/app/api/e/_lib/http";
import { canOnboard } from "@/extensions/onboarding/state";
import { liveImport, runChecks, saveState } from "@/extensions/onboarding/server";

const Body = z.strictObject({ batch: z.string().regex(/^[0-9a-f]{10}$/) });

// POST { batch }: run the Data Health rules over that import's records, file what they find as
// open data issues (once per record and rule), and record the result in onboarding progress.
export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, Body);
    if (w instanceof Response) return w;
    if (!canOnboard(w.ctx.actor.role)) return json({ error: "Only a principal, regional manager or administrator sets up the org" }, 403, w.setCookie);
    if (!(await liveImport(w.ctx, w.body.batch))) return json({ error: "No import with that id in your workspace, or it was undone." }, 404, w.setCookie);
    const result = await runChecks(w.ctx, w.body.batch);
    await saveState(w.ctx, { done: ["check"], check: { issues: result.issues.length, rules: result.rules, at: demoNowIso(w.ctx.nowMs) } });
    return json(result, 200, w.setCookie);
  });
}
