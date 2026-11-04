import { rateLimit } from "@/lib/guard";
import { exportCsv, getDef, parseListQuery } from "@/server/query";
import { handle, readCtx } from "../../_lib/http";

// GET /api/e/[entity]/export.csv with the list's URL state: every matching row (up to 10,000),
// the visible columns (or ?cols=), refs as labels and money in dollars.
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  return handle(async () => {
    const limited = await rateLimit(request, "write");
    if (limited) return limited;
    const { entity } = await params;
    const def = getDef(entity);
    const csv = await exportCsv(await readCtx(request), entity, parseListQuery(new URL(request.url).searchParams));
    const name = `${def.label.many.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  });
}
