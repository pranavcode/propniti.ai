import { Empty } from "@/lib/requests";
import { write } from "@/server/route";
import { resetWorkspace } from "@/server/workspace";

export async function POST(request: Request) {
  return write(request, Empty, async (c) => {
    await resetWorkspace(c.db, c.ws, c.nowMs);
    return { status: 200 };
  });
}
