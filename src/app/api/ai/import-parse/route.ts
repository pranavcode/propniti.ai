import { rateLimit } from "@/lib/guard";
import { parsePortfolioText } from "@/lib/llm";
import { ImportParseRequest, parseBody } from "@/lib/requests";

export async function POST(request: Request) {
  const limited = await rateLimit(request);
  if (limited) return limited;
  const body = await parseBody(request, ImportParseRequest);
  if (body instanceof Response) return body;
  return Response.json(await parsePortfolioText(body.text));
}
