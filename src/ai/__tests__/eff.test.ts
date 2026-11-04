import { describe, expect, it } from "vitest";
import { eff } from "../data";
import { openFixture, WS } from "./fixture";

// AI reads see the visitor's effective rows: overlay rows replace base rows with the same id,
// a tombstone hides its base row, and rows that exist only in the overlay show up.
describe("eff() overlay reads", () => {
  it("hides a tombstoned base row, replaces an edited one and adds an overlay-only row", async () => {
    const { raw, db } = openFixture();
    const cols = "workspace_id, id, household_id, property_id, first_name, last_name, email";
    raw.prepare(`INSERT INTO residents (${cols}, deleted) VALUES (?, 'r1', 'h1', 'p01', 'Jordan', 'Lee', 'jordan@lee.example', 1)`).run(WS);
    raw.prepare(`INSERT INTO residents (${cols}) VALUES (?, 'r2', 'h2', 'p01', 'Ana', 'Ruiz-Diaz', 'ana@ruiz.example')`).run(WS);
    raw.prepare(`INSERT INTO residents (${cols}) VALUES (?, 'r-new', 'h2', 'p01', 'Sam', 'Ruiz', 'sam@ruiz.example')`).run(WS);
    const base = (await db.prepare("SELECT id FROM residents WHERE workspace_id = 'base' ORDER BY id").all<{ id: string }>()).results.map((r) => r.id);

    const e = eff("residents", WS);
    const rows = (await db.prepare(`SELECT id, last_name, workspace_id FROM ${e.sql} t ORDER BY id`).bind(...e.params).all<{ id: string; last_name: string; workspace_id: string }>()).results;
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("r1");
    expect(ids).toContain("r-new");
    expect(ids.filter((id) => id === "r2")).toHaveLength(1);
    expect(rows.find((r) => r.id === "r2")).toMatchObject({ last_name: "Ruiz-Diaz", workspace_id: WS });
    expect(ids.sort()).toEqual([...base.filter((id) => id !== "r1"), "r-new"].sort());

    // Joined on id (the shape the rewrite is for), a tombstone still hides the row.
    const j = (await db.prepare(`SELECT r.id FROM ${e.sql} r JOIN residents h ON h.workspace_id = 'base' AND h.id = r.id WHERE r.id IN ('r1', 'r2')`).bind(...e.params).all<{ id: string }>()).results;
    expect(j.map((r) => r.id)).toEqual(["r2"]);

    // Another workspace (and the base itself) still sees the base rows.
    const other = eff("residents", "another-workspace-0000000001");
    const seen = (await db.prepare(`SELECT id FROM ${other.sql} t ORDER BY id`).bind(...other.params).all<{ id: string }>()).results.map((r) => r.id);
    expect(seen).toEqual(base);
    const b = eff("residents", "base");
    expect((await db.prepare(`SELECT id FROM ${b.sql} t ORDER BY id`).bind(...b.params).all<{ id: string }>()).results.map((r) => r.id)).toEqual(base);
  });
});
