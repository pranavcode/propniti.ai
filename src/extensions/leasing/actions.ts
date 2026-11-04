import { demoIsoIn, demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { Ban, CalendarCheck, CalendarX, Check, Gavel, MoveRight, Pause, Send, Sparkles, TrendingDown, Upload, X } from "lucide-react";
import { LEADERS, OPS } from "@/entities/common";
import type { ActionContext, ActionResult, Role, Row } from "@/entities/types";
import { registerAction } from "../actions";
import { checkFairHousing } from "./fairHousing";
import { APPROVERS, COLUMN_KEYS, columnOf, planMove } from "./pipeline";
import { AlreadyDone, commit, newId, readRow, type Change } from "./store";

// Named actions for the leasing module. Each runs through POST /api/e/[entity]/[id]/actions/[key],
// which checks the role, scope and `when`, and audits the result. AI steps load lazily so the
// registry stays light and free of import cycles with the AI runtime.

const LEASING: Role[] = [...OPS, "leasing_agent", "broker"];
const ok = (message: string, href?: string): ActionResult => ({ status: 200, message, href });
const fail = (status: 400 | 403 | 404 | 409, error: string): ActionResult => ({ status, error });
const now = (ctx: ActionContext) => demoNowIso(ctx.nowMs);
const ai = () => import("./ai");
// AI steps run from their own panels (they return a draft or score), not as header buttons.
const NO_INPUT = z.object({}).strict();
// Rows reach handlers presented (dollars, from the action route) or raw (cents, when an approved
// proposal runs the action); read money either way.
const cents = (row: Row, key: string) => (row[`${key}_cents`] != null ? Number(row[`${key}_cents`]) : Math.round(Number(row[key] ?? 0) * 100));
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

// One follow-up per lead per day: the header button, the bulk bar, "Send all", an edited draft and
// an approved Leasing agent proposal all share the key, so a double click or a second sender is a 409.
const FOLLOW_UP_STAGES = ["Inquiry", "Contacted", "Toured", "Tour scheduled"];
const FollowUp = z.object({ subject: z.string().trim().min(3).max(200).optional(), body: z.string().trim().min(10).max(2000).optional() }).passthrough();

async function sendFollowUp(ctx: ActionContext, row: Row, input: z.infer<typeof FollowUp>): Promise<ActionResult> {
  if (!FOLLOW_UP_STAGES.includes(String(row.stage))) return fail(409, `${row.name ?? "This lead"} is ${String(row.stage ?? "closed").toLowerCase()}; no follow-up sent`);
  const first = String(row.name ?? "there").split(" ")[0];
  const body = input.body ?? `Hi ${first}, thanks again for your interest. We still have homes that fit what you told us. Would you like to book a tour this week? Reply with a time that works and I'll set it up.\n\n${ctx.actor.name}`;
  const flags = checkFairHousing(body);
  if (flags.length) return fail(409, `Check the message: "${flags[0].phrase}" (${flags[0].category})`);
  const at = now(ctx);
  const threadId = newId("thr");
  try {
    await commit(ctx, { entity: "prospects", id: String(row.id), propertyId: row.property_id, verb: "contacted", summary: `Follow-up sent by ${ctx.actor.name}` },
      [{ table: "prospects", id: String(row.id), changes: { last_contact_at: at, ...(row.stage === "Inquiry" ? { stage: "Contacted" } : {}) } }],
      [
        { table: "message_threads", row: { id: threadId, property_id: row.property_id, party_kind: "prospect", party_id: row.id, subject: input.subject ?? "Still looking for a new home?", entity_type: "prospects", entity_id: row.id, assigned_to: ctx.actor.personaId, status: "Waiting", last_message_at: at, unread: 0 } },
        { table: "messages", row: { id: newId("msg"), thread_id: threadId, channel: "Email", direction: "out", sender_kind: "staff", sender_id: ctx.actor.personaId, body, drafted_by_agent: "leasing", sent_at: at } },
      ], `follow-up-${row.id}-${at.slice(0, 10)}`);
  } catch (e) {
    if (e instanceof AlreadyDone) return fail(409, `${row.name ?? "This lead"} already got a follow-up today`);
    throw e;
  }
  await closeProposals(ctx, "prospects", String(row.id), "Edited", `Followed up by ${ctx.actor.name}`);
  return ok(`Follow-up sent to ${row.name}`);
}

// With a subject and body: an edited draft, or an approved Leasing agent proposal (its payload carries them).
registerAction({
  key: "prospects.send_follow_up",
  label: "Send follow-up",
  entity: "prospects",
  roles: LEASING,
  icon: Send,
  when: (r) => FOLLOW_UP_STAGES.includes(String(r.stage)),
  input: FollowUp,
  handler: sendFollowUp,
});

// The one-click version for the record header, the drawer and bulk sends: the standard note.
registerAction({
  key: "prospects.follow_up",
  label: "Send follow-up",
  entity: "prospects",
  roles: LEASING,
  icon: Send,
  bulk: true,
  when: (r) => FOLLOW_UP_STAGES.includes(String(r.stage)),
  confirm: { title: "Send a follow-up?", body: "Sends the standard follow-up email from you and logs the contact. To edit the wording first, use Draft under Follow-ups due on My leasing day." },
  help: { summary: "Emails the lead a short follow-up offering a tour and logs the contact. Each lead gets at most one follow-up a day.", article: "leasing-pipeline-board" },
  handler: (ctx, row) => sendFollowUp(ctx, row, {}),
});

registerAction({
  key: "prospects.draft_follow_up",
  ai: true,
  label: "Draft follow-up with AI",
  entity: "prospects",
  roles: LEASING,
  icon: Sparkles,
  when: (r) => FOLLOW_UP_STAGES.includes(String(r.stage)),
  help: { summary: "The Leasing agent drafts a short follow-up from the lead's stage, budget and beds wanted. You edit it before sending.", article: "leasing-pipeline-board" },
  input: NO_INPUT,
  async handler(ctx, row) {
    const { draftFollowUp } = await ai();
    const r = await draftFollowUp(ctx, row);
    return aiResult({ ...r.result, source: r.source, model: r.model, runId: r.runId }, r.runId);
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
    const found = await readRow(ctx, "prospects", String(row.prospect_id));
    // Only a lead at the tour's own property (the tour row is in scope; its prospect id is just a reference).
    const prospect = found && found.property_id === row.property_id ? found : null;
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
  ai: true,
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
    return decideApplication(ctx, row, decision, input.note);
  },
});

async function decideApplication(ctx: ActionContext, row: Row, decision: "Approved" | "Conditional" | "Denied", note?: string): Promise<ActionResult> {
  if (!OPEN_APP.includes(String(row.stage))) return fail(409, `This application is already ${String(row.stage).toLowerCase()}`);
  const followsAi = row.recommendation ? (row.recommendation === "Approve" ? "Approved" : row.recommendation === "Deny" ? "Denied" : "Conditional") === decision : null;
  const summary = `${decision} by ${ctx.actor.name}${row.recommendation ? ` (AI recommended ${String(row.recommendation).toLowerCase()}${followsAi === false ? "; overridden" : ""})` : ""}${note ? `: ${note}` : ""}`;
  try {
    await commit(ctx, { entity: "applications", id: String(row.id), propertyId: row.property_id, verb: "decided", summary, data: { decision, ai_recommendation: row.recommendation ?? null, note: note ?? "" } },
      [{ table: "applications", id: String(row.id), changes: { stage: decision, decided_by: ctx.actor.personaId, decided_at: now(ctx) } }], [], `decide-${row.id}`);
  } catch (e) {
    if (e instanceof AlreadyDone) return fail(409, "Someone already decided this application");
    throw e;
  }
  await closeProposals(ctx, "applications", String(row.id), followsAi === false ? "Rejected" : "Approved", `${decision} by ${ctx.actor.name}${note ? `: ${note}` : ""}`);
  return ok(`Application ${decision.toLowerCase()}`);
}

// The same decision under the keys the seeded Leasing agent proposals use: approving one of those
// in the inbox accepts the agent's recommendation as the broker's decision.
for (const [verb, decision] of [["approve", "Approved"], ["deny", "Denied"]] as const) {
  registerAction({
    key: `applications.${verb}`,
    label: verb === "approve" ? "Approve application" : "Deny application",
    entity: "applications",
    roles: APPROVERS,
    icon: verb === "approve" ? Check : X,
    when: (r) => OPEN_APP.includes(String(r.stage)),
    input: z.object({ note: z.string().trim().max(500).optional() }).passthrough(),
    confirm: { title: verb === "approve" ? "Approve this application?" : "Deny this application?", body: "Your decision is logged with the AI recommendation. Use the AI scoring tab to add conditions or a reason." },
    handler: (ctx, row, input) => decideApplication(ctx, row, decision, input.note ?? (verb === "deny" ? "Accepted the Leasing agent's recommendation" : undefined)),
  });
}

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "listings.draft_description",
  ai: true,
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
    const next = Math.round(input.rent * 100);
    const before = cents(row, "rent");
    if (next === before) return fail(409, "That is already the asking rent");
    await commit(ctx, { entity: "listings", id: String(row.id), propertyId: row.property_id, verb: "repriced", summary: `Asking rent ${before > next ? "lowered" : "raised"} from $${before / 100} to $${next / 100}: ${input.reason}` },
      [{ table: "listings", id: String(row.id), changes: { rent_cents: next } }],
      [{ table: "listing_price_history", row: { id: newId("lph"), listing_id: row.id, property_id: row.property_id, rent_cents: next, changed_on: now(ctx).slice(0, 10), reason: input.reason } }]);
    return ok(`Asking rent is now $${(next / 100).toLocaleString("en-US")}`);
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
    // Re-checked here: an approved AI proposal runs the handler without the `when` above.
    if (row.status !== "Proposed") return fail(409, `This concession is already ${String(row.status ?? "decided").toLowerCase()}`);
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
  ai: true,
  label: "Draft message with AI",
  entity: "renewal_offers",
  roles: LEASING,
  icon: Sparkles,
  when: (r) => r.status === "Draft",
  input: NO_INPUT,
  async handler(ctx, row) {
    const { draftOfferMessage } = await ai();
    const r = await draftOfferMessage(ctx, { ...row, rent_cents: cents(row, "rent") });
    return aiResult({ ...r.result, source: r.source, model: r.model, runId: r.runId }, r.runId);
  },
});

