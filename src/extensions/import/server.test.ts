import { beforeEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { emptyDb, OTHER, seed, WS } from "@/server/query.fixture";
import type { WriteCtx } from "@/server/query";
import { assemble, type ImportFile, type Payload } from "./assemble";
import { detect } from "./mapping";
import { parseDelimited, toSheet } from "./parse";
import { TABLES } from "@/server/effective";
import { REF_COLUMNS } from "./refs";
import { CHUNK_BYTES, commit, ImportRequest, insertStatements, plan, recentImports, undo, type ImportOptions } from "./server";

let db: Db;
const NOW = Date.parse("2026-11-04T18:00:00Z");
const ctx = async (persona: string, ws = WS): Promise<WriteCtx> => ({ db, ws, actor: await actorFor(db, ws, getPersona(persona)!), nowMs: NOW });
const OPTS: ImportOptions = { tool: "appfolio", reports: ["Rent Roll"], files: ["roll.csv"], portfolioId: "pf1" };

const payloadOf = (...texts: string[]): Payload => {
  const files: ImportFile[] = texts.map((t, i) => {
    const sheet = toSheet(parseDelimited(t));
    const d = detect(sheet.headers);
    return { id: `f${i}`, name: `f${i}.csv`, kind: d.kind, sheet, mapping: d.mapping, excluded: [] };
  });
  const a = assemble(files, [], "2026-11-04");
  expect(a.issues.filter((x) => x.severity === "error")).toEqual([]);
  return a.payload;
};
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

// A new Texas property with three units (one vacant) plus a unit at existing p01 "The Lofts at Riverside".
const ROLL = `Property,Property Address,Unit,Tenant,Email,Rent,Deposit,Lease From,Lease To,Past Due
Pecan Grove,"800 Pecan St, Austin, TX 78702",1,"Lopez, Ana",ana@example.com,"$1,200.00",600,2026-01-01,2026-12-31,250
Pecan Grove,"800 Pecan St, Austin, TX 78702",2,Bo Kim & Cy Kim,bo@example.com,1250,,2026-03-01,2027-02-28,
Pecan Grove,"800 Pecan St, Austin, TX 78702",3,VACANT,,1300,,,,
The Lofts at Riverside,"1 Main St, Austin, TX 78701",104,Dee Ford,dee@example.com,1500,,2026-05-01,2027-04-30,`;

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch([
    "INSERT INTO regions (workspace_id, id, org_id, name, states) VALUES ('base', 'r-tx', 'org1', 'Texas', '[\"TX\"]'), ('base', 'r-se', 'org1', 'Southeast', '[\"GA\"]')",
    "INSERT INTO portfolios (workspace_id, id, org_id, owner_entity_id, name) VALUES ('base', 'pf1', 'org1', 'oe01', 'Bluebonnet portfolio')",
    "INSERT INTO bank_accounts (workspace_id, id, owner_entity_id, name, kind, bank, last4, gl_account_id) VALUES ('base', 'ba-oe01-dep', 'oe01', 'Deposits', 'Deposit', 'Frost', '1234', 'gl-1020')",
  ].map((s) => db.prepare(s)));
});

