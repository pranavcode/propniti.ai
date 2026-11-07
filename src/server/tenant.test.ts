import { beforeEach, describe, expect, it } from "vitest";
import { getPersona, PERSONAS, sameOrg } from "@/auth/personas";
import "@/entities";
import type { Db } from "@/lib/platform/types";
import { inboxCounts } from "@/extensions/inbox/data";
import { orgId } from "@/extensions/settings/data";
import { assemble, type ImportFile } from "@/extensions/import/assemble";
import { detect } from "@/extensions/import/mapping";
import { parseDelimited, toSheet } from "@/extensions/import/parse";
import { commit, plan, undo } from "@/extensions/import/server";
import { companyState } from "@/extensions/onboarding/empty";
import { effective as paramEffective, isLakeside, LAKESIDE_BASE, LAKESIDE_WS } from "./effective";
import { actorFor } from "./permissions";
import { emptyDb, seed, WS } from "./query.fixture";
import { effective, list, metrics, type WriteCtx } from "./query";
import { nextMidnight, resolveWorkspace, tenantWs } from "./workspace";

// Two orgs in one database: Summit's base ('base', the fixture's 6 properties) and Lakeside's
// ('base-lakeside': the org, its principal and one region). The same visitor has a Summit overlay
// (WS) and a Lakeside one (WS + ".lakeside"). Nothing either org reads may come from the other.

const LK = WS + LAKESIDE_WS;
const NOW = Date.parse("2026-11-04T18:00:00Z");
let db: Db;
const ctx = async (persona: string, ws: string | null = persona === "alex" || persona === "maya" ? LK : WS): Promise<WriteCtx> => ({ db, ws: ws!, actor: await actorFor(db, ws, getPersona(persona)!), nowMs: NOW });
const n = async (sql: string, ...binds: unknown[]) => Number((await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n);

const ROLL = `Property,Property Address,Unit,Tenant,Email,Rent,Deposit,Lease From,Lease To,Past Due
Lakeview Flats,"12 Shore Rd, Austin, TX 78702",1,"Lopez, Ana",ana@example.com,"$1,200.00",600,2026-01-01,2026-12-31,250
Lakeview Flats,"12 Shore Rd, Austin, TX 78702",2,Bo Kim,bo@example.com,1250,,2026-03-01,2027-02-28,`;
const OWNERS = `Name,Company Name,Emails
Rita Shore,Shore Holdings LLC,rita@example.com`;
const PROPS = `Property,Property Address,Property City,Property State,Property Zip,Units,Owners
Lakeview Flats,12 Shore Rd,Austin,TX,78702,2,Shore Holdings LLC`;
const payloadOf = (...texts: string[]) => {
  const files: ImportFile[] = texts.map((t, i) => {
    const sheet = toSheet(parseDelimited(t));
    const d = detect(sheet.headers);
    return { id: `f${i}`, name: `f${i}.csv`, kind: d.kind, sheet, mapping: d.mapping, excluded: [] };
  });
  return assemble(files, [], "2026-11-04").payload;
};

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch([
    `INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('${LAKESIDE_BASE}', 'org', 0, 0), ('${LK}', 'demo', 0, 0)`,
    "INSERT INTO orgs (workspace_id, id, name, created_at) VALUES ('base', 'org-summit', 'Summit Residential Partners', '2023-02-14'), ('base', 'org-lakeside', 'Lakeside Property Co.', '2026-11-04'), ('base-lakeside', 'org-lakeside', 'Lakeside Property Co.', '2026-11-04')",
    "INSERT INTO regions (workspace_id, id, org_id, name, states) VALUES ('base', 'r-tx', 'org1', 'Texas', '[\"TX\"]'), ('base-lakeside', 'r-lk-all', 'org-lakeside', 'All markets', '[\"TX\",\"GA\"]')",
    "INSERT INTO portfolios (workspace_id, id, org_id, owner_entity_id, name) VALUES ('base', 'pf1', 'org1', 'oe01', 'Bluebonnet portfolio')",
    "INSERT INTO vendors (workspace_id, id, company, trade) VALUES ('base', 'v01', 'Lone Star Plumbing', 'Plumbing')",
    "INSERT INTO staff (workspace_id, id, org_id, name, title, email, active) VALUES ('base', 'marcus', 'org1', 'Marcus Bell', 'Property manager', 'marcus@summit.example', 1), ('base-lakeside', 'alex', 'org-lakeside', 'Alex Morgan', 'Principal', 'alex@lakeside.example', 1)",
    "INSERT INTO gl_accounts (workspace_id, id, number, name, type) VALUES ('base', 'gl-4000', '4000', 'Rental income', 'Income')",
    "INSERT INTO approval_policies (workspace_id, id, owner_entity_id, category, approver_role) VALUES ('base', 'pol-org-maintenance-spend', NULL, 'Maintenance spend', 'property_manager'), ('base', 'pol-oe01-maintenance-spend', 'oe01', 'Maintenance spend', 'property_manager')",
    "INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, status, last_message_at) VALUES ('base', 'mt1', 'p01', 'resident', 'res-p01-u1', 'Leak in 101', 'Open', '2026-11-03T10:00:00Z')",
    "INSERT INTO tasks (workspace_id, id, title, property_id, status, created_at) VALUES ('base', 't1', 'Call back', 'p01', 'Open', '2026-11-03T10:00:00Z')",
  ].map((s) => db.prepare(s)));
});

