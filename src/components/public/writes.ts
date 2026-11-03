import "server-only";
import { after } from "next/server";
import type { z } from "zod";
import { newId } from "@/ai/data";
import { drainEvents, emitEvent, SYSTEM_ACTOR } from "@/ai/orchestrator";
import { rateLimit } from "@/lib/guard";
import { getPlatform } from "@/lib/platform";
import type { Db } from "@/lib/platform/types";
import { parseBody } from "@/lib/requests";
import { assertTable } from "@/server/effective";
import { cookieHeader, nowIso, resolveWorkspace } from "@/server/workspace";
import { sameOrigin } from "@/ai/session";
import { getListing, leasingAgent, tourSlots } from "./data";
import type { ApplyRequest, TourRequest } from "./schemas";

// Public writes: a visitor's tour request or application lands in their own demo workspace (the
// overlay), where the staff app shows it to the leasing agent and the broker.

type Ctx<T> = { db: Db; ws: string; body: T; nowMs: number };

// One overlay row. Column names come from this file only; values are bound.
async function insert(db: Db, ws: string, table: string, row: Record<string, unknown>) {
  assertTable(table);
  const cols = ["workspace_id", ...Object.keys(row)];
  const vals = [ws, ...Object.values(row).map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v ?? null))];
  return db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals);
}

function reply(body: unknown, status = 200, setCookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie) headers.set("Set-Cookie", cookieHeader(setCookie));
  return Response.json(body, { status, headers });
}

export async function publicWrite<S extends z.ZodType>(request: Request, schema: S, apply: (ctx: Ctx<z.infer<S>>) => Promise<{ status: number; body: unknown }>) {
  if (!sameOrigin(request)) return reply({ error: "Cross-site request refused" }, 403);
  const limited = await rateLimit(request, "write");
  if (limited) return limited;
  const body = await parseBody(request, schema, 16 * 1024);
  if (body instanceof Response) return body;
  const { db, writeLimiter } = getPlatform();
  const nowMs = Date.now();
  const r = await resolveWorkspace(db, request, nowMs, true, !!writeLimiter);
  if (r instanceof Response) return r;
  try {
    const out = await apply({ db, ws: r.ws!, body, nowMs });
    return reply(out.body, out.status, r.setCookie);
  } catch (err) {
    console.error("[listings] write failed:", err);
    return reply({ error: "Something went wrong saving that. Please try again." }, 500, r.setCookie);
  }
}

export async function scheduleTour({ db, ws, body, nowMs }: Ctx<TourRequest>, listingId: string) {
  const l = await getListing(ws, listingId);
  if (!l) return { status: 404, body: { error: "This listing is no longer available." } };
  const slot = tourSlots().find((s) => s.date === body.date);
  if (!slot || !slot.times.includes(body.time)) return { status: 400, body: { error: "That time isn't available. Pick another slot." } };
  const at = nowIso(nowMs);
  const agent = await leasingAgent(db, ws, l.property_id);
  const prospectId = newId("pr");
  const showingId = newId("sh");
  const when = `${body.date}T${body.time}:00`;
  await db.batch([
    await insert(db, ws, "prospects", { id: prospectId, property_id: l.property_id, name: body.name, email: body.email, phone: body.phone, source: "Website", stage: "Tour scheduled", desired_beds: l.beds, budget_cents: l.rent_cents, assigned_to: agent?.id ?? null, last_contact_at: at, created_at: at }),
    await insert(db, ws, "showings", { id: showingId, property_id: l.property_id, unit_id: l.unit_id, prospect_id: prospectId, agent_id: agent?.id ?? null, kind: body.kind, scheduled_at: when, status: "Scheduled", feedback: body.note ?? "" }),
    await insert(db, ws, "activity_events", { id: newId("act"), entity_type: "showings", entity_id: showingId, property_id: l.property_id, at, actor_kind: "system", actor_id: "website", verb: "created", summary: `${body.name} booked a ${body.kind.toLowerCase()} tour of unit ${l.unit} on the public site`, data: { listing_id: l.id } }),
    ...(agent ? [await insert(db, ws, "notifications", { id: newId("ntf"), user_id: agent.id, title: `New tour: ${body.name}`, body: `${body.kind} tour of ${l.property} #${l.unit}, ${body.date} at ${body.time}`, href: `/app/leasing/showings/${showingId}`, entity_type: "showings", entity_id: showingId, at })] : []),
  ]);
  return { status: 200, body: { showingId, when, kind: body.kind, agent: agent?.name ?? null } };
}

const CREDIT: Record<string, string> = { Excellent: "Pass", Good: "Pass", Fair: "Conditional", "Thin file": "Conditional", Poor: "Conditional" };

