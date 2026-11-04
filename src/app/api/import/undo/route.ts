import { handle, json } from "@/app/api/e/_lib/http";
import { parseBody } from "@/lib/requests";
import { importCtx, writeWorkspace } from "@/extensions/import/http";
import { undo, UndoRequest } from "@/extensions/import/server";

// POST { batch }: removes the records one import created (refused once other work depends on them).
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await importCtx(request, "write");
    if (ctx instanceof Response) return ctx;
    const body = await parseBody(request, UndoRequest, 1024);
    if (body instanceof Response) return body;
    const w = await writeWorkspace(request, ctx, false);
    if (w instanceof Response) return w;
    return json(await undo(w.ctx, body.batch), 200, w.setCookie);
  });
}
