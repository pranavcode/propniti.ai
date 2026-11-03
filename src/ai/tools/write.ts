import { z } from "zod";
import { INTERNAL_ROLES } from "@/entities/types";
import { executeProposal } from "../effects";
import { eff, get, isTable, parseJson, type Table } from "../data";
import type { AgentCtx, ProposeInput } from "../runtime";
import type { RunContext } from "../types";
import { registerTool } from "./registry";

// Write tools. None of them changes records directly: they create proposals for a person, store a
// checked message draft, or (execute) run a proposal that a person or the policy already approved.

const ac = (ctx: RunContext) => ctx as unknown as AgentCtx;
const roles = [...INTERNAL_ROLES];

// Dollar amounts in a draft, in cents: "$1,725" → 172500, "$12.50" → 1250.
export const amountsIn = (text: string) => [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "") + (m[2] ?? "")) * 100));
const PROMISE = /\b(waiv\w*|forgiv\w*|no late fees?|won'?t (be )?charged?|guarantee\w*|cancel (your|the) (debt|balance))\b/i;

// Grader shared by the tool and the evals: figures in a draft must be figures from the facts, and a
// draft never promises a waiver.
export function checkDraft(body: string, facts: Record<string, unknown> | undefined): string[] {
  const problems: string[] = [];
  if (PROMISE.test(body)) problems.push("Drafts can't promise waivers, forgiveness or guarantees; a person decides those.");
  const money = new Set(Object.entries(facts ?? {}).filter(([k]) => k.endsWith("_cents")).map(([, v]) => Number(v)));
  for (const a of amountsIn(body)) if (!money.has(a)) problems.push(`$${(a / 100).toFixed(2)} isn't in the record's figures (${[...money].map((m) => `$${(m / 100).toFixed(2)}`).join(", ") || "none"}).`);
  return problems;
}

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
  description: "Write a message to a resident, vendor, owner or applicant about a record. Use only figures from the record's facts. Never promise waivers. The draft is attached to the proposal for that record.",
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
    const problems = checkDraft(i.body, facts);
    if (problems.length) throw new Error(`Draft rejected: ${problems.join(" ")} Rewrite it.`);
    c.drafts.set(i.entity_id, { subject: i.subject, body: i.body, channel: i.channel, language: i.language });
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

// Rules whose fixes touch money, fraud or legal status: always a person, never auto-applied.
const HUMAN_RULES = /^(payments\.|owner_distributions\.|bank_transactions\.|vendors\.unverified_bank_change|leases\.rent_outlier)/;
const LEDGER = /^(charges|payments|transfers|owner_distributions|bank_accounts|journal_entries|credits|bank_transactions)$/;

type Fix = { changes?: Record<string, unknown>; action?: string; params?: Record<string, unknown>; why?: string[]; confidence?: number; source?: string; merge_into?: string };

export function fixProposal(issue: Record<string, unknown>, extraWhy?: string): ProposeInput {
  const fix = parseJson<Fix | null>(issue.suggested_fix, null) ?? {};
  const rule = String(issue.rule_id);
  const table = String(issue.entity_type);
  const id = String(issue.entity_id);
  const evidence = parseJson<Record<string, unknown>>(issue.evidence, {});
  const human = HUMAN_RULES.test(rule) || LEDGER.test(table);
  const why = [...(fix.why ?? [`Rule ${rule} flagged this ${table.replace(/_/g, " ")} record`]), ...(extraWhy ? [extraWhy] : [])];
  // Ledger rows aren't edited from here: the fix becomes a task for the accountant with the evidence.
  const effects = LEDGER.test(table) || !isTable(table)
    ? [{ kind: "task", title: `Fix ${rule.replace(/[._]/g, " ")} on ${id}`, detail: `${why.join(" ")}\nEvidence: ${JSON.stringify(evidence)}\nSuggested: ${JSON.stringify(fix.changes ?? fix.params ?? {})}`, assignee_role: "accountant", priority: "High", property_id: issue.property_id ?? null }]
    : rule === "vendors.unverified_bank_change"
      ? [
          { kind: "update", table: "vendors", id, changes: { status: "Inactive" }, fix: true, issue_id: issue.id },
          { kind: "task", title: `Verify bank change for vendor ${id} by phone (number on file, not the one in the request)`, detail: why.join(" "), assignee_role: "accountant", priority: "High" },
        ]
      : fix.merge_into
        ? [{ kind: "update", table, id, changes: {}, fix: true, issue_id: issue.id, tombstone: true }]
        : [{ kind: "update", table, id, changes: fix.changes ?? {}, fix: true, issue_id: issue.id }];
  return {
    entity: "data_issues", entityId: String(issue.id), action: "data_issues.apply_fix", propertyId: (issue.property_id as string) ?? null,
    title: `Fix: ${rule.replace(/^[a-z_]+\./, "").replace(/_/g, " ")} on ${table.replace(/_/g, " ")} ${id}`,
    payload: { issue_id: issue.id, rule, before: evidence, changes: fix.changes ?? null, merge_into: fix.merge_into ?? null, effects },
    why, confidence: fix.confidence ?? 0.8, risk: human ? "High" : issue.severity === "critical" ? "Medium" : "Low", alwaysHuman: human,
    evidence: [{ entity_type: table, entity_id: id, label: `${table.replace(/_/g, " ")} ${id}` }],
  };
}

registerTool({
  key: "actions.execute",
  description: "Run a proposal that a person approved in this conversation, or that the approval policy allows without a person.",
  input: z.object({ proposal_id: z.string().max(80) }),
  output: z.any(),
  mode: "write", roles, requiresApproval: () => true,
  async run(ctx, i) {
    const c = ac(ctx);
    const e = eff("ai_proposals" as Table, c.ws);
    const p = await c.db.prepare(`SELECT * FROM ${e.sql} p WHERE p.id = ?`).bind(...e.params, i.proposal_id).first<Record<string, unknown>>();
    if (!p) throw new Error(`Proposal ${i.proposal_id} not found`);
    if (p.risk !== "Low" || p.amount_cents != null || c.autonomy !== "auto_within_policy" || c.ws === "base") throw new Error("This proposal needs a person to approve it in the approvals inbox");
    return executeProposal(c.data, p, { id: c.agent, name: `${c.agent} agent`, agent: c.agent });
  },
});
