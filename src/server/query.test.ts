import { beforeEach, describe, expect, it } from "vitest";
import { allEntities, can } from "@/entities";
import { getPersona } from "@/auth/personas";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { actorFor, permissionMatrix } from "./permissions";
import { createRecord, deleteRecord, effective, exportCsv, getRow, list, metrics, parseListQuery, QueryError, relations, updateRecord, writeSchema, type QueryCtx, type WriteCtx } from "./query";

// Fixture: 6 properties across 3 regions, 3 units each, one lease per occupied unit, a few
// charges and payments, and two months of metrics_monthly. All rows are base rows.
const WS = "visitor-workspace-000000001";
const OTHER = "visitor-workspace-000000002";

function seed(db: Db) {
  const props = [
    ["p01", "The Lofts at Riverside", "Austin", "TX", "r-tx"], ["p02", "Barton Creek Commons", "Austin", "TX", "r-tx"], ["p03", "Mueller Park Residences", "Austin", "TX", "r-tx"],
    ["p04", "Deep Ellum Lofts", "Dallas", "TX", "r-tx"], ["p05", "Inman Park Flats", "Atlanta", "GA", "r-se"], ["p06", "Camelback Terrace", "Phoenix", "AZ", "r-sw"],
  ];
  const sql: string[] = [
    "INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('" + WS + "', 'demo', 0, 0), ('" + OTHER + "', 'demo', 0, 0)",
    "INSERT INTO meta (key, value) VALUES ('as_of', '2026-10-28')",
    "INSERT INTO owners (workspace_id, id, name) VALUES ('base', 'ow01', 'Helen Carter')",
    "INSERT INTO owner_entities (workspace_id, id, org_id, owner_id, name, state) VALUES ('base', 'oe01', 'org1', 'ow01', 'Bluebonnet Residential Fund II, LLC', 'TX'), ('base', 'oe02', 'org1', 'ow02', 'Peach State Holdings, LLC', 'GA')",
  ];
  for (const [id, name, metro, state, region] of props) {
    sql.push(`INSERT INTO properties (workspace_id, id, org_id, region_id, portfolio_id, owner_entity_id, name, type, metro, street, city, state, zip, photos) VALUES ('base', '${id}', 'org1', '${region}', 'pf1', '${state === "TX" ? "oe01" : "oe02"}', '${name}', 'Garden multifamily', '${metro}', '1 Main St', '${metro}', '${state}', '78701', '["/img/props/${id}.webp"]')`);
    for (let n = 1; n <= 3; n++) {
      const unit = `${id}-u${n}`;
      const occupied = n < 3;
      sql.push(`INSERT INTO units (workspace_id, id, property_id, number, sqft, market_rent_cents, status) VALUES ('base', '${unit}', '${id}', '10${n}', 800, 150000, '${occupied ? "Occupied" : "Vacant"}')`);
      if (occupied) {
        sql.push(`INSERT INTO households (workspace_id, id, property_id, name) VALUES ('base', 'h-${unit}', '${id}', 'Household ${unit}')`);
        sql.push(`INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-${unit}', 'h-${unit}', '${id}', 'Res', '${unit}', 'r@x.example')`);
        sql.push(`INSERT INTO leases (workspace_id, id, property_id, unit_id, household_id, status, start_on, end_on, rent_cents) VALUES ('base', 'l-${unit}', '${id}', '${unit}', 'h-${unit}', 'Active', '2026-01-01', '2026-12-31', 145000)`);
        sql.push(`INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents) VALUES ('base', 'c-${unit}', 'l-${unit}', 'h-${unit}', '${id}', '${unit}', 'gl-4000', 'Rent', '2026-10', '2026-10-01', 145000)`);
        if (n === 1) sql.push(`INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, method, received_on, amount_cents) VALUES ('base', 'pay-${unit}', 'l-${unit}', 'h-${unit}', '${id}', 'c-${unit}', 'ACH', '2026-10-02', 145000)`);
      }
    }
    for (const month of ["2026-09", "2026-10"]) {
      sql.push(`INSERT INTO metrics_monthly (workspace_id, property_id, month, units, occupied, gpr_cents, charged_cents, collected_cents, occupancy_phys, occupancy_econ, opex_cents, noi_cents, aging_0_30_cents) VALUES ('base', '${id}', '${month}', 3, ${month === "2026-10" ? 2 : 3}, 450000, 290000, 145000, 0.66, 0.6, 50000, 95000, 145000)`);
    }
  }
  return db.batch(sql.map((s) => db.prepare(s)));
}

