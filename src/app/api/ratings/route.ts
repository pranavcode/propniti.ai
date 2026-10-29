import { RateRequest } from "@/lib/requests";
import { rate } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, RateRequest, (c) => rate(c.db, c.ws, c.state, c.body.by, c.body.subject, c.body.stars, c.body.comment, c.body.ref, c.nowMs));
}
