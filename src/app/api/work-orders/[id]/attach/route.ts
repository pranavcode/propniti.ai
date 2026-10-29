import { AttachRequest } from "@/lib/requests";
import { attachDocument } from "@/server/actions";
import { write } from "@/server/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return write(request, AttachRequest, (c) => attachDocument(c.db, c.ws, c.state, id, c.body.invoice, c.nowMs));
}
