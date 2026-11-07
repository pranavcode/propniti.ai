import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import { runAction } from "@/app/api/e/_lib/actions";
import { getAction } from "@/extensions/actions";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { resolveActor } from "@/server/permissions";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import { effective } from "@/server/effective";
import type { WriteCtx } from "@/server/query";
import { safeHref } from "@/lib/links";
import { GET as photo } from "@/app/api/photos/[id]/route";

// The photo route reads through getPlatform(); point it at this file's database.
const held = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/platform", async (orig) => ({ ...(await orig<object>()), getPlatform: () => ({ db: held.db }) }));

// The portal journeys on the generated base: the applicant from a started application to a
// scheduled move-in with staff steps in between, and the resident's repair rating, insurance
// rejection, renewal answer and move-out notice. Each step's guard refuses it out of order, and a
// double click does it once.

const T0 = Date.parse("2026-11-04T17:00:00Z");
const APPLICANT = "apl-0001";
const APP = "app-0001";
const RESIDENT = "res-p01-0001";
const LEASE = "L-10329";
let db: Db;
beforeAll(() => {
  for (const k of ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(k, "");
  db = openSqlite(":memory:");
  held.db = db;
}, 600_000);
afterAll(() => vi.unstubAllEnvs());

async function workspace() {
  const id = randomId();
  const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return id;
}
const ctx = async (persona: string, ws: string): Promise<WriteCtx> => ({ db, ws, actor: await resolveActor(db, getPersona(persona)!, ws), nowMs: T0 });
const run = (c: WriteCtx, key: string, id: string, input: unknown = {}) => {
  const a = getAction(key)!;
  return runAction(c, a, id, a.input ? a.input.parse(input) : input).catch((e: { status?: number; message: string }) => ({ status: e.status ?? 500, error: e.message }));
};
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();
const appRow = (ws: string) => db.prepare(`SELECT a.* FROM ${effective("applications")} AS a WHERE a.id = ?2`).bind(ws, APP).first<Record<string, unknown>>();
const doc = (docType: string, sample?: string) => ({ docType, fileName: `${docType}.pdf`, mime: "application/pdf", bytes: 52_000, ...(sample ? { sample } : {}) });

describe("applicant journey", () => {
  it("runs from a started application to a scheduled move-in, each step once and in order", { timeout: 120_000 }, async () => {
    const ws = await workspace();
    const me = await ctx("applicant", ws);
    const lena = await ctx("lena", ws);
    const rachel = await ctx("rachel", ws);

    // Submitting needs the fee and the first documents.
    expect(await run(me, "applicants.submit_application", APPLICANT)).toMatchObject({ status: 409, error: "Pay the application fee first." });
    expect((await run(me, "applicants.pay_fee", APPLICANT)).status).toBe(200);
    expect(await run(me, "applicants.submit_application", APPLICANT)).toMatchObject({ status: 409, error: "Upload your photo id and pay stub first." });
    // A sample must match the document type it's offered for.
    expect((await run(me, "applicants.upload_document", APPLICANT, doc("Photo ID", "pay-stub"))).status).toBe(400);
    expect((await run(me, "applicants.upload_document", APPLICANT, doc("Photo ID", "photo-id"))).status).toBe(200);
    expect((await run(me, "applicants.upload_document", APPLICANT, doc("Pay stub"))).status).toBe(200);
    const sampleDoc = await db.prepare(`SELECT d.url, d.mime FROM ${effective("documents")} AS d WHERE d.entity_id = ?2 AND d.doc_type = 'Photo ID'`).bind(ws, APP).first();
    expect(sampleDoc).toEqual({ url: "/samples/portal/sample-photo-id.png", mime: "application/pdf" });

    // Signing before a lease is sent is refused.
    expect((await run(me, "applicants.sign_lease", APPLICANT, { signature: "Priyanka Rao", agree: true })).status).toBe(409);
    expect(statuses(await Promise.all([run(me, "applicants.submit_application", APPLICANT), run(me, "applicants.submit_application", APPLICANT)]))).toEqual([200, 409]);
    expect(await appRow(ws)).toMatchObject({ stage: "Submitted" });

    // Staff: screening, then the broker's decision with a reason the applicant sees.
    expect((await run(lena, "applications.record_screening", APP)).status).toBe(409);
    expect(statuses(await Promise.all([run(lena, "applications.order_screening", APP), run(lena, "applications.order_screening", APP)]))).toEqual([200, 409]);
    expect((await run(lena, "applications.record_screening", APP)).status).toBe(200);
    const scr = await db.prepare(`SELECT s.income_verified, s.decision, s.provider FROM ${effective("screening_results")} AS s WHERE s.application_id = ?2`).bind(ws, APP).first();
    expect(scr).toMatchObject({ income_verified: 1, provider: "Sample Screening Co." });
    expect((await run(lena, "applications.send_lease", APP)).status).toBe(409);
    expect((await run(rachel, "applications.decide", APP, { decision: "Conditional", note: "A guarantor co-signs the lease" })).status).toBe(200);
    expect(await appRow(ws)).toMatchObject({ stage: "Conditional", decision_reason: "A guarantor co-signs the lease" });

    expect(statuses(await Promise.all([run(lena, "applications.send_lease", APP), run(lena, "applications.send_lease", APP)]))).toEqual([200, 409]);
    expect((await run(lena, "applications.schedule_move_in", APP)).status).toBe(409);

    // The applicant signs with their own name, once.
    expect(await run(me, "applicants.sign_lease", APPLICANT, { signature: "Someone Else", agree: true })).toMatchObject({ status: 400 });
    expect(statuses(await Promise.all([run(me, "applicants.sign_lease", APPLICANT, { signature: "priyanka  rao", agree: true }), run(me, "applicants.sign_lease", APPLICANT, { signature: "Priyanka Rao", agree: true })]))).toEqual([200, 409]);
    expect(await appRow(ws)).toMatchObject({ stage: "Leased" });
    expect((await run(lena, "applications.schedule_move_in", APP)).status).toBe(200);
    expect((await appRow(ws))?.move_in_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No more documents once leased.
    expect((await run(me, "applicants.upload_document", APPLICANT, doc("Bank statement"))).status).toBe(409);
  });

  it("acts only on the applicant's own record", async () => {
    const ws = await workspace();
    const other = await db.prepare("SELECT id FROM applicants WHERE workspace_id = 'base' AND id <> ?1 LIMIT 1").bind(APPLICANT).first<{ id: string }>();
    const r = await run(await ctx("applicant", ws), "applicants.submit_application", other!.id);
    expect(r.status).toBe(404);
  });
});

describe("resident photos", () => {
  it("are stored off the page and served same-site, only to people who can see the job", { timeout: 60_000 }, async () => {
    const ws = await workspace();
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const r = await run(await ctx("resident", ws), "residents.request_maintenance", RESIDENT, { description: "Water is leaking under the kitchen sink", location: "Kitchen", permissionToEnter: true, photos: [jpeg] });
    const wo = /WO-\d+/.exec("message" in r ? String(r.message) : "")![0];
    const p = await db.prepare("SELECT id, url, data FROM photos WHERE workspace_id = ?1 AND entity_id = ?2").bind(ws, wo).first<{ id: string; url: string; data: string }>();
    expect(p).toEqual({ id: expect.any(String), url: `/api/photos/${p!.id}`, data: jpeg });
    // The staff Photos tab links and renders only what passes SAFE_LINK; this does, a data: URL doesn't.
    expect(safeHref(p!.url)).toBe(p!.url);
    expect(safeHref(jpeg)).toBeUndefined();
    const get = (persona: string) => photo(new Request(`http://localhost${p!.url}`, { headers: { cookie: `pn_ws=${ws}; pn_as=${persona}` } }), { params: Promise.resolve({ id: p!.id }) });
    for (const persona of ["resident", "tom", "marcus", "owner"]) {
      const res = await get(persona);
      expect(res.status, persona).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("content-disposition")).toBe(`inline; filename="${p!.id}.jpg"`);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    // A vendor not on the job, an applicant, and no such photo.
    for (const persona of ["vendor", "applicant"]) expect((await get(persona)).status, persona).toBe(404);
    expect((await photo(new Request("http://localhost/api/photos/x", { headers: { cookie: `pn_ws=${ws}; pn_as=tom` } }), { params: Promise.resolve({ id: "ph-none" }) })).status).toBe(404);
    // Bytes that aren't the declared image type are never served.
    await db.prepare("UPDATE photos SET data = ?3 WHERE workspace_id = ?1 AND id = ?2").bind(ws, p!.id, jpeg.replace("image/jpeg", "image/png")).run();
    expect((await get("tom")).status).toBe(404);
  });
});

describe("resident journeys", () => {
  it("rates a finished repair once, and only their own", { timeout: 60_000 }, async () => {
    const ws = await workspace();
    const me = await ctx("resident", ws);
    const r = await run(me, "residents.request_maintenance", RESIDENT, { description: "Water is leaking under the kitchen sink", location: "Kitchen", permissionToEnter: true, photos: [] });
    expect(r.status).toBe(200);
    const wo = /WO-\d+/.exec("message" in r ? String(r.message) : "")![0];
    expect((await run(me, "residents.rate_request", RESIDENT, { workOrderId: wo, stars: 5 })).status).toBe(409);
    await db.prepare("UPDATE work_orders SET status = 'Completed', completed_at = ?3 WHERE workspace_id = ?1 AND id = ?2").bind(ws, wo, "2026-11-05T10:00:00Z").run();
    expect(statuses(await Promise.all([run(me, "residents.rate_request", RESIDENT, { workOrderId: wo, stars: 4 }), run(me, "residents.rate_request", RESIDENT, { workOrderId: wo, stars: 4 })]))).toEqual([200, 409]);
    const n = await db.prepare("SELECT count(*) AS n FROM ratings WHERE workspace_id = ?1 AND subject_id = ?2").bind(ws, wo).first<{ n: number }>();
    expect(n?.n).toBe(1);
    const theirs = await db.prepare("SELECT w.id FROM work_orders w WHERE w.workspace_id = 'base' AND w.status = 'Completed' AND w.id NOT IN (SELECT work_order_id FROM service_requests WHERE resident_id = ?1 AND work_order_id IS NOT NULL) LIMIT 1").bind(RESIDENT).first<{ id: string }>();
    expect((await run(me, "residents.rate_request", RESIDENT, { workOrderId: theirs!.id, stars: 1 })).status).toBe(404);
  });

  it("gets a rejected policy back with the reason, and can resubmit it", { timeout: 60_000 }, async () => {
    const ws = await workspace();
    const me = await ctx("resident", ws);
    const marcus = await ctx("marcus", ws);
    const policy = { carrier: "Sample Mutual Insurance Co.", policyNumber: "SMP-RI-2027-0412", liability: 300_000, startsOn: "2026-11-01", expiresOn: "2027-11-01", fileName: "SAMPLE.pdf", sample: true };
    expect((await run(me, "residents.submit_insurance", RESIDENT, policy)).status).toBe(200);
    const id = `ri-${LEASE}-2027-11-01`;
    expect(() => getAction("renters_insurance.reject")!.input!.parse({ reason: "no" })).toThrow();
    expect(statuses(await Promise.all([run(marcus, "renters_insurance.reject", id, { reason: "The named insured isn't on this lease" }), run(marcus, "renters_insurance.reject", id, { reason: "The named insured isn't on this lease" })]))).toEqual([200, 409]);
    const rej = await db.prepare("SELECT status, review_note FROM renters_insurance WHERE workspace_id = ?1 AND id = ?2").bind(ws, id).first();
    expect(rej).toEqual({ status: "Rejected", review_note: "The named insured isn't on this lease" });
    expect((await run(marcus, "renters_insurance.verify", id)).status).toBe(409);
    expect((await run(me, "residents.submit_insurance", RESIDENT, { ...policy, carrier: "Sample Mutual Insurance Company" })).status).toBe(200);
    expect(await db.prepare("SELECT status, review_note FROM renters_insurance WHERE workspace_id = ?1 AND id = ?2").bind(ws, id).first()).toEqual({ status: "Pending verification", review_note: null });
    expect((await run(marcus, "renters_insurance.verify", id)).status).toBe(200);
    const doc = await db.prepare("SELECT url FROM documents WHERE workspace_id = ?1 AND id = ?2").bind(ws, `doc-${id}`).first();
    expect(doc).toEqual({ url: "/samples/portal/sample-renters-insurance-declarations.pdf" });
  });

  it("counters or accepts a renewal, and signs an accepted one once", { timeout: 60_000 }, async () => {
    const ws = await workspace();
    const me = await ctx("resident", ws);
    const offer = "ro-L-10329-open";
    expect(() => getAction("residents.respond_renewal")!.input!.parse({ offerId: offer, decision: "Countered" })).toThrow();
    expect((await run(me, "residents.sign_renewal", RESIDENT, { offerId: offer, signature: "Jordan Lee", agree: true })).status).toBe(409);
    expect((await run(me, "residents.respond_renewal", RESIDENT, { offerId: offer, decision: "Accepted" })).status).toBe(200);
    expect(statuses(await Promise.all([run(me, "residents.sign_renewal", RESIDENT, { offerId: offer, signature: "Jordan Lee", agree: true }), run(me, "residents.sign_renewal", RESIDENT, { offerId: offer, signature: "Jordan Lee", agree: true })]))).toEqual([200, 409]);
    const ws2 = await workspace();
    expect((await run(await ctx("resident", ws2), "residents.respond_renewal", RESIDENT, { offerId: offer, decision: "Countered", note: "12 months at my current rent" })).status).toBe(200);
    expect(await db.prepare("SELECT status, resident_note FROM renewal_offers WHERE workspace_id = ?1 AND id = ?2").bind(ws2, offer).first()).toEqual({ status: "Countered", resident_note: "12 months at my current rent" });
  });

  it("gives notice at least 30 days out, once, and staff book the inspection once", { timeout: 60_000 }, async () => {
    const ws = await workspace();
    const me = await ctx("resident", ws);
    const marcus = await ctx("marcus", ws);
    expect((await run(me, "residents.give_notice", RESIDENT, { moveOutOn: "2026-11-20" })).status).toBe(400);
    expect((await run(marcus, "leases.schedule_move_out_inspection", LEASE)).status).toBe(409);
    expect(statuses(await Promise.all([run(me, "residents.give_notice", RESIDENT, { moveOutOn: "2027-01-11" }), run(me, "residents.give_notice", RESIDENT, { moveOutOn: "2027-01-11" })]))).toEqual([200, 409]);
    const lease = await db.prepare("SELECT status, notice_on, move_out_on FROM leases WHERE workspace_id = ?1 AND id = ?2").bind(ws, LEASE).first();
    expect(lease).toEqual({ status: "Notice", notice_on: "2026-11-04", move_out_on: "2027-01-11" });
    // The open renewal offer is declined with the notice.
    expect(await db.prepare(`SELECT o.status FROM ${effective("renewal_offers")} AS o WHERE o.id = 'ro-L-10329-open'`).bind(ws).first()).toEqual({ status: "Declined" });
    // A new request resolves a new actor (each caches which tables the workspace has changed).
    const marcus2 = await ctx("marcus", ws);
    const booked = await Promise.all([run(marcus2, "leases.schedule_move_out_inspection", LEASE), run(marcus2, "leases.schedule_move_out_inspection", LEASE)]);
    expect(statuses(booked), JSON.stringify(booked)).toEqual([200, 409]);
    const n = await db.prepare("SELECT count(*) AS n FROM inspections WHERE workspace_id = ?1 AND kind = 'Move-out' AND scheduled_on = '2027-01-11'").bind(ws).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
