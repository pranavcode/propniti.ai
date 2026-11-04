import { z } from "zod";
import { QueryError } from "@/server/query";
import { handle, json, writeCtx } from "../../../_lib/http";
import { aiLimit, inputSchema, resolveAction, runAction } from "../../../_lib/actions";

type Ctx = { params: Promise<{ entity: string; action: string }> };

// Each record costs ~5 D1 queries (scope read, guards, audit); keep a request well under the
// per-invocation query limit.
const MAX_BULK = 25;

// POST /api/e/[entity]/actions/[action] { ids, input }: a bulk action (ActionDef.bulk), run one
// record at a time so each keeps its own guards; the response reports each id.
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity, action } = await params;
    const a = resolveAction(entity, action);
    if (!a.bulk) throw new QueryError(400, `${a.label} runs on one record at a time`);
    const limited = await aiLimit(request, a);
    if (limited) return limited;
    const w = await writeCtx(request, z.strictObject({ ids: z.array(z.string().min(1).max(80)).min(1).max(MAX_BULK), input: inputSchema(a).optional() }));
    if (w instanceof Response) return w;
    const results: { id: string; status: number; error?: string; message?: string }[] = [];
    for (const id of new Set(w.body.ids)) {
      try {
        const r = await runAction(w.ctx, a, id, w.body.input ?? {});
        results.push(r.status === 200 || r.status === 202 ? { id, status: r.status, message: r.message } : { id, status: r.status, error: r.error });
      } catch (e) {
        if (!(e instanceof QueryError)) throw e;
        results.push({ id, status: e.status, error: e.message });
      }
    }
    const ok = results.filter((r) => r.status === 200).length;
    return json({ ok, failed: results.length - ok, results }, ok ? 200 : 409, w.setCookie);
  });
}
