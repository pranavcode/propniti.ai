import { z } from "zod";
import { Ban, CalendarCheck, CalendarX, Check, Gavel, MoveRight, Pause, Send, Sparkles, TrendingDown, Upload, X } from "lucide-react";
import { LEADERS, OPS } from "@/entities/common";
import type { ActionContext, ActionResult, Role, Row } from "@/entities/types";
import { registerAction } from "../actions";
import { checkFairHousing } from "./fairHousing";
import { APPROVERS, COLUMN_KEYS, columnOf, planMove } from "./pipeline";
import { commit, newId, readRow, type Change } from "./store";

// Named actions for the leasing module. Each runs through POST /api/e/[entity]/[id]/actions/[key],
// which checks the role, scope and `when`, and audits the result. AI steps load lazily so the
// registry stays light and free of import cycles with the AI runtime.

const LEASING: Role[] = [...OPS, "leasing_agent", "broker"];
const ok = (message: string, href?: string): ActionResult => ({ status: 200, message, href });
const fail = (status: 400 | 403 | 404 | 409, error: string): ActionResult => ({ status, error });
const now = (ctx: ActionContext) => new Date(ctx.nowMs).toISOString();
const ai = () => import("./ai");
// AI steps run from their own panels (they return a draft or score), not as header buttons.
const NO_INPUT = z.object({}).strict();
const runHref = (id: string) => `/app/ai/runs/${id}`;
// Action results carry text back to the page; AI steps return JSON with the run to link.
const aiResult = (data: unknown, runId: string): ActionResult => ok(JSON.stringify(data), runHref(runId));

async function latestApplication(ctx: ActionContext, prospectId: string) {
  const { effective } = await import("@/server/query");
  return ctx.db.prepare(`SELECT a.* FROM ${effective("applications", ctx.ws)} a JOIN ${effective("applicants", ctx.ws)} ap ON ap.id = a.applicant_id WHERE ap.prospect_id = ? ORDER BY a.submitted_at DESC LIMIT 1`).bind(prospectId).first<Row>();
}

// Closes any open AI proposal for the record once a person has acted on it another way, so the
// approvals inbox doesn't keep asking.
async function closeProposals(ctx: ActionContext, entity: string, entityId: string, decision: "Approved" | "Edited" | "Rejected", note: string) {
  const { effective } = await import("@/server/query");
  const open = await ctx.db.prepare(`SELECT p.id FROM ${effective("ai_proposals", ctx.ws)} p WHERE p.entity_type = ? AND p.entity_id = ? AND NOT EXISTS (SELECT 1 FROM ${effective("ai_decisions", ctx.ws)} d WHERE d.proposal_id = p.id)`).bind(entity, entityId).all<{ id: string }>();
  for (const p of open.results) {
    await ctx.db.prepare("INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, decided_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ai_decisions WHERE workspace_id = ? AND proposal_id = ?)")
      .bind(ctx.ws, newId("dec"), p.id, decision, ctx.actor.personaId, note, now(ctx), ctx.ws, p.id).run();
  }
}

// ---------------------------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "prospects.move_stage",
  label: "Move in pipeline",
  entity: "prospects",
  roles: LEASING,
  icon: MoveRight,
  input: z.object({ to: z.enum(COLUMN_KEYS) }),
  help: { summary: "Moves the lead one column on the pipeline board and updates the lead and its application.", article: "leasing-pipeline-board" },
  async handler(ctx, row, input) {
    const app = await latestApplication(ctx, String(row.id));
    const from = columnOf(String(row.stage), (app?.stage as string) ?? null);
    if (!from) return fail(409, `${row.name} is ${String(row.stage).toLowerCase()} and isn't on the board`);
    const { effective } = await import("@/server/query");
    const toured = !!(await ctx.db.prepare(`SELECT 1 FROM ${effective("showings", ctx.ws)} WHERE prospect_id = ? AND status = 'Completed' LIMIT 1`).bind(row.id).first());
    const plan = planMove(from, input.to, { role: ctx.actor.role, hasApplication: !!app, toured });
    if (!plan.ok) return fail(plan.status, plan.error);
    const changes: Change[] = [];
    if (plan.prospectStage) changes.push({ table: "prospects", id: String(row.id), changes: { stage: plan.prospectStage, last_contact_at: now(ctx) } });
    if (plan.appStage && app) changes.push({ table: "applications", id: String(app.id), changes: { stage: plan.appStage, ...(plan.decide ? { decided_by: ctx.actor.personaId, decided_at: now(ctx) } : {}) } });
    await commit(ctx, { entity: "prospects", id: String(row.id), propertyId: row.property_id, verb: "moved", summary: `Moved ${row.name} from ${from} to ${input.to} (${ctx.actor.name})`, data: { from, to: input.to } }, changes);
    return ok(`${row.name} moved to ${input.to}`);
  },
});

