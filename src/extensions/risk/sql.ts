import { AS_OF } from "@/entities/common";

// Derived statuses for the risk defs and metrics. Stored status columns are seed hints; dates decide, so a record "expires"
// on its own as the demo's today moves.
export const COMPLIANCE_STATUS_SQL = `(CASE WHEN compliance_items.completed_on IS NOT NULL OR compliance_items.status = 'Done' THEN 'Done' WHEN compliance_items.due_on < ${AS_OF} THEN 'Overdue' WHEN compliance_items.due_on <= date(${AS_OF}, '+30 days') THEN 'Due soon' ELSE 'Open' END)`;
// A certificate counts as insurance only once staff verified it. Seed rows carry date hints
// (Valid/Expiring/Expired), all verified; vendor uploads land as "Pending verification" and
// become "Verified" only through vendor_cois.verify.
export const COI_VERIFIED = ["Valid", "Expiring", "Expired", "Verified"] as const;
export const coiVerifiedSql = (alias: string) => `${alias}.status IN (${COI_VERIFIED.map((s) => `'${s}'`).join(", ")})`;
// Expiry of a vendor's latest verified certificate (NULL when none is verified): the dispatch and
// ranking checks treat a vendor as insured only while this is on or after today.
export const verifiedCoiExpirySql = (coiTable: string, vendorIdExpr: string) =>
  `(SELECT max(k.expires_on) FROM ${coiTable} k WHERE k.vendor_id = ${vendorIdExpr} AND ${coiVerifiedSql("k")})`;
export const COI_STATUS_SQL = `(CASE WHEN vendor_cois.status IN ('Pending verification', 'Rejected') THEN vendor_cois.status WHEN vendor_cois.status = 'Missing' THEN 'Missing' WHEN vendor_cois.expires_on < ${AS_OF} THEN 'Expired' WHEN vendor_cois.expires_on <= date(${AS_OF}, '+30 days') THEN 'Expiring' ELSE 'Valid' END)`;
export const POLICY_STATUS_SQL = `(CASE WHEN insurance_policies.expires_on < ${AS_OF} THEN 'Expired' WHEN insurance_policies.expires_on <= date(${AS_OF}, '+60 days') THEN 'Expiring' ELSE 'Active' END)`;
