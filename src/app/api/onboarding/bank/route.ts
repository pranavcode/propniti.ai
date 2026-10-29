import { BankRequest } from "@/lib/requests";
import { connectBank } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, BankRequest, (c) => connectBank(c.db, c.ws, c.body.bank, c.nowMs));
}
