"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FixPreview, type FixPreviewProps } from "@/components/app/ai";
import { api } from "./client";
import { humanizeKey, readableText, valueText, type FieldHint } from "@/lib/fieldText";

// One Data Health issue as a FixPreview: on the Data Health page, and inline in a record's peek
// drawer when that record has exactly one open issue.

export type Issue = {
  id: string; rule_id: string; rule_name: string | null; rule_description: string | null; entity_type: string; entity_id: string; property: string | null; severity: string; detected_at: string;
  suggested_fix: { why?: string[]; confidence?: number; source?: string; merge_into?: string } | null; before: Record<string, unknown> | null; after: Record<string, unknown>; needsPerson: string | null; href?: string; evidence: Record<string, unknown>;
  entity_label?: string; record?: string | null; fields?: Record<string, FieldHint>;
  options?: { label: string; why: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> }[];
};

// "Lease Lee household · #412", or "Lease L-10002" when the record has no name.
export const issueRecord = (i: Issue) => `${i.entity_label ?? humanizeKey(i.entity_type)} ${i.record ?? i.entity_id}`;

// What a person does for rules whose fix is a named step rather than field changes.
export const NEXT_STEP: Record<string, string> = {
  "residents.possible_duplicate": "Compare the two residents and merge this one into the older record if they're the same person.",
  "vendors.unverified_bank_change": "Call the vendor on a number already on file to confirm the new bank details. Payments stay on hold until then.",
  "vendors.missing_w9": "Request a W-9 from the vendor before the next payment.",
  "bills.possible_duplicate": "Compare it with the paid bill and void this one if it's the same invoice.",
  "bills.amount_outlier": "Check the invoice against the work done before approving it.",
  "bank_transactions.unmatched_deposit": "Match the deposit to its transfer batch in bank reconciliation.",
  "compliance_items.overdue": "Schedule the inspection or service and record the date.",
  "owner_distributions.rounding_cent": "Adjust the distribution by the cent so it matches the owner statement.",
  "documents.import_swapped_columns": "Check the column mapping and import the file again.",
  "documents.misfiled": "File the document to the record it belongs to.",
  "leases.past_end_date": "Check whether the resident still lives there. If they moved out, mark the lease as ended; if they're staying, switch it to month-to-month. Either change goes to approvals.",
};

export const noFix = (i: Issue) => !Object.keys(i.after ?? {}).length && !i.suggested_fix?.merge_into;

export type IssueResult = { message: string; queued?: boolean; proposalId?: string };
// option: which of the issue's fix options a person picked (rules whose fix is a choice).
export const actOnIssue = (id: string, action: "apply" | "dismiss", option?: number) => api<IssueResult>(`/api/ai/data-health/issues/${id}`, "POST", { action, option });

export function fixPreviewProps(i: Issue, act: (action: "apply" | "dismiss", option?: number) => Promise<unknown>): FixPreviewProps {
  const rows = (after: Record<string, unknown>, before: Record<string, unknown> | null) => Object.entries(after).map(([field, value]) => {
    const hint = i.fields?.[field];
    return { field, label: hint?.label ?? humanizeKey(field), before: valueText(field, before?.[field] ?? i.evidence?.[field] ?? null, hint), after: valueText(field, value, hint) };
  });
  return {
    title: `${i.rule_name ?? "Data issue"} · ${issueRecord(i)}${i.property ? ` · ${i.property}` : ""}`,
    changes: rows(i.after ?? {}, i.before),
    choices: i.options?.map((o, k) => ({ label: o.label, detail: o.why, changes: rows(o.after, o.before), onChoose: () => act("apply", k) })),
    why: (i.suggested_fix?.why ?? [i.rule_description ?? "Flagged by a data rule"]).map(readableText),
    confidence: i.suggested_fix?.confidence ?? 0.7,
    source: i.suggested_fix?.source === "rule" || !i.suggested_fix?.source ? "rule" : "Data Health Agent",
    needsPerson: noFix(i) && !i.options?.length ? null : i.needsPerson,
    nextStep: noFix(i) ? { text: NEXT_STEP[i.rule_id] ?? "Open the record to correct it.", href: i.href, label: `Open ${(i.entity_label ?? "record").toLowerCase()}` } : undefined,
    onApply: noFix(i) ? undefined : () => act("apply"),
    onDismiss: () => act("dismiss"),
  };
}

// Loads the issue through the Data Health API (same fix, reasons and role check as the page).
export function IssueFix({ id, onDone }: { id: string; onDone?: () => void }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  useEffect(() => {
    let live = true;
    api<{ issues: { rows: Issue[] } }>(`/api/ai/data-health?scores=0&size=1&issue=${encodeURIComponent(id)}`)
      .then((r) => { if (live) setIssue(r.issues.rows[0] ?? null); }, () => {});
    return () => { live = false; };
  }, [id]);
  if (!issue) return null;
  const act = async (action: "apply" | "dismiss", option?: number) => {
    try {
      const r = await actOnIssue(issue.id, action, option);
      if (r.queued) toast.info(r.message);
      else toast.success(r.message);
      onDone?.();
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  return <FixPreview {...fixPreviewProps(issue, act)} className="mt-2" />;
}
