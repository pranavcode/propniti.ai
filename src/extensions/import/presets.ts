import type { FieldKey, Kind } from "./fields";

// Column presets for the reports property-management tools typically export. They are based on
// the typical layout of each report; vendors change their exports and accounts can customise
// columns, so every mapping stays editable and unmatched columns can be mapped by hand.
// `sample` describes the synthetic sample file in public/samples/ (formats only, no real data).

export const TOOLS = [
  { key: "appfolio", label: "AppFolio" },
  { key: "buildium", label: "Buildium" },
  { key: "yardi_breeze", label: "Yardi Breeze" },
  { key: "yardi_voyager", label: "Yardi Voyager" },
  { key: "rent_manager", label: "Rent Manager" },
  { key: "propertyware", label: "Propertyware" },
  { key: "doorloop", label: "DoorLoop" },
  { key: "tenantcloud", label: "TenantCloud" },
  { key: "entrata", label: "Entrata" },
  { key: "generic", label: "Other / spreadsheet" },
] as const;
export type ToolKey = (typeof TOOLS)[number]["key"];

export type SampleFormat = { date: "us" | "iso"; money: "dollar" | "plain"; name: "first-last" | "last-first"; grouped?: boolean; charges?: boolean; title?: boolean };
export type Preset = { id: string; tool: ToolKey; report: string; kind: Kind; columns: [header: string, field: FieldKey | null][]; file: string; sample: SampleFormat };

const US: SampleFormat = { date: "us", money: "dollar", name: "first-last" };
const ISO: SampleFormat = { date: "iso", money: "plain", name: "first-last" };

function p(tool: ToolKey, report: string, kind: Kind, columns: Preset["columns"], sample: SampleFormat = US): Preset {
  const slug = report.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { id: `${tool}.${slug}`, tool, report, kind, columns, file: `${tool.replace(/_/g, "-")}-${slug}.csv`, sample };
}

