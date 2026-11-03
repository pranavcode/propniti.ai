import { createRecord, getDef, list, parseListQuery, QueryError, writeSchema } from "@/server/query";
import { handle, json, readCtx, writeCtx } from "../_lib/http";

type Ctx = { params: Promise<{ entity: string }> };

// GET /api/e/[entity]?q=&f.<field>=&f.<field>.min=&sort=-field&page=&size=&cursor=
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity } = await params;
    const ctx = await readCtx(request);
    return json(await list(ctx, entity, parseListQuery(new URL(request.url).searchParams)));
  });
}

export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity } = await params;
    const def = getDef(entity);
    if (def.writes !== "generic") throw new QueryError(405, `${def.label.many} change only through named actions`);
    const w = await writeCtx(request, (c) => writeSchema(def, c.actor.role, "create"));
    if (w instanceof Response) return w;
    return json({ row: await createRecord(w.ctx, entity, w.body) }, 201, w.setCookie);
  });
}
