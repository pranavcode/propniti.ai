import { beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { seed, WS } from "@/server/query.fixture";
import * as importRoute from "../route";
import * as undoRoute from "../undo/route";
import * as aiRoute from "../ai/route";

// The import routes over HTTP on a fresh in-memory database (no model configured: AI answers "Rules").
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const host = "propniti.test";
const post = (path: string, body: unknown, opts: { persona?: string; origin?: string | null } = {}) => {
  const headers = new Headers({ host, cookie: `pn_as=${opts.persona ?? "daniel"}; pn_ws=${WS}`, "content-type": "application/json" });
  if (opts.origin !== null) headers.set("origin", opts.origin ?? `http://${host}`);
  return new Request(`http://${host}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
};
const src = { file: "f1", line: 2 };
const payload = {
  properties: [{ key: "the lofts at riverside", name: "The Lofts at Riverside", street: "", city: "", state: "", zip: "", src }],
  units: [{ property: "the lofts at riverside", number: "104", sqft: 700, marketRent: 1500, status: "Occupied", src }],
  residents: [], owners: [], vendors: [], balances: [], recurring: [],
  leases: [{ property: "the lofts at riverside", unit: "104", people: [{ first: "Dee", last: "Ford", email: "dee@example.com" }], start: "2026-05-01", end: "2027-04-30", rent: 1500, status: "Active", src }],
};
const options = { tool: "appfolio", reports: ["Rent Roll"], files: ["roll.csv"] };

beforeAll(async () => {
  const db = getPlatform().db;
  await seed(db);
  await db.prepare("INSERT INTO regions (workspace_id, id, org_id, name, states) VALUES ('base', 'r-tx', 'org1', 'Texas', '[\"TX\"]')").run();
});

describe("POST /api/import", () => {
  it("refuses other sites, portal personas and bad bodies", async () => {
    expect((await importRoute.POST(post("/api/import", { mode: "preview", payload, options }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await importRoute.POST(post("/api/import", { mode: "preview", payload, options }, { persona: "resident" }))).status).toBe(403);
    expect((await importRoute.POST(post("/api/import", { mode: "commit", payload: { ...payload, units: "x" }, options }))).status).toBe(400);
  });

  it("previews without writing, then commits once: a double click gets [200, 409]", async () => {
    const preview = await importRoute.POST(post("/api/import", { mode: "preview", payload, options }));
    expect(preview.status).toBe(200);
    const p = await preview.json();
    expect(p.summary.units).toEqual({ new: 1, existing: 0, skipped: 0 });
    expect(p).not.toHaveProperty("rows");
    const statuses = (await Promise.all([1, 2].map(() => importRoute.POST(post("/api/import", { mode: "commit", payload, options }))))).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const db = getPlatform().db;
    expect((await db.prepare("SELECT count(*) AS n FROM units WHERE workspace_id = ? AND number = '104'").bind(WS).first<{ n: number }>())!.n).toBe(1);
    const batch = (await db.prepare("SELECT entity_id FROM audit WHERE workspace_id = ? AND action = 'import.completed'").bind(WS).first<{ entity_id: string }>())!.entity_id;

    expect((await undoRoute.POST(post("/api/import/undo", { batch }, { persona: "lena" }))).status).toBe(403);
    const undone = await Promise.all([1, 2].map(() => undoRoute.POST(post("/api/import/undo", { batch }))));
    expect(undone.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.prepare("SELECT count(*) AS n FROM units WHERE workspace_id = ? AND number = '104'").bind(WS).first<{ n: number }>())!.n).toBe(0);
  });
});

describe("POST /api/import/ai", () => {
  it("falls back to rules when no model is configured, and caps what it accepts", async () => {
    const body = { files: [{ id: "f1", kind: "rent_roll", headers: ["Property", "Unit", "Notes"], unmapped: [2], mapped: { property: 0, unit: 1 }, samples: [{ line: 2, cells: ["A", "1", "x"] }], flagged: [] }] };
    const res = await aiRoute.POST(post("/api/import/ai", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ live: false, source: "Rules", suggestions: [] });
    const tooMany = { files: [{ ...body.files[0], samples: Array.from({ length: 6 }, (_, i) => ({ line: i + 2, cells: ["A", "1", "x"] })) }] };
    expect((await aiRoute.POST(post("/api/import/ai", tooMany))).status).toBe(400);
    const longCell = { files: [{ ...body.files[0], samples: [{ line: 2, cells: ["A".repeat(61), "1", "x"] }] }] };
    expect((await aiRoute.POST(post("/api/import/ai", longCell))).status).toBe(400);
  });
});