describe("plan (preview)", () => {
  it("counts new and already-on-file records without writing", async () => {
    const p = await plan(await ctx("daniel"), payloadOf(ROLL), OPTS);
    expect(p.summary.properties).toEqual({ new: 1, existing: 1, skipped: 0 });
    expect(p.summary.units).toEqual({ new: 4, existing: 0, skipped: 0 });
    expect(p.summary.leases.new).toBe(3);
    expect(p.summary.residents.new).toBe(4); // Ana, Bo, Cy, Dee
    expect(p.summary.deposits.new).toBe(1);
    expect(p.summary.charges.new).toBe(1); // Ana's past due, as a 0–30 day opening balance
    expect(p.samples.properties[0]).toEqual({ label: "Pecan Grove", detail: "800 Pecan St, Austin, TX 78702" });
    expect(p.matched).toContainEqual({ type: "properties", label: "The Lofts at Riverside", href: "/app/properties/p01" });
    expect(await count("SELECT count(*) AS n FROM units WHERE workspace_id = ?", WS)).toBe(0);
  });

  it("matches existing units, and refuses a second current lease on an occupied unit", async () => {
    const p = await plan(await ctx("daniel"), payloadOf(`Property,Unit,Tenant,Rent,Lease From,Lease To\nThe Lofts at Riverside,101,New Person,1500,2026-06-01,2027-05-31\nThe Lofts at Riverside,103,Eve Moss,1450,2026-06-01,2027-05-31`), OPTS);
    expect(p.summary.units).toEqual({ new: 0, existing: 2, skipped: 0 });
    expect(p.summary.leases).toEqual({ new: 1, existing: 0, skipped: 1 });
    expect(p.skipped[0]).toMatchObject({ type: "leases", reason: "The unit already has a current lease on file" });
  });
});