// Bulk "Prepare all drafts" on the renewals page. Skips a draft that already has a prepared
// proposal waiting, so a re-run or a double click doesn't stack proposals.
registerAction({
  key: "renewal_offers.prepare",
  ai: true,
  bulk: true,
  label: "Prepare with AI",
  entity: "renewal_offers",
  roles: LEASING,
  icon: Sparkles,
  when: (r) => r.status === "Draft",
  help: { summary: "The Renewals agent prices the draft and writes its message, then leaves it as a proposal. A person approves before anything is sent.", article: "renewal-workflow" },
  input: NO_INPUT,
  async handler(ctx, row) {
    const { effective } = await import("@/server/query");
    const open = await ctx.db.prepare(`SELECT p.id, p.payload FROM ${effective("ai_proposals", ctx.ws)} p WHERE p.agent = 'renewals' AND p.entity_type = 'renewal_offers' AND p.entity_id = ? AND p.action = 'renewal_offers.send' AND NOT EXISTS (SELECT 1 FROM ${effective("ai_decisions", ctx.ws)} d WHERE d.proposal_id = p.id) ORDER BY p.created_at DESC LIMIT 1`).bind(row.id).first<{ id: string; payload: string }>();
    if (open && JSON.parse(open.payload || "{}").body) return ok(JSON.stringify({ skipped: true, proposalId: open.id }));
    // An older price-only proposal carries no message; this one replaces it.
    if (open) await closeProposals(ctx, "renewal_offers", String(row.id), "Edited", `Replaced by a prepared offer (${ctx.actor.name})`);
    const { prepareOffer } = await ai();
    const r = await prepareOffer(ctx, { ...row, rent_cents: cents(row, "rent") }, (rentCents, runId) =>
      commit(ctx, { entity: "renewal_offers", id: String(row.id), propertyId: row.property_id, verb: "priced", summary: `Renewals agent prepared $${rentCents / 100} with a message, waiting for approval`, data: { run_id: runId } },
        [{ table: "renewal_offers", id: String(row.id), changes: { rent_cents: rentCents } }]));
    return aiResult({ ...r.result, source: r.source, model: r.model, runId: r.runId }, r.runId);
  },
});

