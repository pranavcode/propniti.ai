import { healthFilters } from "@/ai/filters";
import { dataOf, guarded, json, staffSession } from "@/ai/http";
import { dataHealth, issuesPage } from "@/ai/views";

// Data Health center: scores per property and module, rule list, and a page of issues with fixes.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const sp = new URL(request.url).searchParams;
    const data = dataOf(s);
    const [health, issues] = await Promise.all([
      sp.get("scores") === "0" ? null : dataHealth(data),
      issuesPage(data, { status: sp.get("status") ?? "open", ...healthFilters(sp), page: Number(sp.get("page")) || 1, size: Number(sp.get("size")) || 25 }),
    ]);
    return json({ health, issues });
  });
}
