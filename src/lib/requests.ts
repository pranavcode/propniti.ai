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

export async function parseBody<T extends z.ZodType>(request: Request, schema: T, maxBytes = MAX_BODY_BYTES): Promise<z.infer<T> | Response> {
  const bytes = await readBodyLimited(request, maxBytes);
  if (bytes instanceof Response) return bytes;
  let json: unknown;
  try {
    json = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {};
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

// Demo data routes (src/app/api/*, except ai). Amounts are dollars; the server stores cents.
const Amount = z.number().finite().min(-1_000_000).max(1_000_000);
const Id = z.string().min(1).max(64);
const Text = (max: number) => z.string().max(max);
const MoneyItem = z.object({ description: Text(200), amount: Amount });

export const Empty = z.object({});

export const SubmitInvoiceRequest = z.object({
  items: z.array(MoneyItem).min(1).max(50),
  photos: z.array(Text(300)).max(20),
  invoiceNumber: Text(40).optional(),
});

export const AttachRequest = z.object({
  invoice: z.object({
    isInvoice: z.boolean(),
    vendor: Text(200),
    invoiceNumber: Text(40),
    invoiceDate: Text(40),
    lineItems: z.array(MoneyItem).max(50),
    total: Amount,
    currency: Text(10),
    confidence: z.number().min(0).max(1),
    issues: z.array(Text(300)).max(20),
  }),
});

export const UpdateJobRequest = z.object({
  status: z.enum(["Assigned", "In progress", "Completed"]),
  photo: Text(300).optional(),
});

export const ValidationRequest = z.object({
  validation: z.object({
    decision: z.enum(["approve", "review", "reject"]),
    confidence: z.number().min(0).max(1),
    matched: z.array(Text(300)).max(50),
    issues: z.array(Text(300)).max(50),
    summary: Text(1000),
    source: z.enum(["anthropic", "openai", "workers-ai", "mock"]),
    note: Text(500).optional(),
  }),
  forSubmission: Text(40_000),
});

export const ReportIssueRequest = z.object({ tenantId: Id, text: z.string().trim().min(1).max(500) });

export const RateRequest = z.object({
  by: Id,
  subject: z.object({ kind: z.enum(["maintenance", "vendor", "pm", "property"]), id: Id }),
  stars: z.number().int().min(1).max(5),
  comment: Text(500),
  ref: Text(40).optional(),
});

export const NudgeRequest = z.object({ userId: Id, message: z.string().trim().min(1).max(500), actor: Text(80) });

export const ImportRequest = z.object({
  rows: z.array(z.partialRecord(z.enum(["property", "address", "unit", "tenant", "email", "phone", "rent", "leaseStart", "leaseEnd", "owner"]), Text(300))).max(200),
  source: Text(120),
});

export const BankRequest = z.object({ bank: z.string().trim().min(1).max(80) });

export const InviteRequest = z.object({ emails: z.array(z.email().max(200)).min(1).max(50) });
