import { askAssistant } from "@/lib/llm";
import { AskRequest, parseBody } from "@/lib/requests";
import type { DemoState } from "@/lib/types";

export async function POST(request: Request) {
  const body = await parseBody(request, AskRequest);
  if (body instanceof Response) return body;
  return Response.json(await askAssistant(body.question, body.state as DemoState));
}
