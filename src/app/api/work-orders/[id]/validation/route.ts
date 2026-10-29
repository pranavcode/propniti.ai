import { ValidationRequest } from "@/lib/requests";
import { setValidation } from "@/server/actions";
import { write } from "@/server/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return write(request, ValidationRequest, (c) => setValidation(c.db, c.ws, c.state, id, c.body.validation, c.body.forSubmission, c.nowMs));
}
