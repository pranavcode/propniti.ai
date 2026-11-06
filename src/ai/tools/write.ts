import { z } from "zod";
import { getEntity } from "@/entities";
import { PERMISSIONS } from "@/auth/personas";
import { INTERNAL_ROLES, type Role } from "@/entities/types";
import { get, isTable, parseJson } from "../data";
import type { AgentCtx, ProposeInput } from "../runtime";
import type { RunContext } from "../types";
import { registerTool } from "./registry";
import { checkDraft, letterDates } from "../rules";
export { amountsIn, checkDraft } from "../rules";

// Write tools. None of them changes records directly: they create proposals for a person, store a
// checked message draft, or (execute) run a proposal that a person or the policy already approved.

const ac = (ctx: RunContext) => ctx as unknown as AgentCtx;
const roles = [...INTERNAL_ROLES];

registerTool({
  key: "actions.propose",
  description: "Propose an action on a record for a person to approve (or for the policy to auto-apply when it's low risk). Give the record, the action key, a short title, plain-English reasons and your confidence 0-1. Amounts and details are filled from the data.",
  input: z.object({
    entity: z.string(), entity_id: z.string().max(80), action: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
    title: z.string().min(3).max(160), why: z.array(z.string().max(300)).min(1).max(5), confidence: z.number().min(0).max(1),
  }),
  output: z.any(),
  mode: "write", roles, requiresApproval: () => true,
  async run(ctx, i) {
    const c = ac(ctx);
    if (!c.allowedActions.includes(i.action as ProposeInput["action"])) throw new Error(`${i.action} isn't an action this agent can propose (allowed: ${c.allowedActions.join(", ")})`);
    if (!c.guard) throw new Error("This agent proposes only from its checked candidates");
    const checked = c.guard({ entity: i.entity as ProposeInput["entity"], entityId: i.entity_id, action: i.action as ProposeInput["action"], title: i.title, why: i.why, confidence: i.confidence, payload: {} });
    if ("refuse" in checked) throw new Error(checked.refuse);
    const p = await c.proposeFull(checked);
    return { proposal_id: p.id, queue_state: p.queueState, duplicate: p.duplicate, executed: p.executed };
  },
});

registerTool({
  key: "messages.draft",
  description: "Write a message to a resident, vendor, owner or applicant about a record. Use only figures from the record's facts. Write dates like \"Nov 7, 2026\", never 2026-11-07. Never promise waivers. The draft is attached to the proposal for that record.",
  input: z.object({
    entity_id: z.string().max(80), channel: z.enum(["Email", "SMS", "Portal"]).default("Email"), language: z.enum(["en", "es"]).default("en"),
    subject: z.string().max(160), body: z.string().min(10).max(2000),
  }),
  output: z.any(),
  mode: "write", roles, requiresApproval: () => false,
  async run(ctx, i) {
    const c = ac(ctx);
    const facts = c.facts.get(i.entity_id);
    if (!facts) throw new Error(`No facts for ${i.entity_id}; draft only for records you are proposing on`);
    const body = letterDates(i.body, i.language);
    const problems = checkDraft(body, facts);
    if (problems.length) throw new Error(`Draft rejected: ${problems.join(" ")} Rewrite it.`);
    c.drafts.set(i.entity_id, { subject: letterDates(i.subject, i.language), body, channel: i.channel, language: i.language });
    return { saved: true, entity_id: i.entity_id };
  },
});

registerTool({
  key: "data.propose_fix",
  description: "Propose the suggested fix for an open data-health issue. Money and legal fixes always go to a person.",
  input: z.object({ issue_id: z.string().max(80), why: z.string().max(300).optional() }),
  output: z.any(),
  mode: "write", roles, requiresApproval: () => true,
  async run(ctx, i) {
    const c = ac(ctx);
    const issue = await get(c.data, "data_issues", i.issue_id);
    if (!issue) throw new Error(`Issue ${i.issue_id} not found or outside your scope`);
    if (issue.status !== "open") throw new Error(`Issue ${i.issue_id} is ${issue.status}`);
    const p = await c.proposeFull(fixProposal(issue, i.why));
    return { proposal_id: p.id, queue_state: p.queueState, duplicate: p.duplicate, executed: p.executed };
  },
});

// Rules whose fixes touch money, fraud or legal status: always a person, never auto-applied. So are
// payables records and any change to a GL account or an amount, whatever the rule.
const HUMAN_RULES = /^(payments\.|owner_distributions\.|bank_transactions\.|vendors\.unverified_bank_change|leases\.rent_outlier)/;
const LEDGER = /^(charges|payments|transfers|owner_distributions|bank_accounts|journal_entries|credits|bank_transactions)$/;
const PAYABLES = /^(bills|bill_lines)$/;
const MONEY_FIELD = /^gl_account_id$|_cents$|^bank_/;
// A lease's status decides whether it bills rent and whether the resident is still under it (legal
// status): always a person, but a property manager's call, not an accountant's.
const LEGAL_RULES = /^leases\.past_end_date$/;

