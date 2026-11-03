import { listViews, QueryError, saveView, viewSchema } from "@/server/query";
import { handle, json, readCtx, writeCtx } from "../e/_lib/http";

// Saved views for a list: shared ones and the persona's own. Built-in views ship in the def.
export async function GET(request: Request) {
  return handle(async () => {
    const entity = new URL(request.url).searchParams.get("entity");
    if (!entity) throw new QueryError(400, "entity is required");
    return json({ views: await listViews(await readCtx(request), entity) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const w = await writeCtx(request, viewSchema);
    if (w instanceof Response) return w;
    return json({ view: await saveView(w.ctx, w.body) }, 201, w.setCookie);
  });
}