registerAction({
  key: "prospects.mark_lost",
  label: "Mark lost",
  entity: "prospects",
  roles: LEASING,
  icon: Ban,
  bulk: true,
  when: (r) => !["Leased", "Lost"].includes(String(r.stage)),
  input: z.object({ reason: z.string().trim().max(200).default("") }),
  confirm: { title: "Mark this lead lost?", body: "It leaves the pipeline board. You can still find it under Prospects → Lost." },
  async handler(ctx, row, input) {
    await commit(ctx, { entity: "prospects", id: String(row.id), propertyId: row.property_id, verb: "lost", summary: `Marked lost${input.reason ? `: ${input.reason}` : ""}` }, [{ table: "prospects", id: String(row.id), changes: { stage: "Lost" } }]);
    return ok(`${row.name} marked lost`);
  },
});

// ---------------------------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "showings.complete",
  label: "Mark toured",
  entity: "showings",
  roles: LEASING,
  icon: CalendarCheck,
  when: (r) => r.status === "Scheduled",
  input: z.object({ feedback: z.string().trim().max(1000).default("") }),
  async handler(ctx, row, input) {
    const prospect = await readRow(ctx, "prospects", String(row.prospect_id));
    const changes: Change[] = [{ table: "showings", id: String(row.id), changes: { status: "Completed", feedback: input.feedback } }];
    if (prospect && ["Inquiry", "Contacted", "Tour scheduled"].includes(String(prospect.stage))) changes.push({ table: "prospects", id: String(prospect.id), changes: { stage: "Toured", last_contact_at: now(ctx) } });
    await commit(ctx, { entity: "showings", id: String(row.id), propertyId: row.property_id, verb: "completed", summary: `Tour completed${input.feedback ? `: ${input.feedback}` : ""}` }, changes);
    return ok("Tour marked as completed");
  },
});

registerAction({
  key: "showings.no_show",
  label: "No-show",
  entity: "showings",
  roles: LEASING,
  icon: CalendarX,
  when: (r) => r.status === "Scheduled",
  confirm: { title: "Mark as a no-show?", body: "The lead stays open so you can follow up and rebook." },
  async handler(ctx, row) {
    await commit(ctx, { entity: "showings", id: String(row.id), propertyId: row.property_id, verb: "no-show", summary: "Prospect didn't come to the tour" }, [{ table: "showings", id: String(row.id), changes: { status: "No-show" } }]);
    return ok("Marked as a no-show");
  },
});

// ---------------------------------------------------------------------------------------------
// Applications: AI scoring, then the broker's decision
// ---------------------------------------------------------------------------------------------

const OPEN_APP = ["Started", "Submitted", "Screening", "Review"];

registerAction({
  key: "applications.score",
  label: "Score with AI",
  entity: "applications",
  roles: [...LEASING],
  icon: Sparkles,
  when: (r) => OPEN_APP.includes(String(r.stage)),
  help: { summary: "The Leasing agent scores the application from income, credit band, rental history and verification only, and sends a recommendation to the broker.", article: "fair-housing-applicant-scoring" },
  input: NO_INPUT,
  async handler(ctx, row) {
    const { scoreApplication } = await ai();
    const r = await scoreApplication(ctx, row);
    const s = r.result;
    await commit(ctx, { entity: "applications", id: String(row.id), propertyId: row.property_id, verb: "scored", summary: `Leasing agent scored ${s.score} and recommends ${s.recommendation.toLowerCase()}`, data: { run_id: r.runId } },
      [{ table: "applications", id: String(row.id), changes: { score: s.score, scoring_factors: JSON.stringify(s.factors), recommendation: s.recommendation, income_to_rent: Number(s.ratio.toFixed(2)), ...(row.stage === "Submitted" || row.stage === "Screening" ? { stage: "Review" } : {}) } }]);
    return aiResult({ ...s, source: r.source, model: r.model, runId: r.runId }, r.runId);
  },
});

