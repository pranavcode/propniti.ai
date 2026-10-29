import { Empty } from "@/lib/requests";
import { requestChanges } from "@/server/actions";
import { write } from "@/server/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return write(request, Empty, (c) => requestChanges(c.db, c.ws, c.state, id, c.nowMs));
}
