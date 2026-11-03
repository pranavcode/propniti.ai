import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "@/lib/platform/sqlite";

// 0002_v2 replaces the 0001 domain. These checks hold the schema to the conventions in its header.

const open = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  return raw;
};
const tables = (raw: DatabaseSync) =>
  raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('d1_migrations', 'sqlite_sequence') ORDER BY name").all().map((r) => String(r.name));
const columns = (raw: DatabaseSync, t: string) => raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; pk: number }[];

describe("0002_v2 migration", () => {
  it("applies on top of 0001 holding legacy rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    copyFileSync("migrations/0001_init.sql", join(dir, "0001_init.sql"));
    const raw = open();
    applyMigrations(raw, dir);
    raw.exec(`INSERT INTO workspaces (id, created_at, last_seen_at) VALUES ('w1', 0, 0);
      INSERT INTO users (workspace_id, id, name, role, channel) VALUES ('w1', 'u1', 'A', 'Owner', 'Email');
      INSERT INTO properties (workspace_id, id, name, address, type, units, occupied, owner_id) VALUES ('w1', 'p1', 'P', 'X', 'Residential', 1, 1, 'u1');`);
    copyFileSync("migrations/0002_v2.sql", join(dir, "0002_v2.sql"));
    applyMigrations(raw, dir);
    expect(raw.prepare("SELECT count(*) AS n FROM d1_migrations").get()!.n).toBe(2);
    expect(raw.prepare("SELECT count(*) AS n FROM properties").get()!.n).toBe(0);
    expect(raw.prepare("SELECT id FROM workspaces ORDER BY id").all().map((r) => r.id)).toEqual(["base", "w1"]);
    expect(tables(raw)).not.toContain("users");
  });

  it("gives every domain table workspace_id, a cascade to workspaces and integer-cent money", () => {
    const raw = open();
    applyMigrations(raw);
    const all = tables(raw);
    expect(all.length).toBeGreaterThan(90);
    for (const t of all) {
      if (t === "workspaces" || t === "meta" || t === "base_balances") continue;
      const cols = columns(raw, t);
      expect(cols.map((c) => c.name), t).toContain("workspace_id");
      const fks = raw.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string; on_delete: string }[];
      expect(fks, t).toEqual([expect.objectContaining({ table: "workspaces", on_delete: "CASCADE" })]);
      for (const c of cols) if (c.name.endsWith("_cents")) expect(c.type, `${t}.${c.name}`).toBe("INTEGER");
      if (t === "metrics_monthly") continue;
      expect(cols.find((c) => c.name === "seq")?.pk, t).toBe(1);
      // Append-only: money movements and the audit trail are never edited or hidden.
      if (t === "transfers" || t === "audit") continue;
      expect(cols.map((c) => c.name), t).toContain("deleted");
    }
  });

  it("keeps one live transfer per key and wipes only the overlay when a workspace is deleted", () => {
    const raw = open();
    applyMigrations(raw);
    raw.exec("INSERT INTO workspaces (id, created_at, last_seen_at) VALUES ('visitor-workspace-0000001', 0, 0)");
    const ins = raw.prepare(
      `INSERT INTO transfers (workspace_id, id, key, kind, bank_account_id, owner_entity_id, from_kind, from_id, from_name, to_kind, to_id, to_name, amount_cents, property_id, ref, status, created)
       VALUES (?, ?, 'rent:c1', 'Rent', 'ba1', 'oe1', 'resident', 'r1', 'R', 'trust', 'ba1', 'Trust', 100, 'p01', 'c1', ?, '2026-11-04')
       ON CONFLICT DO NOTHING`,
    );
    const ws = "visitor-workspace-0000001";
    expect(ins.run("base", "t0", "Cleared").changes).toBe(1);
    expect(ins.run(ws, "t1", "Pending").changes).toBe(1);
    expect(ins.run(ws, "t2", "Pending").changes).toBe(0);
    expect(ins.run(ws, "t3", "Returned").changes).toBe(1);
    raw.prepare("DELETE FROM workspaces WHERE id = ?").run(ws);
    expect(raw.prepare("SELECT workspace_id, id FROM transfers").all()).toEqual([{ workspace_id: "base", id: "t0" }]);
  });
});

describe("0002_v2 on D1 (Miniflare)", () => {
  it("applies after 0001", { timeout: 30_000 }, async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch: () => new Response('') }", compatibilityDate: "2026-10-28", d1Databases: { DB: "mig-db" } }));
    try {
      const db = await mf.getD1Database("DB");
      for (const f of ["0001_init.sql", "0002_v2.sql"]) {
        const sql = readFileSync(`migrations/${f}`, "utf8").replace(/--.*$/gm, "");
        await db.batch(sql.split(/;\s*\n/).filter((s) => s.trim()).map((s) => db.prepare(s)));
      }
      const { results } = await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name <> 'sqlite_sequence'").all<{ n: number }>();
      expect(results[0].n).toBeGreaterThan(90);
    } finally {
      await mf.dispose();
    }
  });
});