// Used by the broker's buttons and by approving a Leasing agent proposal in the inbox (whose payload
// carries the recommendation). The decision, the person and the AI recommendation are all audited.
const Decide = z.object({
  decision: z.enum(["Approved", "Conditional", "Denied"]).optional(),
  note: z.string().trim().max(500).optional(),
  facts: z.object({ recommendation: z.string().optional() }).passthrough().optional(),
}).passthrough();

registerAction({
  key: "applications.decide",
  label: "Decide application",
  entity: "applications",
  roles: APPROVERS,
  icon: Gavel,
  when: (r) => OPEN_APP.includes(String(r.stage)),
  input: Decide,
  help: { summary: "Approve, approve with conditions, or deny. Only brokers and managers decide; the AI recommendation is advice.", article: "fair-housing-applicant-scoring" },
  async handler(ctx, row, input) {
    const rec = input.facts?.recommendation;
    const decision = input.decision ?? (rec === "Approve" ? "Approved" : rec === "Deny" ? "Denied" : rec ? "Conditional" : undefined);
    if (!decision) return fail(400, "Choose approve, conditional or deny");
    if (decision !== "Approved" && !input.note && !rec) return fail(400, "Give a reason for a conditional approval or a denial. It goes in the adverse-action record.");
    const followsAi = row.recommendation ? (row.recommendation === "Approve" ? "Approved" : row.recommendation === "Deny" ? "Denied" : "Conditional") === decision : null;
    const summary = `${decision} by ${ctx.actor.name}${row.recommendation ? ` (AI recommended ${String(row.recommendation).toLowerCase()}${followsAi === false ? "; overridden" : ""})` : ""}${input.note ? `: ${input.note}` : ""}`;
    await commit(ctx, { entity: "applications", id: String(row.id), propertyId: row.property_id, verb: "decided", summary, data: { decision, ai_recommendation: row.recommendation ?? null, note: input.note ?? "" } },
      [{ table: "applications", id: String(row.id), changes: { stage: decision, decided_by: ctx.actor.personaId, decided_at: now(ctx) } }]);
    await closeProposals(ctx, "applications", String(row.id), followsAi === false ? "Rejected" : "Approved", `${decision} by ${ctx.actor.name}${input.note ? `: ${input.note}` : ""}`);
    return ok(`Application ${decision.toLowerCase()}`);
  },
});

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "listings.draft_description",
  label: "Draft with AI",
  entity: "listings",
  roles: LEASING,
  icon: Sparkles,
  help: { summary: "The Leasing agent drafts the headline and description from the unit and property facts. You edit it before saving.", article: "listing-editor-ai-description" },
  input: NO_INPUT,
  async handler(ctx, row) {
    const { draftListing } = await ai();
    const r = await draftListing(ctx, row);
    return aiResult({ ...r.result, flags: checkFairHousing(`${r.result.headline} ${r.result.description}`), source: r.source, model: r.model, runId: r.runId }, r.runId);
  },
});

const syndicate = (row: Row, value: string) => {
  const s = (typeof row.syndication === "object" && row.syndication ? row.syndication : {}) as Record<string, string>;
  return JSON.stringify(Object.fromEntries(Object.keys(s).length ? Object.keys(s).map((k) => [k, value === "Live" && k === "Facebook Marketplace" && s[k] === "Off" ? "Off" : value]) : [["Zillow", value], ["Apartments.com", value], ["Website", value]]));
};

registerAction({
  key: "listings.publish",
  label: "Publish",
  entity: "listings",
  roles: LEASING,
  icon: Upload,
  bulk: true,
  when: (r) => r.status === "Draft" || r.status === "Paused",
  help: { summary: "Puts the listing live on the website and the listing sites it syndicates to.", article: "list-unit-syndication" },
  async handler(ctx, row) {
    const flags = checkFairHousing(`${row.headline} ${row.description}`);
    if (flags.length) return fail(409, `Fix the fair-housing wording first: "${flags[0].phrase}" (${flags[0].category}). Open the editor for a suggestion.`);
    if (!String(row.description ?? "").trim()) return fail(409, "Add a description before publishing. \"Draft with AI\" in the editor writes one.");
    await commit(ctx, { entity: "listings", id: String(row.id), propertyId: row.property_id, verb: "published", summary: "Published and sent to listing sites" },
      [{ table: "listings", id: String(row.id), changes: { status: "Active", syndication: syndicate(row, "Live"), ...(row.status === "Draft" ? { listed_on: now(ctx).slice(0, 10) } : {}) } }]);
    return ok("Listing published");
  },
});