describe("commit", () => {
  it("writes everything into the visitor's overlay in one batch, with an audit row and an event", async () => {
    const c = await ctx("daniel");
    const r = await commit(c, payloadOf(ROLL), OPTS);
    expect(r.created).toEqual({ properties: 1, units: 4, households: 3, residents: 4, leases: 3, deposits: 1, charges: 1 });
    expect(r.links.properties![0]).toEqual({ label: "Pecan Grove", href: `/app/properties/pro-i${r.batch}-1` });
    expect(await count("SELECT count(*) AS n FROM properties WHERE workspace_id = 'base'")).toBe(6);
    expect(await count("SELECT count(*) AS n FROM properties WHERE workspace_id = ? AND id LIKE ?", WS, `pro-i${r.batch}-%`)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM units WHERE workspace_id = ?", OTHER)).toBe(0);
    const prop = await db.prepare("SELECT * FROM properties WHERE workspace_id = ? AND name = 'Pecan Grove'").bind(WS).first<Record<string, unknown>>();
    expect(prop).toMatchObject({ region_id: "r-tx", portfolio_id: "pf1", owner_entity_id: "oe01", metro: "Austin", street: "800 Pecan St", zip: "78702", unit_count: 3 });
    const lease = await db.prepare("SELECT * FROM leases WHERE workspace_id = ? AND rent_cents = 120000").bind(WS).first<Record<string, unknown>>();
    expect(lease).toMatchObject({ status: "Active", start_on: "2026-01-01", end_on: "2026-12-31", deposit_cents: 60000, term_months: 12 });
    expect(await db.prepare("SELECT description, due_on, amount_cents, paid_cents FROM charges WHERE workspace_id = ? AND lease_id = ?").bind(WS, lease!.id).first()).toEqual({ description: "Opening balance · 0–30 days (imported)", due_on: "2026-10-20", amount_cents: 25000, paid_cents: 0 });
    expect(await db.prepare("SELECT bank_account_id, amount_cents, status FROM deposits WHERE workspace_id = ?").bind(WS).first()).toEqual({ bank_account_id: "ba-oe01-dep", amount_cents: 60000, status: "Held" });
    const audit = await db.prepare("SELECT actor, role, action, detail FROM audit WHERE workspace_id = ? AND entity_id = ?").bind(WS, r.batch).first();
    expect(audit).toEqual({ actor: "Daniel Reyes", role: "principal", action: "import.completed", detail: "Imported from AppFolio (Rent Roll): 1 property, 4 units, 3 households, 4 residents, 3 leases, 1 deposit, 1 opening-balance charge" });
    expect(await count("SELECT count(*) AS n FROM events WHERE workspace_id = ? AND type = 'import.completed'", WS)).toBe(1);
  });

  it("is idempotent: the same file again creates nothing; a changed file adds only what is new", async () => {
    const c = await ctx("daniel");
    await commit(c, payloadOf(ROLL), OPTS);
    await expect(commit(c, payloadOf(ROLL), OPTS)).rejects.toMatchObject({ status: 409 });
    const again = await plan(c, payloadOf(ROLL), OPTS);
    expect(Object.values(again.summary).reduce((s, x) => s + x.new, 0)).toBe(0);
    expect(again.summary.units.existing).toBe(4);
    const more = await commit(c, payloadOf(`${ROLL}\nPecan Grove,"800 Pecan St, Austin, TX 78702",4,Gil Hart,gil@example.com,1275,,2026-07-01,2027-06-30,`), OPTS);
    expect(more.created).toEqual({ units: 1, households: 1, residents: 1, leases: 1 });
    expect(await count("SELECT count(*) AS n FROM properties WHERE workspace_id = ?", WS)).toBe(1);
  });

  it("double clicks write once: [fulfilled, 409] and one row per record", async () => {
    const c = await ctx("daniel");
    const results = await Promise.allSettled([commit(c, payloadOf(ROLL), OPTS), commit(c, payloadOf(ROLL), OPTS)]);
    expect(results.map((r) => (r.status === "fulfilled" ? 200 : (r.reason as { status: number }).status)).sort()).toEqual([200, 409]);
    expect(await count("SELECT count(*) AS n FROM units WHERE workspace_id = ?", WS)).toBe(4);
    expect(await count("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'import.completed'", WS)).toBe(1);
  });
});

describe("undo", () => {
  it("removes exactly the batch's rows, once, and the same file can be imported again", async () => {
    const c = await ctx("daniel");
    const first = await commit(c, payloadOf(`Property,Unit,Tenant,Rent,Lease From,Lease To\nThe Lofts at Riverside,103,Eve Moss,1450,2026-06-01,2027-05-31`), OPTS);
    const r = await commit(c, payloadOf(ROLL), OPTS);
    const out = await undo(c, r.batch);
    expect(out.removed).toEqual(r.created);
    for (const t of ["properties", "units", "households", "residents", "leases", "deposits", "charges"]) expect(await count(`SELECT count(*) AS n FROM ${t} WHERE workspace_id = ? AND id LIKE ?`, WS, `%-i${r.batch}-%`)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM leases WHERE workspace_id = ? AND id LIKE ?", WS, `%-i${first.batch}-%`)).toBe(1);
    await expect(undo(c, r.batch)).rejects.toMatchObject({ status: 409 });
    const again = await commit(c, payloadOf(ROLL), OPTS);
    expect(again.batch).toBe(r.batch);
    expect(again.created.units).toBe(4);
    const recent = await recentImports(db, WS);
    expect(recent.map((x) => [x.batch, x.undone])).toEqual([[r.batch, false], [r.batch, true], [first.batch, false]]);
  });

  it("refuses when later work hangs on the imported records", async () => {
    const c = await ctx("daniel");
    const r = await commit(c, payloadOf(ROLL), OPTS);
    const lease = await db.prepare("SELECT id, household_id, property_id FROM leases WHERE workspace_id = ? LIMIT 1").bind(WS).first<{ id: string; household_id: string; property_id: string }>();
    await db.prepare("INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, method, received_on, amount_cents) VALUES (?, 'pay-x', ?, ?, ?, 'Check', '2026-11-04', 1000)").bind(WS, lease!.id, lease!.household_id, lease!.property_id).run();
    await expect(undo(c, r.batch)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Other records point at records from this import \(payments\)/) });
  });
});

