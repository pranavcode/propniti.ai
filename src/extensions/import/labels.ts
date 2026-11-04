// Display names for the tables an import writes (shared by the server summary and the wizard).
export type ImportTableName = "owners" | "owner_entities" | "portfolios" | "properties" | "units" | "households" | "residents" | "leases" | "deposits" | "recurring_charges" | "charges" | "vendors";

export const TYPE_LABEL: Record<ImportTableName, [one: string, many: string]> = {
  owners: ["owner", "owners"], owner_entities: ["owner entity", "owner entities"], portfolios: ["portfolio", "portfolios"], properties: ["property", "properties"], units: ["unit", "units"],
  households: ["household", "households"], residents: ["resident", "residents"], leases: ["lease", "leases"], deposits: ["deposit", "deposits"], recurring_charges: ["recurring charge", "recurring charges"],
  charges: ["opening-balance charge", "opening-balance charges"], vendors: ["vendor", "vendors"],
};

// What the preview shows as cards; households and portfolios are created alongside, not on their own.
export const SHOWN: ImportTableName[] = ["properties", "units", "residents", "leases", "deposits", "charges", "recurring_charges", "owners", "owner_entities", "vendors"];

// Property types the app uses (the seed roster's types); imported files map onto these.
export const PROPERTY_TYPES = ["Garden multifamily", "Mid-rise multifamily", "High-rise multifamily", "Townhomes", "Small residential", "Mixed-use", "Office", "Retail strip", "Industrial flex"] as const;
