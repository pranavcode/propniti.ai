import { z } from "zod";

// Request schemas for the public forms, shared by the browser (step validation) and the routes.
// Every string and list is capped. Nothing here asks about protected characteristics or arrests.

const name = z.string().trim().min(1, "Required").max(60);
const email = z.email("Enter a valid email").max(120);
const phone = z.string().trim().regex(/^[0-9()+.\-\s]{10,20}$/, "Enter a 10-digit phone number");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const state = z.string().trim().regex(/^[A-Za-z]{2}$/, "2-letter state");
const zip = z.string().trim().regex(/^\d{5}$/, "5-digit ZIP");
const dollars = (msg: string) => z.coerce.number({ error: msg }).int("Whole dollars").min(0).max(1_000_000);

export const TOUR_KINDS = ["In person", "Self-guided", "Virtual"] as const;
export const TourRequest = z.strictObject({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email,
  phone,
  kind: z.enum(TOUR_KINDS),
  date: isoDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  note: z.string().trim().max(500).optional(),
});
export type TourRequest = z.infer<typeof TourRequest>;

export const AskRequest = z.strictObject({ question: z.string().trim().min(2, "Ask a question").max(300, "Keep it under 300 characters") });

export const CREDIT_BANDS = [
  { value: "Excellent", label: "740 or higher" },
  { value: "Good", label: "670–739" },
  { value: "Fair", label: "580–669" },
  { value: "Poor", label: "Below 580" },
  { value: "Thin file", label: "No credit history yet" },
] as const;
export const EMPLOYMENT = ["Employed", "Self-employed", "Student", "Retired", "Other"] as const;
export const DOC_KINDS = ["Photo ID", "Proof of income", "Other"] as const;

export const Personal = z.strictObject({
  first_name: name,
  last_name: name,
  email,
  phone,
  move_in: isoDate,
  lease_months: z.coerce.number().int().min(1).max(24),
  adults: z.coerce.number().int().min(1, "At least 1").max(6, "Up to 6 adults"),
});

export const Residence = z.strictObject({
  street: z.string().trim().min(3, "Required").max(120),
  city: z.string().trim().min(2, "Required").max(60),
  state,
  zip,
  since: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  rent: dollars("Enter your current monthly rent (0 if you own or live rent-free)"),
  landlord: z.string().trim().max(80).optional(),
  landlord_phone: z.union([phone, z.literal("")]).optional(),
  reason: z.string().trim().max(300).optional(),
  evicted: z.enum(["no", "yes"], { error: "Choose one" }),
});

export const Income = z.strictObject({
  employment: z.enum(EMPLOYMENT, { error: "Choose one" }),
  employer: z.string().trim().max(80).optional(),
  title: z.string().trim().max(80).optional(),
  monthly_income: dollars("Enter your monthly income before tax").refine((v) => v > 0, "Enter your monthly income before tax"),
  other_income: dollars("Whole dollars").optional(),
  other_source: z.string().trim().max(80).optional(),
  credit: z.enum(CREDIT_BANDS.map((c) => c.value) as [string, ...string[]], { error: "Choose a range" }),
}).refine((v) => !["Employed", "Self-employed"].includes(v.employment) || !!v.employer?.trim(), { path: ["employer"], message: "Enter your employer or business name" });

export const DocMeta = z.strictObject({
  kind: z.enum(DOC_KINDS),
  name: z.string().trim().min(1).max(160),
  size: z.number().int().min(1).max(10 * 1024 * 1024),
  type: z.string().max(80),
});
export const Documents = z.strictObject({ files: z.array(DocMeta).max(8) })
  .refine((d) => d.files.some((f) => f.kind === "Photo ID"), { path: ["files"], message: "Add a photo ID" })
  .refine((d) => d.files.some((f) => f.kind === "Proof of income"), { path: ["files"], message: "Add at least one proof of income" });

export const Consent = z.strictObject({
  screening: z.literal(true, { error: "Required to process your application" }),
  accurate: z.literal(true, { error: "Required" }),
  signature: z.string().trim().min(3, "Type your full name").max(120),
});

export const ApplyRequest = z.strictObject({ personal: Personal, residence: Residence, income: Income, documents: Documents, consent: Consent })
  .refine((a) => a.consent.signature.toLowerCase().replace(/\s+/g, " ") === `${a.personal.first_name} ${a.personal.last_name}`.toLowerCase().replace(/\s+/g, " "), { path: ["consent", "signature"], message: "Type your name exactly as entered in step 1" });
export type ApplyRequest = z.infer<typeof ApplyRequest>;