describe("undo safety", () => {
  const VEN = `Vendor Name,Type,Contact,Email,Phone,1099\nDesert Air HVAC,HVAC,Luis Mora,luis@example.com,6025550111,Yes`;

  it("refuses when any record outside the batch points at one inside it", async () => {
    const c = await ctx("daniel");
    const r = await commit(c, payloadOf(ROLL, VEN), OPTS);
    const id = async (t: string) => (await db.prepare(`SELECT id FROM ${t} WHERE workspace_id = ? AND id LIKE ? LIMIT 1`).bind(WS, `%-i${r.batch}-%`).first<{ id: string }>())!.id;
    const [vendor, lease, unit, property] = [await id("vendors"), await id("leases"), await id("units"), await id("properties")];
    const cases: [string, string, unknown[]][] = [
      ["work order for the vendor", "INSERT INTO work_orders (workspace_id, id, property_id, vendor_id, title, category, priority, status, opened_at) VALUES (?, 'wo-x', 'p01', ?, 'Fix', 'HVAC', 'Normal', 'New', '2026-11-04')", [WS, vendor]],
      ["note on the lease", "INSERT INTO notes (workspace_id, id, entity_type, entity_id, author_id, body, created_at) VALUES (?, 'n-x', 'leases', ?, 'daniel', 'hi', '2026-11-04')", [WS, lease]],
      ["unit added by hand at the property", "INSERT INTO units (workspace_id, id, property_id, number) VALUES (?, 'u-hand', ?, '999')", [WS, property]],
      ["lease added by hand on the unit", "INSERT INTO leases (workspace_id, id, property_id, unit_id, household_id, status, start_on, rent_cents) VALUES (?, 'l-hand', 'p01', ?, 'h-x', 'Future', '2027-06-01', 1)", [WS, unit]],
    ];
    for (const [what, sql, binds] of cases) {
      await db.prepare(sql).bind(...binds).run();
      await expect(undo(c, r.batch), what).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Other records point at records from this import/) });
      await db.prepare(sql.match(/INSERT INTO (\w+)/)![1] === "notes" ? "DELETE FROM notes WHERE id = 'n-x'" : `DELETE FROM ${sql.match(/INSERT INTO (\w+)/)![1]} WHERE id IN ('wo-x', 'u-hand', 'l-hand')`).run();
    }
    // Logs (audit, activity, events) don't block: they stay as history.
    await db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, at, actor_kind, actor_id, verb, summary) VALUES (?, 'a-x', 'leases', ?, '2026-11-04', 'staff', 'daniel', 'updated', 'x')").bind(WS, lease).run();
    expect((await undo(c, r.batch)).removed).toEqual(r.created);
  });

  it("refuses a person whose scope doesn't cover every property in the batch", async () => {
    const units = `Property,Unit,Sqft,Market Rent,Status\nThe Lofts at Riverside,201,700,1400,Vacant\nDeep Ellum Lofts,201,700,1400,Vacant`;
    const r = await commit(await ctx("daniel"), payloadOf(units), OPTS);
    await expect(undo(await ctx("marcus"), r.batch)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/outside your scope/) });
    expect((await undo(await ctx("daniel"), r.batch)).removed).toEqual({ units: 2 });
  });

  it("the foreign-key list covers every id column in the schema", async () => {
    const cols = (await db.prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p WHERE m.type = 'table' ORDER BY m.name, p.cid").all<{ t: string; c: string }>()).results;
    const derived: Record<string, string[]> = {};
    for (const { t, c } of cols) if (TABLES.includes(t as never) && (/_id$/.test(c) && c !== "workspace_id" || c === "renewal_of" || c === "ref")) (derived[t] ??= []).push(c);
    expect(REF_COLUMNS).toEqual(derived);
  });
});

