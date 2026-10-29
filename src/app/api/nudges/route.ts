import { NudgeRequest } from "@/lib/requests";
import { nudge } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, NudgeRequest, (c) => nudge(c.db, c.ws, c.state, c.body.userId, c.body.message, c.body.actor, c.nowMs));
}