// options: fixes a person chooses between (each with its own changes); `choice` names the picked one.
export type FixOption = { label: string; changes: Record<string, unknown>; why?: string };
type Fix = { changes?: Record<string, unknown>; action?: string; params?: Record<string, unknown>; why?: string[]; confidence?: number; source?: string; merge_into?: string; options?: FixOption[]; choice?: string };

export function fixProposal(issue: Record<string, unknown>, extraWhy?: string): ProposeInput {
  const fix = parseJson<Fix | null>(issue.suggested_fix, null) ?? {};
  const rule = String(issue.rule_id);
  const table = String(issue.entity_type);
  const id = String(issue.entity_id);
  const evidence = parseJson<Record<string, unknown>>(issue.evidence, {});
  const money = HUMAN_RULES.test(rule) || LEDGER.test(table) || PAYABLES.test(table) || Object.keys(fix.changes ?? {}).some((k) => MONEY_FIELD.test(k));
  // A fix that names an action (merge, void, hold) but no field changes has nothing to apply here.
  const manual = !Object.keys(fix.changes ?? {}).length && !fix.merge_into && rule !== "vendors.unverified_bank_change";
  const human = money || manual || LEGAL_RULES.test(rule);
  const assignee = money ? "accountant" : "property_manager";
  const why = [...(fix.why ?? [`Rule ${rule} flagged this ${table.replace(/_/g, " ")} record`]), ...(extraWhy ? [extraWhy] : [])];
  // Ledger rows aren't edited from here, and action-only fixes need a person to do them: either
  // becomes a task with the evidence.
  const effects = LEDGER.test(table) || !isTable(table) || manual
    ? [{ kind: "task", title: `Fix ${rule.replace(/[._]/g, " ")} on ${id}`, detail: `${why.join(" ")}\nEvidence: ${JSON.stringify(evidence)}\nSuggested: ${JSON.stringify(fix.changes ?? (fix.action ? { action: fix.action, ...fix.params } : fix.params) ?? {})}`, assignee_role: assignee, priority: "High", property_id: issue.property_id ?? null }]
    : rule === "vendors.unverified_bank_change"
      // Not a fix: the open issue is the payment hold (money.ts, bankHold), so it stays open until the
      // callback (vendors.confirm_bank_change) closes it. Approving only stops work and assigns the call.
      ? [
          { kind: "update", table: "vendors", id, changes: { status: "Inactive" } },
          { kind: "task", title: `Verify bank change for vendor ${id} by phone (number on file, not the one in the request)`, detail: why.join(" "), assignee_role: "accountant", priority: "High" },
        ]
      : fix.merge_into
        ? [{ kind: "update", table, id, changes: {}, fix: true, issue_id: issue.id, tombstone: true }]
        : [{ kind: "update", table, id, changes: fix.changes ?? {}, fix: true, issue_id: issue.id }];
  return {
    entity: "data_issues", entityId: String(issue.id), action: "data_issues.apply_fix", propertyId: (issue.property_id as string) ?? null,
    title: `Fix: ${rule.replace(/^[a-z_]+\./, "").replace(/_/g, " ")} on ${table.replace(/_/g, " ")} ${id}${fix.choice ? ` (${fix.choice})` : ""}`,
    payload: { issue_id: issue.id, rule, before: evidence, changes: fix.changes ?? null, merge_into: fix.merge_into ?? null, effects },
    why, confidence: fix.confidence ?? 0.8, risk: human ? "High" : issue.severity === "critical" ? "Medium" : "Low", alwaysHuman: human, ...(human ? { assignee } : {}),
    evidence: [{ entity_type: table, entity_id: id, label: `${table.replace(/_/g, " ")} ${id}` }],
  };
}

// Dismissing closes the issue with no fix and no approval, so a fraud or money flag (an unverified
// bank change) or any critical issue is dismissed only by the principal or a payables approver.
export function canDismiss(issue: Record<string, unknown>, role: Role): boolean {
  const p = fixProposal(issue);
  if (!(p.alwaysHuman && p.assignee === "accountant") && issue.severity !== "critical") return true;
  return role === "principal" || PERMISSIONS[role]?.payables === "approve";
}

// For the page's button: why applying this fix would queue it in the approvals inbox, or null when
// this role's click applies it. Mirrors applyFixes in datafix.ts and canDecide's low-risk rule for staff.
export function queueReason(p: ProposeInput, role: Role): string | null {
  if (p.alwaysHuman) return "Touches money, fraud or legal status, or needs a manual step: a person reviews it in the approvals inbox";
  if (p.risk !== "Low") return "Critical issue: a person with approval rights reviews it in the approvals inbox";
  const access = PERMISSIONS[role]?.[getEntity("data_issues")?.module ?? "intelligence"] ?? "none";
  return access === "write" || access === "approve" ? null : "Your role can't apply Data Health fixes: a person reviews it in the approvals inbox";
}