describe("request schema", () => {
  const base = { properties: [], units: [], residents: [], leases: [], owners: [], vendors: [], balances: [], recurring: [] };
  const src = { file: "f", line: 2 };
  it("refuses unknown unit statuses and property types, and leases that end before they start", () => {
    const ok = (payload: object, options: object = OPTS) => ImportRequest.safeParse({ mode: "preview", payload: { ...base, ...payload }, options }).success;
    expect(ok({ units: [{ property: "a", number: "1", status: "Vacant", src }] })).toBe(true);
    expect(ok({ units: [{ property: "a", number: "1", status: "Haunted", src }] })).toBe(false);
    expect(ok({ properties: [{ key: "a", name: "A", street: "", city: "", state: "", zip: "", type: "Castle", src }] })).toBe(false);
    expect(ok({}, { ...OPTS, propertyType: "Castle" })).toBe(false);
    const lease = { property: "a", unit: "1", people: [{ first: "A", last: "B" }], start: "2026-05-01", rent: 1, status: "Active", src };
    expect(ok({ leases: [{ ...lease, end: "2027-04-30" }] })).toBe(true);
    expect(ok({ leases: [{ ...lease, end: "2026-04-30" }] })).toBe(false);
    expect(ok({ recurring: [{ property: "a", unit: "1", label: "Pet", amount: 5, frequency: "Monthly", start: "2026-05-01", end: "2026-01-01", src }] })).toBe(false);
  });
});

describe("permissions and scope", () => {
  it("a property manager adds units in scope but not new properties or out-of-scope ones", async () => {
    const p = await plan(await ctx("marcus"), payloadOf(`${ROLL}\nInman Park Flats,"1 Main St, Atlanta, GA 30307",9,Hal Ito,hal@example.com,1300,,2026-01-01,2026-12-31,`), OPTS);
    expect(p.summary.properties).toEqual({ new: 0, existing: 1, skipped: 2 });
    expect(p.skipped.filter((s) => s.type === "properties").map((s) => s.reason)).toEqual(["New properties need a principal or regional manager", "Already on file, but outside your scope"]);
    expect(p.summary.units).toEqual({ new: 1, existing: 0, skipped: 4 });
    expect(p.summary.leases.new).toBe(1);
  });

  it("a regional manager can't create a property outside their region; a leasing agent can't add units", async () => {
    const ga = `Property,Property Address,Unit,Tenant,Rent,Lease From,Lease To\nPeach Row,"5 Peach St, Atlanta, GA 30307",1,Al Bo,900,2026-01-01,2026-12-31`;
    const p = await plan(await ctx("priya"), payloadOf(ga), OPTS);
    expect(p.skipped[0]).toMatchObject({ type: "properties", reason: "Its region is outside your scope" });
    const lena = await plan(await ctx("lena"), payloadOf(`Property,Unit,Sqft,Market Rent,Status\nThe Lofts at Riverside,201,700,1400,Vacant`), OPTS);
    expect(lena.summary.units).toEqual({ new: 0, existing: 0, skipped: 1 });
    expect(lena.skipped[0]!.reason).toBe("Your role can't add units");
  });

  it("opening balances go only on leases this import creates, never on a ledger already on file", async () => {
    const grace = await ctx("grace");
    const p = await plan(grace, payloadOf(`Property,Unit,Tenant,0-30,31-60,61-90,90+,Total\nThe Lofts at Riverside,102,Res,100,50,0,0,150`), { ...OPTS, reports: ["Aged Receivables Detail"] });
    expect(p.summary.charges).toEqual({ new: 0, existing: 0, skipped: 1 });
    expect(p.skipped[0]).toMatchObject({ type: "charges", reason: "Already on file — its balance comes from its ledger" });
    await expect(commit(grace, payloadOf(`Property,Unit,Tenant,0-30,31-60,61-90,90+,Total\nThe Lofts at Riverside,102,Res,100,50,0,0,150`), OPTS)).rejects.toMatchObject({ status: 409 });
    expect(await count("SELECT count(*) AS n FROM charges WHERE workspace_id = ?", WS)).toBe(0);
    // With the rent roll in the same import, the new lease gets the aging buckets.
    const roll = `Property,Unit,Tenant,Rent,Lease From,Lease To\nThe Lofts at Riverside,104,Dee Ford,1500,2026-05-01,2027-04-30`;
    const aging = `Property,Unit,Tenant,0-30,31-60,61-90,90+,Total\nThe Lofts at Riverside,104,Dee Ford,100,50,0,0,150`;
    const r = await commit(await ctx("daniel"), payloadOf(roll, aging), OPTS);
    expect(r.created.charges).toBe(2);
    expect((await db.prepare("SELECT due_on, amount_cents FROM charges WHERE workspace_id = ? ORDER BY due_on").bind(WS).all()).results).toEqual([{ due_on: "2026-09-20", amount_cents: 5000 }, { due_on: "2026-10-20", amount_cents: 10000 }]);
  });

  it("field rules drop what a role can't set", async () => {
    const marcus = await plan(await ctx("marcus"), payloadOf(`Vendor Name,Type,Contact,Email,Phone,1099,Tax ID\nDesert Air HVAC,HVAC,Luis Mora,luis@example.com,6025550111,Yes,12-3456789`), OPTS);
    expect(marcus.rows.vendors[0]).not.toHaveProperty("tin_last4");
    expect(marcus.rows.vendors[0]).not.toHaveProperty("is_1099");
    expect(marcus.notes.some((n) => /^Vendors: .* is set by another role/.test(n))).toBe(true);
  });

  it("owners with entities get a portfolio, and properties naming that owner land in it", async () => {
    const c = await ctx("daniel");
    const owners = `Name,Company Name,Emails,Phone Numbers,Address,Tax ID,Management Fee\nNora Vale,Vale Family Holdings LLC,nora@example.com,5125550199,"9 Elm St, Austin, TX 78704",12-3456789,7%`;
    const props = `Property,Property Address,Property City,Property State,Property Zip,Units,Owners\nElm Court,9 Elm St,Austin,TX,78704,12,Vale Family Holdings LLC`;
    const r = await commit(c, payloadOf(owners, props), OPTS);
    expect(r.created).toEqual({ owners: 1, owner_entities: 1, portfolios: 1, properties: 1 });
    const entity = await db.prepare("SELECT id, ein_last4, mgmt_fee_pct, state FROM owner_entities WHERE workspace_id = ?").bind(WS).first<{ id: string }>();
    expect(entity).toMatchObject({ ein_last4: "6789", mgmt_fee_pct: 0.07, state: "TX" });
    expect(await db.prepare("SELECT owner_entity_id, unit_count FROM properties WHERE workspace_id = ?").bind(WS).first()).toEqual({ owner_entity_id: entity!.id, unit_count: 12 });
  });
});

