import { Empty } from "@/lib/requests";
import { deleteView } from "@/server/query";
import { handle, json, writeCtx } from "../../e/_lib/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const w = await writeCtx(request, Empty);
    if (w instanceof Response) return w;
    await deleteView(w.ctx, id);
    return json({ ok: true }, 200, w.setCookie);
  });
}
