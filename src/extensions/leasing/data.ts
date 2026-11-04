import "server-only";
import type { Actor, Role, Row } from "@/entities/types";
import { staffDecision } from "@/ai/decide";
import { currentSession } from "@/auth/session";
import { sql } from "@/ai/data";
import { proposalOut, type ProposalOut } from "@/ai/views";
import { getPlatform } from "@/lib/platform";
import { effective, metrics } from "@/server/query";
import { AS_OF } from "@/seed/constants";
import { checkFairHousing } from "./fairHousing";
import { columnOf, type Column } from "./pipeline";
import { proposalSource, type AiSource } from "@/ai/rules";

// Reads for the leasing pages (home briefings, the board, renewals), scoped to the persona's
// properties and bounded: every list here has a LIMIT.

export type LeasingCtx = { db: ReturnType<typeof getPlatform>["db"]; ws: string | null; actor: Actor; persona: Awaited<ReturnType<typeof currentSession>>["persona"] };

export async function leasingCtx(): Promise<LeasingCtx> {
  const s = await currentSession();
  return { db: getPlatform().db, ws: s.ws, actor: s.actor, persona: s.persona };
}

const E = (c: LeasingCtx, t: string) => effective(t, c.ws);
function scope(c: LeasingCtx, col: string) {
  return c.actor.propertyIds === "all" ? { sql: "", binds: [] as unknown[] } : { sql: ` AND ${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(c.actor.propertyIds)] as unknown[] };
}
async function all<T = Row>(c: LeasingCtx, q: string, binds: unknown[]) {
  return (await c.db.prepare(q).bind(...binds).all<T>()).results;
}
// Server copies of the AI page labels (the originals live in a client module).
export const AGENT_NAME: Record<string, string> = { leasing: "Leasing Agent", renewals: "Renewals Agent" };
export { proposalSource as sourceOf } from "@/ai/rules";
// Tour times are the property's wall-clock time (the seed writes them as "10:00Z" for a 10 AM
// tour), so they are formatted in UTC, on the server, which also keeps server and browser renders equal.
export function localTime(iso: unknown, _metro?: unknown, withDate = false) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", ...(withDate ? { month: "short", day: "numeric" } : {}) }).format(new Date(String(iso)));
}
const aiData = (c: LeasingCtx) => ({ db: c.db, ws: c.ws ?? "base", actor: c.actor });

export async function kpis(c: LeasingCtx, keys: string[]) {
  const qc = { db: c.db, ws: c.ws, actor: c.actor };
  return Promise.all(keys.map(async (k) => {
    try {
      const m = await metrics(qc, k);
      return { key: k, value: m.value ?? null, previous: m.previous ?? null, spark: m.spark ?? [], points: m.points, asOf: m.asOf, source: m.source };
    } catch (e) {
      return { key: k, value: null, previous: null, spark: [], points: [], error: e instanceof Error ? e.message : "Couldn't load" };
    }
  }));
}

export async function todaysTours(c: LeasingCtx, agentId?: string) {
  const s = scope(c, "sh.property_id");
  return all(c, `SELECT sh.id, sh.scheduled_at, sh.status, sh.kind, sh.feedback, sh.prospect_id, pr.name AS prospect, pr.desired_beds, pr.budget_cents, pr.phone, u.number AS unit, p.name AS property, p.metro, st.name AS agent
    FROM ${E(c, "showings")} sh JOIN ${E(c, "prospects")} pr ON pr.id = sh.prospect_id LEFT JOIN ${E(c, "units")} u ON u.id = sh.unit_id JOIN ${E(c, "properties")} p ON p.id = sh.property_id LEFT JOIN ${E(c, "staff")} st ON st.id = sh.agent_id
    WHERE substr(sh.scheduled_at, 1, 10) = ?${agentId ? " AND (sh.agent_id = ? OR sh.agent_id IS NULL)" : ""}${s.sql} ORDER BY sh.scheduled_at LIMIT 30`, [AS_OF, ...(agentId ? [agentId] : []), ...s.binds]);
}

export async function followUps(c: LeasingCtx, limit = 8) {
  const s = scope(c, "pr.property_id");
  const where = `pr.stage IN ('Inquiry', 'Contacted', 'Toured') AND julianday(?) - julianday(coalesce(pr.last_contact_at, pr.created_at)) BETWEEN 3 AND 30${s.sql}`;
  const [rows, total, ids] = await Promise.all([
    all(c, `SELECT pr.id, pr.name, pr.stage, pr.source, pr.desired_beds, pr.budget_cents, p.name AS property, CAST(julianday(?) - julianday(coalesce(pr.last_contact_at, pr.created_at)) AS INTEGER) AS days FROM ${E(c, "prospects")} pr JOIN ${E(c, "properties")} p ON p.id = pr.property_id WHERE ${where} ORDER BY CASE pr.stage WHEN 'Toured' THEN 0 ELSE 1 END, days LIMIT ?`, [AS_OF, AS_OF, ...s.binds, limit]),
    all<{ n: number }>(c, `SELECT count(*) AS n FROM ${E(c, "prospects")} pr WHERE ${where}`, [AS_OF, ...s.binds]),
    // Every due lead, for "Send all" (capped; the next batch shows once these are contacted).
    all<{ id: string }>(c, `SELECT pr.id FROM ${E(c, "prospects")} pr WHERE ${where} ORDER BY pr.id LIMIT 200`, [AS_OF, ...s.binds]),
  ]);
  return { rows, total: Number(total[0]?.n ?? 0), ids: ids.map((r) => String(r.id)) };
}

// Proposals from the Leasing and Renewals Agents still waiting on a person, newest risk first.
// The Leasing Agent's decision on an application: live runs propose applications.decide, earlier
// runs (and the seed) approve or deny directly. The broker desk lists all three.
export const DECIDE_ACTIONS = ["applications.decide", "applications.approve", "applications.deny"];

export async function leasingProposals(c: LeasingCtx, opts: { actions?: string[]; limit?: number } = {}) {
  const acts = opts.actions ?? [];
  const rows = await sql<Row>(aiData(c),
    `SELECT p.* FROM {ai_proposals} p WHERE p.agent IN ('leasing', 'renewals') AND p.queue_state = 'needs_you'
     AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id)${acts.length ? " AND p.action IN (SELECT value FROM json_each(?))" : ""}
     ORDER BY CASE p.risk WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, p.created_at DESC LIMIT ?`, [...(acts.length ? [JSON.stringify(acts)] : []), opts.limit ?? 8]);
  return rows.map((r): ProposalOut & { canApprove: boolean } => Object.assign(proposalOut(r), { canApprove: mayDecide(c.actor.role, r) }));
}

// The approvals API's own rule (src/ai/decide.ts), so the page offers exactly what the API allows.
const mayDecide = (role: Role, p: Row) => staffDecision(role, p).ok;

// Applications waiting on the broker, with the latest Leasing Agent score if there is one.
export async function waitingApplications(c: LeasingCtx, limit = 10) {
  const s = scope(c, "a.property_id");
  const where = `a.stage = 'Review'${s.sql}`;
  const [rows, total] = await Promise.all([
    all(c, `SELECT a.id, a.rent_cents, a.income_to_rent, a.submitted_at, a.score, a.recommendation, ap.first_name || ' ' || ap.last_name AS applicant, p.name AS property, u.number AS unit,
        (SELECT s.decision FROM ${E(c, "screening_results")} s WHERE s.application_id = a.id LIMIT 1) AS screening,
        (SELECT json_object('id', x.id, 'score', json_extract(x.payload, '$.facts.score'), 'rec', json_extract(x.payload, '$.facts.recommendation'), 'run', x.run_id, 'model', x.model, 'confidence', x.confidence) FROM ${E(c, "ai_proposals")} x WHERE x.entity_type = 'applications' AND x.entity_id = a.id AND x.agent = 'leasing' ORDER BY x.created_at DESC LIMIT 1) AS ai,
        CAST(julianday(?) - julianday(a.submitted_at) AS INTEGER) AS waiting
      FROM ${E(c, "applications")} a JOIN ${E(c, "applicants")} ap ON ap.id = a.applicant_id JOIN ${E(c, "properties")} p ON p.id = a.property_id LEFT JOIN ${E(c, "units")} u ON u.id = a.unit_id
      WHERE ${where} ORDER BY a.submitted_at LIMIT ?`, [AS_OF, ...s.binds, limit]),
    all<{ n: number }>(c, `SELECT count(*) AS n FROM ${E(c, "applications")} a WHERE ${where}`, s.binds),
  ]);
  return {
    total: Number(total[0]?.n ?? 0),
    rows: rows.map((r): Row & { score: unknown; recommendation: unknown; runId: string | null; proposalId: string | null; model: string | null; confidence: number | null } => {
      const ai = r.ai ? (JSON.parse(String(r.ai)) as { id: string; score: number | null; rec: string | null; run: string | null; model: string | null; confidence: number | null }) : null;
      return Object.assign(r, { score: r.score ?? ai?.score ?? null, recommendation: r.recommendation ?? ai?.rec ?? null, runId: ai?.run ?? null, proposalId: ai?.id ?? null, model: ai?.model ?? null, confidence: ai?.confidence ?? null });
    }),
  };
}

// Fair-housing flags across live and draft listings (the broker's compliance card).
export async function fairHousingFlags(c: LeasingCtx) {
  const s = scope(c, "l.property_id");
  const rows = await all(c, `SELECT l.id, l.headline, l.description, l.status, p.name AS property, u.number AS unit FROM ${E(c, "listings")} l JOIN ${E(c, "properties")} p ON p.id = l.property_id LEFT JOIN ${E(c, "units")} u ON u.id = l.unit_id WHERE l.status IN ('Active', 'Draft', 'Paused')${s.sql} LIMIT 1000`, s.binds);
  return rows.flatMap((r) => {
    const flags = checkFairHousing(`${r.headline} ${r.description}`);
    return flags.length ? [{ id: String(r.id), headline: String(r.headline), status: String(r.status), property: String(r.property), unit: String(r.unit ?? ""), flags }] : [];
  });
}

// What happened since yesterday, from the records (the briefing's facts).
export async function overnight(c: LeasingCtx) {
  const since = new Date(Date.parse(AS_OF) - 86_400_000).toISOString().slice(0, 10);
  const sp = scope(c, "property_id");
  const [leads, apps, tours, runs] = await Promise.all([
    all<{ n: number }>(c, `SELECT count(*) AS n FROM ${E(c, "prospects")} WHERE substr(created_at, 1, 10) >= ?${sp.sql}`, [since, ...sp.binds]),
    all<{ n: number }>(c, `SELECT count(*) AS n FROM ${E(c, "applications")} WHERE substr(submitted_at, 1, 10) >= ?${sp.sql}`, [since, ...sp.binds]),
    all<{ n: number }>(c, `SELECT count(*) AS n FROM ${E(c, "showings")} WHERE status = 'Completed' AND substr(scheduled_at, 1, 10) >= ?${sp.sql}`, [since, ...sp.binds]),
    // Runs carry no property; show only runs that proposed something on the persona's properties.
    all<Row>(c, `SELECT r.id, r.agent_key, r.summary, r.started_at, r.status FROM ${E(c, "agent_runs")} r WHERE r.agent_key IN ('leasing', 'renewals')
      AND EXISTS (SELECT 1 FROM ${E(c, "ai_proposals")} p WHERE p.run_id = r.id${scope(c, "p.property_id").sql}) ORDER BY r.started_at DESC LIMIT 3`, scope(c, "p.property_id").binds),
  ]);
  return { leads: Number(leads[0]?.n ?? 0), applications: Number(apps[0]?.n ?? 0), tours: Number(tours[0]?.n ?? 0), runs };
}

// ---------------------------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------------------------

export type Card = { id: string; name: string; property: string; propertyId: string; stage: string; appStage: string | null; appId: string | null; score: number | null; beds: number | null; budget: number | null; source: string; days: number; nextTour: string | null; stale: boolean; column: Column };

export async function pipeline(c: LeasingCtx, property?: string) {
  const s = scope(c, "pr.property_id");
  const pf = property ? " AND pr.property_id = ?" : "";
  // Prospects first, then their applications, scores and next tours in three batched lookups by id
  // (json_each), rather than correlated subqueries per card: keeps the board inside D1's CPU limit.
  const rows = await all(c, `SELECT pr.id, pr.name, pr.stage, pr.property_id, p.name AS property, p.metro, pr.desired_beds, pr.budget_cents, pr.source,
      CAST(julianday(?) - julianday(coalesce(pr.last_contact_at, pr.created_at)) AS INTEGER) AS days
    FROM ${E(c, "prospects")} pr JOIN ${E(c, "properties")} p ON p.id = pr.property_id
    WHERE (pr.stage IN ('Inquiry', 'Contacted', 'Tour scheduled', 'Toured', 'Applied') OR (pr.stage = 'Leased' AND substr(coalesce(pr.last_contact_at, pr.created_at), 1, 10) >= ?))${s.sql}${pf}
    ORDER BY pr.created_at DESC LIMIT 600`, [AS_OF, new Date(Date.parse(AS_OF) - 30 * 86_400_000).toISOString().slice(0, 10), ...s.binds, ...(property ? [property] : [])]);
  const ids = JSON.stringify(rows.map((r) => String(r.id)));
  const [apps, tours] = await Promise.all([
    all(c, `SELECT ap.prospect_id, a.id, a.stage, a.score, a.submitted_at FROM ${E(c, "applicants")} ap JOIN ${E(c, "applications")} a ON a.applicant_id = ap.id WHERE ap.prospect_id IN (SELECT value FROM json_each(?)) ORDER BY a.submitted_at`, [ids]),
    all(c, `SELECT prospect_id, min(scheduled_at) AS next_tour FROM ${E(c, "showings")} WHERE prospect_id IN (SELECT value FROM json_each(?)) AND status = 'Scheduled' AND substr(scheduled_at, 1, 10) >= ? GROUP BY prospect_id`, [ids, AS_OF]),
  ]);
  const appOf = new Map(apps.map((a) => [String(a.prospect_id), a])); // latest submission wins (ordered ascending)
  const unscored = apps.filter((a) => a.score == null).map((a) => String(a.id));
  const scores = unscored.length ? await all(c, `SELECT entity_id, json_extract(payload, '$.facts.score') AS score, title FROM ${E(c, "ai_proposals")} WHERE entity_type = 'applications' AND entity_id IN (SELECT value FROM json_each(?)) ORDER BY created_at`, [JSON.stringify(unscored)]) : [];
  const scoreOf = new Map(scores.map((x) => [String(x.entity_id), x.score ?? /score (\d+)/.exec(String(x.title))?.[1] ?? null]));
  const tourOf = new Map(tours.map((t) => [String(t.prospect_id), t.next_tour as string]));
  for (const r of rows) {
    const a = appOf.get(String(r.id));
    r.app = a ? `${a.stage}|${a.id}|${a.score ?? scoreOf.get(String(a.id)) ?? ""}` : null;
    r.next_tour = tourOf.get(String(r.id)) ?? null;
  }
  const cards: Card[] = [];
  for (const r of rows) {
    const [appStage, appId, score] = r.app ? String(r.app).split("|") : [null, null, null];
    const column = columnOf(String(r.stage), appStage);
    if (!column) continue;
    const days = Number(r.days ?? 0);
    cards.push({
      id: String(r.id), name: String(r.name), property: String(r.property), propertyId: String(r.property_id), stage: String(r.stage), appStage: appStage || null, appId: appId || null,
      score: score ? Number(score) : null, beds: r.desired_beds == null ? null : Number(r.desired_beds), budget: r.budget_cents == null ? null : Number(r.budget_cents) / 100,
      source: String(r.source ?? ""), days, nextTour: localTime(r.next_tour, r.metro, true), stale: ["lead", "tour"].includes(column) && days >= 3 && !r.next_tour, column,
    });
  }
  return cards;
}

export async function scopedProperties(c: LeasingCtx) {
  const s = scope(c, "p.id");
  return all<{ id: string; name: string }>(c, `SELECT p.id, p.name FROM ${E(c, "properties")} p WHERE p.type NOT IN ('Retail strip', 'Office', 'Industrial flex')${s.sql} ORDER BY p.name LIMIT 60`, s.binds);
}

// ---------------------------------------------------------------------------------------------
// Renewals workbench
// ---------------------------------------------------------------------------------------------

export type RenewalRow = { leaseId: string; resident: string; residentId: string | null; property: string; propertyId: string; unit: string; unitType: string; endOn: string; daysLeft: number; rent: number; market: number | null; status: string; offer: { id: string; status: string; rent: number; version: number; sentAt: string | null } | null; agent: { id: string; title: string; runId: string | null; why: string[]; confidence: number; model: string | null; source: AiSource; rentCents: number | null } | null };

export async function renewals(c: LeasingCtx, opts: { window: number; status?: string; page: number; size: number }) {
  const s = scope(c, "l.property_id");
  const end = new Date(Date.parse(AS_OF) + opts.window * 86_400_000).toISOString().slice(0, 10);
  const offerSql = `(SELECT o.id || '|' || o.status || '|' || o.rent_cents || '|' || o.version || '|' || coalesce(o.sent_at, '') FROM ${E(c, "renewal_offers")} o WHERE o.lease_id = l.id ORDER BY o.version DESC, coalesce(o.sent_at, '9999') DESC LIMIT 1)`;
  const statusExpr = `coalesce((SELECT o.status FROM ${E(c, "renewal_offers")} o WHERE o.lease_id = l.id ORDER BY o.version DESC, coalesce(o.sent_at, '9999') DESC LIMIT 1), 'No offer')`;
  const where = `l.status IN ('Active', 'Month-to-month') AND l.kind = 'Residential' AND (l.end_on IS NULL OR l.end_on <= ?) AND (l.end_on IS NULL OR l.end_on >= ?)${s.sql}${opts.status ? ` AND ${statusExpr} = ?` : ""}`;
  const binds = [end, AS_OF, ...s.binds, ...(opts.status ? [opts.status] : [])];
  const [rows, counts] = await Promise.all([
    all(c, `SELECT l.id, l.end_on, l.rent_cents, l.status AS lease_status, l.property_id, p.name AS property, u.number AS unit, ut.name AS unit_type, ut.market_rent_cents,
        r.id AS resident_id, coalesce(r.first_name || ' ' || r.last_name, h.name) AS resident, ${offerSql} AS offer,
        (SELECT json_object('id', x.id, 'title', x.title, 'run', x.run_id, 'why', json(x.why), 'confidence', x.confidence, 'model', x.model, 'payload', json(x.payload)) FROM ${E(c, "ai_proposals")} x WHERE x.agent = 'renewals' AND ((x.entity_type = 'leases' AND x.entity_id = l.id) OR (x.entity_type = 'renewal_offers' AND x.entity_id IN (SELECT o.id FROM ${E(c, "renewal_offers")} o WHERE o.lease_id = l.id))) AND NOT EXISTS (SELECT 1 FROM ${E(c, "ai_decisions")} d WHERE d.proposal_id = x.id) ORDER BY x.created_at DESC LIMIT 1) AS agent
      FROM ${E(c, "leases")} l JOIN ${E(c, "properties")} p ON p.id = l.property_id JOIN ${E(c, "units")} u ON u.id = l.unit_id LEFT JOIN ${E(c, "unit_types")} ut ON ut.id = u.unit_type_id
      LEFT JOIN ${E(c, "households")} h ON h.id = l.household_id LEFT JOIN ${E(c, "residents")} r ON r.household_id = l.household_id AND r.is_primary = 1
      WHERE ${where} ORDER BY coalesce(l.end_on, '0000') LIMIT ? OFFSET ?`, [...binds, opts.size, (opts.page - 1) * opts.size]),
    all<{ st: string; n: number }>(c, `SELECT ${statusExpr} AS st, count(*) AS n FROM ${E(c, "leases")} l WHERE l.status IN ('Active', 'Month-to-month') AND l.kind = 'Residential' AND (l.end_on IS NULL OR l.end_on <= ?) AND (l.end_on IS NULL OR l.end_on >= ?)${s.sql} GROUP BY st`, [end, AS_OF, ...s.binds]),
  ]);
  const out: RenewalRow[] = rows.map((r) => {
    const o = r.offer ? String(r.offer).split("|") : null;
    const a = r.agent ? (JSON.parse(String(r.agent)) as { id: string; title: string; run: string | null; why: string[] | null; confidence: number; model: string | null; payload: Record<string, unknown> | null }) : null;
    return {
      leaseId: String(r.id), resident: String(r.resident ?? "Resident"), residentId: (r.resident_id as string) ?? null, property: String(r.property), propertyId: String(r.property_id), unit: String(r.unit), unitType: String(r.unit_type ?? ""),
      endOn: String(r.end_on ?? ""), daysLeft: r.end_on ? Math.round((Date.parse(String(r.end_on)) - Date.parse(AS_OF)) / 86_400_000) : 0, rent: Number(r.rent_cents) / 100,
      market: r.market_rent_cents == null ? null : Number(r.market_rent_cents) / 100, status: o ? o[1] : r.lease_status === "Month-to-month" ? "Month-to-month" : "No offer",
      offer: o ? { id: o[0], status: o[1], rent: Number(o[2]) / 100, version: Number(o[3]), sentAt: o[4] || null } : null,
      agent: a ? { id: a.id, title: a.title, runId: a.run, why: a.why ?? [], confidence: Number(a.confidence), model: a.model, source: proposalSource(a), rentCents: suggestedCents(a.payload) ?? (/\$([\d,]+)/.exec(a.title) ? Number(/\$([\d,]+)/.exec(a.title)![1].replace(/,/g, "")) * 100 : null) } : null,
    };
  });
  const byStatus = Object.fromEntries(counts.map((x) => [x.st, Number(x.n)]));
  return { rows: out, counts: byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
}

export async function renewalHistory(c: LeasingCtx, leaseId: string) {
  return all(c, `SELECT id, version, status, rent_cents, term_months, sent_at, responded_at FROM ${E(c, "renewal_offers")} WHERE lease_id = ? ORDER BY version DESC, coalesce(sent_at, '9999') DESC LIMIT 20`, [leaseId]);
}

// The rent an agent proposal suggests, whichever agent wrote it (seeded, scheduled or on demand).
export function suggestedCents(payload: Record<string, unknown> | null | undefined): number | null {
  const p = payload ?? {};
  const facts = (p.facts ?? {}) as Record<string, unknown>;
  const v = facts.offer_rent_cents ?? p.rent_cents;
  return v == null ? null : Number(v);
}

export type PreparedDraft = { offerId: string; leaseId: string; resident: string; property: string; unit: string; endOn: string; rent: number; offerRent: number; proposal: { id: string; title: string; risk: string; why: string[]; subject: string; body: string; runId: string | null; canApprove: boolean } | null };

// Draft offers for leases ending in the window, with the prepared proposal (rent and message) still
// waiting on each, for "Prepare all drafts" and "Send selected". Capped: the page works in batches.
export async function renewalDrafts(c: LeasingCtx, window: number): Promise<PreparedDraft[]> {
  const s = scope(c, "l.property_id");
  const end = new Date(Date.parse(AS_OF) + window * 86_400_000).toISOString().slice(0, 10);
  const rows = await all(c, `SELECT o.id, o.lease_id, o.rent_cents, l.end_on, l.rent_cents AS current_cents, p.name AS property, u.number AS unit, coalesce(r.first_name || ' ' || r.last_name, 'Resident') AS resident,
      (SELECT json_object('id', x.id, 'title', x.title, 'risk', x.risk, 'amount', x.amount_cents, 'queue', x.queue_state, 'why', json(x.why), 'payload', json(x.payload), 'run', x.run_id) FROM ${E(c, "ai_proposals")} x WHERE x.agent = 'renewals' AND x.entity_type = 'renewal_offers' AND x.entity_id = o.id AND x.action = 'renewal_offers.send' AND NOT EXISTS (SELECT 1 FROM ${E(c, "ai_decisions")} d WHERE d.proposal_id = x.id) ORDER BY x.created_at DESC LIMIT 1) AS proposal
    FROM ${E(c, "renewal_offers")} o JOIN ${E(c, "leases")} l ON l.id = o.lease_id JOIN ${E(c, "properties")} p ON p.id = l.property_id JOIN ${E(c, "units")} u ON u.id = l.unit_id
    LEFT JOIN ${E(c, "residents")} r ON r.household_id = l.household_id AND r.is_primary = 1
    WHERE o.status = 'Draft' AND l.status IN ('Active', 'Month-to-month') AND (l.end_on IS NULL OR l.end_on BETWEEN ? AND ?)${s.sql} ORDER BY coalesce(l.end_on, '0000') LIMIT 200`, [AS_OF, end, ...s.binds]);
  return rows.map((r) => {
    const x = r.proposal ? JSON.parse(String(r.proposal)) as { id: string; title: string; risk: string; amount: number | null; queue: string; why: string[] | null; payload: Record<string, unknown> | null; run: string | null } : null;
    const body = x?.payload?.body;
    return {
      offerId: String(r.id), leaseId: String(r.lease_id), resident: String(r.resident), property: String(r.property), unit: String(r.unit), endOn: String(r.end_on ?? ""), rent: Number(r.current_cents) / 100, offerRent: Number(r.rent_cents) / 100,
      proposal: x && typeof body === "string" ? { id: x.id, title: x.title, risk: x.risk, why: x.why ?? [], subject: String(x.payload?.subject ?? ""), body, runId: x.run, canApprove: mayDecide(c.actor.role, { risk: x.risk, amount_cents: x.amount, queue_state: x.queue, entity_type: "renewal_offers"}) } : null,
    };
  });
}

// Open leads created in the last 30 days with no contact in 3+ days, by assigned agent: the same
// set as "Going stale" in leasing.agent_performance, so the counts and the bulk actions agree.
export async function staleLeadsByAgent(c: LeasingCtx): Promise<Record<string, { id: string; property: string }[]>> {
  const s = scope(c, "pr.property_id");
  const rows = await all<{ id: string; agent: string | null; property_id: string }>(c, `SELECT pr.id, pr.assigned_to AS agent, pr.property_id FROM ${E(c, "prospects")} pr WHERE pr.stage IN ('Inquiry', 'Contacted', 'Toured') AND julianday(?) - julianday(coalesce(pr.last_contact_at, pr.created_at)) >= 3 AND substr(pr.created_at, 1, 10) >= date(?, '-30 days')${s.sql} ORDER BY pr.id LIMIT 1000`, [AS_OF, AS_OF, ...s.binds]);
  const out: Record<string, { id: string; property: string }[]> = {};
  for (const r of rows) (out[String(r.agent)] ??= []).push({ id: String(r.id), property: String(r.property_id) });
  return out;
}

// Leasing agents and the properties their assignments cover (property, region or org), so the
// broker only picks someone who can take the leads; the action checks coverage again per lead.
export async function leasingAgents(c: LeasingCtx) {
  const rows = await all<{ id: string; name: string; props: string }>(c, `SELECT s.id, s.name, (SELECT json_group_array(p.id) FROM ${E(c, "properties")} p WHERE EXISTS (SELECT 1 FROM ${E(c, "role_assignments")} ra WHERE ra.staff_id = s.id AND ra.role = 'leasing_agent' AND (ra.scope_kind = 'org' OR (ra.scope_kind = 'property' AND ra.scope_id = p.id) OR (ra.scope_kind = 'region' AND ra.scope_id = p.region_id)))) AS props
    FROM ${E(c, "staff")} s WHERE s.active = 1 AND EXISTS (SELECT 1 FROM ${E(c, "role_assignments")} ra WHERE ra.staff_id = s.id AND ra.role = 'leasing_agent') ORDER BY s.name LIMIT 100`, []);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), properties: JSON.parse(String(r.props || "[]")) as string[] }));
}
