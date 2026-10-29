import { UpdateJobRequest } from "@/lib/requests";
import { updateJob } from "@/server/actions";
import { write } from "@/server/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return write(request, UpdateJobRequest, (c) => updateJob(c.db, c.ws, c.state, id, c.body.status, c.body.photo, c.nowMs));
}
