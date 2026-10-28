import { z } from "zod";

// The AI routes are public and forward input to a paid model, so cap and validate it.
const MAX_BODY_BYTES = 256 * 1024;

const LineItem = z.object({ description: z.string().max(200), amount: z.number().finite() });

export const ValidateRequest = z.object({
  workOrder: z.object({
    id: z.string().max(40),
    title: z.string().max(200),
    po: z.object({
      number: z.string().max(40),
      items: z.array(LineItem).max(50),
      total: z.number().finite(),
      photosRequired: z.number().int().min(0).max(20),
    }),
    submission: z
      .object({
        invoiceNumber: z.string().max(40),
        items: z.array(LineItem).max(50),
        total: z.number().finite(),
        photos: z.array(z.string().max(300)).max(20),
      })
      .optional(),
  }),
});

export const AskRequest = z.object({
  question: z.string().trim().min(1).max(500),
  // Portfolio snapshot from the client's demo store; shape is checked loosely, size by MAX_BODY_BYTES.
  state: z.object({
    properties: z.array(z.unknown()),
    users: z.array(z.unknown()),
    vendors: z.array(z.unknown()),
    tenancies: z.array(z.unknown()),
    invoices: z.array(z.unknown()),
    workOrders: z.array(z.unknown()),
    transfers: z.array(z.unknown()),
    ratings: z.array(z.unknown()),
    notifications: z.array(z.unknown()),
    audit: z.array(z.unknown()),
  }),
});

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  return parsed.data;
}