describe("workspaces per org", () => {
  it("gives Lakeside personas the visitor's id plus a suffix, and Summit personas the plain id", () => {
    expect(tenantWs("abc", getPersona("alex")!)).toBe("abc.lakeside");
    expect(tenantWs(null, getPersona("maya")!)).toBe("~.lakeside");
    expect(tenantWs("abc", getPersona("daniel")!)).toBe("abc");
    expect(tenantWs(null, getPersona("nadia")!)).toBeNull();
    expect(isLakeside("~.lakeside")).toBe(true);
  });

  it("creates the Lakeside overlay beside the Summit one from the same cookie, and resets it at midnight", async () => {
    const id = "visitor-cookie-id-0000000000001";
    const req = (persona: string) => new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}; pn_as=${persona}` } });
    const summit = await resolveWorkspace(db, req("daniel"), NOW, true, false);
    const lake = await resolveWorkspace(db, req("alex"), NOW, true, false);
    expect(summit).toMatchObject({ ws: id });
    expect(lake).toMatchObject({ ws: `${id}.lakeside` });
    expect((lake as { setCookie?: string }).setCookie).toBeUndefined();
    // The public site is Summit's whoever is browsing.
    expect(await resolveWorkspace(db, req("alex"), NOW, true, false, false)).toMatchObject({ ws: id });

    await db.prepare("INSERT INTO properties (workspace_id, id, org_id, region_id, portfolio_id, owner_entity_id, name, type, metro, street, city, state, zip, photos) VALUES (?, 'p-lk', 'org-lakeside', 'r-lk-all', 'pf-x', 'oe-x', 'Lakeview Flats', 'Garden multifamily', 'Austin', '1 Shore', 'Austin', 'TX', '78702', '[]')").bind(`${id}.lakeside`).run();
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("properties")}`, `${id}.lakeside`)).toBe(1);
    // Midnight Pacific: the overlay is wiped and Lakeside is empty again.
    await resolveWorkspace(db, req("alex"), nextMidnight(NOW) + 1, true, false);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("properties")}`, `${id}.lakeside`)).toBe(0);
  });
});

describe("Lakeside never sees Summit", () => {
  it("lists, searches and counts nothing of Summit's, whatever the role's scope", async () => {
    const alex = await ctx("alex");
    expect(alex.actor.propertyIds).toBe("all");
    for (const e of ["properties", "units", "residents", "leases", "charges", "payments", "owners", "owner_entities", "vendors", "message_threads", "tasks", "regions", "staff"]) {
      const r = await list(alex, e, { size: 25 });
      expect(r.rows.filter((x) => !["r-lk-all", "alex"].includes(String(x.id))), e).toEqual([]);
    }
    expect((await list(alex, "properties", { q: "Riverside" })).total).toBe(0);
    // Summit's list totals are cached for the same role and scope; Lakeside must not get them.
    expect((await list(await ctx("daniel"), "properties")).total).toBe(6);
    expect((await list(alex, "properties")).total).toBe(0);
  });

  it("reads shared reference data, but only the org-default policies", async () => {
    const alex = await ctx("alex");
    expect(await n(`SELECT count(*) AS n FROM ${effective("gl_accounts", LK)}`)).toBe(1);
    expect(await n(`SELECT count(*) AS n FROM ${effective("approval_policies", LK)}`)).toBe(1);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("approval_policies")}`, LK)).toBe(1);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("approval_policies")}`, WS)).toBe(2);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("properties")}`, LK)).toBe(0);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("properties")}`, "~.lakeside")).toBe(0);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("orgs")}`, LK)).toBe(1);
    expect(orgId(alex)).toBe("org-lakeside");
    expect(orgId(await ctx("daniel"))).toBe("org-summit");
  });

  it("gets no metrics, inbox items or Summit figures", async () => {
    const alex = await ctx("alex");
    const summit = await metrics(await ctx("daniel"), "portfolio.noi", { month: "2026-10", months: 2 });
    expect(summit.points?.length).toBeGreaterThan(0);
    const lake = await metrics(alex, "portfolio.noi", { month: "2026-10", months: 2 });
    expect(lake.points ?? []).toEqual([]);
    expect(await inboxCounts(alex)).toMatchObject({ messages: 0, approvals: 0, alerts: 0, needsYou: 0 });
    expect(await companyState(alex)).toBe("empty");
    expect(await companyState(await ctx("daniel"))).toBeNull();
  });
});

