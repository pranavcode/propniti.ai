// Record kinds a file can hold and the fields each kind maps onto. Pure data, shared by the
// browser (mapping, cleanup, preview) and the server (re-validation before the write).
// Kept free of "@/" imports so scripts can load it with plain Node.

export const KINDS = ["rent_roll", "properties", "units", "residents", "owners", "vendors", "balances", "recurring"] as const;
export type Kind = (typeof KINDS)[number];

export type FieldType = "text" | "name" | "money" | "date" | "phone" | "email" | "state" | "zip" | "unit" | "int" | "pct" | "bool" | "taxid";

export const FIELDS = {
  property: { label: "Property name", type: "text", syn: ["property", "property name", "rental", "rental name", "rental property", "building", "community", "site", "property code", "complex"] },
  address: { label: "Full address", type: "text", syn: ["property address", "address", "full address", "location"] },
  street: { label: "Street", type: "text", syn: ["street", "street address", "address line 1", "address 1", "property street", "property address line 1"] },
  city: { label: "City", type: "text", syn: ["city", "property city"] },
  state: { label: "State", type: "state", syn: ["state", "property state", "st", "province"] },
  zip: { label: "ZIP", type: "zip", syn: ["zip", "zip code", "postal code", "property zip", "postcode"] },
  propertyType: { label: "Property type", type: "text", syn: ["property type", "type", "rental type", "asset type"] },
  yearBuilt: { label: "Year built", type: "int", syn: ["year built", "built", "yr built"] },
  unitCount: { label: "Unit count", type: "int", syn: ["units", "unit count", "number of units", "# units", "total units", "door count"] },
  owner: { label: "Owner", type: "text", syn: ["owner", "owners", "owner name", "owner(s)", "rental owner", "rental owners", "landlord", "owner entity"] },
  unit: { label: "Unit", type: "unit", syn: ["unit", "unit number", "unit #", "unit no", "unit name", "apt", "apartment", "suite", "space", "bldg-unit", "bldg unit", "door"] },
  sqft: { label: "Square feet", type: "int", syn: ["sqft", "sq ft", "square feet", "sq. ft.", "unit sq ft", "size", "area"] },
  marketRent: { label: "Market rent", type: "money", syn: ["market rent", "asking rent", "market", "list rent", "advertised rent"] },
  unitStatus: { label: "Unit status", type: "text", syn: ["unit status", "status", "occupancy status", "occupancy", "vacancy status"] },
  tenant: { label: "Tenant name", type: "name", syn: ["tenant", "tenants", "tenant name", "resident", "resident name", "residents", "name", "lessee", "occupant", "primary tenant", "full name", "payer name"] },
  firstName: { label: "First name", type: "name", syn: ["first name", "first", "given name", "tenant first name", "resident first name"] },
  lastName: { label: "Last name", type: "name", syn: ["last name", "last", "surname", "family name", "tenant last name", "resident last name"] },
  email: { label: "Email", type: "email", syn: ["email", "emails", "email address", "e-mail", "tenant email", "resident email", "primary email"] },
  phone: { label: "Phone", type: "phone", syn: ["phone", "phone number", "phone numbers", "mobile", "cell", "telephone", "primary phone", "tenant phone", "mobile phone"] },
  residentStatus: { label: "Resident status", type: "text", syn: ["status", "tenant status", "resident status", "lease status"] },
  rent: { label: "Monthly rent", type: "money", syn: ["rent", "monthly rent", "rent amount", "current rent", "lease rent", "actual rent", "scheduled rent", "contract rent"] },
  leaseStart: { label: "Lease start", type: "date", syn: ["lease start", "lease from", "lease start date", "start date", "lease begin", "from", "lease beginning"] },
  leaseEnd: { label: "Lease end", type: "date", syn: ["lease end", "lease to", "lease end date", "lease expiration", "lease exp", "end date", "expiration", "expires", "to"] },
  moveIn: { label: "Move-in", type: "date", syn: ["move in", "move-in", "move in date", "move-in date", "movein"] },
  moveOut: { label: "Move-out", type: "date", syn: ["move out", "move-out", "move out date", "move-out date", "notice date"] },
  deposit: { label: "Security deposit", type: "money", syn: ["deposit", "security deposit", "deposits held", "deposit held", "resident deposit", "sec dep", "deposit amount"] },
  leaseId: { label: "Lease or tenant ID", type: "text", syn: ["lease id", "lease", "lease number", "tenant id", "resident id", "resident code", "tenant code", "lease code"] },
  leaseStatus: { label: "Lease status", type: "text", syn: ["lease status", "status", "tenant status"] },
  balance: { label: "Balance owed", type: "money", syn: ["balance", "past due", "balance due", "total unpaid", "total", "amount due", "outstanding", "total balance", "total amount", "current balance"] },
  aging0: { label: "0–30 days", type: "money", syn: ["0-30", "0 - 30 days", "0-30 days", "current", "0 to 30", "1-30", "0-30 days past due"] },
  aging30: { label: "31–60 days", type: "money", syn: ["31-60", "30-60", "31 - 60 days", "31-60 days", "30 to 60"] },
  aging60: { label: "61–90 days", type: "money", syn: ["61-90", "60-90", "61 - 90 days", "61-90 days", "60 to 90"] },
  aging90: { label: "Over 90 days", type: "money", syn: ["90+", "over 90", "over 90 days", "91+", "90+ days", "more than 90"] },
  chargeCode: { label: "Charge", type: "text", syn: ["charge code", "charge", "charge type", "charge description", "description", "income type", "item"] },
  chargeAmount: { label: "Charge amount", type: "money", syn: ["amount", "charge amount", "monthly amount"] },
  frequency: { label: "Frequency", type: "text", syn: ["frequency", "recurrence", "cycle", "period"] },
  chargeStart: { label: "Charge start", type: "date", syn: ["charge start", "start", "effective date", "begins"] },
  chargeEnd: { label: "Charge end", type: "date", syn: ["charge end", "end", "ends"] },
  ownerName: { label: "Owner name", type: "name", syn: ["owner", "owner name", "name", "full name", "contact name", "rental owner"] },
  entityName: { label: "Owner entity (company)", type: "text", syn: ["company", "company name", "entity", "entity name", "legal name", "llc", "ownership entity"] },
  taxId: { label: "Tax ID", type: "taxid", syn: ["tax id", "ein", "taxpayer id", "tin", "ssn/ein", "federal tax id", "tax id number"] },
  feePct: { label: "Management fee %", type: "pct", syn: ["management fee", "management fee %", "mgmt fee", "fee %", "fee percent"] },
  company: { label: "Vendor company", type: "text", syn: ["company", "company name", "vendor", "vendor name", "business name", "payee"] },
  trade: { label: "Trade", type: "text", syn: ["trade", "trades", "vendor trades", "category", "type", "vendor type", "service", "specialty"] },
  contactName: { label: "Contact name", type: "name", syn: ["contact", "contact name", "name", "primary contact", "full name"] },
  is1099: { label: "Gets a 1099", type: "bool", syn: ["1099", "send 1099", "send 1099?", "1099 eligible", "1099 vendor", "is 1099"] },
  vendorStatus: { label: "Vendor status", type: "text", syn: ["status", "vendor status", "active"] },
} as const satisfies Record<string, { label: string; type: FieldType; syn: readonly string[] }>;
export type FieldKey = keyof typeof FIELDS;

