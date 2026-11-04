import { handle, json, writeCtx } from "@/app/api/e/_lib/http";
import { OnboardingPatch, canOnboard } from "@/extensions/onboarding/state";
import { saveState } from "@/extensions/onboarding/server";

// POST a patch of onboarding progress (current step, steps done or skipped, answers). Stored in the
// org's settings in the visitor's workspace; finished steps also tick the setup checklist.
export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, OnboardingPatch);
    if (w instanceof Response) return w;
    if (!canOnboard(w.ctx.actor.role)) return json({ error: "Only a principal, regional manager or administrator sets up the org" }, 403, w.setCookie);
    return json({ state: await saveState(w.ctx, w.body) }, 200, w.setCookie);
  });
}
