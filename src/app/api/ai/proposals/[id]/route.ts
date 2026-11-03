import { z } from "zod";
import { Edits, executeProposal, rejectProposal } from "@/ai/effects";
import { canDecide, dataOf, guarded, json, writeSession } from "@/ai/http";
import { proposal, proposalOut } from "@/ai/views";

const Decide = z.object({
  decision: z.enum(["approve", "reject", "snooze"]),
  note: z.string().max(500).default(""),
  // Edit before approving: only the message wording can change.
  payload: Edits.optional(),
});

// Accept (runs the action once), edit and accept, reject or snooze. Every decision is audited.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const w = await writeSession(request, Decide);
    if (w instanceof Response) return w;
    const { s, body } = w;
    const data = dataOf(s);
    const p = await proposal(data, id);
    if (!p) return json({ error: "Proposal not found" }, { status: 404 });
    const allowed = canDecide(s, p);
    if (!allowed.ok) return json({ error: allowed.error }, { status: 403 });
    const by = { id: s.persona.id, name: s.persona.name, role: s.actor.role };
    const r = body.decision === "approve" ? await executeProposal(data, p, by, body.payload, body.note) : await rejectProposal(data, p, by, body.note, body.decision === "snooze" ? "Snoozed" : "Rejected");
    if (!r.ok) return json({ error: r.message }, { status: r.status ?? 400, setCookie: s.setCookie });
    return json({ ok: true, message: r.message, href: r.href, proposal: proposalOut(p) }, { setCookie: s.setCookie });
  });
}
