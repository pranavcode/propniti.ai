import { InviteRequest } from "@/lib/requests";
import { invite } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, InviteRequest, (c) => invite(c.db, c.ws, c.state, c.body.emails, c.nowMs));
}