// required: every entry must be mapped; an array entry means any one of its fields will do.
export const KIND_SPECS: Record<Kind, { label: string; plural: string; fields: FieldKey[]; required: (FieldKey | FieldKey[])[]; help: string }> = {
  rent_roll: {
    label: "Rent roll (leases)", plural: "rent roll rows",
    fields: ["property", "address", "street", "city", "state", "zip", "unit", "sqft", "marketRent", "tenant", "firstName", "lastName", "email", "phone", "rent", "leaseStart", "leaseEnd", "moveIn", "moveOut", "deposit", "leaseId", "leaseStatus", "balance", "chargeCode", "chargeAmount", "owner"],
    required: ["property", "unit", ["rent", "chargeAmount"]],
    help: "Creates properties, units, residents and leases; deposits, balances and extra charges when the file has them.",
  },
  properties: {
    label: "Properties", plural: "properties",
    fields: ["property", "address", "street", "city", "state", "zip", "propertyType", "yearBuilt", "unitCount", "owner"],
    required: ["property", ["address", "street"]],
    help: "Property names and addresses.",
  },
  units: {
    label: "Units", plural: "units",
    fields: ["property", "address", "unit", "sqft", "marketRent", "unitStatus"],
    required: ["property", "unit"],
    help: "Units with size, market rent and status.",
  },
  residents: {
    label: "Residents and tenants", plural: "residents",
    fields: ["property", "unit", "tenant", "firstName", "lastName", "email", "phone", "residentStatus", "moveIn", "moveOut"],
    required: ["property", ["tenant", "firstName"]],
    help: "A tenant directory: names and contact details.",
  },
  owners: {
    label: "Owners and owner entities", plural: "owners",
    fields: ["ownerName", "entityName", "firstName", "lastName", "email", "phone", "address", "state", "taxId", "feePct"],
    required: [["ownerName", "entityName", "firstName"]],
    help: "Owners and the legal entities that hold the properties.",
  },
  vendors: {
    label: "Vendors", plural: "vendors",
    fields: ["company", "trade", "contactName", "email", "phone", "taxId", "is1099", "vendorStatus"],
    required: ["company"],
    help: "Vendor companies, trades and contacts.",
  },
  balances: {
    label: "Open balances (aged receivables)", plural: "balances",
    fields: ["property", "unit", "tenant", "balance", "aging0", "aging30", "aging60", "aging90"],
    required: ["property", "unit", ["balance", "aging0", "aging30", "aging60", "aging90"]],
    help: "What each lease owes today, by age. Posted as opening-balance charges on the lease.",
  },
  recurring: {
    label: "Recurring charges", plural: "recurring charges",
    fields: ["property", "unit", "tenant", "chargeCode", "chargeAmount", "frequency", "chargeStart", "chargeEnd"],
    required: ["property", "unit", "chargeCode", "chargeAmount"],
    help: "Monthly charges beyond rent: parking, pets, utilities.",
  },
};

// Header text → comparable form: lower case, punctuation folded to spaces.
export const normHeader = (h: string) => h.toLowerCase().replace(/[“”"'?:()]+/g, "").replace(/[_\-/.]+/g, " ").replace(/#/g, " # ").replace(/\s+/g, " ").trim();
const SYN_NORM = new Map<FieldKey, string[]>(Object.entries(FIELDS).map(([k, f]) => [k as FieldKey, f.syn.map(normHeader)]));
export const synonymsOf = (f: FieldKey) => SYN_NORM.get(f) ?? [];

// Character-bigram Dice similarity, 0–1. Catches "Lease Expires On" ≈ "lease expiration".
export function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}
