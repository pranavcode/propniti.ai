import { demoNowIso } from "@/lib/clock";
import type { Row } from "@/entities/types";
import { daysBetween, sql, upsertOverlay } from "../data";
import type { AgentCtx } from "../runtime";
import { defineAgent, money, planOf, type Candidate } from "./framework";
import { scoreApplicant } from "../rules";
export { scoreApplicant, type Factor } from "../rules";

// Applicant scoring with plain-English reasons for and against (a broker or manager decides), and
// follow-ups for prospects nobody has contacted in three days. "Improve with AI" occupancy plans
// also hand it paused or draft listings on vacant units to put back on the market.

export const FOLLOW_UP_STAGES = ["Inquiry", "Contacted", "Toured"];
export const STALE_CONTACT_DAYS = 3;

export default defineAgent({
  key: "leasing",
  name: "Leasing Agent",
  ownerRole: "leasing_agent",
  goal: "Score every application waiting on a decision with plain-English reasons for and against, recommend approve, conditional or deny for the broker, and follow up with prospects nobody has contacted in three days.",
  tools: ["records.search", "records.get", "records.related", "messages.draft", "actions.propose"],
  triggers: { schedule: "0 */4 * * *", events: ["application.submitted", "screening.completed"] },
  autonomy: "act_with_approval",
  entities: ["applications", "applicants", "screening_results", "prospects"],
  actions: ["applications.decide", "prospects.send_follow_up", "listings.publish"],
  maxProposals: 10,
  async collect(ctx, trigger) {
    // An application.submitted event names the new application: score it first, whatever its stage.
    const fresh = (trigger.input as { application_id?: string } | undefined)?.application_id;
    const plan = planOf(trigger);
    if (plan) return planCandidates(ctx, plan.ids);
    const apps = await ctx.call<{ rows: Row[] }>("records.search", { entity: "applications", filters: [{ field: "stage", op: "in", value: ["Submitted", "Screening", "Review"] }], sort: ["submitted_at", "asc"], size: 25 });
    const ids = [...new Set([...(fresh ? [fresh] : []), ...apps.rows.map((a) => String(a.id))])];
    const details = ids.length
      ? await sql<Row>(ctx.data,
          `SELECT a.id, a.property_id, a.unit_id, a.rent_cents, a.stage, a.submitted_at, ap.id AS applicant_id, ap.first_name, ap.last_name, ap.monthly_income_cents, ap.employer,
                  s.credit_band, s.eviction_found, s.criminal_flag, s.income_verified, s.decision AS screening, u.number AS unit, u.market_rent_cents, p.name AS property
           FROM {applications} a JOIN {applicants} ap ON ap.id = a.applicant_id LEFT JOIN {screening_results} s ON s.application_id = a.id
           LEFT JOIN {units} u ON u.id = a.unit_id LEFT JOIN {properties} p ON p.id = a.property_id WHERE a.id IN (SELECT value FROM json_each(?))`,
          [JSON.stringify(ids)])
      : [];
    if (details.length) await ctx.step({ kind: "tool_result", toolKey: "records.related", output: { applications_with_screening: details.length }, ok: true });
    const out: Candidate[] = details.map((d) => {
      const rent = Number(d.rent_cents ?? d.market_rent_cents ?? 0);
      const s = scoreApplicant({ monthly_income_cents: d.monthly_income_cents as number | null, rent_cents: rent, credit_band: d.credit_band as string | null, eviction_found: Number(d.eviction_found ?? 0), criminal_flag: Number(d.criminal_flag ?? 0), income_verified: Number(d.income_verified ?? 0) });
      const name = `${d.first_name} ${d.last_name}`;
      const pros = s.factors.filter((f) => f.direction === "+").map((f) => `For: ${f.detail}`);
      const cons = s.factors.filter((f) => f.direction === "-").map((f) => `Against: ${f.detail}`);
      const stage = s.recommendation === "Approve" ? "Approved" : s.recommendation === "Deny" ? "Denied" : "Conditional";
      return {
        entity: "applications", entityId: String(d.id), propertyId: String(d.property_id), action: "applications.decide",
        title: `${s.recommendation} ${name} for ${d.property} #${d.unit} — score ${s.score}`,
        why: [...pros, ...cons, ...(s.review ? ["Screening flagged a record: a person must do an individualized review (not scored)"] : [])].slice(0, 6),
        confidence: s.review ? 0.5 : 0.7 + Math.abs(s.score - 65) / 150, risk: s.recommendation === "Deny" || s.review ? "High" : "Medium", alwaysHuman: true, assignee: "broker",
        facts: { applicant: name, rent_cents: rent, monthly_income_cents: (d.monthly_income_cents as number) ?? null, income_to_rent: Number(s.ratio.toFixed(2)), credit_band: (d.credit_band as string) ?? null, score: s.score, recommendation: s.recommendation },
        evidence: [{ entity_type: "applicants", entity_id: String(d.applicant_id), label: name }, { entity_type: "applications", entity_id: String(d.id), label: `Application ${d.id}` }],
        effects: [{ kind: "update", table: "applications", id: String(d.id), changes: { stage, recommendation: s.recommendation, score: s.score, scoring_factors: JSON.stringify(s.factors), decided_at: demoNowIso() } }],
        publicText: true,
        priority: (d.id === fresh ? 10_000 : 500) + daysBetween(String(d.submitted_at ?? ctx.today).slice(0, 10), ctx.today),
      };
    });
    // The new application gets its score and reasons on the record right away (advisory fields only;
    // the decision stays a proposal for the broker), so the record shows the AI screening summary.
    const scored = out.find((c) => c.entityId === fresh);
    if (scored && ctx.ws !== "base") {
      const changes = (scored.effects[0] as { changes: Record<string, unknown> }).changes;
      await upsertOverlay(ctx.data, "applications", scored.entityId, { score: changes.score, scoring_factors: changes.scoring_factors, recommendation: changes.recommendation });
      await ctx.step({ kind: "message", output: { scored: scored.entityId, score: changes.score, recommendation: changes.recommendation }, ok: true });
    }

    const cutoff = new Date(Date.parse(ctx.today) - STALE_CONTACT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const stale = await ctx.call<{ rows: Row[] }>("records.search", { entity: "prospects", filters: [{ field: "stage", op: "in", value: FOLLOW_UP_STAGES }, { field: "last_contact_at", op: "lt", value: cutoff }], sort: ["last_contact_at", "asc"], size: 10 });
    return [...out, ...stale.rows.map((p) => followUp(ctx.today, p))];
  },
});

function followUp(today: string, p: Row): Candidate {
  const days = daysBetween(String(p.last_contact_at ?? today).slice(0, 10), today);
  return {
    entity: "prospects", entityId: String(p.id), propertyId: String(p.property_id), action: "prospects.send_follow_up",
    title: `Follow up with ${p.name} — no contact in ${days} days`, why: [`Stage ${p.stage}, last contact ${String(p.last_contact_at).slice(0, 10)}`, p.budget_cents ? `Budget ${money(Number(p.budget_cents))}` : "Came in through " + (p.source || "the website")],
    confidence: 0.85, risk: "Low", facts: { prospect: String(p.name), days_since_contact: days, budget_cents: (p.budget_cents as number) ?? null, desired_beds: (p.desired_beds as number) ?? null },
    message: { party_kind: "prospect", party_id: String(p.id), subject: "Still looking for a new home?", body: `Hi ${String(p.name).split(" ")[0]}, thanks again for your interest. We have homes available that fit what you told us. Would you like to book a tour this week? Just reply with a time that works.` },
    effects: [], publicText: true, priority: 100 + days,
  };
}

// A plan's records: prospects still open for follow-up, and listings that are off the market.
async function planCandidates(ctx: AgentCtx, ids: string[]): Promise<Candidate[]> {
  const only = [{ field: "id", op: "in", value: ids.slice(0, 50) }];
  const prospects = await ctx.call<{ rows: Row[] }>("records.search", { entity: "prospects", filters: [...only, { field: "stage", op: "in", value: FOLLOW_UP_STAGES }], size: 50 });
  const listings = await ctx.call<{ rows: Row[] }>("records.search", { entity: "listings", filters: [...only, { field: "status", op: "in", value: ["Draft", "Paused"] }], size: 50 });
  return [
    ...prospects.rows.map((p) => followUp(ctx.today, p)),
    ...listings.rows.filter((l) => String(l.description ?? "").trim()).map((l): Candidate => ({
      entity: "listings", entityId: String(l.id), propertyId: String(l.property_id), action: "listings.publish",
      title: `Relist ${l.headline} at ${money(Number(l.rent_cents))}`,
      why: [`Listing is ${String(l.status).toLowerCase()} while the unit is vacant`, Number(l.leads) ? `${l.leads} leads and ${l.views} views while it was live` : "No leads recorded yet"],
      confidence: 0.8, risk: "Low", facts: { listing: String(l.id), headline: String(l.headline), rent_cents: Number(l.rent_cents), status: String(l.status) },
      evidence: [{ entity_type: "listings", entity_id: String(l.id), label: String(l.headline) }],
      effects: [], priority: 300,
    })),
  ];
}
