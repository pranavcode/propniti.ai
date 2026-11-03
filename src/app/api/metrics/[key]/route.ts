import { metrics } from "@/server/query";
import { handle, json, readCtx } from "../../e/_lib/http";

// GET /api/metrics/[key]?property=&months=&month=YYYY-MM: KPI/chart data within the persona's scope.
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return handle(async () => {
    const { key } = await params;
    const sp = new URL(request.url).searchParams;
    return json(await metrics(await readCtx(request), key, {
      property: sp.get("property") ?? undefined,
      months: sp.get("months") ? Number(sp.get("months")) : undefined,
      month: sp.get("month") ?? undefined,
    }));
  });
}
