import { deleteRecord, getDef, getRow, QueryError, relations, updateRecord, writeSchema } from "@/server/query";
import { Empty } from "@/lib/requests";
import { actionsForRow } from "@/server/permissions";
import { peekData } from "@/components/entity/peek";
import { handle, json, readCtx, writeCtx } from "../../_lib/http";

type Ctx = { params: Promise<{ entity: string; id: string }> };

// GET /api/e/[entity]/[id]: the record, its relations (?relations=0 to skip) and the actions
// this role may run on it. ?peek=1 instead returns the record page header data the peek drawer
// shows (facts, status, data health, AI summary, related counts, edit fields).
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity, id } = await params;
    const ctx = await readCtx(request);
    const def = getDef(entity);
    const row = await getRow(ctx, entity, id);
    if (!row) throw new QueryError(404, `${def.label.one} not found`);
    const sp = new URL(request.url).searchParams;
    if (sp.get("peek") === "1") return json({ row, peek: await peekData(ctx, def, row) });
    const withRelations = sp.get("relations") !== "0";
    return json({
      row,
      relations: withRelations ? await relations(ctx, def, row) : undefined,
      actions: actionsForRow(def.key, ctx.actor.role, row).map((a) => ({ key: a.key, label: a.label, confirm: a.confirm, bulk: !!a.bulk, money: !!a.money, hasInput: !!a.input })),
    });
  });
}

function genericOnly(entity: string) {
  const def = getDef(entity);
  if (def.writes !== "generic") throw new QueryError(405, `${def.label.many} change only through named actions`);
  return def;
}

export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity, id } = await params;
    const def = genericOnly(entity);
    const w = await writeCtx(request, (c) => writeSchema(def, c.actor.role, "update"));
    if (w instanceof Response) return w;
    return json({ row: await updateRecord(w.ctx, entity, id, w.body) }, 200, w.setCookie);
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { entity, id } = await params;
    genericOnly(entity);
    const w = await writeCtx(request, Empty);
    if (w instanceof Response) return w;
    await deleteRecord(w.ctx, entity, id);
    return json({ ok: true }, 200, w.setCookie);
  });
}
