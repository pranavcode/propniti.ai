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
import type { WriteCtx } from "@/server/query";
import { extractInsurance, toInsuranceRead } from "@/lib/llm";

// Renters insurance from the resident portal: the AI reads the declarations page (or the resident
// types it), the resident confirms, and a Pending verification policy is filed on their lease until
// staff verify it on the renters insurance list.

const T0 = Date.parse("2026-11-04T17:00:00Z");
const RESIDENT = "res-p01-0001";
const LEASE = "L-10329";
let db: Db;
beforeAll(() => {
  for (const k of ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(k, "");
  db = openSqlite(":memory:");
}, 600_000);
afterAll(() => vi.unstubAllEnvs());

async function ctx(persona: string, ws?: string): Promise<WriteCtx> {
  const id = ws ?? randomId();
  if (!ws) {
    const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
    if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  }
  return { db, ws: id, actor: await resolveActor(db, getPersona(persona)!, id), nowMs: T0 };
}
const run = (c: WriteCtx, key: string, id: string, input: unknown) => {
  const a = getAction(key)!;
  return runAction(c, a, id, a.input ? a.input.parse(input) : input).catch((e: { status?: number; message: string }) => ({ status: e.status ?? 500, error: e.message }));
};
const policy = { carrier: "Lemonade Insurance Co.", policyNumber: "LP-2027-55810", liability: 100_000, startsOn: "2026-11-01", expiresOn: "2027-11-01", fileName: "declarations.pdf", aiFields: ["carrier", "policyNumber", "liability", "startsOn", "expiresOn"], source: "anthropic" };

describe("reading a declarations page", () => {
  it("normalises the model's fields and drops values it couldn't read", () => {
    const r = toInsuranceRead({ is_declarations: true, carrier: " Lemonade ", policy_number: "LP-1", liability_limit: 100000, effective_date: "2026-11-01", expiration_date: "11/01/2027", confidence: 1.4, issues: [] });
    expect(r).toMatchObject({ carrier: "Lemonade", policyNumber: "LP-1", liability: 100000, startsOn: "2026-11-01", expiresOn: "", confidence: 1 });
  });

  it("says so, and reads nothing, when no model is configured", async () => {
    const r = await extractInsurance({ mime: "application/pdf", base64: "JVBERi0=" });
    expect(r.source).toBe("mock");
    expect(r.fields).toBeUndefined();
    expect(r.note).toMatch(/not configured/i);
  });
});

describe("filing renters insurance from the portal", () => {
  it("creates one Pending verification policy on the resident's lease on a double click", async () => {
    const c = await ctx("resident");
    const rs = await Promise.all([run(c, "residents.submit_insurance", RESIDENT, policy), run(c, "residents.submit_insurance", RESIDENT, policy)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await db.prepare("SELECT lease_id, carrier, policy_number, liability_cents, status FROM renters_insurance WHERE workspace_id = ?").bind(c.ws).all();
    expect(rows.results).toEqual([{ lease_id: LEASE, carrier: policy.carrier, policy_number: policy.policyNumber, liability_cents: 10_000_000, status: "Pending verification" }]);
    const doc = await db.prepare("SELECT extracted FROM documents WHERE workspace_id = ? AND entity_type = 'renters_insurance'").bind(c.ws).first<{ extracted: string }>();
    expect(JSON.parse(doc!.extracted)).toMatchObject({ source: "anthropic", read_by_ai: policy.aiFields, confirmed_by_resident: true });
  });

  it("updates the pending policy when the resident corrects it", async () => {
    const c = await ctx("resident");
    expect((await run(c, "residents.submit_insurance", RESIDENT, policy)).status).toBe(200);
    expect((await run(c, "residents.submit_insurance", RESIDENT, { ...policy, policyNumber: "LP-2027-55811" })).status).toBe(200);
    const rows = await db.prepare("SELECT policy_number FROM renters_insurance WHERE workspace_id = ?").bind(c.ws).all<{ policy_number: string }>();
    expect(rows.results.map((r) => r.policy_number)).toEqual(["LP-2027-55811"]);
  });

  it("refuses a policy that has already expired or ends before it starts", async () => {
    const c = await ctx("resident");
    expect((await run(c, "residents.submit_insurance", RESIDENT, { ...policy, expiresOn: "2026-10-01" })).status).toBe(400);
    expect((await run(c, "residents.submit_insurance", RESIDENT, { ...policy, startsOn: "2027-12-01" })).status).toBe(400);
  });

  it("staff verify a pending policy; a resident can't", async () => {
    const r = await ctx("resident");
    expect((await run(r, "residents.submit_insurance", RESIDENT, policy)).status).toBe(200);
    const id = (await db.prepare("SELECT id FROM renters_insurance WHERE workspace_id = ?").bind(r.ws).first<{ id: string }>())!.id;
    expect((await run(r, "renters_insurance.verify", id, {})).status).toBe(403);
    const pm = await ctx("marcus", r.ws);
    expect((await run(pm, "renters_insurance.verify", id, {})).status).toBe(200);
    expect((await db.prepare("SELECT status FROM renters_insurance WHERE workspace_id = ? AND id = ?").bind(r.ws, id).first<{ status: string }>())!.status).toBe("Active");
    expect((await run(pm, "renters_insurance.verify", id, {})).status).toBe(409);
  });
});