describe("Summit never sees Lakeside", () => {
  it("doesn't list, count or search a Lakeside import made by the same visitor", async () => {
    const alex = await ctx("alex");
    const p = await plan(alex, payloadOf(OWNERS, PROPS, ROLL), { tool: "appfolio", reports: ["Rent Roll"], files: ["a.csv", "b.csv", "c.csv"] });
    expect(p.rows.properties.map((r) => r.org_id)).toEqual(["org-lakeside"]);
    expect(p.rows.properties.map((r) => r.region_id)).toEqual(["r-lk-all"]);
    const done = await commit(alex, payloadOf(OWNERS, PROPS, ROLL), { tool: "appfolio", reports: ["Rent Roll"], files: ["a.csv", "b.csv", "c.csv"] });
    expect(done.created.properties).toBe(1);
    expect((await list(alex, "properties")).rows.map((r) => r.name)).toEqual(["Lakeview Flats"]);

    const daniel = await ctx("daniel");
    for (const e of ["properties", "units", "residents", "leases", "owners", "owner_entities"]) {
      const r = await list(daniel, e, { size: 100 });
      expect(r.rows.some((x) => String(x.id).includes(`-i${done.batch}-`)), e).toBe(false);
    }
    expect((await list(daniel, "properties", { q: "Lakeview" })).total).toBe(0);
    expect(await n(`SELECT count(*) AS n FROM ${paramEffective("properties")}`, WS)).toBe(6);

    // Undo works inside Lakeside and leaves it empty.
    await undo(alex, done.batch);
    expect((await list(alex, "properties")).total).toBe(0);
  });
});

describe("the invited property manager", () => {
  it("sees nothing until the principal's invite in Lakeside names her properties", async () => {
    const maya = await ctx("maya");
    expect(maya.actor.propertyIds).toEqual([]);
    expect(await companyState(maya)).toBe("empty");
    const add = (ws: string, ids: string[]) => db.batch([
      db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email, active) VALUES (?, 's-maya', 'org-lakeside', 'Maya Chen', 'Property manager', 'maya@propniti.demo', 0)").bind(ws),
      ...ids.map((p) => db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES (?, ?, 's-maya', 'property_manager', 'property', ?)").bind(ws, `ra-${p}`, p)),
    ]);
    // An invite with her email in Summit's overlay grants nothing in Lakeside.
    await add(WS, ["p01"]);
    expect((await ctx("maya")).actor.propertyIds).toEqual([]);
    await add(LK, ["p-lk-1", "p-lk-2"]);
    expect((await ctx("maya")).actor.propertyIds).toEqual(["p-lk-1", "p-lk-2"]);
    // Neither id exists yet: still nothing to show.
    expect(await companyState(await ctx("maya"))).toBe("empty");
  });

  it("is only notified about approvals inside her own org", () => {
    const alex = getPersona("alex")!;
    expect(PERSONAS.filter((p) => !p.portal && sameOrg(p, alex)).map((p) => p.id)).toEqual(["alex", "maya"]);
    expect(sameOrg(getPersona("daniel")!, getPersona("nadia")!)).toBe(true);
  });
});

describe("platform admin", () => {
  it("sees both orgs in the customer list", async () => {
    const r = await list(await ctx("nadia"), "orgs", { size: 25 });
    expect(r.rows.map((x) => x.id).sort()).toEqual(["org-lakeside", "org-summit"]);
  });
});