const SendInput = z.object({
  subject: z.string().trim().min(3).max(200).optional(),
  body: z.string().trim().min(20).max(4000).optional(),
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
  input: SendInput.passthrough(),
  help: { summary: "Sends the offer to the primary resident and records the message, the offer and who sent it.", article: "renewal-workflow" },
  async handler(ctx, row, input) {
    const { checkDraft, letterDates } = await import("@/ai/rules");
    if (row.status !== "Draft") return fail(409, `This offer was already ${String(row.status).toLowerCase()}`);
    const rent = cents(row, "rent");
    const { effective } = await import("@/server/query");
    const lease = await ctx.db.prepare(`SELECT l.end_on, p.name AS property, u.number AS unit, r.id AS resident_id, r.first_name FROM ${effective("leases", ctx.ws)} l JOIN ${effective("properties", ctx.ws)} p ON p.id = l.property_id JOIN ${effective("units", ctx.ws)} u ON u.id = l.unit_id LEFT JOIN ${effective("residents", ctx.ws)} r ON r.household_id = l.household_id AND r.is_primary = 1 WHERE l.id = ? AND l.property_id = ?`).bind(row.lease_id, row.property_id).first<Row>();
    if (!lease?.resident_id) return fail(409, "No primary resident on this lease to send the offer to");
    // Approved from the inbox without an edited message: the standard wording, with the offer's own figures.
    const subject = input.subject ?? `Your renewal offer at ${lease.property}`;
    const body = letterDates(input.body ?? `Hi ${lease.first_name},\n\nYour lease at ${lease.property} #${lease.unit} ends on ${lease.end_on}. We can renew for ${row.term_months} months at $${(rent / 100).toLocaleString("en-US")} a month.\n\nReply to this message to accept, or if you'd like to talk about a different term.\n\nThank you,\n${ctx.actor.name}`);
    const problems = [...checkDraft(body, { offer_rent_cents: rent, current_rent_cents: cents(row, "current_rent") }), ...checkFairHousing(body).map((f) => `"${f.phrase}" (${f.category})`)];
    if (problems.length) return fail(409, `Check the message: ${problems[0]}`);
    const at = now(ctx);
    const threadId = newId("thr");
    try {
      await commit(ctx, { entity: "renewal_offers", id: String(row.id), propertyId: row.property_id, verb: "sent", summary: `Offer of $${rent / 100} for ${row.term_months} months sent by ${input.channel}${input.ai_drafted ? " (AI-drafted, reviewed by a person)" : ""}` },
      [{ table: "renewal_offers", id: String(row.id), changes: { status: "Sent", sent_at: at, expires_on: demoIsoIn(30 * 86_400_000, ctx.nowMs).slice(0, 10) } }],
      [
        { table: "message_threads", row: { id: threadId, property_id: row.property_id, party_kind: "resident", party_id: lease.resident_id, subject, entity_type: "renewal_offers", entity_id: row.id, assigned_to: ctx.actor.personaId, status: "Waiting", last_message_at: at, unread: 0 } },
        { table: "messages", row: { id: newId("msg"), thread_id: threadId, channel: input.channel, direction: "out", sender_kind: "staff", sender_id: ctx.actor.personaId, body, drafted_by_agent: input.ai_drafted ? "renewals" : null, sent_at: at } },
      ], `send-${row.id}`);
    } catch (e) {
      if (e instanceof AlreadyDone) return fail(409, "This offer was already sent");
      throw e;
    }
    await closeProposals(ctx, "renewal_offers", String(row.id), "Approved", `Sent at $${rent / 100} by ${ctx.actor.name}`);
    await closeProposals(ctx, "leases", String(row.lease_id), "Edited", `Handled on the renewals page by ${ctx.actor.name}`);
    return ok("Renewal offer sent", `/app/leasing/renewal-offers/${row.id}`);
  },
});

