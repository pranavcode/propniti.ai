export type PersonaId = "pm" | "owner" | "tenant" | "maintenance" | "vendor" | "admin";

export type Property = {
  id: string;
  name: string;
  address: string;
  type: "Multifamily" | "Duplex" | "Commercial";
  units: number;
  occupied: number;
  ownerId: string;
};

export type User = {
  id: string;
  name: string;
  role: "Property manager" | "Owner" | "Tenant" | "Maintenance" | "Vendor" | "Admin";
  email: string;
  phone: string;
  channel: "SMS" | "WhatsApp" | "Email" | "Voice";
  idVerified: boolean;
};

export type Vendor = {
  id: string;
  userId: string;
  company: string;
  trade: string;
  // Paid this calendar year before the ledger's records; cleared payouts are added on top.
  ytdPaid: number;
};

export type Tenancy = {
  id: string;
  propertyId: string;
  unit: string;
  tenantId: string;
  rent: number;
  cadence: "Monthly";
  leaseStart: string;
  leaseEnd: string;
  status: "Active" | "Renewal due" | "Notice given";
};

export type Invoice = {
  id: string;
  tenancyId: string;
  amount: number;
  generated: string;
  due: string;
  status: "Paid" | "Processing" | "Due" | "Overdue";
};

export type LineItem = { description: string; amount: number };

export type WorkOrder = {
  id: string;
  propertyId: string;
  unit: string;
  title: string;
  vendorId: string;
  assigneeId?: string;
  estimatedHours: number;
  // Vendor jobs: Submitted → Payment pending → Paid. In-house jobs end at Completed.
  status: "Assigned" | "In progress" | "Submitted" | "Changes requested" | "Payment pending" | "Paid" | "Completed";
  po: { number: string; items: LineItem[]; total: number; photosRequired: number };
  submission?: { invoiceNumber: string; items: LineItem[]; total: number; photos: string[] };
  validation?: ValidationResult;
};

export type PartyKind = "tenant" | "trust" | "pm" | "owner" | "vendor";
export type Party = { kind: PartyKind; id: string; name: string };

export type TransferKind = "Rent" | "Management fee" | "Vendor payout" | "Owner payout";

export type Transfer = {
  id: string;
  // Idempotency key: one live transfer per key (e.g. "rent:INV-2611-01").
  key: string;
  kind: TransferKind;
  from: Party;
  to: Party;
  amount: number;
  propertyId: string;
  ref: string;
  status: "Pending" | "Cleared" | "Returned";
  created: string;
  settlesAt?: number;
  cleared?: string;
  // Owner payout this item was included in; unset = still on the owner's open statement.
  statement?: string;
};

export type RatingSubject = { kind: "maintenance" | "vendor" | "pm" | "property"; id: string };

export type Rating = {
  id: string;
  by: string;
  subject: RatingSubject;
  stars: number;
  comment: string;
  ref?: string;
  ts: string;
};

export type Notification = {
  id: string;
  userId: string;
  channel: User["channel"];
  message: string;
  ts: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  detail: string;
};

export type AiSource = "anthropic" | "openai" | "workers-ai" | "mock";

export type ExtractedInvoice = {
  isInvoice: boolean;
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  lineItems: LineItem[];
  total: number;
  currency: string;
  confidence: number;
  issues: string[];
};

export type ExtractResult = {
  invoice?: ExtractedInvoice;
  checks: { label: string; ok: boolean }[];
  source: AiSource;
  note?: string;
};

export type ValidationResult = {
  decision: "approve" | "review" | "reject";
  confidence: number;
  matched: string[];
  issues: string[];
  summary: string;
  source: AiSource;
  note?: string;
};

export type AskResult = {
  answer: string;
  suggestedActions: string[];
  source: AiSource;
  note?: string;
};

export type DemoState = {
  properties: Property[];
  users: User[];
  vendors: Vendor[];
  tenancies: Tenancy[];
  invoices: Invoice[];
  workOrders: WorkOrder[];
  transfers: Transfer[];
  ratings: Rating[];
  setup?: { bank?: string; invited: string[]; importedRows: number; completed: boolean };
  notifications: Notification[];
  audit: AuditEntry[];
};
