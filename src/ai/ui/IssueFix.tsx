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
};

// "Lease Lee household · #412", or "Lease L-10002" when the record has no name.
export const issueRecord = (i: Issue) => `${i.entity_label ?? humanizeKey(i.entity_type)} ${i.record ?? i.entity_id}`;

export const noFix = (i: Issue) => !Object.keys(i.after ?? {}).length && !i.suggested_fix?.merge_into;

export type IssueResult = { message: string; queued?: boolean; proposalId?: string };
export const actOnIssue = (id: string, action: "apply" | "dismiss") => api<IssueResult>(`/api/ai/data-health/issues/${id}`, "POST", { action });

export function fixPreviewProps(i: Issue, act: (action: "apply" | "dismiss") => Promise<unknown>): FixPreviewProps {
  return {
    title: `${i.rule_name ?? "Data issue"} · ${issueRecord(i)}${i.property ? ` · ${i.property}` : ""}`,
    changes: Object.entries(i.after ?? {}).map(([field, after]) => {
      const hint = i.fields?.[field];
      return { field, label: hint?.label ?? humanizeKey(field), before: valueText(field, i.before?.[field] ?? i.evidence?.[field] ?? null, hint), after: valueText(field, after, hint) };
    }),
    why: (i.suggested_fix?.why ?? [i.rule_description ?? "Flagged by a data rule"]).map(readableText),
    confidence: i.suggested_fix?.confidence ?? 0.7,
    source: i.suggested_fix?.source === "rule" || !i.suggested_fix?.source ? "rule" : "Data Health Agent",
    needsPerson: noFix(i) ? "No automatic fix: open the record to correct it" : i.needsPerson,
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
  const act = async (action: "apply" | "dismiss") => {
    try {
      const r = await actOnIssue(issue.id, action);
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