let db: Db;
const actor = async (personaId: string, ws: string | null = null) => actorFor(db, ws, getPersona(personaId)!);
const ctx = async (personaId: string, ws: string | null = null): Promise<QueryCtx> => ({ db, ws, actor: await actor(personaId, ws) });
const wctx = async (personaId: string, ws = WS): Promise<WriteCtx> => ({ db, ws, actor: await actor(personaId, ws), nowMs: Date.parse("2026-10-28T15:00:00Z") });

beforeEach(async () => {
  db = openSqlite(":memory:");
  await seed(db);
});

describe("whitelist", () => {
  it("rejects identifiers that are not fields of the def", async () => {
    const c = await ctx("daniel");
    await expect(list(c, "properties", { filters: { "name; DROP TABLE properties": "x" } })).rejects.toMatchObject({ status: 400 });
    await expect(list(c, "properties", { sort: ["name desc, (SELECT 1)", "asc"] })).rejects.toMatchObject({ status: 400 });
    await expect(list(c, "properties", { filters: { "metro.like": "A%" } })).rejects.toMatchObject({ status: 400 });
    await expect(list(c, "properties", { filters: { photos: "x" } })).rejects.toMatchObject({ status: 400 });
    await expect(list(c, "nope", {})).rejects.toMatchObject({ status: 404 });
  });

  it("binds values, so quotes and wildcards in search are literal", async () => {
    const c = await ctx("daniel");
    expect((await list(c, "properties", { q: "' OR 1=1 --" })).total).toBe(0);
    expect((await list(c, "properties", { q: "%" })).total).toBe(0);
    expect((await list(c, "properties", { q: "lofts" })).rows.map((r) => r.id).sort()).toEqual(["p01", "p04"]);
  });

  it("refuses a workspace id that isn't a cookie id when expanding effective()", () => {
    expect(effective("units", "x'); DROP TABLE units; --")).not.toContain("DROP");
    expect(() => effective("units; DROP", WS)).toThrow();
  });

  it("only hidden-for-role fields disappear from rows and filters", async () => {
    const leasing = await ctx("lena");
    const r = (await list(leasing, "residents", { size: 1 })).rows[0];
    expect(r).not.toHaveProperty("balance");
    await expect(list(leasing, "residents", { filters: { "balance.min": "1" } })).rejects.toMatchObject({ status: 400 });
    expect((await list(await ctx("marcus"), "residents", { size: 1 })).rows[0]).toHaveProperty("balance");
  });
});

