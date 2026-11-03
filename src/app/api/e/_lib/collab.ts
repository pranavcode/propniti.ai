import { addCollab, collab, noteSchema, taskSchema, type Collab } from "@/server/query";
import { handle, json, readCtx, writeCtx } from "./http";

// Notes, tasks, activity and documents on any record. Reading needs read access to the record;
// adding a note or task too (collaboration, not a record edit).

type Ctx = { params: Promise<{ entity: string; id: string }> };

export const collabGet = (kind: Collab) => async (request: Request, { params }: Ctx) =>
  handle(async () => {
    const { entity, id } = await params;
    const sp = new URL(request.url).searchParams;
    return json(await collab(await readCtx(request), kind, entity, id, Number(sp.get("page")) || 1, Number(sp.get("size")) || 50));
  });

export const collabPost = (kind: "notes" | "tasks") => async (request: Request, { params }: Ctx) =>
  handle(async () => {
    const { entity, id } = await params;
    const w = await writeCtx(request, kind === "notes" ? noteSchema : taskSchema);
    if (w instanceof Response) return w;
    return json({ row: await addCollab(w.ctx, kind, entity, id, w.body) }, 201, w.setCookie);
  });
