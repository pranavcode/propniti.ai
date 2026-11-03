import { z } from "zod";
import { nlFilter } from "@/ai/nlfilter";
import { dataOf, guarded, json, readSession } from "@/ai/http";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";

const Body = z.object({ entity: z.string().max(40), text: z.string().trim().min(2).max(300) });

// DataTable ✦ AI filter: { entity, text } → { view: { filters, q?, sort? }, explanation, dropped }.
export async function POST(request: Request) {
  return guarded(async () => {
    const limited = await rateLimit(request);
    if (limited) return limited;
    const body = await parseBody(request, Body, 4096);
    if (body instanceof Response) return body;
    const s = await readSession(request);
    if (s instanceof Response) return s;
    return json(await nlFilter(dataOf(s), body.entity, body.text));
  });
}
