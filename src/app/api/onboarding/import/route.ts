import { ImportRequest } from "@/lib/requests";
import { importRows } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, ImportRequest, (c) => importRows(c.db, c.ws, c.state, c.body.rows, c.body.source, c.nowMs));
}
