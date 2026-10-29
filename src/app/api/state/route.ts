import { readState } from "@/server/route";

export async function GET(request: Request) {
  return readState(request);
}
