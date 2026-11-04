import { handle, json } from "@/app/api/e/_lib/http";
import { parseBody } from "@/lib/requests";
import { AiRequest, suggest } from "@/extensions/import/ai";
import { importCtx } from "@/extensions/import/http";

// POST headers + a few sample rows + flagged cells → suggestions to accept (AI rate limit applies).
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await importCtx(request, "ai");
    if (ctx instanceof Response) return ctx;
    const body = await parseBody(request, AiRequest, 64 * 1024);
    if (body instanceof Response) return body;
    return json(await suggest(body));
  });
}
