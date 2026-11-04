import { forgetInboxCounts } from "@/extensions/inbox/counts";
import { PaymentRunInput, payRun } from "@/extensions/payables/paymentRun";
import { forgetOverlay } from "@/server/query";
import { handle, json, writeCtx } from "../../e/_lib/http";

// POST /api/payables/payment-run { ids }: pays one chunk of a payment run (at most 25 bills). Each
// bill goes through payBill's guards and audit; the response reports each bill.
export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, PaymentRunInput);
    if (w instanceof Response) return w;
    const r = await payRun({ db: w.ctx.db, ws: w.ctx.ws, actor: w.ctx.actor, nowMs: w.ctx.nowMs }, w.body.ids);
    forgetOverlay(w.ctx.actor);
    forgetInboxCounts(w.ctx.ws);
    return json(r.error ? { error: r.error } : { results: r.results }, r.status, w.setCookie);
  });
}
