import { Empty } from "@/lib/requests";
import { disburseOwner } from "@/server/money";
import { write } from "@/server/route";

type Params = { params: Promise<{ id: string }> };

// The client sends a fresh Idempotency-Key per click; a retry with the same key pays once.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return Response.json({ error: "Idempotency-Key header required" }, { status: 400 });
  return write(request, Empty, (c) => disburseOwner(c.db, c.ws, c.state, id, key, c.nowMs));
}