registerAction({
  key: "listings.pause",
  label: "Pause",
  entity: "listings",
  roles: LEASING,
  icon: Pause,
  bulk: true,
  when: (r) => r.status === "Active",
  async handler(ctx, row) {
    await commit(ctx, { entity: "listings", id: String(row.id), propertyId: row.property_id, verb: "paused", summary: "Paused on all listing sites" }, [{ table: "listings", id: String(row.id), changes: { status: "Paused", syndication: syndicate(row, "Paused") } }]);
    return ok("Listing paused");
  },
});

registerAction({
  key: "listings.reduce_price",
  label: "Change price",
  entity: "listings",
  roles: LEASING,
  icon: TrendingDown,
  when: (r) => r.status !== "Leased",
  input: z.object({ rent: z.number().min(100).max(50_000), reason: z.string().trim().min(3).max(200) }),
  help: { summary: "Changes the asking rent and keeps the old price and your reason in the price history.", article: "list-unit-syndication" },
  async handler(ctx, row, input) {
    const cents = Math.round(input.rent * 100);
    const before = Math.round(Number(row.rent) * 100);
    if (cents === before) return fail(409, "That is already the asking rent");
    await commit(ctx, { entity: "listings", id: String(row.id), propertyId: row.property_id, verb: "repriced", summary: `Asking rent ${before > cents ? "lowered" : "raised"} from $${before / 100} to $${cents / 100}: ${input.reason}` },
      [{ table: "listings", id: String(row.id), changes: { rent_cents: cents } }],
      [{ table: "listing_price_history", row: { id: newId("lph"), listing_id: row.id, property_id: row.property_id, rent_cents: cents, changed_on: now(ctx).slice(0, 10), reason: input.reason } }]);
    return ok(`Asking rent is now $${(cents / 100).toLocaleString("en-US")}`);
  },
});

// ---------------------------------------------------------------------------------------------
// Concessions (regional managers approve property specials)
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "concessions.approve",
  label: "Approve",
  entity: "concessions",
  roles: [...LEADERS],
  icon: Check,
  when: (r) => r.status === "Proposed",
  async handler(ctx, row) {
    await commit(ctx, { entity: "concessions", id: String(row.id), propertyId: row.property_id, verb: "approved", summary: `Approved by ${ctx.actor.name}` }, [{ table: "concessions", id: String(row.id), changes: { status: "Active", approved_by: ctx.actor.personaId } }]);
    await closeProposals(ctx, "concessions", String(row.id), "Approved", `Approved by ${ctx.actor.name}`);
    return ok("Concession approved");
  },
});

registerAction({
  key: "concessions.reject",
  label: "Reject",
  entity: "concessions",
  roles: [...LEADERS],
  icon: X,
  when: (r) => r.status === "Proposed",
  input: z.object({ reason: z.string().trim().min(3).max(300) }),
  async handler(ctx, row, input) {
    await commit(ctx, { entity: "concessions", id: String(row.id), propertyId: row.property_id, verb: "rejected", summary: `Rejected by ${ctx.actor.name}: ${input.reason}` }, [{ table: "concessions", id: String(row.id), changes: { status: "Rejected" } }]);
    await closeProposals(ctx, "concessions", String(row.id), "Rejected", input.reason);
    return ok("Concession rejected");
  },
});

