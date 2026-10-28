import { rateLimit } from "@/lib/guard";
import { mapImportColumns } from "@/lib/llm";
import { ImportMapRequest, parseBody } from "@/lib/requests";

export async function POST(request: Request) {
  const limited = await rateLimit(request);
  if (limited) return limited;
  const body = await parseBody(request, ImportMapRequest);
  if (body instanceof Response) return body;
  return Response.json(await mapImportColumns(body.headers, body.samples));
}
