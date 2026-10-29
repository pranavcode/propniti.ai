import { DEMO_TODAY } from "./seed";
import type { DemoState, Invoice, Property, Tenancy, User } from "./types";

// Portfolio import for onboarding: rent-roll exports from other tools (AppFolio, Buildium,
// spreadsheets) are parsed, mapped onto our fields, checked, then merged into the portfolio.

export const IMPORT_FIELDS = ["property", "address", "unit", "tenant", "email", "phone", "rent", "leaseStart", "leaseEnd", "owner"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Partial<Record<ImportField, string | null>>;
export type ImportRow = Partial<Record<ImportField, string>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  property: "Property",
  address: "Address",
  unit: "Unit",
  tenant: "Tenant name",
  email: "Tenant email",
  phone: "Tenant phone",
  rent: "Monthly rent",
  leaseStart: "Lease start",
  leaseEnd: "Lease end",
  owner: "Owner",
};
export const REQUIRED: ImportField[] = ["property", "unit", "tenant", "rent"];

// Picks comma or tab by counting them outside quotes on the header line.
function detectDelimiter(text: string): "," | "\t" {
  let commas = 0;
  let tabs = 0;
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c === ",") commas++;
    else if (!quoted && c === "\t") tabs++;
  }
  return tabs > commas ? "\t" : ",";
}

// RFC 4180 CSV: quoted fields, escaped quotes, commas and newlines inside quotes. Tabs work too.
// Throws on an unclosed quote rather than silently merging records.
export function parseCsv(text: string): string[][] {
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim())) rows.push(row.map((f) => f.trim()));
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("The file has an unclosed quote (\"), so its rows can't be read reliably.");
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row.map((f) => f.trim()));
  return rows;
}

// Rows with more cells than the header usually mean a broken export.
export function widthProblems(table: string[][]): string[] {
  const width = table[0]?.length ?? 0;
  return table.slice(1).flatMap((r, i) => (r.length > width ? [`Row ${i + 2} has ${r.length} columns but the header has ${width}`] : []));
}

// Header names other tools use for each field. The AI mapping handles anything not listed.
const SYNONYMS: Record<ImportField, string[]> = {
  property: ["property", "property name", "building", "rental", "rental property", "community", "site"],
  address: ["address", "property address", "street address", "street"],
  unit: ["unit", "unit number", "unit #", "unit no", "apt", "apartment", "suite", "space"],
  tenant: ["tenant", "tenant name", "resident", "resident name", "lessee", "occupant", "name"],
  email: ["email", "tenant email", "e-mail", "resident email", "email address"],
  phone: ["phone", "phone number", "tenant phone", "mobile", "cell", "telephone"],
  rent: ["rent", "monthly rent", "rent amount", "market rent", "current rent", "lease rent", "amount"],
  leaseStart: ["lease start", "lease from", "move in", "move-in", "start date", "lease start date", "from"],
  leaseEnd: ["lease end", "lease to", "lease expiration", "expiration", "end date", "lease end date", "move out", "to"],
  owner: ["owner", "owner name", "landlord", "property owner"],
};

const norm = (h: string) => h.toLowerCase().replace(/[_\-:]+/g, " ").replace(/\s+/g, " ").trim();

export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const exact = headers.find((h) => !used.has(h) && SYNONYMS[field].includes(norm(h)));
    const partial = exact ?? headers.find((h) => !used.has(h) && SYNONYMS[field].some((s) => s.length > 3 && norm(h).includes(s)));
    mapping[field] = partial ?? null;
    if (partial) used.add(partial);
  }
  return mapping;
}

export function applyMapping(table: string[][], mapping: Mapping): ImportRow[] {
  const [headers, ...body] = table;
  return body.map((cells) => {
    const row: ImportRow = {};
    for (const field of IMPORT_FIELDS) {
      const h = mapping[field];
      const idx = h ? headers.indexOf(h) : -1;
      if (idx >= 0 && cells[idx]) row[field] = cells[idx];
    }
    return row;
  });
}

