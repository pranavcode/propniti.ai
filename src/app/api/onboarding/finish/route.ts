import { Empty } from "@/lib/requests";
import { finishOnboarding } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, Empty, (c) => finishOnboarding(c.db, c.ws));
}