export async function submitApplication({ db, ws, body, nowMs }: Ctx<ApplyRequest>, listingId: string) {
  const l = await getListing(ws, listingId);
  if (!l) return { status: 404, body: { error: "This listing is no longer available." } };
  const { personal: p, residence: r, income: i, documents, consent } = body;
  const at = nowIso(nowMs);
  const income = (i.monthly_income + (i.other_income ?? 0)) * 100;
  const ratio = Math.round((income / l.rent_cents) * 100) / 100;
  const agent = await leasingAgent(db, ws, l.property_id);
  const fullName = `${p.first_name} ${p.last_name}`;
  const ids = { prospect: newId("pr"), applicant: newId("apl"), application: newId("app") };
  const history = [
    `Current address: ${r.street}, ${r.city}, ${r.state.toUpperCase()} ${r.zip}, since ${r.since}, rent $${r.rent.toLocaleString("en-US")}/month.`,
    r.landlord ? `Landlord: ${r.landlord}${r.landlord_phone ? `, ${r.landlord_phone}` : ""}.` : "No landlord reference given.",
    r.reason ? `Reason for moving: ${r.reason}` : "",
    `Prior eviction (self-reported): ${r.evicted}.`,
    `Income: ${i.employment}${i.employer ? ` at ${i.employer}` : ""}${i.title ? ` (${i.title})` : ""}, $${i.monthly_income.toLocaleString("en-US")}/month${i.other_income ? ` plus $${i.other_income.toLocaleString("en-US")} from ${i.other_source || "other sources"}` : ""}.`,
    `Adults applying: ${p.adults}. Lease: ${p.lease_months} months from ${p.move_in}. Signed "${consent.signature}" at ${at}.`,
  ].filter(Boolean).join("\n");
  await db.batch([
    await insert(db, ws, "prospects", { id: ids.prospect, property_id: l.property_id, name: fullName, email: p.email, phone: p.phone, source: "Website", stage: "Applied", desired_beds: l.beds, desired_move_in: p.move_in, budget_cents: l.rent_cents, assigned_to: agent?.id ?? null, last_contact_at: at, created_at: at }),
    await insert(db, ws, "applicants", { id: ids.applicant, prospect_id: ids.prospect, first_name: p.first_name, last_name: p.last_name, email: p.email, phone: p.phone, monthly_income_cents: income, employer: i.employer ?? "", created_at: at }),
    await insert(db, ws, "applications", { id: ids.application, property_id: l.property_id, unit_id: l.unit_id, listing_id: l.id, applicant_id: ids.applicant, stage: "Submitted", desired_move_in: p.move_in, rent_cents: l.rent_cents, income_to_rent: ratio, fee_paid: 0, submitted_at: at }),
    // Self-reported until the screening provider returns; income is verified by a person from the documents.
    await insert(db, ws, "screening_results", { id: newId("scr"), application_id: ids.application, applicant_id: ids.applicant, property_id: l.property_id, provider: "Self-reported (screening pending)", credit_band: i.credit, eviction_found: r.evicted === "yes" ? 1 : 0, criminal_flag: 0, income_verified: 0, decision: CREDIT[i.credit] ?? "Conditional", completed_at: null }),
    ...(await Promise.all(documents.files.map((f) => insert(db, ws, "documents", { id: newId("doc"), property_id: l.property_id, entity_type: "applications", entity_id: ids.application, name: f.name, url: "", mime: f.type || "application/octet-stream", doc_type: f.kind, filed_to: `Application ${ids.application} › Documents`, uploaded_by: ids.applicant, uploaded_at: at })))),
    await insert(db, ws, "notes", { id: newId("note"), entity_type: "applications", entity_id: ids.application, author_id: "website", body: history, created_at: at }),
    await insert(db, ws, "activity_events", { id: newId("act"), entity_type: "applications", entity_id: ids.application, property_id: l.property_id, at, actor_kind: "system", actor_id: "website", verb: "created", summary: `${fullName} applied for ${l.property} #${l.unit} on the public site`, data: { listing_id: l.id } }),
    ...(await Promise.all(["rachel", ...(agent ? [agent.id] : [])].map((user) => insert(db, ws, "notifications", { id: newId("ntf"), user_id: user, title: `New application: ${fullName}`, body: `${l.property} #${l.unit} · income ${ratio}× rent · the Leasing agent is scoring it`, href: `/app/leasing/applications/${ids.application}`, entity_type: "applications", entity_id: ids.application, at })))),
  ]);
  // The Leasing agent listens for application.submitted: it scores the application with reasons
  // for and against and puts a recommendation in the broker's approvals queue.
  const data = { db, ws, actor: SYSTEM_ACTOR };
  await emitEvent(data, { type: "application.submitted", entityType: "applications", entityId: ids.application, propertyId: l.property_id });
  after(async () => {
    const { runs } = await drainEvents(db, ws, Date.now());
    await Promise.all(runs.map((r) => r.done));
  });
  return { status: 200, body: { applicationId: ids.application } };
}