// ---------------------------------------------------------------------------------------------
// Renewal offers: the Renewals agent prices it, a person accepts or edits, AI drafts, a person sends
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "renewal_offers.propose",
  label: "Price with AI",
  entity: "renewal_offers",
  roles: LEASING,
  icon: Sparkles,
  when: (r) => r.status === "Draft",
  help: { summary: "The Renewals agent prices the offer from the unit type's market rent, tenure and payment history.", article: "renewal-workflow" },
  input: NO_INPUT,
  async handler(ctx, row) {
    const { proposeOffer } = await ai();
    const r = await proposeOffer(ctx, row);
    await commit(ctx, { entity: "renewal_offers", id: String(row.id), propertyId: row.property_id, verb: "priced", summary: `Renewals agent proposed $${r.result.rentCents / 100} (${r.result.changePct}%)`, data: { run_id: r.runId } },
      [{ table: "renewal_offers", id: String(row.id), changes: { rent_cents: r.result.rentCents, market_rent_cents: r.result.facts.market_rent_cents } }]);
    return aiResult({ ...r.result, source: r.source, model: r.model, runId: r.runId }, r.runId);
  },
});

registerAction({
  key: "renewal_offers.draft_message",
  label: "Draft message with AI",
  entity: "renewal_offers",
  roles: LEASING,
  icon: Sparkles,
  when: (r) => r.status === "Draft",
  input: NO_INPUT,
  async handler(ctx, row) {
    const { draftOfferMessage } = await ai();
    const r = await draftOfferMessage(ctx, { ...row, rent_cents: Math.round(Number(row.rent) * 100) });
    return aiResult({ ...r.result, source: r.source, model: r.model, runId: r.runId }, r.runId);
  },
});

const SendInput = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(4000),
  channel: z.enum(["Email", "SMS", "Portal"]).default("Email"),
  ai_drafted: z.boolean().default(false),
});

registerAction({
  key: "renewal_offers.send",
  label: "Send offer",
  entity: "renewal_offers",
  roles: LEASING,
  icon: Send,
  when: (r) => r.status === "Draft",
  input: SendInput,
  help: { summary: "Sends the offer to the primary resident and records the message, the offer and who sent it.", article: "renewal-workflow" },
  async handler(ctx, row, input) {
    const { checkDraft } = await import("@/ai/tools/write");
    const rent = Math.round(Number(row.rent) * 100);
    const problems = [...checkDraft(input.body, { offer_rent_cents: rent, current_rent_cents: Math.round(Number(row.current_rent) * 100) }), ...checkFairHousing(input.body).map((f) => `"${f.phrase}" (${f.category})`)];
    if (problems.length) return fail(409, `Check the message: ${problems[0]}`);
    const { effective } = await import("@/server/query");
    const resident = await ctx.db.prepare(`SELECT r.id FROM ${effective("leases", ctx.ws)} l JOIN ${effective("residents", ctx.ws)} r ON r.household_id = l.household_id AND r.is_primary = 1 WHERE l.id = ?`).bind(row.lease_id).first<{ id: string }>();
    if (!resident) return fail(409, "No primary resident on this lease to send the offer to");
    const at = now(ctx);
    const threadId = newId("thr");
    await commit(ctx, { entity: "renewal_offers", id: String(row.id), propertyId: row.property_id, verb: "sent", summary: `Offer of $${rent / 100} for ${row.term_months} months sent by ${input.channel}${input.ai_drafted ? " (AI-drafted, reviewed by a person)" : ""}` },
      [{ table: "renewal_offers", id: String(row.id), changes: { status: "Sent", sent_at: at, expires_on: new Date(ctx.nowMs + 30 * 86_400_000).toISOString().slice(0, 10) } }],
      [
        { table: "message_threads", row: { id: threadId, property_id: row.property_id, party_kind: "resident", party_id: resident.id, subject: input.subject, entity_type: "renewal_offers", entity_id: row.id, assigned_to: ctx.actor.personaId, status: "Waiting", last_message_at: at, unread: 0 } },
        { table: "messages", row: { id: newId("msg"), thread_id: threadId, channel: input.channel, direction: "out", sender_kind: "staff", sender_id: ctx.actor.personaId, body: input.body, drafted_by_agent: input.ai_drafted ? "renewals" : null, sent_at: at } },
      ]);
    await closeProposals(ctx, "renewal_offers", String(row.id), "Approved", `Sent at $${rent / 100} by ${ctx.actor.name}`);
    await closeProposals(ctx, "leases", String(row.lease_id), "Edited", `Handled on the renewals page by ${ctx.actor.name}`);
    return ok("Renewal offer sent", `/app/leasing/renewal-offers/${row.id}`);
  },
});