export const PRESETS: Preset[] = [
  // AppFolio: rent roll grouped under a property heading row; directories with plural contact columns.
  p("appfolio", "Rent Roll", "rent_roll", [["Unit", "unit"], ["BD/BA", null], ["Tenant", "tenant"], ["Status", "leaseStatus"], ["Sqft", "sqft"], ["Market Rent", "marketRent"], ["Rent", "rent"], ["Deposit", "deposit"], ["Lease From", "leaseStart"], ["Lease To", "leaseEnd"], ["Move-in", "moveIn"], ["Move-out", "moveOut"], ["Past Due", "balance"]], { ...US, name: "last-first", grouped: true, title: true }),
  p("appfolio", "Tenant Directory", "residents", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Status", "residentStatus"], ["Emails", "email"], ["Phone Numbers", "phone"], ["Move-in", "moveIn"], ["Move-out", "moveOut"]], { ...US, name: "last-first" }),
  p("appfolio", "Property Directory", "properties", [["Property", "property"], ["Property Address", "street"], ["Property City", "city"], ["Property State", "state"], ["Property Zip", "zip"], ["Units", "unitCount"], ["Property Type", "propertyType"], ["Year Built", "yearBuilt"], ["Owners", "owner"]]),
  p("appfolio", "Unit Directory", "units", [["Property", "property"], ["Unit", "unit"], ["Sqft", "sqft"], ["Market Rent", "marketRent"], ["Status", "unitStatus"]]),
  p("appfolio", "Owner Directory", "owners", [["Name", "ownerName"], ["Company Name", "entityName"], ["Emails", "email"], ["Phone Numbers", "phone"], ["Address", "address"], ["Tax ID", "taxId"], ["Management Fee", "feePct"], ["Properties Owned", null]]),
  p("appfolio", "Vendor Directory", "vendors", [["Company Name", "company"], ["Name", "contactName"], ["Vendor Trades", "trade"], ["Phone Numbers", "phone"], ["Email", "email"], ["Send 1099?", "is1099"], ["Tax ID", "taxId"]]),
  p("appfolio", "Aged Receivables Detail", "balances", [["Property", "property"], ["Unit", "unit"], ["Payer Name", "tenant"], ["Total Amount", "balance"], ["0-30", "aging0"], ["30-60", "aging30"], ["60-90", "aging60"], ["90+", "aging90"]]),

  // Buildium: "Rental" for the property; ISO-ish dates in CSV exports.
  p("buildium", "Rent roll", "rent_roll", [["Rental", "property"], ["Unit", "unit"], ["Tenants", "tenant"], ["Lease type", null], ["Lease start date", "leaseStart"], ["Lease end date", "leaseEnd"], ["Rent", "rent"], ["Security deposit", "deposit"], ["Balance due", "balance"]], ISO),
  p("buildium", "Tenant directory", "residents", [["First name", "firstName"], ["Last name", "lastName"], ["Email", "email"], ["Phone", "phone"], ["Rental", "property"], ["Unit", "unit"], ["Status", "residentStatus"]], ISO),
  p("buildium", "Rentals", "properties", [["Rental", "property"], ["Address", "street"], ["City", "city"], ["State", "state"], ["Zip", "zip"], ["Type", "propertyType"], ["Units", "unitCount"], ["Rental owners", "owner"]], ISO),
  p("buildium", "Rental owners", "owners", [["First name", "firstName"], ["Last name", "lastName"], ["Company name", "entityName"], ["Email", "email"], ["Phone", "phone"], ["State", "state"], ["Taxpayer ID", "taxId"]], ISO),
  p("buildium", "Vendors", "vendors", [["Company name", "company"], ["Contact name", "contactName"], ["Category", "trade"], ["Email", "email"], ["Phone", "phone"], ["1099 eligible", "is1099"], ["Taxpayer ID", "taxId"]], ISO),
  p("buildium", "Outstanding balances", "balances", [["Rental", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Balance", "balance"], ["0 - 30 days", "aging0"], ["31 - 60 days", "aging30"], ["61 - 90 days", "aging60"], ["Over 90 days", "aging90"]], ISO),

  p("yardi_breeze", "Rent Roll", "rent_roll", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Status", "leaseStatus"], ["Market Rent", "marketRent"], ["Rent", "rent"], ["Deposit", "deposit"], ["Move In", "moveIn"], ["Lease Start", "leaseStart"], ["Lease End", "leaseEnd"], ["Balance", "balance"]]),
  p("yardi_breeze", "Tenant Directory", "residents", [["Property", "property"], ["Unit", "unit"], ["Tenant Name", "tenant"], ["Email", "email"], ["Phone", "phone"], ["Status", "residentStatus"]]),
  p("yardi_breeze", "Owner List", "owners", [["Owner", "ownerName"], ["Entity", "entityName"], ["Email", "email"], ["Phone", "phone"], ["State", "state"], ["Tax ID", "taxId"]]),
  p("yardi_breeze", "Vendor List", "vendors", [["Vendor Name", "company"], ["Type", "trade"], ["Contact", "contactName"], ["Email", "email"], ["Phone", "phone"], ["1099", "is1099"]]),
  p("yardi_breeze", "Aged Receivables", "balances", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["0-30", "aging0"], ["31-60", "aging30"], ["61-90", "aging60"], ["Over 90", "aging90"], ["Total", "balance"]]),

  // Yardi Voyager: one row per lease charge; rows after the first carry only the charge code and amount.
  p("yardi_voyager", "Rent Roll with Lease Charges", "rent_roll", [["Property", "property"], ["Unit", "unit"], ["Unit Type", null], ["Unit Sq Ft", "sqft"], ["Resident", "leaseId"], ["Name", "tenant"], ["Market Rent", "marketRent"], ["Charge Code", "chargeCode"], ["Amount", "chargeAmount"], ["Resident Deposit", "deposit"], ["Other Deposit", null], ["Move In", "moveIn"], ["Lease Expiration", "leaseEnd"], ["Move Out", "moveOut"], ["Balance", "balance"]], { ...US, charges: true, title: true }),
  p("yardi_voyager", "Resident Directory", "residents", [["Property", "property"], ["Unit", "unit"], ["Resident Code", null], ["Resident Name", "tenant"], ["Email", "email"], ["Phone", "phone"], ["Status", "residentStatus"]], { ...US, name: "last-first" }),
  p("yardi_voyager", "Aged Receivables", "balances", [["Property", "property"], ["Unit", "unit"], ["Resident", null], ["Name", "tenant"], ["Total Unpaid", "balance"], ["0-30 Days", "aging0"], ["31-60 Days", "aging30"], ["61-90 Days", "aging60"], ["Over 90 Days", "aging90"]]),
  p("yardi_voyager", "Vendor Directory", "vendors", [["Vendor Code", null], ["Vendor Name", "company"], ["Contact", "contactName"], ["Email", "email"], ["Phone", "phone"], ["Type", "trade"], ["1099 Vendor", "is1099"]]),

  p("rent_manager", "Rent Roll", "rent_roll", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Unit Type", null], ["SqFt", "sqft"], ["Market Rent", "marketRent"], ["Rent", "rent"], ["Deposit", "deposit"], ["Move In", "moveIn"], ["Lease Start", "leaseStart"], ["Lease End", "leaseEnd"], ["Balance", "balance"]]),
  p("rent_manager", "Tenant List", "residents", [["Property", "property"], ["Unit", "unit"], ["Name", "tenant"], ["Email", "email"], ["Phone", "phone"], ["Status", "residentStatus"]]),
  p("rent_manager", "Owner List", "owners", [["Owner Name", "ownerName"], ["Company", "entityName"], ["Email", "email"], ["Phone", "phone"], ["State", "state"], ["Tax ID", "taxId"]]),
  p("rent_manager", "Vendor List", "vendors", [["Vendor", "company"], ["Contact", "contactName"], ["Category", "trade"], ["Email", "email"], ["Phone", "phone"], ["1099", "is1099"]]),
  p("rent_manager", "Aging", "balances", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Total", "balance"], ["0-30", "aging0"], ["31-60", "aging30"], ["61-90", "aging60"], ["90+", "aging90"]]),

  p("propertyware", "Rent Roll", "rent_roll", [["Building", "property"], ["Unit", "unit"], ["Lease", "leaseId"], ["Primary Tenant", "tenant"], ["Lease Start", "leaseStart"], ["Lease End", "leaseEnd"], ["Rent", "rent"], ["Security Deposit", "deposit"], ["Balance", "balance"]]),
  p("propertyware", "Tenant Directory", "residents", [["Building", "property"], ["Unit", "unit"], ["First Name", "firstName"], ["Last Name", "lastName"], ["Email", "email"], ["Phone", "phone"], ["Status", "residentStatus"]]),
  p("propertyware", "Owner Directory", "owners", [["Owner Name", "ownerName"], ["Company", "entityName"], ["Email", "email"], ["Phone", "phone"], ["State", "state"]]),
  p("propertyware", "Vendor Directory", "vendors", [["Vendor Name", "company"], ["Category", "trade"], ["Contact", "contactName"], ["Email", "email"], ["Phone", "phone"], ["1099", "is1099"]]),
  p("propertyware", "Delinquency", "balances", [["Building", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Balance", "balance"], ["0-30", "aging0"], ["31-60", "aging30"], ["61-90", "aging60"], ["91+", "aging90"]]),

  p("doorloop", "Rent Roll", "rent_roll", [["Property", "property"], ["Unit", "unit"], ["Tenants", "tenant"], ["Lease Start", "leaseStart"], ["Lease End", "leaseEnd"], ["Rent", "rent"], ["Deposit", "deposit"], ["Balance", "balance"]]),
  p("doorloop", "Tenants", "residents", [["Full Name", "tenant"], ["Email", "email"], ["Phone", "phone"], ["Property", "property"], ["Unit", "unit"], ["Status", "residentStatus"]]),
  p("doorloop", "Properties", "properties", [["Name", "property"], ["Address", "street"], ["City", "city"], ["State", "state"], ["Zip", "zip"], ["Type", "propertyType"], ["Units", "unitCount"]]),
  p("doorloop", "Owners", "owners", [["Full Name", "ownerName"], ["Company", "entityName"], ["Email", "email"], ["Phone", "phone"], ["Management Fee", "feePct"]]),
  p("doorloop", "Vendors", "vendors", [["Company Name", "company"], ["Full Name", "contactName"], ["Email", "email"], ["Phone", "phone"], ["Category", "trade"]]),
  p("doorloop", "Aged Receivables", "balances", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["0-30", "aging0"], ["31-60", "aging30"], ["61-90", "aging60"], ["90+", "aging90"], ["Total", "balance"]]),

  p("tenantcloud", "Rent Roll", "rent_roll", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Lease Start", "leaseStart"], ["Lease End", "leaseEnd"], ["Rent", "rent"], ["Deposit", "deposit"], ["Balance", "balance"]], ISO),
  p("tenantcloud", "Tenants", "residents", [["First Name", "firstName"], ["Last Name", "lastName"], ["Email", "email"], ["Phone", "phone"], ["Property", "property"], ["Unit", "unit"]], ISO),
  p("tenantcloud", "Service Pros", "vendors", [["Company", "company"], ["Name", "contactName"], ["Category", "trade"], ["Email", "email"], ["Phone", "phone"]], ISO),

  p("entrata", "Rent Roll", "rent_roll", [["Property", "property"], ["Bldg-Unit", "unit"], ["Unit Type", null], ["Resident", "tenant"], ["Lease Status", "leaseStatus"], ["Lease Start", "leaseStart"], ["Lease End", "leaseEnd"], ["Move-In", "moveIn"], ["Market Rent", "marketRent"], ["Rent", "rent"], ["Deposit Held", "deposit"], ["Balance", "balance"]], { ...US, name: "last-first" }),
  p("entrata", "Resident Directory", "residents", [["Property", "property"], ["Unit", "unit"], ["Resident", "tenant"], ["Email", "email"], ["Phone", "phone"], ["Status", "residentStatus"]], { ...US, name: "last-first" }),
  p("entrata", "Aged Receivables", "balances", [["Property", "property"], ["Unit", "unit"], ["Resident", "tenant"], ["Total", "balance"], ["0-30", "aging0"], ["31-60", "aging30"], ["61-90", "aging60"], ["90+", "aging90"]]),
  p("entrata", "Vendors", "vendors", [["Vendor", "company"], ["Contact", "contactName"], ["Category", "trade"], ["Email", "email"], ["Phone", "phone"], ["1099", "is1099"]]),

  // Spreadsheets kept by hand: no fixed layout, so these lean on synonym matching.
  { ...p("generic", "Portfolio spreadsheet", "rent_roll", [["Property Name", "property"], ["Property Address", "address"], ["Unit #", "unit"], ["Resident", "tenant"], ["Email", "email"], ["Phone", "phone"], ["Monthly Rent", "rent"], ["Lease From", "leaseStart"], ["Lease To", "leaseEnd"], ["Owner", "owner"]], ISO), file: "generic-portfolio-spreadsheet.xlsx" },
  p("generic", "Recurring charges", "recurring", [["Property", "property"], ["Unit", "unit"], ["Tenant", "tenant"], ["Charge", "chargeCode"], ["Amount", "chargeAmount"], ["Frequency", "frequency"], ["Start", "chargeStart"], ["End", "chargeEnd"]], ISO),
];

export const presetsFor = (tool: ToolKey) => PRESETS.filter((x) => x.tool === tool);
export const toolLabel = (tool: string) => TOOLS.find((t) => t.key === tool)?.label ?? tool;
