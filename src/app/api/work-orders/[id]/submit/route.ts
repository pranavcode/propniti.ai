import { SubmitInvoiceRequest } from "@/lib/requests";
import { submitInvoice } from "@/server/actions";
import { write } from "@/server/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return write(request, SubmitInvoiceRequest, (c) => submitInvoice(c.db, c.ws, c.state, id, c.body.items, c.body.photos, c.body.invoiceNumber, c.nowMs));
}
