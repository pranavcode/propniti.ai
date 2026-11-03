import { AS_OF } from "@/entities/common";

// Derived statuses for the risk defs and metrics. Stored status columns are seed hints; dates decide, so a record "expires"
// on its own as the demo's today moves.
export const COMPLIANCE_STATUS_SQL = `(CASE WHEN compliance_items.completed_on IS NOT NULL OR compliance_items.status = 'Done' THEN 'Done' WHEN compliance_items.due_on < ${AS_OF} THEN 'Overdue' WHEN compliance_items.due_on <= date(${AS_OF}, '+30 days') THEN 'Due soon' ELSE 'Open' END)`;
export const COI_STATUS_SQL = `(CASE WHEN vendor_cois.status = 'Missing' THEN 'Missing' WHEN vendor_cois.expires_on < ${AS_OF} THEN 'Expired' WHEN vendor_cois.expires_on <= date(${AS_OF}, '+30 days') THEN 'Expiring' ELSE 'Valid' END)`;
export const POLICY_STATUS_SQL = `(CASE WHEN insurance_policies.expires_on < ${AS_OF} THEN 'Expired' WHEN insurance_policies.expires_on <= date(${AS_OF}, '+60 days') THEN 'Expiring' ELSE 'Active' END)`;
