import { z } from "zod";
import { forgetInboxCounts } from "@/extensions/inbox/counts";
import { approveSafe, BULK_CAP, safeMatching } from "@/ai/bulk";
import { RISKS } from "@/ai/filters";
import { guarded, json, writeSession } from "@/ai/http";

// The inbox filters; "approve all matching" re-reads the matching ids on the server.
const Match = z.object({ agent: z.string().max(40).optional(), risk: z.enum(RISKS).optional(), property: z.string().max(40).optional(), entity: z.string().max(60).optional() }).strict();
const Bulk = z.union([
  z.object({ ids: z.array(z.string().max(80)).min(1).max(50) }).strict(),
  z.object({ match: Match, preview: z.boolean().default(false) }).strict(),
]);

// "Approve all safe": only low-risk proposals with no amount; anything else is skipped and listed.
// With `match`, preview returns how many would be approved (capped) and the real call approves them.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, Bulk, "write", { staff: true });
    if (w instanceof Response) return w;
    const { s, body } = w;
    let ids: string[];
    let more = false;
    if ("match" in body) {
      const m = await safeMatching(s, body.match);
      if (body.preview) return json({ count: m.count, more: m.more, cap: BULK_CAP }, { setCookie: s.setCookie });
      ids = m.ids;
      more = m.more;
    } else ids = body.ids;
    const r = await approveSafe(s, ids);
    forgetInboxCounts(s.ws);
    return json({ ...r, more }, { setCookie: s.setCookie });
  });
}