describe("scope", () => {
  it("limits a property-scoped persona to its properties on lists, records and relations", async () => {
    const marcus = await ctx("marcus"); // p01–p03
    const res = await list(marcus, "properties", {});
    expect(res.total).toBe(3);
    expect(res.rows.map((r) => r.id)).toEqual(["p02", "p03", "p01"]); // by name: Barton, Mueller, The Lofts
    expect(await getRow(marcus, "properties", "p05")).toBeNull();
    expect((await list(marcus, "units", {})).total).toBe(9);
    expect((await list(marcus, "charges", {})).total).toBe(6);
  });

  it("resolves a region scope to that region's properties", async () => {
    const priya = await actor("priya");
    expect(priya.propertyIds).toEqual(["p01", "p02", "p03", "p04"]);
    expect((await list({ db, ws: null, actor: priya }, "properties", {})).total).toBe(4);
  });

  it("gives org scope every property, and an owner only their entities' properties", async () => {
    expect((await actor("daniel")).propertyIds).toBe("all");
    const owner = await actor("owner");
    expect(owner.propertyIds).toEqual(["p01", "p02", "p03", "p04"]);
  });

  it("shows a resident only their own household's rows", async () => {
    const r = await ctx("resident");
    // The persona's record id is res-p01-0001, which the fixture doesn't have: nothing leaks.
    expect((await list(r, "charges", {})).total).toBe(0);
    await db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'h-p01-u1', 'p01', 'Jordan', 'Lee', 'j@x.example')").run();
    const r2 = await ctx("resident");
    expect((await list(r2, "charges", {})).rows.map((c) => c.id)).toEqual(["c-p01-u1"]);
  });

  it("denies entities the role can't read", async () => {
    await expect(list(await ctx("lena"), "charges", {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("pagination", () => {
  it("returns the total under the same filters and caps page size at 100", async () => {
    const c = await ctx("daniel");
    const p1 = await list(c, "units", { size: 5, page: 1, sort: ["number", "asc"] });
    expect(p1.total).toBe(18);
    expect(p1.rows).toHaveLength(5);
    const p4 = await list(c, "units", { size: 5, page: 4, sort: ["number", "asc"] });
    expect(p4.rows).toHaveLength(3);
    expect((await list(c, "units", { size: 1000 })).size).toBe(100);
    const vacant = await list(c, "units", { filters: { status: "Vacant" }, size: 2 });
    expect(vacant.total).toBe(6);
    expect(vacant.counts).toMatchObject({ Vacant: 6, Occupied: 12 });
  });

  it("walks every row exactly once with keyset cursors, in the same order as offsets", async () => {
    const c = await ctx("daniel");
    const offset = (await list(c, "units", { size: 100, sort: ["market_rent", "desc"] })).rows.map((r) => r.id);
    const seen: unknown[] = [];
    let cursor: string | undefined;
    do {
      const res = await list(c, "units", { size: 4, sort: ["market_rent", "desc"], cursor });
      seen.push(...res.rows.map((r) => r.id));
      cursor = res.nextCursor;
    } while (cursor);
    expect(seen).toEqual(offset);
    expect(new Set(seen).size).toBe(18);
  });

  it("keyset-pages across NULL sort values", async () => {
    const c = await ctx("daniel");
    for (const dir of ["asc", "desc"] as const) {
      const all = (await list(c, "units", { size: 100, sort: ["lease_end", dir] })).rows.map((r) => r.id);
      const seen: unknown[] = [];
      let cursor: string | undefined;
      do {
        const res = await list(c, "units", { size: 5, sort: ["lease_end", dir], cursor });
        seen.push(...res.rows.map((r) => r.id));
        cursor = res.nextCursor;
      } while (cursor);
      expect(seen, dir).toEqual(all);
    }
  });

  it("parses the URL encoding the pages and API share", () => {
    const q = parseListQuery(new URLSearchParams("q=loft&f.metro=Austin,Dallas&f.occupancy.max=0.9&sort=-noi_month&page=2&size=25"));
    expect(q).toMatchObject({ q: "loft", filters: { metro: ["Austin", "Dallas"], "occupancy.max": "0.9" }, sort: ["noi_month", "desc"], page: 2, size: 25 });
  });

  it("filters with IN lists through json_each and ranges on computed fields", async () => {
    const c = await ctx("daniel");
    expect((await list(c, "properties", { filters: { metro: ["Austin", "Dallas"] } })).total).toBe(4);
    expect((await list(c, "properties", { filters: { "occupancy.max": "0.7" } })).total).toBe(6);
    expect((await list(c, "charges", { filters: { status: "Overdue" } })).total).toBe(6);
  });
});

describe("rows", () => {
  it("returns money in dollars, ref labels, computed columns and the thumbnail", async () => {
    const row = (await getRow(await ctx("daniel"), "properties", "p01"))!;
    expect(row).toMatchObject({ id: "p01", units: 3, noi_month: 950, delinquent: 1450, _image: "/img/props/p01-400.webp" });
    expect(row.occupancy).toBeCloseTo(2 / 3);
    const unit = (await getRow(await ctx("daniel"), "units", "p01-u1"))!;
    expect(unit).toMatchObject({ market_rent: 1500, rent: 1450, property_id: "p01", property_id__label: "The Lofts at Riverside", label: "The Lofts at Riverside #101" });
  });

  it("derives charge status from payments", async () => {
    const c = await ctx("daniel");
    expect((await getRow(c, "charges", "c-p01-u1"))!.status).toBe("Paid");
    expect((await getRow(c, "charges", "c-p01-u2"))!).toMatchObject({ status: "Overdue", balance: 1450, aging: "0-30" });
  });

  it("expands one and many relations, including remote=local keys", async () => {
    const c = await ctx("daniel");
    const def = allEntities().find((d) => d.key === "residents")!;
    const res = (await getRow(c, "residents", "res-p01-u1"))!;
    const rel = await relations(c, def, res);
    expect(rel.property.rows[0].id).toBe("p01");
    expect(rel.leases.rows.map((r) => r.id)).toEqual(["l-p01-u1"]);
    expect(rel.charges.total).toBe(1);
  });

  it("exports CSV with labels and guards against formula injection", async () => {
    await db.prepare("UPDATE properties SET name = '=HYPERLINK(\"x\")' WHERE id = 'p06'").run();
    const csv = await exportCsv(await ctx("daniel"), "properties", {});
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Property");
    expect(lines).toHaveLength(7);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe("writes", () => {
  it("refuses generic writes to actions-only entities with 405", async () => {
    const c = await wctx("grace");
    await expect(createRecord(c, "charges", { description: "x" })).rejects.toMatchObject({ status: 405 });
    await expect(updateRecord(c, "payments", "pay-p01-u1", { reference: "x" })).rejects.toMatchObject({ status: 405 });
    await expect(deleteRecord(c, "charges", "c-p01-u1")).rejects.toMatchObject({ status: 405 });
  });

  it("validates bodies from field defs: types, enums, unknown and non-editable fields", () => {
    const pm = writeSchema(allEntities().find((d) => d.key === "properties")!, "property_manager", "update");
    expect(pm.safeParse({ name: "New name" }).success).toBe(true);
    expect(pm.safeParse({ status: "Stabilized" }).success).toBe(false); // leaders only
    expect(pm.safeParse({ occupancy: 1 }).success).toBe(false);        // computed
    expect(pm.safeParse({ nope: 1 }).success).toBe(false);
    const units = writeSchema(allEntities().find((d) => d.key === "units")!, "property_manager", "create");
    expect(units.safeParse({ number: "101", property_id: "p01", status: "Sold" }).success).toBe(false);
    expect(units.safeParse({ number: "101", property_id: "p01", market_rent: "abc" }).success).toBe(false);
    expect(units.safeParse({ number: "101", property_id: "p01", market_rent: 1725.5 }).success).toBe(true);
    expect(units.safeParse({ property_id: "p01" }).success).toBe(false); // number is required
  });

  it("copies a base row into the overlay on update and never touches base", async () => {
    const c = await wctx("marcus");
    const row = await updateRecord(c, "units", "p01-u3", { market_rent: 1725.5, status: "Make-ready" });
    expect(row).toMatchObject({ market_rent: 1725.5, status: "Make-ready" });
    const base = await db.prepare("SELECT market_rent_cents, status FROM units WHERE workspace_id = 'base' AND id = 'p01-u3'").first();
    expect(base).toEqual({ market_rent_cents: 150000, status: "Vacant" });
    expect((await getRow(await ctx("marcus", OTHER), "units", "p01-u3"))!.market_rent).toBe(1500);
    expect((await getRow(await ctx("marcus", null), "units", "p01-u3"))!.market_rent).toBe(1500);
    // Second edit updates the same overlay row.
    await updateRecord(c, "units", "p01-u3", { market_rent: 1800 });
    expect((await db.prepare("SELECT count(*) AS n FROM units WHERE id = 'p01-u3'").first())!.n).toBe(2);
    const audit = await db.prepare("SELECT action, before_json, after_json, role FROM audit WHERE entity_id = 'p01-u3' ORDER BY seq").all();
    expect(audit.results[0]).toMatchObject({ action: "units.updated", role: "property_manager" });
    expect(JSON.parse(String(audit.results[0].before_json))).toEqual({ market_rent_cents: 150000, status: "Vacant" });
    expect((await db.prepare("SELECT count(*) AS n FROM events WHERE type = 'units.updated'").first())!.n).toBe(2);
    expect((await db.prepare("SELECT count(*) AS n FROM activity_events WHERE entity_id = 'p01-u3'").first())!.n).toBe(2);
  });

  it("hides a deleted base row with an overlay tombstone, for this visitor only", async () => {
    await deleteRecord(await wctx("daniel"), "properties", "p06");
    expect(await getRow(await ctx("daniel", WS), "properties", "p06")).toBeNull();
    expect((await list(await ctx("daniel", WS), "properties", {})).total).toBe(5);
    expect((await list(await ctx("daniel", OTHER), "properties", {})).total).toBe(6);
    expect((await db.prepare("SELECT deleted FROM properties WHERE workspace_id = 'base' AND id = 'p06'").first())!.deleted).toBe(0);
  });

  it("creates overlay rows, and refuses ones outside the persona's scope", async () => {
    const row = await createRecord(await wctx("marcus"), "units", { number: "999", property_id: "p02", sqft: 700, market_rent: 1400, status: "Vacant" });
    expect(row).toMatchObject({ number: "999", market_rent: 1400, property_id: "p02" });
    expect((await list(await ctx("marcus", WS), "units", { filters: { property_id: "p02" } })).total).toBe(4);
    await expect(createRecord(await wctx("marcus"), "units", { number: "998", property_id: "p05", sqft: 700 })).rejects.toMatchObject({ status: 403 });
    expect((await db.prepare("SELECT count(*) AS n FROM units WHERE number = '998'").first())!.n).toBe(0);
  });

  it("can't update or delete a record outside scope", async () => {
    await expect(updateRecord(await wctx("marcus"), "units", "p05-u1", { sqft: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteRecord(await wctx("priya"), "units", "p05-u1")).rejects.toMatchObject({ status: 404 });
  });

  it("requires the def's create/update/delete role", async () => {
    await expect(createRecord(await wctx("lena"), "properties", { name: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(deleteRecord(await wctx("marcus"), "properties", "p01")).rejects.toBeInstanceOf(QueryError);
  });
});

describe("permissions", () => {
  it("keeps every ledger table actions-only", () => {
    const ledger = new Set(["charges", "payments", "transfers", "owner_distributions", "bank_accounts", "journal_entries"]);
    const defs = allEntities().filter((d) => ledger.has(d.table));
    expect(defs.length).toBeGreaterThanOrEqual(2);
    for (const d of defs) expect(d.writes, d.key).toBe("actions-only");
  });

  it("derives can() from the defs and the module matrix", () => {
    expect(can("property_manager", "read", "properties")).toBe(true);
    expect(can("property_manager", "update", "properties")).toBe(true);
    expect(can("leasing_agent", "update", "properties")).toBe(false); // portfolio is read-only for leasing
    expect(can("admin", "update", "properties")).toBe(false);          // admin reads, doesn't operate
    expect(can("leasing_agent", "read", "charges")).toBe(false);
    expect(can("accountant", "create", "charges")).toBe(false);         // actions-only
    expect(can("maintenance_supervisor", "update", "work_orders")).toBe(true);
  });

  it("generates the role × entity matrix for Settings → Roles", () => {
    const m = permissionMatrix();
    const props = m.find((r) => r.entity === "properties")!;
    expect(props.cells.principal).toMatchObject({ read: true, create: true, update: true, delete: true });
    expect(props.cells.leasing_agent).toMatchObject({ read: true, create: false });
    expect(m.find((r) => r.entity === "charges")!.writes).toBe("actions-only");
  });

  it("every registered def's identifiers and relations are valid", () => {
    for (const d of allEntities()) {
      expect(d.fields[d.titleField], `${d.key}.titleField`).toBeDefined();
      expect(d.fields[d.list.defaultSort[0]] ?? d.list.defaultSort[0] === "id", `${d.key}.defaultSort`).toBeTruthy();
      for (const f of d.detail.facts) expect(d.fields[f], `${d.key}.facts.${f}`).toBeDefined();
      for (const t of d.detail.tabs) if ("fields" in t && t.fields) for (const f of t.fields) expect(d.fields[f], `${d.key}.tab.${f}`).toBeDefined();
      for (const t of d.detail.tabs) if ("relation" in t && t.relation) expect(d.relations.some((r) => r.name === t.relation), `${d.key}.tab.${t.relation}`).toBe(true);
      for (const r of d.detail.related) expect(d.relations.some((x) => x.name === r), `${d.key}.related.${r}`).toBe(true);
      for (const v of d.list.savedViews ?? []) for (const k of Object.keys(v.filters ?? {})) expect(d.fields[k.split(".")[0]], `${d.key}.view.${v.key}.${k}`).toBeDefined();
      if (d.list.statusTabs) expect(d.fields[d.list.statusTabs], `${d.key}.statusTabs`).toBeDefined();
    }
  });

  it("every registered def lists its first page against the real schema", async () => {
    const c = await ctx("daniel");
    for (const d of allEntities()) {
      if (!can("principal", "read", d.key)) continue;
      const res = await list(c, d.key, { size: 2 });
      expect(res.total, d.key).toBeGreaterThanOrEqual(0);
      for (const v of d.list.savedViews ?? []) await list(c, d.key, { filters: v.filters, sort: v.sort, size: 1 });
    }
  });
});

describe("metrics", () => {
  it("reads metrics_monthly within scope with the previous month for deltas", async () => {
    const all = await metrics(await ctx("daniel"), "portfolio.occupancy");
    expect(all.value).toBeCloseTo(12 / 18);
    expect(all.previous).toBe(1);
    expect(all.points.map((p) => p.month)).toEqual(["2026-09", "2026-10"]);
    const marcus = await metrics(await ctx("marcus"), "portfolio.noi");
    expect(marcus.value).toBe(950 * 3);
    await expect(metrics(await ctx("marcus"), "portfolio.noi", { property: "p05" })).rejects.toMatchObject({ status: 403 });
    const byProp = await metrics(await ctx("priya"), "portfolio.by_property");
    expect(byProp.points).toHaveLength(4);
  });

  it("adds the visitor's live payments to the current month", async () => {
    await db.prepare(`INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, method, received_on, amount_cents) VALUES ('${WS}', 'pay-live', 'l-p01-u2', 'h-p01-u2', 'p01', 'c-p01-u2', 'ACH', '2026-10-28', 145000)`).run();
    const before = await metrics(await ctx("marcus", null), "receivables.collections_rate");
    const after = await metrics(await ctx("marcus", WS), "receivables.collections_rate");
    expect(after.points.at(-1)!.collected).toBe(Number(before.points.at(-1)!.collected) + 1450);
  });
});
