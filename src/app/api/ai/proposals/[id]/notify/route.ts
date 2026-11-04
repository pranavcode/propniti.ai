import { z } from "zod";
import { forgetInboxCounts } from "@/extensions/inbox/counts";
import { guarded, json, writeSession } from "@/ai/http";
import { notifyApprover } from "@/ai/notify";

// "Notify approver" on a proposal this persona can see but not decide.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const w = await writeSession(request, z.object({}).strict(), "write", { staff: true });
    if (w instanceof Response) return w;
    const r = await notifyApprover(w.s, id);
    if (r.ok) forgetInboxCounts(w.s.ws);
    return r.ok ? json(r, { setCookie: w.s.setCookie }) : json({ error: r.error }, { status: r.status, setCookie: w.s.setCookie });
  });
}
