import { getDef, matchingIds, parseListQuery, withView } from "@/server/query";
import { handle, json, readCtx } from "../../_lib/http";

// GET /api/e/[entity]/ids with the list's URL state: the ids of every matching record the
// persona can see, up to BULK_MATCH_CAP, for "Select all matching" bulk actions.
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  return handle(async () => {
    const { entity } = await params;
    const q = parseListQuery(withView(getDef(entity), new URL(request.url).searchParams));
    return json(await matchingIds(await readCtx(request), entity, q));
  });
}
