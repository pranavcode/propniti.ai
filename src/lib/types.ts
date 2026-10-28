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
  status: "Paid" | "Due" | "Overdue";
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
  status: "Assigned" | "In progress" | "Submitted" | "Changes requested" | "Approved" | "Paid";
  po: { number: string; items: LineItem[]; total: number; photosRequired: number };
  submission?: { invoiceNumber: string; items: LineItem[]; total: number; photos: string[] };
  validation?: ValidationResult;
};

export type Payment = {
  id: string;
  kind: "Rent" | "Vendor payout" | "Owner payout";
  payee: string;
  amount: number;
  date: string;
  status: "Pending" | "Sent" | "Received";
  ref: string;
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
  payments: Payment[];
  notifications: Notification[];
  audit: AuditEntry[];
};