describe("D1 limits", () => {
  it("packs rows as JSON: two bound values per statement, each statement under 100 KB", async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: `uni-i0000000000-${i}`, property_id: "p01", number: `X${i}`, sqft: 700, market_rent_cents: 140000, status: "Vacant", available_on: null }));
    const stmts = insertStatements(db, WS, "units", rows);
    expect(stmts.length).toBeGreaterThan(1);
    expect(stmts.length).toBeLessThan(10);
    await db.batch(stmts);
    expect(await count("SELECT count(*) AS n FROM units WHERE workspace_id = ?", WS)).toBe(3000);
    expect(CHUNK_BYTES).toBeLessThan(100_000);
  });

  it("imports a 2,000-row rent roll in one batch", async () => {
    const lines = ["Property,Property Address,Unit,Tenant,Rent,Lease From,Lease To"];
    for (let i = 0; i < 2000; i++) lines.push(`Big Oak ${Math.floor(i / 400)},"${100 + Math.floor(i / 400)} Oak St, Austin, TX 78702",${1000 + i},Person ${i} Test,${1200 + (i % 50)},2026-01-01,2026-12-31`);
    const r = await commit(await ctx("daniel"), payloadOf(lines.join("\n")), OPTS);
    expect(r.created).toMatchObject({ properties: 5, units: 2000, leases: 2000, residents: 2000 });
  });
});
