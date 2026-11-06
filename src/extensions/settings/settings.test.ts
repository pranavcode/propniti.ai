import { beforeAll, describe, expect, it, vi } from "vitest";
import "@/entities";
import { getPlatform } from "@/lib/platform";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { list, updateRecord, type WriteCtx } from "@/server/query";
import { runAction } from "@/app/api/e/_lib/actions";
import { getAction } from "@/extensions/actions";
import * as invite from "@/app/(app)/app/settings/users/invite/route";
import * as company from "@/app/(app)/app/settings/company/save/route";
import * as prefs from "@/app/(app)/app/settings/notifications/prefs/route";
import * as connect from "@/app/(app)/app/settings/integrations/connect/route";
import * as listRoute from "@/app/api/e/[entity]/route";
import * as recordRoute from "@/app/api/e/[entity]/[id]/route";
import * as policyRoute from "@/app/api/ai/policies/[id]/route";
import * as agentRoute from "@/app/api/ai/agents/[key]/route";

// Settings writes on a fresh in-memory database: state-rule amendments keep history, policy
// edits are audited with before/after, and the settings POST routes are guarded and idempotent.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const db = () => getPlatform().db;
const host = "propniti.test";
const post = (path: string, body: unknown, persona = "sam") => new Request(`http://${host}${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { host, origin: `http://${host}`, "content-type": "application/json", cookie: `pn_as=${persona}; pn_ws=${WS}` },
});
const wctx = async (persona: string): Promise<WriteCtx> => ({ db: db(), ws: WS, nowMs: Date.parse("2026-11-04T15:00:00Z"), actor: await actorFor(db(), WS, getPersona(persona)!) });

beforeAll(async () => {
  await seed(db());
  for (const s of [
    "INSERT INTO state_rules (workspace_id, id, state, rule, value, note, effective_from) VALUES ('base', 'sr-tx-grace_days-20230101', 'TX', 'grace_days', '1', 'Old grace period', '2023-01-01'), ('base', 'sr-tx-grace_days-20240901', 'TX', 'grace_days', '2', 'Tex. Prop. Code §92.019', '2024-09-01')",
    "INSERT INTO approval_policies (workspace_id, id, owner_entity_id, category, limit_cents, approver_role, owner_approval_over_cents, always_human) VALUES ('base', 'apol-maintenance-spend', NULL, 'Maintenance spend', 100000, 'property_manager', 500000, 0)",
    "INSERT INTO approval_policies (workspace_id, id, owner_entity_id, category, limit_cents, approver_role, owner_approval_over_cents, always_human) VALUES ('base', 'apol-legal', NULL, 'Legal', NULL, 'principal', NULL, 1)",
    "INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 'sam', 'org-summit', 'Sam Okafor', 'Administrator', 'sam.okafor@summitresidential.example')",
  ]) await db().prepare(s).run();
});

