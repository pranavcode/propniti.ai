import { validateWorkOrder } from "@/lib/llm";
import { ValidateRequest, parseBody } from "@/lib/requests";
import type { WorkOrder } from "@/lib/types";

export async function POST(request: Request) {
  const body = await parseBody(request, ValidateRequest);
  if (body instanceof Response) return body;
  return Response.json(await validateWorkOrder(body.workOrder as WorkOrder));
}
