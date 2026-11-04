import { z } from "zod";
import { applyFixes, BULK_FIX_CAP, issueTargets } from "@/ai/datafix";
import { dataOf, guarded, json, writeSession } from "@/ai/http";

const f = z.string().max(120).optional();
const Match = z.object({ severity: f, rule: f, property: f, entity: f, entity_id: f, issue: f }).strict();
const Body = z.union([
  z.object({ ids: z.array(z.string().max(80)).min(1).max(50) }).strict(),
  z.object({ match: Match, mode: z.enum(["safe", "send"]), preview: z.boolean().default(false) }).strict(),
]);

// "Apply all safe fixes": formatting and typo fixes only; money, fraud and legal fixes are skipped.
// With `match`, the page's filters pick the issues on the server across every page (capped):
// mode "safe" applies them, mode "send" queues the ones a person must approve. preview only counts.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Body, "write", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    const data = dataOf(s);
    if (!("match" in body)) return json(await applyFixes(data, s.persona, body.ids, { safeOnly: true }), { setCookie: s.setCookie });
    const t = await issueTargets(data, body.match, body.mode);
    if (body.preview || !t.ids.length) return json({ count: t.count, more: t.more, cap: BULK_FIX_CAP, applied: 0, queued: 0 }, { setCookie: s.setCookie });
    const r = await applyFixes(data, s.persona, t.ids, { safeOnly: body.mode === "safe" });
    return json({ ...r, more: t.more }, { setCookie: s.setCookie });
  });
}
