import { rateLimit } from "@/lib/guard";
import { validateWorkOrder } from "@/lib/llm";
import { ValidateRequest, parseBody } from "@/lib/requests";
import type { WorkOrder } from "@/lib/types";
import { sameOrigin } from "@/ai/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request);
  if (limited) return limited;
  const body = await parseBody(request, ValidateRequest);
  if (body instanceof Response) return body;
  return Response.json(await validateWorkOrder(body.workOrder as WorkOrder));
}
