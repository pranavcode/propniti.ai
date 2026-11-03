import { rateLimit } from "@/lib/guard";
import { parsePortfolioText } from "@/lib/llm";
import { ImportParseRequest, parseBody } from "@/lib/requests";
import { sameOrigin } from "@/ai/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request);
  if (limited) return limited;
  const body = await parseBody(request, ImportParseRequest);
  if (body instanceof Response) return body;
  return Response.json(await parsePortfolioText(body.text));
}
