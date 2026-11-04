import { z } from "zod";
import { applyFixes, dismissIssue } from "@/ai/datafix";
import { DB_BUSY, dataOf, guarded, json, writeSession } from "@/ai/http";

const Body = z.object({ action: z.enum(["apply", "dismiss"]), note: z.string().max(300).default("") });

// FixPreview buttons: apply the suggested fix (audited, logged with before/after) or dismiss it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const w = await writeSession(request, Body, "write", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    const data = dataOf(s);
    if (body.action === "dismiss") {
      const r = await dismissIssue(data, s.persona, id, body.note);
      return r.ok ? json(r, { setCookie: s.setCookie }) : json({ error: r.message }, { status: r.status ?? 400 });
    }
    const r = await applyFixes(data, s.persona, [id], { safeOnly: false });
    const one = r.results[0];
    if (one?.ok) return json({ ok: true, message: one.message, runId: r.runId }, { setCookie: s.setCookie });
    // Not applied but waiting in the approvals inbox: accepted, not an error.
    if (one?.queued) return json({ ok: false, queued: true, proposalId: one.proposalId, message: one.message, runId: r.runId }, { status: 202, setCookie: s.setCookie });
    const message = one?.message ?? "Couldn't apply";
    return json({ error: message, runId: r.runId }, { status: message === DB_BUSY ? 503 : 400 });
  });
}