export const parseMoney = (v?: string) => {
  if (!v) return NaN;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

// Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY; returns YYYY-MM-DD or null.
export function parseDate(v?: string): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export type RowCheck = { row: ImportRow; errors: string[]; warnings: string[] };

const unitKey = (property?: string, unit?: string) => `${property?.trim().toLowerCase()}|${unit?.trim().toLowerCase()}`;

// existing = property/unit keys already in the portfolio, so re-importing a file can't duplicate tenancies.
export function existingUnitKeys(s: DemoState): Set<string> {
  return new Set(s.tenancies.map((t) => unitKey(s.properties.find((p) => p.id === t.propertyId)?.name, t.unit)));
}

export function validateRows(rows: ImportRow[], existing: Set<string> = new Set()): RowCheck[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const f of REQUIRED) if (!row[f]?.trim()) errors.push(`${FIELD_LABELS[f]} is missing`);
    const rent = parseMoney(row.rent);
    if (row.rent && (!Number.isFinite(rent) || rent <= 0)) errors.push(`Rent "${row.rent}" is not a positive amount`);
    else if (rent > 50_000) warnings.push(`Rent ${row.rent} looks unusually high`);
    for (const f of ["leaseStart", "leaseEnd"] as const) if (row[f] && !parseDate(row[f])) errors.push(`${FIELD_LABELS[f]} "${row[f]}" is not a date`);
    const start = parseDate(row.leaseStart);
    const end = parseDate(row.leaseEnd);
    if (start && end && end <= start) errors.push("Lease ends before it starts");
    if (!row.leaseEnd) warnings.push("No lease end date: treated as month-to-month");
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) warnings.push(`Email "${row.email}" looks invalid`);
    const key = unitKey(row.property, row.unit);
    if (row.property && row.unit && existing.has(key)) errors.push(`Already in your portfolio: ${row.property} ${row.unit}`);
    else if (row.property && row.unit && seen.has(key)) errors.push(`Duplicate: ${row.property} ${row.unit} appears more than once`);
    seen.add(key);
    return { row, errors, warnings };
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";
// IDs come from the name for readability, with a counter when that ID is already taken.
const uniqueId = (base: string, taken: Set<string>) => {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
};
const COMMERCIAL = /retail|office|plaza|commercial|center|centre|industrial|warehouse|medical/i;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// Merges valid rows into the portfolio: properties (reused by name), tenants, tenancies
// and next month's rent invoice. Rows with errors are skipped by the caller.
export function importPortfolio(s: DemoState, rows: ImportRow[], pmChannel: User["channel"] = "Email"): { state: DemoState; counts: { properties: number; tenancies: number } } {
  const properties = [...s.properties];
  const users = [...s.users];
  const tenancies = [...s.tenancies];
  const invoices = [...s.invoices];
  let newProps = 0;
  const takenIds = new Set([...properties.map((p) => p.id), ...users.map((u) => u.id)]);
  const ownerFor = (name?: string) => {
    const label = name?.trim() || "Owner to invite";
    let owner = users.find((u) => u.role === "Owner" && u.name.toLowerCase() === label.toLowerCase());
    if (!owner) {
      owner = { id: uniqueId(`u-own-${slug(label)}`, takenIds), name: label, role: "Owner", email: "", phone: "", channel: "Email", idVerified: false };
      users.push(owner);
    }
    return owner.id;
  };
  rows.forEach((row, j) => {
    const i = s.tenancies.length + j; // keeps IDs unique across repeated imports
    const pname = row.property!.trim();
    let prop = properties.find((p) => p.name.toLowerCase() === pname.toLowerCase());
    if (!prop) {
      const commercial = COMMERCIAL.test(pname) || rows.some((r) => r.property?.trim().toLowerCase() === pname.toLowerCase() && /^suite\b/i.test(r.unit ?? ""));
      prop = { id: uniqueId(`p-${slug(pname)}`, takenIds), name: pname, address: row.address?.trim() || "Address to confirm", type: commercial ? "Commercial" : "Multifamily", units: 0, occupied: 0, ownerId: ownerFor(row.owner) };
      properties.push(prop);
      newProps++;
    }
    const idx = properties.findIndex((p) => p.id === prop!.id);
    properties[idx] = { ...properties[idx], units: properties[idx].units + 1, occupied: properties[idx].occupied + 1 };
    const tenantId = uniqueId(`u-imp-${slug(row.tenant!)}-${i}`, takenIds);
    users.push({ id: tenantId, name: row.tenant!.trim(), role: "Tenant", email: row.email?.trim() ?? "", phone: row.phone?.trim() ?? "", channel: row.phone ? "SMS" : pmChannel, idVerified: false });
    const leaseEnd = parseDate(row.leaseEnd) ?? "Month-to-month";
    const tenancy: Tenancy = {
      id: `t-imp-${i}-${slug(row.unit!)}`,
      propertyId: prop.id,
      unit: row.unit!.trim(),
      tenantId,
      rent: parseMoney(row.rent),
      cadence: "Monthly",
      leaseStart: parseDate(row.leaseStart) ?? DEMO_TODAY,
      leaseEnd,
      status: leaseEnd !== "Month-to-month" && daysBetween(DEMO_TODAY, leaseEnd) <= 45 ? "Renewal due" : "Active",
    };
    tenancies.push(tenancy);
    const inv: Invoice = { id: `INV-2611-I${i}`, tenancyId: tenancy.id, amount: tenancy.rent, generated: DEMO_TODAY, due: "2026-11-01", status: "Due" };
    invoices.push(inv);
  });
  return { state: { ...s, properties: properties as Property[], users, tenancies, invoices }, counts: { properties: newProps, tenancies: rows.length } };
}
