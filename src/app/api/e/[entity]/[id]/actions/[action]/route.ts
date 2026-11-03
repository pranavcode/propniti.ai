import { handle, json, writeCtx } from "../../../../_lib/http";
import { aiLimit, inputSchema, resolveAction, runAction } from "../../../../_lib/actions";

type Ctx = { params: Promise<{ entity: string; id: string; action: string }> };

// POST /api/e/[entity]/[id]/actions/[action]: body is the action's input (ActionDef.input).
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity, id, action } = await params;
    const a = resolveAction(entity, action);
    const limited = await aiLimit(request, a);
    if (limited) return limited;
    const w = await writeCtx(request, inputSchema(a));
    if (w instanceof Response) return w;
    const r = await runAction(w.ctx, a, id, w.body);
    return json(r.status === 200 ? { ok: true, message: r.message, href: r.href } : { error: r.error }, r.status, w.setCookie);
  });
}
