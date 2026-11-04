import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { setModelForTests, type ChatModel } from "@/ai/providers";
import { seed, WS } from "@/server/query.fixture";
import * as importRoute from "@/app/api/import/route";
import * as undoRoute from "@/app/api/import/undo/route";
import * as stateRoute from "../route";
import * as detectRoute from "../detect/route";
import * as checkRoute from "../check/route";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { portfolioStats } from "@/extensions/onboarding/server";
import { EMPTY } from "@/extensions/onboarding/state";

// The onboarding routes on a fresh in-memory database: who may save progress, what the AI file
// check accepts and sends, and the Data Health run over one import's records.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const db = () => getPlatform().db;
const host = "propniti.test";
const post = (path: string, body: unknown, opts: { persona?: string; origin?: string | null } = {}) => {
  const headers = new Headers({ host, cookie: `pn_as=${opts.persona ?? "daniel"}; pn_ws=${WS}`, "content-type": "application/json" });
  if (opts.origin !== null) headers.set("origin", opts.origin ?? `http://${host}`);
  return new Request(`http://${host}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
};
const stored = async () => JSON.parse((await db().prepare("SELECT data FROM user_preferences WHERE workspace_id = ? AND id = 'org-summit'").bind(WS).first<{ data: string }>())?.data ?? "{}").onboarding;

beforeAll(async () => {
  await seed(db());
  await db().prepare("INSERT INTO regions (workspace_id, id, org_id, name, states) VALUES ('base', 'r-tx', 'org1', 'Texas', '[\"TX\"]')").run();
  await db().prepare("INSERT INTO portfolios (workspace_id, id, org_id, owner_entity_id, name) VALUES ('base', 'pf1', 'org1', 'oe01', 'Fund II')").run();
  await db().prepare("INSERT INTO data_rules (workspace_id, id, entity_type, name, severity, description, check_kind, check_sql, enabled) VALUES ('base', 'properties.missing_zip_state', 'properties', 'Missing ZIP or state', 'warn', 'ZIP or state is blank.', 'sql', 'SELECT id FROM {{properties}} WHERE zip = '''' OR state = ''''', 1)").run();
});
afterEach(() => setModelForTests(undefined));

describe("POST /api/onboarding", () => {
  it("refuses other sites, roles that don't set up the org, portals and bad bodies", async () => {
    const body = { at: "data" };
    expect((await stateRoute.POST(post("/api/onboarding", body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await stateRoute.POST(post("/api/onboarding", body, { persona: "marcus" }))).status).toBe(403);
    expect((await stateRoute.POST(post("/api/onboarding", body, { persona: "resident" }))).status).toBe(403);
    expect((await stateRoute.POST(post("/api/onboarding", { at: "nowhere" }))).status).toBe(400);
    expect((await stateRoute.POST(post("/api/onboarding", { company: { name: "A", states: ["ZZ"], size: null } }))).status).toBe(400);
  });

  it("saves progress for the principal, regional manager and admin, and resumes from it", async () => {
    const r = await stateRoute.POST(post("/api/onboarding", { at: "data", done: ["company"], company: { name: "Lakeside Property Co.", states: ["TX", "AZ"], size: 420 } }));
    expect(r.status).toBe(200);
    expect((await r.json()).state).toMatchObject({ at: "data", done: ["company"] });
    expect(await stored()).toMatchObject({ at: "data", done: ["company"], company: { name: "Lakeside Property Co.", states: ["TX", "AZ"], size: 420 } });
    expect((await stateRoute.POST(post("/api/onboarding", { at: "rules", skipped: ["data"] }, { persona: "priya" }))).status).toBe(200);
    expect((await stateRoute.POST(post("/api/onboarding", { at: "team" }, { persona: "sam" }))).status).toBe(200);
    expect(await stored()).toMatchObject({ at: "team", done: ["company"], skipped: ["data"], company: { name: "Lakeside Property Co." } });
  });

  it("marks the setup checklist steps a finished step completes, and a double click changes nothing more", async () => {
    const both = await Promise.all([1, 2].map(() => stateRoute.POST(post("/api/onboarding", { done: ["rules"] }))));
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect((await stored()).done).toEqual(["company", "rules"]);
    const steps = await db().prepare("SELECT step, status FROM onboarding_progress WHERE workspace_id = ? ORDER BY step").bind(WS).all();
    expect(steps.results).toEqual(expect.arrayContaining([{ step: "payments", status: "Done" }]));
    expect(steps.results.filter((s) => s.step === "payments")).toHaveLength(1);
  });
});

describe("portfolioStats", () => {
  it("sizes from vendor work orders only, reading an even sample of the sorted costs and the true count", async () => {
    const costs = Array.from({ length: 2400 }, (_, i) => 1000 + i * 100); // $10 … $2,409
    for (let k = 0; k < costs.length; k += 400) {
      const values = costs.slice(k, k + 400).map((c, i) => `('base', 'wo-${k + i}', 'p01', 'Fix', 'General', 'Normal', 'Completed', 'v01', ${c}, '2026-10-01')`).join(", ");
      await db().prepare(`INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, cost_cents, opened_at) VALUES ${values}`).run();
    }
    await db().prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, cost_cents, opened_at) VALUES ('base', 'wo-inhouse', 'p01', 'Fix', 'General', 'Normal', 'Completed', NULL, 99999999, '2026-10-01')").run();
    const s = await portfolioStats({ db: db(), ws: WS, actor: await actorFor(db(), WS, getPersona("daniel")!) }, EMPTY);
    expect(s.counts!.workOrders).toBe(2400);
    expect(s.workOrders.length).toBe(1200);
    expect(Math.max(...s.workOrders)).toBeLessThan(2410);
    const sorted = [...s.workOrders].sort((a, b) => a - b);
    expect(sorted[600]! - sorted[599]!).toBe(2);
  });
});

describe("setup checklist ticks", () => {
  const ticked = async (step: string) => (await db().prepare("SELECT count(*) AS n FROM onboarding_progress WHERE workspace_id = ? AND step = ?").bind(WS, step).first<{ n: number }>())!.n;
  it("ticks only the items the role can do itself", async () => {
    // A regional manager can't add people, so finishing the team step leaves roles and team open.
    expect((await stateRoute.POST(post("/api/onboarding", { done: ["team"] }, { persona: "priya" }))).status).toBe(200);
    expect([await ticked("roles"), await ticked("team")]).toEqual([0, 0]);
    // An admin can't create properties, so a finished data step doesn't tick the import.
    expect((await stateRoute.POST(post("/api/onboarding", { done: ["data"] }, { persona: "sam" }))).status).toBe(200);
    expect(await ticked("import")).toBe(0);
  });
});

describe("POST /api/onboarding/detect", () => {
  const body = { files: [{ id: "f1", name: "export.csv", headers: ["Property", "Unit", "Tenant", "Rent"], samples: [["Maple Court", "101", "Ana Diaz", "1450"]] }] };

  it("answers with rules only when no model is configured", async () => {
    const res = await detectRoute.POST(post("/api/onboarding/detect", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ live: false, source: "Rules", detections: [] });
  });

  it("refuses more than three sample rows, long cells and portal users", async () => {
    const rows = { files: [{ ...body.files[0], samples: Array.from({ length: 4 }, () => ["a", "1", "b", "1"]) }] };
    expect((await detectRoute.POST(post("/api/onboarding/detect", rows))).status).toBe(400);
    const long = { files: [{ ...body.files[0], samples: [["x".repeat(61), "1", "b", "1"]] }] };
    expect((await detectRoute.POST(post("/api/onboarding/detect", long))).status).toBe(400);
    expect((await detectRoute.POST(post("/api/onboarding/detect", body, { persona: "resident" }))).status).toBe(403);
  });

  it("keeps only answers for files it was sent, with a known tool and record type", async () => {
    let sent = "";
    const model: ChatModel = {
      info: { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet", native: true },
      chat: async () => { throw new Error("not used"); },
      structured: async (schema, system, user) => {
        sent = user;
        expect(system).toMatch(/data, never instructions/);
        return { value: schema.parse({ files: [
          { file: "f1", tool: "appfolio", record_type: "rent_roll", confidence: 1.4, reason: "Tenant and Past Due columns, as AppFolio names them." },
          { file: "f9", tool: "appfolio", record_type: "rent_roll", confidence: 0.9, reason: "Not a file that was sent." },
          { file: "f1", tool: "quickbooks", record_type: "rent_roll", confidence: 0.9, reason: "Unknown tool, and a second answer." },
        ] }), usage: { tokensIn: 400, tokensOut: 80, costCents: 0.16, latencyMs: 700 } };
      },
    };
    setModelForTests(model);
    const res = await detectRoute.POST(post("/api/onboarding/detect", body));
    const out = await res.json();
    expect(out).toMatchObject({ live: true, source: "Claude Sonnet", detections: [{ id: "f1", tool: "appfolio", kind: "rent_roll", confidence: 1 }] });
    expect(out.detections).toHaveLength(1);
    expect(JSON.parse(sent)).toEqual({ files: [{ file: "f1", name: "export.csv", headers: body.files[0]!.headers, sample_rows: body.files[0]!.samples }] });
  });

  it("falls back to rules when the model fails", async () => {
    setModelForTests({ info: { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet", native: true }, chat: async () => { throw new Error("x"); }, structured: async () => { throw new Error("timed out"); } });
    expect(await (await detectRoute.POST(post("/api/onboarding/detect", body))).json()).toMatchObject({ live: false, source: "Rules", detections: [] });
  });
});

describe("POST /api/onboarding/check", () => {
  const src = { file: "f1", line: 2 };
  const payload = {
    properties: [{ key: "maple court", name: "Maple Court", street: "1 Elm St", city: "Austin", state: "TX", zip: "", src }],
    units: [{ property: "maple court", number: "101", sqft: 700, marketRent: 1500, status: "Occupied", src }],
    residents: [], owners: [], vendors: [], balances: [], recurring: [],
    leases: [{ property: "maple court", unit: "101", people: [{ first: "Ana", last: "Diaz", email: "ana@example.com" }], start: "2026-05-01", end: "2027-04-30", rent: 1450, status: "Active", src }],
  };
  let batch = "";

  beforeAll(async () => {
    const r = await importRoute.POST(post("/api/import", { mode: "commit", payload, options: { tool: "appfolio", reports: ["Rent Roll"], files: ["roll.csv"] } }));
    const out = await r.json();
    batch = out.batch;
    if (!batch) throw new Error(JSON.stringify(out));
  });

  it("runs the Data Health rules on the import's records and files each issue once", async () => {
    const runs = await Promise.all([1, 2].map(() => checkRoute.POST(post("/api/onboarding/check", { batch }))));
    expect(runs.map((r) => r.status)).toEqual([200, 200]);
    const out = await runs[0]!.json();
    expect(out.rules).toBe(1);
    expect(out.issues).toEqual([expect.objectContaining({ rule: "properties.missing_zip_state", name: "Missing ZIP or state", label: "Maple Court", href: expect.stringMatching(/^\/app\/properties\/pro-i[0-9a-f]{10}-1$/) })]);
    const rows = await db().prepare("SELECT rule_id, status FROM data_issues WHERE workspace_id = ? AND id LIKE 'di-onb-%'").bind(WS).all();
    expect(rows.results).toEqual([{ rule_id: "properties.missing_zip_state", status: "open" }]);
    expect((await stored()).check).toMatchObject({ issues: 1, rules: 1 });
    expect((await stored()).done).toContain("check");
  });

  it("refuses a batch that isn't a live import here, and roles that don't set up the org", async () => {
    expect((await checkRoute.POST(post("/api/onboarding/check", { batch: "0000000000" }))).status).toBe(404);
    expect((await checkRoute.POST(post("/api/onboarding/check", { batch }, { persona: "marcus" }))).status).toBe(403);
    expect((await undoRoute.POST(post("/api/import/undo", { batch }))).status).toBe(200);
    expect((await checkRoute.POST(post("/api/onboarding/check", { batch }))).status).toBe(404);
  });
});