describe("state rules", () => {
  it("marks only the latest version on or before today as in force", async () => {
    const res = await list(await wctx("sam"), "state_rules", {});
    expect(Object.fromEntries(res.rows.map((r) => [r.id, r.current]))).toEqual({ "sr-tx-grace_days-20240901": true, "sr-tx-grace_days-20230101": false });
  });

  it("amends by adding a dated version, once on a double click", async () => {
    const a = getAction("state_rules.amend")!;
    const input = { value: "3", note: "Board raised the grace period to three days (test).", effective_from: "2026-12-01" };
    const ctx = await wctx("sam");
    const results = await Promise.all([runAction(ctx, a, "sr-tx-grace_days-20240901", input), runAction(ctx, a, "sr-tx-grace_days-20240901", input)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await db().prepare("SELECT id, value, changed_by FROM state_rules WHERE workspace_id = ? AND id = 'sr-tx-grace_days-20261201'").bind(WS).all();
    expect(rows.results).toEqual([{ id: "sr-tx-grace_days-20261201", value: "3", changed_by: "sam" }]);
  });

  it("refuses a version that starts before the current one, and non-admins", async () => {
    const a = getAction("state_rules.amend")!;
    const input = { value: "5", note: "Backdated change that should be refused.", effective_from: "2024-01-01" };
    expect((await runAction(await wctx("sam"), a, "sr-tx-grace_days-20240901", input)).status).toBe(400);
    await expect(runAction(await wctx("marcus"), a, "sr-tx-grace_days-20240901", { ...input, effective_from: "2027-01-01" })).rejects.toMatchObject({ status: 403 });
  });
});

const patch = (path: string, body: unknown, persona: string) => new Request(`http://${host}${path}`, {
  method: "PATCH", body: JSON.stringify(body),
  headers: { host, origin: `http://${host}`, "content-type": "application/json", cookie: `pn_as=${persona}; pn_ws=${WS}` },
});
const editPolicy = (persona: string, body: unknown, id = "apol-maintenance-spend") => policyRoute.PATCH(patch(`/api/ai/policies/${id}`, body, persona), { params: Promise.resolve({ id }) });

describe("approval policies", () => {
  it("audits a limit change with the values before and after", async () => {
    expect((await editPolicy("sam", { limit_cents: 250000 })).status).toBe(200);
    const a = await db().prepare("SELECT before_json, after_json, actor FROM audit WHERE workspace_id = ? AND entity_type = 'approval_policies' ORDER BY at DESC").bind(WS).first<{ before_json: string; after_json: string; actor: string }>();
    expect(JSON.parse(a!.before_json)).toMatchObject({ limit_cents: 100000 });
    expect(JSON.parse(a!.after_json)).toMatchObject({ limit_cents: 250000 });
    expect(a!.actor).toBe("Sam Okafor");
  });

  it("lets principals, regional managers and admins change policies through one route, and nobody else", async () => {
    for (const p of ["daniel", "priya", "sam"]) expect((await editPolicy(p, { owner_approval_over_cents: 600000, approver_role: "accountant" })).status, p).toBe(200);
    for (const p of ["marcus", "grace", "tom", "nadia"]) expect((await editPolicy(p, { limit_cents: 9000 })).status, p).toBe(403);
  });

  it("closes the generic record API to policy edits", async () => {
    await expect(updateRecord(await wctx("sam"), "approval_policies", "apol-maintenance-spend", { limit: 9000 })).rejects.toMatchObject({ status: 405 });
    await expect(updateRecord(await wctx("nadia"), "approval_policies", "apol-maintenance-spend", { limit: 9000 })).rejects.toMatchObject({ status: 405 });
  });

  it("keeps legal and safety decisions always with a person", async () => {
    expect((await editPolicy("sam", { always_human: false }, "apol-legal")).status).toBe(400);
    expect((await editPolicy("sam", { always_human: true })).status).toBe(200);
  });
});

describe("agent settings", () => {
  const editAgent = (persona: string, body: unknown) => agentRoute.PATCH(patch("/api/ai/agents/collections", body, persona), { params: Promise.resolve({ key: "collections" }) });
  it("only policy editors change an agent's autonomy, schedule or on/off, because it applies to the whole org", async () => {
    for (const p of ["marcus", "grace", "tom", "rachel", "nadia"]) expect((await editAgent(p, { autonomy: "auto_within_policy" })).status, p).toBe(403);
    for (const p of ["daniel", "priya", "sam"]) expect((await editAgent(p, { autonomy: "act_with_approval" })).status, p).toBe(200);
  });
});

describe("settings routes", () => {
  const body = { name: "Ava Nguyen", email: "ava.nguyen@summitresidential.example", title: "Assistant property manager", role: "property_manager", scope_kind: "property", scope_ids: ["p01", "p02"] };

  it("invites once on a double click, with role rows and the setup step", async () => {
    const res = await Promise.all([invite.POST(post("/app/settings/users/invite", body)), invite.POST(post("/app/settings/users/invite", body))]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const staff = await db().prepare("SELECT id, active FROM staff WHERE workspace_id = ? AND email = ?").bind(WS, body.email).all<{ id: string; active: number }>();
    expect(staff.results).toHaveLength(1);
    expect(staff.results[0].active).toBe(0);
    const roles = await db().prepare("SELECT count(*) AS n FROM role_assignments WHERE workspace_id = ? AND staff_id = ?").bind(WS, staff.results[0].id).first<{ n: number }>();
    expect(roles!.n).toBe(2);
    const step = await db().prepare("SELECT status FROM onboarding_progress WHERE workspace_id = ? AND step = 'team'").bind(WS).first<{ status: string }>();
    expect(step!.status).toBe("Done");
  });

  it("refuses org settings from non-admins and cross-site posts, and validates input", async () => {
    for (const p of ["marcus", "priya", "grace", "lena"]) expect((await invite.POST(post("/app/settings/users/invite", { ...body, email: "x@y.example" }, p))).status, p).toBe(403);
    const cross = new Request(`http://${host}/app/settings/users/invite`, { method: "POST", body: JSON.stringify(body), headers: { host, origin: "https://evil.example", "content-type": "application/json", cookie: `pn_as=sam; pn_ws=${WS}` } });
    expect((await invite.POST(cross)).status).toBe(403);
    const bad = { legal_name: "Summit", ein: "123", address: "600 Congress Ave", phone: "5125550140", support_email: "a@b.example", timezone: "America/Chicago", fiscal_year_start: "January", license_number: "" };
    expect((await company.POST(post("/app/settings/company/save", bad))).status).toBe(400);
  });

  it("lets the principal and admins edit the company profile, and no other role", async () => {
    const profile = { legal_name: "Summit Residential Partners, LLC", ein: "84-2719305", address: "600 Congress Ave, Suite 1400, Austin, TX 78701", phone: "(512) 555-0140", support_email: "residents@summitresidential.example", timezone: "America/Chicago", fiscal_year_start: "January", license_number: "TX 9011842" };
    for (const p of ["daniel", "sam"]) expect((await company.POST(post("/app/settings/company/save", profile, p))).status, p).toBe(200);
    for (const p of ["priya", "marcus", "lena", "rachel", "grace", "tom"]) expect((await company.POST(post("/app/settings/company/save", profile, p))).status, p).toBe(403);
    const cross = new Request(`http://${host}/app/settings/company/save`, { method: "POST", body: JSON.stringify(profile), headers: { host, origin: "https://evil.example", "content-type": "application/json", cookie: `pn_as=daniel; pn_ws=${WS}` } });
    expect((await company.POST(cross)).status).toBe(403);
    expect((await company.POST(post("/app/settings/company/save", { ...profile, ein: "123" }, "daniel"))).status).toBe(400);
  });

  it("lets the principal add people, but not grant the administrator role or reach outside the org", async () => {
    const as = (b: unknown, p = "daniel") => invite.POST(post("/app/settings/users/invite", b, p));
    const ok = await as({ ...body, email: "pm.new@summitresidential.example" });
    expect(ok.status).toBe(200);
    expect((await db().prepare("SELECT role FROM role_assignments WHERE workspace_id = ? AND staff_id = ?").bind(WS, (await ok.json()).id).all()).results).toEqual([{ role: "property_manager" }, { role: "property_manager" }]);
    expect((await as({ ...body, email: "boss@summitresidential.example", role: "admin", scope_kind: "org", scope_ids: [] })).status).toBe(403);
    expect((await as({ ...body, email: "far@summitresidential.example", scope_ids: ["p01", "p99"] })).status).toBe(403);
    expect((await db().prepare("SELECT count(*) AS n FROM staff WHERE workspace_id = ? AND email IN ('boss@summitresidential.example', 'far@summitresidential.example')").bind(WS).first<{ n: number }>())!.n).toBe(0);
    // An administrator still grants the administrator role.
    expect((await as({ ...body, email: "admin2@summitresidential.example", role: "admin", scope_kind: "org", scope_ids: [] }, "sam")).status).toBe(200);
  });

  it("saves personal notification preferences for any staff persona and merges them", async () => {
    expect((await prefs.POST(post("/app/settings/notifications/prefs", { types: { sla: { in_app: true, email: true, sms: false } } }, "marcus"))).status).toBe(200);
    expect((await prefs.POST(post("/app/settings/notifications/prefs", { digest: "Off" }, "marcus"))).status).toBe(200);
    const row = await db().prepare("SELECT data FROM user_preferences WHERE workspace_id = ? AND id = 'marcus'").bind(WS).first<{ data: string }>();
    expect(JSON.parse(row!.data).notifications).toEqual({ types: { sla: { in_app: true, email: true, sms: false } }, digest: "Off" });
  });

  it("records a simulated integration and ties Plaid to the bank setup step", async () => {
    const res = await connect.POST(post("/app/settings/integrations/connect", { key: "plaid", connect: false }));
    expect(res.status).toBe(200);
    const step = await db().prepare("SELECT status FROM onboarding_progress WHERE workspace_id = ? AND step = 'bank'").bind(WS).first<{ status: string }>();
    expect(step!.status).toBe("Todo");
  });
});

describe("audit scope", () => {
  const get = (path: string, persona: string) => new Request(`http://${host}${path}`, { headers: { host, cookie: `pn_as=${persona}; pn_ws=${WS}` } });
  const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

  beforeAll(async () => {
    await db().prepare(`INSERT INTO audit (workspace_id, id, at, actor, action, entity_type, entity_id, property_id, detail, after_json) VALUES
      ('base', 'au-tx', '2026-11-01T10:00:00Z', 'Grace Kim', 'bills.approve', 'bills', 'BILL-1', 'p01', 'Approved $2,400 bill', '{"amount_cents":240000}'),
      ('base', 'au-ga', '2026-11-01T11:00:00Z', 'Grace Kim', 'bills.approve', 'bills', 'BILL-2', 'p05', 'Approved $9,100 bill for Inman Park Flats', '{"amount_cents":910000}')`).run();
  });

  it("keeps a Texas regional manager out of Georgia audit rows in the list and the API", async () => {
    const res = await list(await wctx("priya"), "audit", { size: 100 });
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain("au-tx");
    expect(ids).not.toContain("au-ga");
    const body = await (await listRoute.GET(get("/api/e/audit?f.property_id=p05", "priya"), p({ entity: "audit" }))).json();
    expect(body.total).toBe(0);
    expect((await recordRoute.GET(get("/api/e/audit/au-ga", "priya"), p({ entity: "audit", id: "au-ga" }))).status).toBe(404);
  });

  it("still shows every row to org-wide readers", async () => {
    const ids = (await list(await wctx("daniel"), "audit", { size: 100 })).rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["au-tx", "au-ga"]));
  });
});