// A reminder on a sent offer nobody has answered. The Renewals agent proposes it (a plain reminder,
// or a month-to-month notice when the lease is about to end); a person approves. Once a day per offer.
registerAction({
  key: "renewal_offers.follow_up",
  label: "Send reminder",
  entity: "renewal_offers",
  roles: LEASING,
  icon: Send,
  when: (r) => r.status === "Sent",
  input: FollowUp,
  help: { summary: "Reminds the resident that their renewal offer is still open and logs the message.", article: "renewal-workflow" },
  async handler(ctx, row, input) {
    const { checkDraft, letterDates } = await import("@/ai/rules");
    if (row.status !== "Sent") return fail(409, `This offer is ${String(row.status).toLowerCase()}; no reminder sent`);
    const rent = cents(row, "rent");
    const { effective } = await import("@/server/query");
    const lease = await ctx.db.prepare(`SELECT l.end_on, p.name AS property, u.number AS unit, r.id AS resident_id, r.first_name FROM ${effective("leases", ctx.ws)} l JOIN ${effective("properties", ctx.ws)} p ON p.id = l.property_id JOIN ${effective("units", ctx.ws)} u ON u.id = l.unit_id LEFT JOIN ${effective("residents", ctx.ws)} r ON r.household_id = l.household_id AND r.is_primary = 1 WHERE l.id = ? AND l.property_id = ?`).bind(row.lease_id, row.property_id).first<Row>();
    if (!lease?.resident_id) return fail(409, "No primary resident on this lease to remind");
    const subject = input.subject ?? `Your renewal offer at ${lease.property} is still open`;
    const body = letterDates(input.body ?? `Hi ${lease.first_name},\n\nA reminder that your renewal offer of $${(rent / 100).toLocaleString("en-US")} a month for ${row.term_months} months is still open. Your lease at ${lease.property} #${lease.unit} ends on ${lease.end_on}. Reply to accept, or let us know if you'd like to talk about other terms.\n\nThank you,\n${ctx.actor.name}`);
    const problems = [...checkDraft(body, { offer_rent_cents: rent, current_rent_cents: cents(row, "current_rent") }), ...checkFairHousing(body).map((f) => `"${f.phrase}" (${f.category})`)];
    if (problems.length) return fail(409, `Check the message: ${problems[0]}`);
    const at = now(ctx);
    try {
      const threadId = newId("thr");
      await commit(ctx, { entity: "renewal_offers", id: String(row.id), propertyId: row.property_id, verb: "reminded", summary: `Reminder sent by ${ctx.actor.name}` }, [],
        [
          { table: "message_threads", row: { id: threadId, property_id: row.property_id, party_kind: "resident", party_id: lease.resident_id, subject, entity_type: "renewal_offers", entity_id: row.id, assigned_to: ctx.actor.personaId, status: "Waiting", last_message_at: at, unread: 0 } },
          { table: "messages", row: { id: newId("msg"), thread_id: threadId, channel: "Email", direction: "out", sender_kind: "staff", sender_id: ctx.actor.personaId, body, drafted_by_agent: "renewals", sent_at: at } },
        ], `offer-reminder-${row.id}-${at.slice(0, 10)}`);
    } catch (e) {
      if (e instanceof AlreadyDone) return fail(409, "A reminder already went out on this offer today");
      throw e;
    }
    await closeProposals(ctx, "renewal_offers", String(row.id), "Edited", `Reminder sent by ${ctx.actor.name}`);
    return ok("Reminder sent", `/app/leasing/renewal-offers/${row.id}`);
  },
});
