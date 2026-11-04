import { handle, json } from "@/app/api/e/_lib/http";
import { parseBody } from "@/lib/requests";
import { importCtx } from "@/extensions/import/http";
import { DetectRequest, detectWithModel } from "@/extensions/onboarding/ai";

// POST file names, header rows and up to three sample rows → the model's guess of each file's
// source tool and record type (AI rate limit applies). Rules answer when no model is configured.
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await importCtx(request, "ai");
    if (ctx instanceof Response) return ctx;
    const body = await parseBody(request, DetectRequest, 64 * 1024);
    if (body instanceof Response) return body;
    return json(await detectWithModel(body));
  });
}
