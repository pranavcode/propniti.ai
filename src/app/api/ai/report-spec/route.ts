import { z } from "zod";
import { askReport } from "@/extensions/accounting/reports/ask";
import { scopeProperties } from "@/extensions/accounting/reports/run";
import { addMonths } from "@/extensions/accounting/reports/spec";
import { guarded, json, readSession } from "@/ai/http";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";
import { asOfMonth } from "@/server/query";

const Body = z.object({ text: z.string().trim().min(2).max(300) });

// The report builder's words → report spec (the same askReport the reports page runs), for the
// eval runner and API clients. Read-only; the persona's scope limits the properties.
export async function POST(request: Request) {
  return guarded(async () => {
    const limited = await rateLimit(request);
    if (limited) return limited;
    const body = await parseBody(request, Body, 4096);
    if (body instanceof Response) return body;
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const ctx = { db: s.db, ws: s.ws === "base" ? null : s.ws, actor: s.actor };
    const [scope, month] = await Promise.all([scopeProperties(ctx), asOfMonth(s.db)]);
    return json(await askReport(body.text, scope, addMonths(month, -1)));
  });
}
