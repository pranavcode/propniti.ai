import { beforeEach, describe, expect, it } from "vitest";
import { allEntities, can, getEntity, registerEntity } from "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor, permissionMatrix } from "./permissions";
import { emptyDb, OTHER, seed, WS } from "./query.fixture";
import { createRecord, deleteRecord, effective, exportCsv, getRow, list, matchingIds, metrics, parseListQuery, QueryError, relations, updateRecord, withView, writeSchema, type QueryCtx, type WriteCtx } from "./query";

let db: Db;
const actor = async (personaId: string, ws: string | null = null) => actorFor(db, ws, getPersona(personaId)!);
const ctx = async (personaId: string, ws: string | null = null): Promise<QueryCtx> => ({ db, ws, actor: await actor(personaId, ws) });
const wctx = async (personaId: string, ws = WS): Promise<WriteCtx> => ({ db, ws, actor: await actor(personaId, ws), nowMs: Date.parse("2026-10-28T15:00:00Z") });

beforeEach(async () => {
  db = emptyDb();
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

  it("gives portal users only their own rows, never everything at their property", async () => {
    await db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'h-p01-u1', 'p01', 'Jordan', 'Lee', 'j@x.example')").run();
    // Rows a persona gets from the generic list; an entity its role can't read counts as none.
    const ids = async (c: QueryCtx, e: string) => list(c, e, { size: 100 }).then((r) => r.rows.map((x) => x.id), (err) => (err.status === 403 ? [] : Promise.reject(err)));
    const r = await ctx("resident");
    expect(await ids(r, "charges")).toEqual(["c-p01-u1"]);
    expect((await ids(r, "leases")).every((id) => id === "l-p01-u1")).toBe(true);
    expect(await ids(r, "units")).toEqual([]);
    // Owner: their entities' properties, but not every lease and charge at those properties.
    const o = await ctx("owner");
    expect((await ids(o, "properties")).length).toBe(4);
    expect(await ids(o, "leases")).toEqual([]);
    expect(await ids(o, "charges")).toEqual([]);
  });

  it("shows org-level audit rows to scoped readers with settings access, but not other regions' rows", async () => {
    const at = "2026-10-28T10:00:00Z";
    await db.batch([
      db.prepare(`INSERT INTO audit (workspace_id, id, at, actor, action, property_id, detail) VALUES ('base', 'au-org', '${at}', 'Sam', 'approval_policies.updated', NULL, 'Raised the limit')`),
      db.prepare(`INSERT INTO audit (workspace_id, id, at, actor, action, property_id, detail) VALUES ('base', 'au-tx', '${at}', 'Marcus', 'units.updated', 'p01', 'x')`),
      db.prepare(`INSERT INTO audit (workspace_id, id, at, actor, action, property_id, detail) VALUES ('base', 'au-ga', '${at}', 'Ann', 'units.updated', 'p05', 'x')`),
    ]);
    const ids = async (p: string) => list(await ctx(p), "audit", { size: 100 }).then((r) => r.rows.map((x) => x.id).sort(), (e) => (e.status === 403 ? [] : Promise.reject(e)));
    expect(await ids("priya")).toEqual(["au-org", "au-tx"]);
    expect(await ids("marcus")).not.toContain("au-org"); // no settings access
    expect(await ids("daniel")).toEqual(["au-ga", "au-org", "au-tx"]);
  });

  it("denies entities the role can't read", async () => {
    await expect(list(await ctx("lena"), "charges", {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("overlay fast path", () => {
  it("returns the same lists, totals, tabs and footers whether or not the visitor has overlay rows", async () => {
    const snap = async (wsId: string | null) => {
      const c = await ctx("daniel", wsId);
      const out: unknown[] = [];
      for (const e of ["units", "charges", "properties", "leases"]) {
        const r = await list(c, e, { size: 100 });
        out.push(r.total, r.counts, r.footer, r.rows.map((x) => JSON.stringify(x)));
        out.push(await getRow(c, e, r.rows[0]?.id as string));
      }
      return out;
    };
    // An empty overlay (fast path everywhere) matches no workspace at all.
    expect(await snap(WS)).toEqual(await snap(null));
    // Overlay rows in one table switch only that table to the full path; edits show through it.
    await updateRecord(await wctx("daniel"), "units", "p01-u3", { sqft: 999 });
    const c = await ctx("daniel", WS);
    expect((await getRow(c, "units", "p01-u3"))!.sqft).toBe(999);
    expect((await getRow(c, "properties", "p01"))!.units).toBe(3);
    // Tables the overlay doesn't touch read exactly as base.
    expect(await list(c, "charges", { size: 100 })).toEqual(await list(await ctx("daniel", null), "charges", { size: 100 }));
    // A tombstone in the overlay hides the base row (and its label on rows that point at it).
    await deleteRecord(await wctx("daniel"), "properties", "p06");
    const after = await ctx("daniel", WS);
    expect((await list(after, "properties", {})).total).toBe(5);
    expect((await getRow(after, "charges", "c-p06-u1"))!.property_id__label).toBeNull();
  });

  it("reuses base aggregates across requests until the visitor's overlay touches the table", async () => {
    const first = await list(await ctx("grace", WS), "charges", { size: 1 });
    // A second request (new actor) is served the cached total, tabs and footer.
    const again = await list(await ctx("grace", WS), "charges", { size: 1 });
    expect([again.total, again.counts, again.footer]).toEqual([first.total, first.counts, first.footer]);
    // Overlay rows in a table the def reads switch to live aggregates.
    await db.prepare(`INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents) VALUES ('${WS}', 'c-live', 'l-p01-u1', 'h-p01-u1', 'p01', 'p01-u1', 'gl-4000', 'Late fee', '2026-10', '2026-10-05', 5000)`).run();
    const live = await list(await ctx("grace", WS), "charges", { size: 1 });
    expect(live.total).toBe(first.total + 1);
    expect(live.footer!["sum:amount"]).toBe((first.footer!["sum:amount"] as number) + 50);
    // Another visitor with no overlay still gets the base figures.
    expect((await list(await ctx("grace", OTHER), "charges", { size: 1 })).total).toBe(first.total);
  });

  it("drops the per-request overlay cache after a write in the same request", async () => {
    const w = await wctx("marcus");
    expect((await getRow(w, "units", "p01-u2"))!.sqft).toBe(800); // caches "no overlay rows"
    await updateRecord(w, "units", "p01-u2", { sqft: 812 });
    expect((await getRow(w, "units", "p01-u2"))!.sqft).toBe(812);
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

describe("select all matching", () => {
  it("resolves every id under the list's filters, in list order", async () => {
    const c = await ctx("daniel");
    const q = parseListQuery(new URLSearchParams("f.status=Vacant&sort=number"));
    const listed = (await list(c, "units", { ...q, size: 100 })).rows.map((r) => r.id);
    expect(await matchingIds(c, "units", q)).toEqual({ ids: listed, capped: false });
    expect(listed).toHaveLength(6);
  });

  it("stays inside the persona's scope", async () => {
    const out = await matchingIds(await ctx("marcus"), "units", {});
    expect(out.ids).toHaveLength(9);
    expect(out.ids.every((id) => /^p0[123]-/.test(id))).toBe(true);
  });

  it("stops at the cap and says so", async () => {
    const c = await ctx("daniel");
    expect(await matchingIds(c, "units", {}, 5)).toMatchObject({ capped: true });
    expect((await matchingIds(c, "units", {}, 5)).ids).toHaveLength(5);
    expect((await matchingIds(c, "units", {}, 18)).capped).toBe(false);
    // Pages past the 100-row page cap with keyset cursors.
    expect((await matchingIds(c, "units", { size: 7 } as never, 13)).ids).toHaveLength(13);
  });

  it("applies a built-in view named in the URL unless the URL has its own filters", () => {
    const wo = getEntity("work_orders")!;
    expect(withView(wo, new URLSearchParams("view=awaiting-approval")).get("f.status")).toBe("Submitted");
    expect(withView(wo, new URLSearchParams("view=awaiting-approval&f.priority=Low")).get("f.status")).toBeNull();
  });

  it("refuses an entity the role can't read", async () => {
    await expect(matchingIds(await ctx("vendor"), "owners", {})).rejects.toMatchObject({ status: 403 });
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

  it("names a unit whose property id has the wrong case, for an org-wide actor, and sorts it with its property", async () => {
    await db.prepare("UPDATE units SET property_id = 'P01' WHERE id = 'p01-u2'").run();
    const res = await list(await ctx("daniel"), "units", { size: 100 });
    const bad = res.rows.find((r) => r.id === "p01-u2")!;
    expect(bad).toMatchObject({ property_id: "P01", property_id__label: "The Lofts at Riverside", label: "The Lofts at Riverside #102" });
    const lofts = res.rows.filter((r) => String(r.label).startsWith("The Lofts")).map((r) => r.id);
    expect(lofts).toEqual(["p01-u1", "p01-u2", "p01-u3"]);
    expect(res.rows.every((r) => r.label != null)).toBe(true);
  });

  it("shows a unit's current lease only while it runs and the unit isn't vacant", async () => {
    // p01-u1: lease still "Active" but ended before as_of (2026-10-28). p01-u2: lease runs, unit marked Vacant.
    await db.prepare("UPDATE leases SET end_on = '2026-09-30' WHERE id = 'l-p01-u1'").run();
    await db.prepare("UPDATE units SET status = 'Vacant' WHERE id = 'p01-u2'").run();
    const c = await ctx("daniel");
    for (const id of ["p01-u1", "p01-u2"]) expect(await getRow(c, "units", id)).toMatchObject({ rent: null, resident: null, lease_end: null });
    expect(await getRow(c, "units", "p02-u1")).toMatchObject({ rent: 1450, resident: "Household p02-u1", lease_end: "2026-12-31" });
  });

  it("names who filed and uploaded a document: a person by name, an agent by its agent name", async () => {
    await db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 'lena', 'org1', 'Lena Ortiz', 'Leasing agent', 'lena@x.example')").run();
    await db.prepare("INSERT INTO documents (workspace_id, id, property_id, name, url, uploaded_at, classified_by, uploaded_by) VALUES ('base', 'doc-1', 'p01', 'Lease', '/docs/leases/L-1', '2026-10-01T00:00:00Z', 'document_classifier', 'lena'), ('base', 'doc-2', 'p01', 'Bill', '/x', '2026-10-01T00:00:00Z', 'lena', 'ap')").run();
    const rows = (await list(await ctx("daniel"), "documents", {})).rows;
    expect(rows.find((r) => r.id === "doc-1")).toMatchObject({ classified_by: "Document Classifier Agent", uploaded_by: "Lena Ortiz" });
    expect(rows.find((r) => r.id === "doc-2")).toMatchObject({ classified_by: "Lena Ortiz", uploaded_by: "Payables Agent" });
  });

  it("names a vendor or applicant who uploaded a document", async () => {
    await db.prepare("INSERT INTO vendors (workspace_id, id, company, trade, bank_last4, tin_last4) VALUES ('base', 'v9', 'Lone Star Plumbing', 'Plumbing', '1111', '2222')").run();
    await db.prepare("INSERT INTO applicants (workspace_id, id, first_name, last_name, email, created_at) VALUES ('base', 'apl-0001', 'Ana', 'Ruiz', 'ana@x.example', '2026-10-01T00:00:00Z')").run();
    await db.prepare("INSERT INTO documents (workspace_id, id, property_id, name, url, uploaded_at, classified_by, uploaded_by) VALUES ('base', 'doc-v', 'p01', 'COI', '/x', '2026-10-01T00:00:00Z', 'v9', 'v9'), ('base', 'doc-a', 'p01', 'Pay stub', '/y', '2026-10-01T00:00:00Z', 'apl-0001', 'apl-0001')").run();
    const rows = (await list(await ctx("daniel"), "documents", {})).rows;
    expect(rows.find((r) => r.id === "doc-v")).toMatchObject({ classified_by: "Lone Star Plumbing", uploaded_by: "Lone Star Plumbing" });
    expect(rows.find((r) => r.id === "doc-a")).toMatchObject({ classified_by: "Ana Ruiz", uploaded_by: "Ana Ruiz" });
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
    const csv = await new Response(await exportCsv(await ctx("daniel"), "properties", {})).text();
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
    const docs = writeSchema(allEntities().find((d) => d.key === "documents")!, "property_manager", "create");
    expect(docs.safeParse({ name: "x", url: "javascript:alert(1)" }).success).toBe(false);
    expect(docs.safeParse({ name: "x", url: "//evil.example/x" }).success).toBe(false);
    expect(docs.safeParse({ name: "x", url: "/docs/lease.pdf" }).success).toBe(true);
    const vendors = allEntities().find((d) => d.key === "vendors")!;
    // Bank details change only through the verified vendors.change_bank_account action, never a generic write.
    expect(writeSchema(vendors, "property_manager", "create").safeParse({ company: "X", trade: "HVAC", bank_last4: "1234" }).success).toBe(false);
    expect(writeSchema(vendors, "accountant", "create").safeParse({ company: "X", trade: "HVAC", bank_last4: "1234" }).success).toBe(false);
    expect(writeSchema(allEntities().find((d) => d.key === "units")!, "property_manager", "update").safeParse({ property_id: "p02" }).success).toBe(false); // set once
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

  it("keeps fields hidden from a role out of the audit shown in a record's activity", async () => {
    await db.prepare("INSERT INTO vendors (workspace_id, id, company, trade, bank_last4, tin_last4) VALUES ('base', 'v9', 'Lone Star Plumbing', 'Plumbing', '1111', '2222')").run();
    await db.prepare(`INSERT INTO audit (workspace_id, id, at, actor, action, entity_type, entity_id, detail, before_json, after_json) VALUES ('${WS}', 'a1', '2026-10-28T10:00:00Z', 'Grace Kim', 'vendors.updated', 'vendors', 'v9', 'Updated bank', '{"bank_last4":"1111","phone":"1"}', '{"bank_last4":"9999","phone":"2"}')`).run();
    const { collab } = await import("./query");
    const rows = (await collab(await ctx("tom", WS), "activity", "vendors", "v9")).rows;
    const audit = rows.find((r) => r.verb === "vendors.updated")!;
    expect(String(audit.data)).not.toContain("9999");
    expect(String(audit.data)).not.toContain("1111");
    expect(String((await collab(await ctx("grace", WS), "activity", "vendors", "v9")).rows.find((r) => r.verb === "vendors.updated")!.data)).toContain("9999");
    expect(String(audit.data)).toContain('"phone":"2"');
  });

  it("gives portal users no staff notes, activity or tasks on their own records", async () => {
    const { collab } = await import("./query");
    const at = "2026-10-28T10:00:00Z";
    await db.batch([
      db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'h-p01-u1', 'p01', 'Jordan', 'Lee', 'j@x.example')"),
      db.prepare("INSERT INTO vendors (workspace_id, id, company, trade) VALUES ('base', 'v01', 'Lone Star Plumbing', 'Plumbing')"),
      db.prepare(`INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at) VALUES ('base', 'WO-7', 'p01', 'Leak', 'Plumbing', 'Normal', 'Assigned', 'v01', '${at}')`),
      ...[["charges", "c-p01-u1"], ["properties", "p01"], ["work_orders", "WO-7"]].flatMap(([t, id]) => [
        db.prepare(`INSERT INTO notes (workspace_id, id, entity_type, entity_id, author_id, body, created_at) VALUES ('base', 'n-${id}', '${t}', '${id}', 'marcus', 'Staff only: payment plan likely', '${at}')`),
        db.prepare(`INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, at, actor_kind, actor_id, verb, summary) VALUES ('base', 'ae-${id}', '${t}', '${id}', '${at}', 'staff', 'marcus', 'commented', 'Marcus added a note')`),
        db.prepare(`INSERT INTO tasks (workspace_id, id, title, entity_type, entity_id, created_at) VALUES ('base', 't-${id}', 'Call about collections', '${t}', '${id}', '${at}')`),
        db.prepare(`INSERT INTO audit (workspace_id, id, at, actor, action, entity_type, entity_id, detail) VALUES ('base', 'au-${id}', '${at}', 'Marcus Bell', '${t}.updated', '${t}', '${id}', 'Internal change')`),
      ]),
    ]);
    for (const [persona, entity, id] of [["resident", "charges", "c-p01-u1"], ["owner", "properties", "p01"], ["vendor", "work_orders", "WO-7"]]) {
      const c = await ctx(persona);
      expect(await getRow(c, entity, id)).not.toBeNull();
      for (const kind of ["notes", "activity", "tasks"] as const) await expect(collab(c, kind, entity, id)).rejects.toMatchObject({ status: 403 });
    }
    // Staff still see them.
    for (const kind of ["notes", "activity", "tasks"] as const) expect((await collab(await ctx("marcus"), kind, "charges", "c-p01-u1")).rows.length).toBeGreaterThan(0);
  });

  it("writes only the changed columns and refuses an edit when the record changed or locked after it was read", async () => {
    await db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', 'WO-8', 'p01', 'Leak', 'Plumbing', 'Normal', 'Assigned', '2026-10-28T10:00:00Z')").run();
    await updateRecord(await wctx("marcus"), "work_orders", "WO-8", { description: "Under the sink" });
    // Another request's write lands between this edit's read and its write batch.
    const racing = (sql: string): Db => {
      let fired = false;
      return { prepare: (q) => db.prepare(q), batch: async (stmts) => {
        if (!fired && stmts.length >= 4) { fired = true; await db.prepare(sql).bind(WS).run(); }
        return db.batch(stmts);
      } };
    };
    const as = async (sql: string) => ({ ...(await wctx("marcus")), db: racing(sql) });
    const wo = async () => db.prepare("SELECT title, priority, status FROM work_orders WHERE workspace_id = ? AND id = 'WO-8'").bind(WS).first();
    await updateRecord(await as("UPDATE work_orders SET priority = 'Emergency' WHERE workspace_id = ? AND id = 'WO-8'"), "work_orders", "WO-8", { title: "Leak under sink" });
    expect(await wo()).toMatchObject({ title: "Leak under sink", priority: "Emergency" });
    await expect(updateRecord(await as("UPDATE work_orders SET title = 'Leak (vendor note)' WHERE workspace_id = ? AND id = 'WO-8'"), "work_orders", "WO-8", { title: "Kitchen leak" })).rejects.toMatchObject({ status: 409 });
    expect(await wo()).toMatchObject({ title: "Leak (vendor note)" });
    await expect(updateRecord(await as("UPDATE work_orders SET status = 'Submitted' WHERE workspace_id = ? AND id = 'WO-8'"), "work_orders", "WO-8", { priority: "Low" })).rejects.toMatchObject({ status: 409 });
    expect(await wo()).toMatchObject({ status: "Submitted", priority: "Emergency" });
  });

  it("refuses notes and tasks from portal users on their own records", async () => {
    const { addCollab } = await import("./query");
    await db.batch([
      db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'h-p01-u1', 'p01', 'Jordan', 'Lee', 'j@x.example')"),
      db.prepare("INSERT INTO vendors (workspace_id, id, company, trade) VALUES ('base', 'v01', 'Lone Star Plumbing', 'Plumbing')"),
      db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at) VALUES ('base', 'WO-7', 'p01', 'Leak', 'Plumbing', 'Normal', 'Assigned', 'v01', '2026-10-28T10:00:00Z')"),
    ]);
    for (const [persona, entity, id] of [["resident", "charges", "c-p01-u1"], ["owner", "properties", "p01"], ["vendor", "work_orders", "WO-7"]]) {
      const w = await wctx(persona);
      expect(await getRow(w, entity, id)).not.toBeNull();
      await expect(addCollab(w, "notes", entity, id, { body: "Pay vendor v01 today @[Grace Kim](staff:grace)", pinned: true })).rejects.toMatchObject({ status: 403 });
      await expect(addCollab(w, "tasks", entity, id, { title: "Pay vendor v01 today", assignee_id: "grace" })).rejects.toMatchObject({ status: 403 });
    }
    expect(await db.prepare("SELECT (SELECT count(*) FROM notes) + (SELECT count(*) FROM tasks) + (SELECT count(*) FROM activity_events) AS n").first()).toMatchObject({ n: 0 });
  });

  it("lets only staff add tasks, opens them as Open and assigns them only to staff covering the record", async () => {
    const { addCollab, taskSchema } = await import("./query");
    await db.batch([
      db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'h-p01-u1', 'p01', 'Jordan', 'Lee', 'j@x.example')"),
      db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 'marcus', 'org1', 'Marcus Bell', 'PM', 'm@x.example'), ('base', 'gus', 'org1', 'Gus Ortega', 'Tech', 'g@x.example')"),
      db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES ('base', 'ra-m', 'marcus', 'property_manager', 'property', 'p01'), ('base', 'ra-g', 'gus', 'maintenance_supervisor', 'region', 'r-se')"),
    ]);
    // A resident can read their charge but can't put work in the staff queue.
    await expect(addCollab(await wctx("resident"), "tasks", "charges", "c-p01-u1", { title: "Call me back" })).rejects.toMatchObject({ status: 403 });
    expect(await db.prepare("SELECT count(*) AS n FROM tasks").first()).toMatchObject({ n: 0 });
    // Created tasks start Open; the body can't set the status.
    expect(taskSchema.safeParse({ title: "Chase", status: "Done" }).success).toBe(false);
    const m = await wctx("marcus");
    await expect(addCollab(m, "tasks", "charges", "c-p01-u1", { title: "Chase", assignee_id: "nobody" })).rejects.toMatchObject({ status: 400 });
    await expect(addCollab(m, "tasks", "charges", "c-p01-u1", { title: "Chase", assignee_id: "gus" })).rejects.toMatchObject({ status: 400 });
    expect(await addCollab(m, "tasks", "charges", "c-p01-u1", { title: "Chase", assignee_id: "marcus" })).toMatchObject({ status: "Open", assignee_id: "marcus" });
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
    await expect(createRecord(await wctx("marcus"), "units", { number: "998", property_id: "p05", sqft: 700 })).rejects.toMatchObject({ status: 400 });
    expect((await db.prepare("SELECT count(*) AS n FROM units WHERE number = '998'").first())!.n).toBe(0);
  });

  it("refuses a portal user's create that falls outside their own records", async () => {
    await expect(createRecord(await wctx("resident"), "work_orders", { title: "Leak", category: "Plumbing", priority: "Normal", status: "New", property_id: "p05", opened_at: "2026-10-28T10:00:00Z" })).rejects.toMatchObject({ status: 403 });
    expect((await db.prepare("SELECT count(*) AS n FROM work_orders").first())!.n).toBe(0);
  });

  it("refuses references to records outside the actor's scope, on create and update", async () => {
    await expect(createRecord(await wctx("marcus"), "work_orders", { title: "Leak", category: "Plumbing", priority: "Normal", status: "New", property_id: "p01", unit_id: "p05-u1", opened_at: "2026-10-28T10:00:00Z" })).rejects.toMatchObject({ status: 400 });
    await expect(updateRecord(await wctx("marcus"), "residents", "res-p01-u1", { household_id: "h-p05-u1" })).rejects.toMatchObject({ status: 400 });
    await expect(createRecord(await wctx("marcus"), "units", { number: "77", property_id: "p02", sqft: 700, status: "Vacant", unit_type_id: "nope" })).rejects.toMatchObject({ status: 400 });
    const ok = await createRecord(await wctx("marcus"), "work_orders", { title: "Leak", category: "Plumbing", priority: "Normal", status: "New", property_id: "p01", unit_id: "p01-u1", opened_at: "2026-10-28T10:00:00Z" });
    expect(ok.unit_id).toBe("p01-u1");
  });

  it("writes nothing when a create or edit lands outside scope", async () => {
    // A field that moves scope without being a reference, so only the in-batch guard can catch it.
    const units = getEntity("units")!;
    registerEntity({ ...units, fields: { ...units.fields, property_id: { type: "text", label: "Property" } } });
    try {
      const snap = async () => [await db.prepare("SELECT * FROM units WHERE workspace_id <> 'base' ORDER BY id").all(), await db.prepare("SELECT count(*) AS n FROM audit").first(), await db.prepare("SELECT count(*) AS n FROM events").first()];
      const before = await snap();
      await expect(updateRecord(await wctx("marcus"), "units", "p01-u3", { property_id: "p05" })).rejects.toMatchObject({ status: 403 });
      await expect(createRecord(await wctx("marcus"), "units", { number: "88", property_id: "p05", sqft: 700, status: "Vacant" })).rejects.toMatchObject({ status: 403 });
      expect(await snap()).toEqual(before);
      // An in-scope edit after a refused one still works.
      expect((await updateRecord(await wctx("marcus"), "units", "p01-u3", { property_id: "p02" })).property_id).toBe("p02");
    } finally {
      registerEntity(units);
    }
  });

  it("lets only actions set system fields; create takes their initial values", async () => {
    const units = getEntity("units")!;
    registerEntity({ ...units, fields: { ...units.fields, status: { ...units.fields.status, system: true, initial: ["Vacant", "Make-ready"] } } });
    try {
      const def = getEntity("units")!;
      expect(writeSchema(def, "property_manager", "update").safeParse({ status: "Occupied" }).success).toBe(false);
      expect(writeSchema(def, "property_manager", "create").safeParse({ number: "1", property_id: "p01", status: "Occupied" }).success).toBe(false);
      expect(writeSchema(def, "property_manager", "create").safeParse({ number: "1", property_id: "p01", status: "Make-ready" }).success).toBe(true);
      // The query layer enforces it too, for callers that skip the HTTP schema.
      await expect(updateRecord(await wctx("marcus"), "units", "p01-u3", { status: "Occupied" })).rejects.toMatchObject({ status: 400 });
      await expect(createRecord(await wctx("marcus"), "units", { number: "90", property_id: "p02", sqft: 1, status: "Occupied" })).rejects.toMatchObject({ status: 400 });
      expect((await createRecord(await wctx("marcus"), "units", { number: "91", property_id: "p02", sqft: 1 })).status).toBe("Vacant");
    } finally {
      registerEntity(units);
    }
  });

  it("refuses generic edits and deletes once lockedWhen applies", async () => {
    const units = getEntity("units")!;
    registerEntity({ ...units, lockedWhen: { field: "status", in: ["Occupied"], fields: ["market_rent"] } });
    try {
      await expect(updateRecord(await wctx("marcus"), "units", "p01-u1", { market_rent: 1 })).rejects.toMatchObject({ status: 409 });
      expect((await updateRecord(await wctx("marcus"), "units", "p01-u1", { sqft: 900 })).sqft).toBe(900);
      expect((await updateRecord(await wctx("marcus"), "units", "p01-u3", { market_rent: 1 })).market_rent).toBe(1); // Vacant: not locked
      await expect(deleteRecord(await wctx("priya"), "units", "p01-u1")).rejects.toMatchObject({ status: 409 });
    } finally {
      registerEntity(units);
    }
  });

  it("locks finished leases, approved bills, sent offers and settled concessions against generic edits", async () => {
    await db.prepare("UPDATE leases SET status = 'Terminated' WHERE id = 'l-p01-u1'").run();
    await expect(updateRecord(await wctx("marcus"), "leases", "l-p01-u1", { rent: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await updateRecord(await wctx("marcus"), "leases", "l-p01-u2", { rent: 1500 })).rent).toBe(1500);
    for (const [e, states] of [["bills", ["Approved", "Paid"]], ["renewal_offers", ["Sent", "Accepted"]], ["concessions", ["Active"]]] as const) {
      const lock = getEntity(e)?.lockedWhen;
      expect(lock?.field, e).toBe("status");
      for (const st of states) expect(lock!.in, e).toContain(st);
    }
  });

  it("emits a def's domain events and uses its id format", async () => {
    const wo = getEntity("work_orders")!;
    registerEntity({ ...wo, events: { created: "wo.created" }, idFormat: { prefix: "WO", digits: 5 } });
    try {
      const row = await createRecord(await wctx("marcus"), "work_orders", { title: "Leak", category: "Plumbing", priority: "Urgent", property_id: "p01", opened_at: "2026-10-28T10:00:00Z" });
      expect(String(row.id)).toMatch(/^WO-\d{5}$/);
      const types = (await db.prepare("SELECT type FROM events WHERE entity_id = ? ORDER BY type").bind(row.id).all()).results.map((r) => r.type);
      expect(types).toEqual(["wo.created", "work_orders.created"]);
      await updateRecord(await wctx("marcus"), "work_orders", String(row.id), { title: "Leak under sink" });
      expect((await db.prepare("SELECT count(*) AS n FROM events WHERE entity_id = ? AND type = 'wo.created'").bind(row.id).first())!.n).toBe(1);
    } finally {
      registerEntity(wo);
    }
  });

  it("never reuses a base id for a formatted id", async () => {
    const u = getEntity("units")!;
    // Two-digit ids from 10 to 99: fill all but one in base, so the generator must find it.
    const stmts = [];
    for (let n = 10; n <= 99; n++) if (n !== 57) stmts.push(db.prepare("INSERT INTO units (workspace_id, id, property_id, number) VALUES ('base', ?, 'p01', ?)").bind(`U-${n}`, `x${n}`));
    await db.batch(stmts);
    registerEntity({ ...u, idFormat: { prefix: "U", digits: 2 } });
    try {
      const ids = new Set<string>();
      for (let i = 0; i < 3; i++) ids.add(String((await createRecord(await wctx("marcus"), "units", { number: `n${i}`, property_id: "p02", sqft: 1 })).id));
      for (const id of ids) expect(id === "U-57" || !id.startsWith("U-")).toBe(true);
    } finally {
      registerEntity(u);
    }
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
    await expect(metrics(await ctx("vendor"), "portfolio.noi")).rejects.toMatchObject({ status: 403 });
    await expect(metrics(await ctx("resident"), "portfolio.noi")).rejects.toMatchObject({ status: 403 });
    expect((await metrics(await ctx("owner"), "portfolio.noi")).value).toBe(950 * 4);
    const byProp = await metrics(await ctx("priya"), "portfolio.by_property");
    expect(byProp.points).toHaveLength(4);
  });

  it("serves a metric only to roles with access to its module", async () => {
    await import("@/extensions");
    // A leasing agent has no payables, accounting or receivables access; an owner has no payables.
    for (const key of ["payables.open_ap", "accounting.income_expense", "accounting.trust_cash", "accounting.cash_forecast", "receivables.aging_by_property"])
      await expect(metrics(await ctx("lena"), key)).rejects.toMatchObject({ status: 403 });
    for (const key of ["payables.open_ap", "payables.aging"]) await expect(metrics(await ctx("owner"), key)).rejects.toMatchObject({ status: 403 });
    // Access they do have still works.
    await expect(metrics(await ctx("lena"), "portfolio.noi")).resolves.toBeTruthy();
    await expect(metrics(await ctx("owner"), "owners.distributions")).resolves.toBeTruthy();
    await expect(metrics(await ctx("grace"), "payables.open_ap")).resolves.toBeTruthy();
    // "Explain this number" uses the same module rule.
    const { canReadModuleOf } = await import("./query");
    expect(canReadModuleOf("leasing_agent", "receivables.collections_rate")).toBe(false);
    expect(canReadModuleOf("leasing_agent", "portfolio.noi")).toBe(true);
  });

  it("adds the visitor's live payments to the current month", async () => {
    await db.prepare(`INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, method, received_on, amount_cents) VALUES ('${WS}', 'pay-live', 'l-p01-u2', 'h-p01-u2', 'p01', 'c-p01-u2', 'ACH', '2026-10-28', 145000)`).run();
    const before = await metrics(await ctx("marcus", null), "receivables.collections_rate", { month: "2026-10" });
    const after = await metrics(await ctx("marcus", WS), "receivables.collections_rate", { month: "2026-10" });
    expect(after.points.at(-1)!.collected).toBe(Number(before.points.at(-1)!.collected) + 1450);
  });

  it("counts a live payment toward the month of the charge it pays, and never reads above 100%", async () => {
    // Paying down a September charge in October is not October collection.
    await db.batch([
      db.prepare(`INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents, paid_cents) VALUES ('${WS}', 'c-old', 'l-p01-u2', 'h-p01-u2', 'p01', 'p01-u2', 'gl-4000', 'Rent', '2026-09', '2026-09-01', 900000, 900000)`),
      db.prepare(`INSERT INTO payments (workspace_id, id, lease_id, household_id, property_id, charge_id, method, received_on, amount_cents) VALUES ('${WS}', 'pay-old', 'l-p01-u2', 'h-p01-u2', 'p01', 'c-old', 'ACH', '2026-10-29', 900000)`),
    ]);
    const before = await metrics(await ctx("marcus", null), "receivables.collections_rate", { month: "2026-10" });
    const after = await metrics(await ctx("marcus", WS), "receivables.collections_rate", { month: "2026-10" });
    expect(after.points.at(-1)!.collected).toBe(before.points.at(-1)!.collected);
    expect(after.value).toBe(before.value);
    expect(after.value).toBeLessThanOrEqual(1);
  });
});

describe("facets", () => {
  it("counts facet values under the other filters and the scope", async () => {
    const { facetOptions } = await import("./query");
    const f = await facetOptions(await ctx("priya"), "properties", { filters: { metro: "Austin" } });
    expect(f.region_id).toEqual([{ value: "r-tx", label: undefined, count: 3 }]);
    const units = await facetOptions(await ctx("daniel"), "units", { filters: { property_id: "p01" } });
    expect(units.property_id.find((o) => o.value === "p05")).toMatchObject({ label: "Inman Park Flats", count: 3 });
  });
});
