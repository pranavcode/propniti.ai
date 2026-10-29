import { z } from "zod";
import { readBodyLimited } from "./guard";

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
  // Portfolio snapshot from the client's demo store. Fields the assistant reads are checked
  // strictly; everything else passes through, capped by MAX_BODY_BYTES.
  state: z.object({
    properties: z.array(z.looseObject({ id: z.string(), name: z.string(), units: z.number(), occupied: z.number() })),
    users: z.array(z.looseObject({ id: z.string(), name: z.string() })),
    vendors: z.array(z.unknown()),
    tenancies: z.array(z.looseObject({ id: z.string(), propertyId: z.string(), unit: z.string(), tenantId: z.string(), rent: z.number(), leaseEnd: z.string(), status: z.string() })),
    invoices: z.array(z.looseObject({ id: z.string(), tenancyId: z.string(), amount: z.number(), due: z.string(), status: z.string() })),
    workOrders: z.array(z.looseObject({ id: z.string(), title: z.string(), propertyId: z.string(), status: z.string() })),
    transfers: z.array(z.unknown()),
    ratings: z.array(z.unknown()),
    notifications: z.array(z.unknown()),
    audit: z.array(z.unknown()),
  }),
});

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | Response> {
  const bytes = await readBodyLimited(request, MAX_BODY_BYTES);
  if (bytes instanceof Response) return bytes;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  return parsed.data;
}

export const ImportMapRequest = z.object({
  headers: z.array(z.string().max(120)).min(1).max(60),
  samples: z.array(z.array(z.string().max(300)).max(60)).max(5),
});

export const ImportParseRequest = z.object({ text: z.string().trim().min(1).max(20_000) });
